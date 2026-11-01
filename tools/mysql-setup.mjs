// MySQL 준비 한 번에: 연결 확인 → 표 만들기 → SQLite(data/app.db) 그대로 복사 → 한 칸씩 대조.
//   node --env-file=.env tools/mysql-setup.mjs <단계> [옵션]
//   단계: check (연결 · 응답 시간 · 표 상태) | schema (표 · 뷰 · 커리큘럼) | copy | verify | all (= check → schema → copy → verify)
//   옵션: --from <app.db 경로> (기본 data/app.db)
//         --with-learners  학습자 기록(기기 · 풀이 · 진도 · 제보 · 리포트 …)까지 옮긴다
//         --content-only   문제 · 진단 태그 · 운영 기록만 옮긴다 (학습자 기록은 SQLite에 남음)
//         (copy · all은 둘 중 하나를 꼭 고른다)
// 접속: .env의 MYSQL_HOST · MYSQL_PORT · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE (예전 이름 DB_* 도 읽음)
//       표 만들기 권한이 없는 서버 계정이면 MYSQL_ADMIN_USER · MYSQL_ADMIN_PASSWORD (schema 단계에서만 씀)
// 지우는 명령은 없다. copy는 MySQL 표가 비어 있을 때만 하고, 번호(id)를 SQLite와 똑같이 옮긴다 (브라우저에 저장된 진도 · 책갈피가 같은 문제를 가리키게).
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2), step = argv[0] || "help";
const opt = k => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.includes("--" + k);
const E = process.env, env = (a, b, d) => E[a] || E[b] || d;
const CFG = { host: env("MYSQL_HOST", "DB_HOST", "127.0.0.1"), port: +env("MYSQL_PORT", "DB_PORT", 3306), user: env("MYSQL_USER", "DB_USER"),
  password: env("MYSQL_PASSWORD", "DB_PASSWORD", ""), database: env("MYSQL_DATABASE", "DB_NAME", "problem_solving_site") };
const FROM = resolve(opt("from") || join(ROOT, "data", "app.db"));

// ───────── 표 짝: SQLite 표 → MySQL 표 (옮길 순서 = 외래 키 순서) ─────────
const PK = { semester: "semester_id", course: "course_id", chapter: "chapter_id", problem: "problem_id", problem_version: "version_id",
  report: "report_id", ai_grade: "ai_grade_id", tag_job: "job_id", device: "device_id", event: "event_id" };
const RENAME = { chapter: { key: "chapter_key" }, insight_meta: { key: "meta_key" }, ai_block: { until: "blocked_until" } };
const CONTENT = ["semester", "course", "chapter", "problem", "problem_version", "kc", "facet", "misc", "item_tag", "family", "family_member"];
const OPS = ["tag_job", "ai_budget", "ai_block", "insight_meta"];                         // 운영 기록 (사람 기록 아님)
const LEARNER = ["device", "enrollment", "progress", "resume", "transfer_code", "bookmark", "event", "report", "ai_grade", "insight"];
const ORDER = ["semester", "course", "chapter", "problem", "problem_version", "device", "enrollment", "progress", "resume", "transfer_code", "bookmark",
  "event", "report", "ai_grade", "kc", "facet", "misc", "item_tag", "family", "family_member", "insight", "tag_job", "ai_budget", "ai_block", "insight_meta"];
const SKIP = { item_first: "MySQL에서는 v_item_first 뷰가 submission에서 계산해요" };
const colMap = (t, c) => c === "id" && PK[t] ? PK[t] : RENAME[t]?.[c] || c;

const log = (...a) => console.log(...a);
const die = msg => { console.error("\n✗ " + msg); process.exit(1); };
const connect = (extra = {}) => mysql.createConnection({ ...CFG, charset: "utf8mb4_0900_ai_ci", timezone: "Z", dateStrings: true,
  supportBigNumbers: true, decimalNumbers: true, multipleStatements: true, ...extra })
  .then(async c => { await c.query("SET time_zone = '+00:00'"); return c; })
  .catch(e => die(`MySQL에 접속하지 못했어요 (${CFG.user || "?"}@${CFG.host}:${CFG.port}/${CFG.database}): ${e.code || ""} ${e.message}\n  .env의 MYSQL_HOST · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE를 확인하세요`));

// ───────── 값 바꾸기 ─────────
const pad = (n, w = 2) => String(n).padStart(w, "0");
/** 시각(ISO 글자 등) → MySQL DATETIME(3) 글자 (UTC). 못 읽으면 undefined */
function toDT(v) {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? v : Date.parse(String(v).includes("T") || /Z|[+-]\d\d:?\d\d$/.test(v) ? v : String(v).replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}
const dtMs = v => v == null ? null : Date.parse(String(v).replace(" ", "T") + (/[Z+]|-\d\d:\d\d$/.test(String(v).slice(10)) ? "" : "Z"));
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}` : JSON.stringify(v ?? null);

// ───────── 단계: check ─────────
async function check() {
  log(`\n[1] 연결 확인  ${CFG.user || "?"}@${CFG.host}:${CFG.port}/${CFG.database}`);
  if (!CFG.user) die(".env에 MYSQL_USER가 없어요");
  const c = await connect();
  const [[v]] = await c.query("SELECT VERSION() v, @@character_set_server cs");
  const [maj, min, pat] = v.v.split(/[.-]/).map(Number);
  log(`  MySQL ${v.v}` + (maj < 8 || (maj === 8 && min === 0 && pat < 19) ? "  ✗ 8.0.19 이상이 필요해요 (INSERT … AS n 문법)" : "  ✓"));
  const t0 = performance.now(); for (let i = 0; i < 20; i++) await c.query("SELECT 1");
  const rtt = (performance.now() - t0) / 20;
  log(`  왕복 시간 ${rtt.toFixed(1)}ms` + (rtt > 10 ? "  ⚠ 서버는 쿼리마다 기다려요. 리포트 만들기 · 관리자 통계가 눈에 띄게 느려질 수 있어요" : "  ✓"));
  const [[n]] = await c.query("SELECT SUM(table_type = 'BASE TABLE') t, SUM(table_type = 'VIEW') v FROM information_schema.tables WHERE table_schema = DATABASE()");
  log(`  표 ${n.t || 0}개 · 뷰 ${n.v || 0}개` + (+n.t >= 31 ? "" : "  (schema 단계에서 만들어요)"));
  if (+n.t >= 31) {
    const [r] = await c.query("SELECT (SELECT COUNT(*) FROM problem) problem, (SELECT COUNT(*) FROM device) device, (SELECT COUNT(*) FROM event) event");
    log(`  지금 들어 있는 것: 문제 ${r[0].problem} · 기기 ${r[0].device} · 이벤트 ${r[0].event}`);
  }
  await c.end();
  log(existsSync(FROM) ? `  SQLite 원본: ${FROM} ✓` : `  SQLite 원본 없음: ${FROM} (copy 단계에서 --from으로 지정)`);
}

// ───────── 단계: schema ─────────
async function schema() {
  log("\n[2] 표 만들기 (server/mysql/schema.sql · curriculum.sql, 다시 실행해도 안전)");
  const admin = E.MYSQL_ADMIN_USER ? { user: E.MYSQL_ADMIN_USER, password: E.MYSQL_ADMIN_PASSWORD || "" } : {};
  const c = await connect(admin);
  for (const f of ["schema.sql", "curriculum.sql"]) {
    const sql = readFileSync(join(ROOT, "server", "mysql", f), "utf8").replace(/^\s*USE\s+\w+\s*;\s*$/gim, "");   // DB 이름은 .env를 따른다
    try { await c.query(sql); log(`  ${f} ✓`); }
    catch (e) { die(`${f} 실행 실패: ${e.code} ${e.message}` + (/denied/i.test(e.message) ? "\n  표를 만들 권한이 없어요. .env에 MYSQL_ADMIN_USER · MYSQL_ADMIN_PASSWORD(관리자 계정)를 잠깐 넣고 다시 하세요" : "")); }
  }
  const [[n]] = await c.query("SELECT SUM(table_type = 'BASE TABLE') t, SUM(table_type = 'VIEW') v FROM information_schema.tables WHERE table_schema = DATABASE()");
  const [[k]] = await c.query("SELECT COUNT(*) n FROM curriculum_item");
  log(`  표 ${n.t}개 · 뷰 ${n.v}개 · 커리큘럼 ${k.n}칸` + (+n.t === 31 && +n.v === 3 ? "  ✓" : "  ✗ 표 31개 · 뷰 3개여야 해요"));
  await c.end();
}

// ───────── 공통: 표 구조 읽기 ─────────
function openSqlite() {
  if (!existsSync(FROM)) die(`SQLite 파일이 없어요: ${FROM}`);
  return new DatabaseSync(FROM, { readOnly: true });
}
async function myCols(c) {
  const [rows] = await c.query(`SELECT table_name t, column_name c, data_type d, is_nullable n, extra x FROM information_schema.columns
      WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`);
  const m = {};
  for (const r of rows) (m[r.t] ||= {})[r.c] = { type: r.d, nullable: r.n === "YES", auto: /auto_increment/.test(r.x), generated: /GENERATED/.test(r.x) };
  return m;
}
const sqTables = s => s.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const sqCols = (s, t) => s.prepare(`PRAGMA table_info(${t})`).all().map(r => r.name);
/** 옮길 표와 칸 짝 → [{ t, pairs: [[sqlite칸, mysql칸, 타입]], order }] */
function plan(s, M, tables) {
  const have = new Set(sqTables(s)), out = [];
  for (const t of sqTables(s)) if (!ORDER.includes(t) && !SKIP[t]) die(`SQLite에 모르는 표가 있어요: ${t} (tools/mysql-setup.mjs의 표 목록에 더해 주세요)`);
  for (const t of ORDER) {
    if (!tables.includes(t) || !have.has(t)) continue;
    if (!M[t]) die(`MySQL에 ${t} 표가 없어요. schema 단계를 먼저 하세요`);
    const pairs = [];
    for (const c of sqCols(s, t)) {
      const mc = colMap(t, c);
      if (!M[t][mc]) die(`MySQL ${t} 표에 ${mc} 칸이 없어요 (SQLite ${t}.${c}). server/mysql/schema.sql에 먼저 더해 주세요`);
      pairs.push([c, mc, M[t][mc].type]);
    }
    if (t === "item_tag" && M.item_tag.course_id && !pairs.some(p => p[1] === "course_id")) pairs.push([null, "course_id", "int"]);   // MySQL에서 더한 칸
    // event는 들어온 순서(rowid)대로 넣어야 MySQL seq가 같은 순서가 된다. WITHOUT ROWID 표는 순서를 따지지 않는다
    const order = t === "event" ? " ORDER BY rowid" : sqCols(s, t).includes("id") ? " ORDER BY id" : "";
    out.push({ t, pairs, order });
  }
  return out;
}
function convert(t, pairs, row, extra) {
  const vals = [];
  for (const [sc, mc, type] of pairs) {
    let v = sc ? row[sc] : extra(mc, row);
    if (v === undefined) v = null;
    if (type === "datetime" || type === "timestamp") { const d = toDT(v); if (d === undefined) return { bad: `${mc} 시각을 못 읽음: ${String(v).slice(0, 30)}` }; v = d; }
    else if (type === "json") {
      if (v == null || v === "") v = v === "" ? null : v;
      if (v != null) { try { v = JSON.stringify(JSON.parse(v)); } catch { return { bad: `${mc} JSON이 아님: ${String(v).slice(0, 30)}` }; } }
    } else if (typeof v === "bigint") v = Number(v);
    vals.push(v);
  }
  return { vals };
}

// ───────── 단계: copy ─────────
async function copy() {
  const learners = has("with-learners"), contentOnly = has("content-only");
  if (learners === contentOnly) die("--with-learners(학습자 기록까지) 또는 --content-only(문제 · 진단 태그 · 운영 기록만) 중 하나를 골라 주세요");
  const tables = [...CONTENT, ...OPS, ...(learners ? LEARNER : [])];
  log(`\n[3] 복사  ${FROM} → MySQL ${CFG.database}  (${learners ? "학습자 기록 포함" : "학습자 기록 빼고"})`);
  const s = openSqlite(), c = await connect(), M = await myCols(c), P = plan(s, M, tables);
  // 비어 있을 때만 (지우는 명령 없이 같은 번호로 넣으려면)
  const busy = [];
  for (const { t } of P) { const [[r]] = await c.query(`SELECT COUNT(*) n FROM \`${t}\``); if (+r.n) busy.push(`${t} ${r.n}줄`); }
  for (const t of ["submission"]) if (learners) { const [[r]] = await c.query(`SELECT COUNT(*) n FROM ${t}`); if (+r.n) busy.push(`${t} ${r.n}줄`); }
  if (busy.length) die(`MySQL 표가 비어 있지 않아 복사하지 않았어요: ${busy.join(", ")}\n  이미 옮겼다면 verify 단계로 확인하세요. 처음부터 다시 하려면 이 표들을 비운 뒤(삭제는 사람이 확인하고) 다시 하세요`);
  const courseOf = new Map(s.prepare("SELECT id, course_id FROM problem").all().map(r => [Number(r.id), Number(r.course_id)]));
  const extra = (mc, row) => mc === "course_id" ? courseOf.get(Number(row.problem_id)) ?? null : null;
  const skipped = {};
  const skip = (t, why, row) => { (skipped[t] ||= []).push(why + (row ? `  [${Object.entries(row).slice(0, 3).map(([k, v]) => `${k}=${String(v).slice(0, 24)}`).join(" ")}]` : "")); };
  await c.query("START TRANSACTION");
  try {
    for (const { t, pairs, order } of P) {
      const rows = s.prepare(`SELECT * FROM ${t}${order}`).all();
      const cols = pairs.map(p => "`" + p[1] + "`").join(", "), one = "(" + pairs.map(() => "?").join(",") + ")";
      let n = 0, batch = [], raw = [];
      const flush = async () => {
        if (!batch.length) return;
        try { await c.query(`INSERT INTO \`${t}\` (${cols}) VALUES ${batch.map(() => one).join(",")}`, batch.flat()); n += batch.length; }
        catch {                                                        // 한 줄씩 다시: 문제 있는 줄만 건너뛴다
          for (let i = 0; i < batch.length; i++) {
            try { await c.query(`INSERT INTO \`${t}\` (${cols}) VALUES ${one}`, batch[i]); n++; }
            catch (e) { skip(t, `${e.code}: ${e.message.slice(0, 90)}`, raw[i]); }
          }
        }
        batch = []; raw = [];
      };
      for (const row of rows) {
        const r = convert(t, pairs, row, extra);
        if (r.bad) { skip(t, r.bad, row); continue; }
        batch.push(r.vals); raw.push(row);
        if (batch.length >= 200) await flush();
      }
      await flush();
      log(`  ${t.padEnd(16)} ${String(n).padStart(6)} / ${rows.length}` + (skipped[t] ? `  ⚠ 건너뜀 ${skipped[t].length}` : ""));
    }
    if (learners) log(`  ${"submission".padEnd(16)} ${String(await fillSubmission(c)).padStart(6)}  (풀이 이벤트에서 만든 통계용 정리본)`);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); die("복사 실패, 하나도 넣지 않았어요: " + e.message); }
  for (const t of OPS) if (!P.some(p => p.t === t)) log(`  (${t} 표가 SQLite에 없어 건너뜀)`);
  if (!learners) log("  학습자 기록(기기 · 풀이 · 진도 · 제보 · 리포트)은 옮기지 않았어요. MySQL 판 서버에서는 학습자가 새 기기처럼 시작해요");
  for (const [t, list] of Object.entries(skipped)) { log(`\n  ⚠ ${t}: ${list.length}줄 건너뜀 (예: 처음 3줄)`); list.slice(0, 3).forEach(x => log("    " + x)); }
  await c.end(); s.close();
}
/** event의 풀이(answer_submit · idk) → submission. 서버(server.js POST /api/events)와 같은 규칙 */
async function fillSubmission(c) {
  const [rows] = await c.query(`SELECT event_id, session_id, device_id, problem_id, version, type, client_ts, payload FROM event
      WHERE type IN ('answer_submit', 'idk') AND problem_id IS NOT NULL AND version IS NOT NULL ORDER BY seq`);
  const count = new Map(); let n = 0;
  for (const e of rows) {
    const p = e.payload && typeof e.payload === "object" ? e.payload : {}, k = e.device_id + "|" + e.problem_id, idk = e.type === "idk";
    const attempt = Number.isInteger(p.attempt) && p.attempt >= 1 ? Math.min(p.attempt, 65535) : (count.get(k) || 0) + 1;
    count.set(k, (count.get(k) || 0) + 1);
    const ms = Number.isFinite(+p.ms) && +p.ms >= 0 ? Math.min(Math.round(+p.ms), 4e9) : null;
    const [r] = await c.query(`INSERT IGNORE INTO submission(client_id, session_id, mode, device_id, problem_id, version, answer, is_correct, attempt, ms, is_idk, is_self, submitted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [e.event_id, e.session_id || "", ["focus", "list"].includes(p.mode) ? p.mode : null, e.device_id, e.problem_id, e.version,
      String(p.answer ?? "").slice(0, 2000), !idk && !!p.correct ? 1 : 0, attempt, ms, idk ? 1 : 0, p.self ? 1 : 0, e.client_ts]);
    n += r.affectedRows;
  }
  return n;
}

// ───────── 단계: verify ─────────
async function verify() {
  log(`\n[4] 대조  SQLite ${FROM} ↔ MySQL ${CFG.database}  (옮긴 표만, 한 칸씩)`);
  const s = openSqlite(), c = await connect(), M = await myCols(c);
  const [[dv]] = await c.query("SELECT COUNT(*) n FROM device");
  const learners = +dv.n > 0 || has("with-learners");
  const P = plan(s, M, [...CONTENT, ...OPS, ...(learners ? LEARNER : [])]);
  let bad = 0;
  log(`  ${"표".padEnd(16)} SQLite   MySQL  결과`);
  for (const { t, pairs } of P) {
    const pkCols = await pkOf(c, t);
    const sq = s.prepare(`SELECT * FROM ${t}`).all(), [my] = await c.query(`SELECT * FROM \`${t}\``);
    const keyOf = (row, side) => pkCols.map(mc => { const sc = pairs.find(p => p[1] === mc)?.[0]; return String(side === "s" ? row[sc ?? mc] : row[mc]); }).join("|");
    const mm = new Map(my.map(r => [keyOf(r, "m"), r]));
    let diff = 0, missing = 0; const ex = [];
    for (const r of sq) {
      const m = mm.get(keyOf(r, "s"));
      if (!m) { missing++; continue; }
      for (const [sc, mc, type] of pairs) {
        if (!sc) continue;
        const a = r[sc], b = m[mc];
        let same;
        if (type === "datetime" || type === "timestamp") same = (a == null || a === "") ? b == null : Number.isNaN(Date.parse(a)) ? false : Date.parse(a) === dtMs(b);
        else if (type === "json") { try { same = (a == null || a === "") ? b == null : canon(JSON.parse(a)) === canon(typeof b === "string" ? JSON.parse(b) : b); } catch { same = false; } }
        else if (a == null || b == null) same = a == null && b == null;
        else if (typeof a === "number" || typeof a === "bigint" || typeof b === "number") same = Number(a) === Number(b);
        else same = String(a) === String(b);
        if (!same) { diff++; if (ex.length < 3) ex.push(`${mc}: ${String(a).slice(0, 40)} ≠ ${String(b).slice(0, 40)}`); }
      }
    }
    const ok = !diff && !missing && sq.length === my.length;
    if (!ok) bad++;
    log(`  ${t.padEnd(16)} ${String(sq.length).padStart(6)}  ${String(my.length).padStart(6)}  ${ok ? "모두 같음" : `✗ 없음 ${missing} · 다른 칸 ${diff}`}`);
    ex.forEach(x => log("      " + x));
  }
  if (learners) {
    const [[a]] = await c.query("SELECT COUNT(*) n FROM event WHERE type IN ('answer_submit','idk') AND problem_id IS NOT NULL AND version IS NOT NULL");
    const [[b]] = await c.query("SELECT COUNT(*) n FROM submission");
    log(`  ${"submission".padEnd(16)} 풀이 이벤트 ${a.n} → ${b.n}줄` + (+b.n <= +a.n ? "  (없는 문제 · 버전 풀이는 빠져요)" : "  ✗"));
  }
  log(bad ? `\n✗ 다른 표 ${bad}개. 위 예시를 확인하세요` : "\n✓ 옮긴 표가 모두 SQLite와 같아요");
  await c.end(); s.close();
  if (bad) process.exitCode = 1;
}
async function pkOf(c, t) {
  const [r] = await c.query(`SELECT column_name c FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = 'PRIMARY' ORDER BY ordinal_position`, [t]);
  return r.map(x => x.c);
}

const STEPS = { check, schema, copy, verify, all: async () => { await check(); await schema(); await copy(); await verify(); } };
if (!STEPS[step]) { log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 10).join("\n").replace(/^\/\/ ?/gm, "")); process.exit(0); }
await STEPS[step]();
