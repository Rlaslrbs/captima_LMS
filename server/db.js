// DB 접속, 문제 세트 가져오기, 통계 계산
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(HERE);
export const DATA = join(ROOT, "data");
mkdirSync(DATA, { recursive: true });

export const DB_FILE = process.env.DB_PATH || join(DATA, "app.db");
export const BACKUP_DIR = join(dirname(DB_FILE), "backups");
export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));

// 이미 있는 표에 새 열 더하기 (CREATE TABLE IF NOT EXISTS는 열을 더하지 않는다)
function addColumns(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, def] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}
addColumns("misc", [["facet", "TEXT"]]);
addColumns("item_tag", [["facet", "TEXT"], ["depth", "INTEGER"], ["src", "TEXT NOT NULL DEFAULT 'llm'"], ["conf", "INTEGER NOT NULL DEFAULT 2"]]);
db.exec("CREATE INDEX IF NOT EXISTS item_tag_facet ON item_tag(facet)");

export const now = () => new Date().toISOString();
export const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

/** 묶어서 실행: 중간에 실패하면 전부 되돌린다 */
export function tx(fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ───────── 문제 세트(JSON) 가져오기 ─────────
const BODY_KEYS = ["no", "q", "q_sub", "stem", "ox", "opts", "opts_sub", "ans", "a", "accept", "strict", "num", "tol", "ph",
  "pts", "s", "src", "fix", "tags", "exams", "topic", "math", "why"];
const KINDS = new Set(["ox", "mc", "short", "essay"]);

// ───────── 학습 리포트 v2: 진단 정보(dx)의 낱말 (docs/insight/v2/DATA.md §4) ─────────
export const FACET_KINDS = ["def", "property", "condition", "procedure", "relation", "distinction"];
export const ROLES = ["base", "iso", "near"];
export const DELTA_TYPES = ["surface", "repr", "object", "condition", "qualifier", "reverse", "neighbour", "combine"];
export const DEPTH_WHY = ["D1a", "D1b", "D1c", "D2a", "D2b", "D3a", "D3b", "D3c", "D4a", "D4b", "D4c", "D4d"];
export const DEPTH_NAMES = { 1: "정의", 2: "적용", 3: "구별", 4: "조건" };
const FACET_RE = /^[a-z0-9_]{1,30}$/;               // dx.facet = "<topic>.<f>"
const MISC_RE = /^[a-z][a-z0-9_]{1,40}$/;           // 저자 코드 (m_dfa_dfd). m + 숫자는 자동 태깅용
const nchar = s => [...String(s ?? "")].length;

// 문제 본문 지문(body_hash). 화면에 보이는 내용이 바뀌면 달라진다 (SPEC §8.4).
// core=true면 해설(s)·바른 진술(fix)을 빼고 계산한다: 해설만 고친 새 버전은 저자 태그를 그대로 이어받는다 (DATA §5.3).
const HASH_KEYS = ["q", "q_sub", "stem", "opts", "ans", "ox", "fix", "a", "accept", "num", "tol", "pts", "s", "topic"];
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}`
  : JSON.stringify(v ?? null);
export function bodyHash(kind, body, { core = false } = {}) {
  const o = {};
  for (const k of HASH_KEYS) if (body?.[k] !== undefined && !(core && (k === "s" || k === "fix"))) o[k] = body[k];
  return createHash("sha1").update(String(kind) + canon(o)).digest("hex");
}

// ───────── 수식 검사 (수식 과목을 올릴 때 화면이 깨지지 않게) ─────────
// 화면은 \( … \) (문장 속)와 \[ … \] (따로 한 줄)만 수식으로 그린다 (web/js/math.js).
const TEXT_KEYS = ["q", "q_sub", "stem", "a", "s", "fix"], LIST_KEYS = ["opts", "opts_sub", "pts", "accept", "why"];
const hasMath = s => /\\\(|\\\[/.test(s);
function mathErrors(s) {
  const errs = [];
  const count = re => (s.match(re) || []).length;
  if (count(/\\\(/g) !== count(/\\\)/g)) errs.push("\\( 와 \\) 의 짝이 안 맞아요");
  if (count(/\\\[/g) !== count(/\\\]/g)) errs.push("\\[ 와 \\] 의 짝이 안 맞아요");
  for (const m of s.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)) {
    const body = (m[1] ?? m[2]).replace(/\\[{}]/g, "");
    let depth = 0, bad = false; for (const ch of body) { if (ch === "{") depth++; else if (ch === "}" && --depth < 0) { bad = true; break; } }
    if (bad || depth !== 0) { errs.push(`수식 안 { } 짝이 안 맞아요: ${m[0].slice(0, 40)}`); break; }
  }
  if (/(^|[^\\])\$[^$\n]*\\[a-zA-Z]+[^$\n]*\$/.test(s)) errs.push("$ … $ 수식은 화면에 안 나와요. \\( … \\)로 바꿔 주세요");
  return errs;
}
export function checkMath(problem, courseMath) {
  const id = problem.ext_id ?? "?", out = [];
  const texts = [...TEXT_KEYS.map(k => problem[k]), ...LIST_KEYS.flatMap(k => Array.isArray(problem[k]) ? problem[k] : [])].filter(v => typeof v === "string");
  let any = false;
  for (const t of texts) { if (hasMath(t)) any = true; for (const e of mathErrors(t)) out.push(`${id}: ${e}`); }
  if (any && !courseMath && !problem.math) out.push(`${id}: 수식이 있는데 수식 과목이 아니에요 (course.math를 true로)`);
  return [...new Set(out)];
}

/** 문제 세트 검사 → 오류 목록. warnings 배열을 주면 막지는 않는 주의 사항을 거기에 더한다 */
export function checkPack(pack, warnings = []) {
  const errs = [];
  if (!pack || typeof pack !== "object") return ["JSON 형식이 아니에요"];
  if (!pack.semester?.code) errs.push("semester.code(학기 코드, 예: 26-2)가 없어요");
  if (!pack.course?.code || !pack.course?.name) errs.push("course.code와 course.name이 필요해요");
  if (!Array.isArray(pack.chapters) || !pack.chapters.length) errs.push("chapters(챕터 목록)가 비어 있어요");
  if (!Array.isArray(pack.problems) || !pack.problems.length) errs.push("problems(문제 목록)가 비어 있어요");
  if (errs.length) return errs;
  const T = pack.course.topics;      // 개념 코드 → 한국어 이름, 또는 {name, confusable, facets} (학습 리포트)
  if (T != null && (typeof T !== "object" || Array.isArray(T) || !Object.values(T).every(v => typeof v === "string" || (v && typeof v === "object" && !Array.isArray(v) && typeof v.name === "string" && v.name))))
    errs.push('course.topics는 {"개념 코드": "한국어 이름"} 또는 {"개념 코드": {"name": "…", "facets": {…}}} 형태여야 해요');
  const keys = new Set(pack.chapters.map(c => c.key)); const seen = new Set();
  pack.problems.forEach((p, i) => {
    const id = p.ext_id ?? `#${i + 1}`;
    if (!p.ext_id) errs.push(`${id}: ext_id(문제 번호)가 없어요`);
    if (seen.has(p.ext_id)) errs.push(`${id}: 문제 번호가 중복돼요`);
    seen.add(p.ext_id);
    if (!keys.has(p.chapter)) errs.push(`${id}: 없는 챕터(${p.chapter})`);
    if (!KINDS.has(p.kind)) errs.push(`${id}: 유형(kind)은 ox/mc/short/essay 중 하나여야 해요`);
    if (!p.q) errs.push(`${id}: 문제(q)가 없어요`);
    if (p.kind === "ox" && typeof p.ox !== "boolean") errs.push(`${id}: O/X 정답(ox: true/false)이 없어요`);
    if (p.kind === "mc" && !(Array.isArray(p.opts) && Number.isInteger(p.ans) && p.ans >= 0 && p.ans < p.opts.length)) errs.push(`${id}: 객관식 보기(opts)나 정답 번호(ans)가 잘못됐어요`);
    if (p.kind === "mc" && p.why != null && !(Array.isArray(p.why) && Array.isArray(p.opts) && p.why.length === p.opts.length && p.why.every(w => typeof w === "string")))
      errs.push(`${id}: 보기별 착각(why)은 보기(opts)와 같은 개수의 문장 목록이어야 해요 (보기 ${Array.isArray(p.opts) ? p.opts.length : "?"}개, 정답 자리는 "")`);
    if ((p.kind === "short" || p.kind === "essay") && !p.a) errs.push(`${id}: 정답·모범 답안(a)이 없어요`);
    if (p.publish != null && typeof p.publish !== "boolean") errs.push(`${id}: publish는 true/false예요 (false = 새 문제를 숨김으로)`);
    errs.push(...checkMath(p, !!pack.course.math));
  });
  if (!errs.length) checkDx(pack, errs, warnings);
  return errs;
}

/** 학습 리포트 v2 규칙 (DATA.md §6.3). 필드가 있을 때만 검사하므로 예전 세트는 그대로 통과한다 */
function checkDx(pack, errs, W) {
  const T = pack.course.topics || {}, M = pack.course.misconceptions;
  const facets = new Map();                         // "topic.f" → { retired }
  for (const [t, v] of Object.entries(T)) {
    if (typeof v === "string") continue;
    if (v.confusable != null && !(Array.isArray(v.confusable) && v.confusable.every(c => T[c] != null))) errs.push(`course.topics.${t}.confusable: 있는 개념 코드 목록이어야 해요`);
    if (v.facets == null) continue;
    if (typeof v.facets !== "object" || Array.isArray(v.facets)) { errs.push(`course.topics.${t}.facets: {"세부 코드": {name, kind, statement}} 형태여야 해요`); continue; }
    for (const [f, d] of Object.entries(v.facets)) {
      const code = `${t}.${f}`, at = `세부 포인트 ${code}`;
      if (!FACET_RE.test(f)) errs.push(`${at}: 세부 코드는 영어 소문자·숫자·_ 로 30자 이내예요`);
      if (!d || typeof d !== "object" || Array.isArray(d)) { errs.push(`${at}: {name, kind, statement} 형태여야 해요`); continue; }
      const retired = d.status === "retired";
      if (d.status != null && !["active", "draft", "retired"].includes(d.status)) errs.push(`${at}: status는 active/draft/retired 중 하나예요`);
      if (!retired) {
        if (!d.name || nchar(d.name) > 20) errs.push(`${at}: name(20자 이내)이 필요해요`);
        if (!d.statement || nchar(d.statement) > 90) errs.push(`${at}: statement(바른 진술, 90자 이내)가 필요해요`);
        if (!FACET_KINDS.includes(d.kind ?? "property")) errs.push(`${at}: kind는 ${FACET_KINDS.join("/")} 중 하나예요`);
      }
      if (d.merged_into != null && !retired) errs.push(`${at}: merged_into는 status "retired"와 함께 써요`);
      facets.set(code, { retired, d });
    }
  }
  for (const [code, { retired, d }] of facets) {
    if (d.confusable != null && !(Array.isArray(d.confusable) && d.confusable.every(c => facets.has(c) && c !== code))) errs.push(`세부 포인트 ${code}: confusable은 다른 세부 포인트 코드 목록이어야 해요`);
    if (retired && d.merged_into != null && !(facets.has(d.merged_into) && !facets.get(d.merged_into).retired)) errs.push(`세부 포인트 ${code}: merged_into(${d.merged_into})가 살아 있는 세부 포인트가 아니에요`);
  }

  const miscs = new Map();
  if (M != null) {
    if (typeof M !== "object" || Array.isArray(M)) errs.push('course.misconceptions는 {"오개념 코드": {facet, belief, truth}} 형태여야 해요');
    else for (const [m, d] of Object.entries(M)) {
      const at = `오개념 ${m}`;
      if (!MISC_RE.test(m) || /^m\d+$/.test(m)) errs.push(`${at}: 코드는 영어 소문자로 시작해요(예: m_dfa_dfd). m + 숫자만인 코드는 자동 태깅용이라 못 써요`);
      if (!d || typeof d !== "object" || Array.isArray(d)) { errs.push(`${at}: {facet, belief, truth} 형태여야 해요`); continue; }
      const retired = d.status === "retired";
      if (d.status != null && !["ok", "retired"].includes(d.status)) errs.push(`${at}: status는 ok/retired 중 하나예요`);
      if (!facets.has(d.facet)) errs.push(`${at}: facet(${d.facet})이 course.topics의 세부 포인트에 없어요`);
      if (!retired) {
        if (!d.belief || nchar(d.belief) > 70 || !/생각함$/.test(String(d.belief).trim())) errs.push(`${at}: belief는 학생 관점 "~라고 생각함"으로 끝나는 70자 이내 문장이에요`);
        if (!d.truth || nchar(d.truth) > 90) errs.push(`${at}: truth(바른 진술, 90자 이내)가 필요해요`);
      }
      if (d.cw != null && !facets.has(d.cw) && T[d.cw] == null) errs.push(`${at}: cw(${d.cw})는 세부 포인트나 개념 코드여야 해요`);
      miscs.set(m, { retired, d, offered: 0 });
    }
  }
  const miscOk = (id, m) => {
    if (!miscs.has(m)) { errs.push(`${id}: 오개념 ${m}이 course.misconceptions에 없어요`); return; }
    if (miscs.get(m).retired) errs.push(`${id}: 오개념 ${m}은 은퇴한 코드예요`);
    miscs.get(m).offered++;
  };

  const fam = new Map();
  for (const [i, p] of pack.problems.entries()) {
    const dx = p.dx, id = p.ext_id ?? `#${i + 1}`;
    if (p.kind === "mc" && /(첫|둘|두|셋|세|넷|네|다섯)\s*(째|번째)\s*보기|[①②③④⑤⑥]\s*[:：)]/.test(String(p.s || "")))
      W.push(`${id}: 해설이 보기를 위치(둘째 보기, ① …)로 가리켜요. 보기 순서가 바뀌면 틀린 말이 돼요. 보기별 설명은 why에 써 주세요`);
    if (dx == null) continue;
    if (typeof dx !== "object" || Array.isArray(dx)) { errs.push(`${id}: dx는 객체여야 해요`); continue; }
    const fm = typeof dx.facet === "string" ? /^([^.\s]+)\.([^.\s]+)$/.exec(dx.facet) : null;
    if (!fm) { errs.push(`${id}: dx.facet은 "개념.세부" 형태(예: dfx.dfd)여야 해요`); continue; }
    if (facets.has(dx.facet)) { if (facets.get(dx.facet).retired) errs.push(`${id}: dx.facet ${dx.facet}은 은퇴한 세부 포인트예요`); }
    else if (typeof T[fm[1]] === "string" && FACET_RE.test(fm[2])) W.push(`${id}: 세부 포인트 ${dx.facet}이 course.topics에 없어 초안(draft)으로 만들어요`);
    else errs.push(`${id}: dx.facet ${dx.facet}이 course.topics의 세부 포인트에 없어요`);
    if (p.topic && p.topic !== fm[1]) W.push(`${id}: topic(${p.topic})과 dx.facet의 개념(${fm[1]})이 달라요`);
    if (dx.facets2 != null && !(Array.isArray(dx.facets2) && dx.facets2.length <= 2 && dx.facets2.every(f => facets.has(f) && f !== dx.facet))) errs.push(`${id}: dx.facets2는 다른 세부 포인트 최대 2개예요`);
    if (dx.depth != null && !(Number.isInteger(dx.depth) && dx.depth >= 1 && dx.depth <= 4)) errs.push(`${id}: dx.depth는 1~4 (1 정의 · 2 적용 · 3 구별 · 4 조건)예요`);
    if (dx.depth_why != null && !(DEPTH_WHY.includes(dx.depth_why) && Number(dx.depth_why[1]) === dx.depth)) errs.push(`${id}: dx.depth_why는 D1a…D4d 중 depth와 같은 숫자로 시작해야 해요`);
    if (dx.family != null || dx.role != null || dx.delta != null) {
      const d = dx.delta;
      if (typeof dx.family !== "string" || !dx.family) errs.push(`${id}: 변형 묶음에는 dx.family(묶음 이름)가 필요해요`);
      else if (/^F\d+$/.test(dx.family)) errs.push(`${id}: F + 숫자 묶음 이름은 자동 태깅용이라 못 써요`);
      if (!ROLES.includes(dx.role)) errs.push(`${id}: dx.role은 base/iso/near 중 하나예요`);
      else if (dx.role === "base") { if (d != null) errs.push(`${id}: 기준 문제(base)에는 delta를 쓰지 않아요`); }
      else if (!(Array.isArray(d) && d.length === 2 && DELTA_TYPES.includes(d[0]) && typeof d[1] === "string" && d[1].trim() && nchar(d[1]) <= 40))
        errs.push(`${id}: dx.delta는 ["바뀐 종류", "바뀐 점 40자 이내"]예요 (종류: ${DELTA_TYPES.join("/")})`);
      else if (dx.role === "iso" && !["surface", "repr"].includes(d[0])) errs.push(`${id}: iso 변형의 delta 종류는 surface 또는 repr예요`);
      else if (dx.role === "near" && d[0] === "surface") errs.push(`${id}: near 변형은 surface가 아닌 구조 하나를 바꿔요`);
      if (dx.principle != null && (typeof dx.principle !== "string" || nchar(dx.principle) > 90)) errs.push(`${id}: dx.principle은 90자 이내 문장이에요`);
      if (typeof dx.family === "string" && dx.family) { if (!fam.has(dx.family)) fam.set(dx.family, []); fam.get(dx.family).push({ id, role: dx.role, depth: dx.depth, facet: dx.facet }); }
    }
    const mis = dx.mis;
    if (mis != null) {
      if (p.kind === "mc") {
        if (!(Array.isArray(mis) && mis.length === p.opts.length)) errs.push(`${id}: 객관식 dx.mis는 보기(opts)와 같은 개수예요 (정답 자리는 "", 진단 못 하면 null)`);
        else mis.forEach((m, k) => {
          if (k === p.ans) { if (m !== "") errs.push(`${id}: dx.mis의 정답 자리(${k})는 ""예요`); }
          else if (m === "") errs.push(`${id}: dx.mis[${k}]: ""는 정답 자리에만 써요`);
          else if (m !== null) miscOk(id, m);
        });
      } else if (p.kind === "ox") {
        const o = typeof mis === "string" ? { m: mis } : mis;
        if (!o || typeof o !== "object" || Array.isArray(o)) errs.push(`${id}: O/X dx.mis는 오개념 코드 또는 {m, mr}예요`);
        else {
          if (o.m != null) { if (p.ox) errs.push(`${id}: 참인 진술에는 m을 쓰지 않아요. X라고 답하는 반대 믿음은 {mr}에 써요`); else miscOk(id, o.m); }
          if (o.mr != null) miscOk(id, o.mr);
        }
      } else if (p.kind === "short") {
        if (!(Array.isArray(mis) && mis.length <= 4 && mis.every(x => x && typeof x === "object" && (x.ex == null || Array.isArray(x.ex))))) errs.push(`${id}: 단답 dx.mis는 [{pattern, ex: ["예상 오답"], m}] 최대 4개예요`);
        else mis.forEach(x => { if (x.m != null) miscOk(id, x.m); });
      } else if (p.kind === "essay") {
        if (!(Array.isArray(mis) && Array.isArray(p.pts) && mis.length <= p.pts.length)) errs.push(`${id}: 서술형 dx.mis는 채점 포인트(pts)마다 오개념 코드 또는 null이에요`);
        else mis.forEach(m => { if (m != null) miscOk(id, m); });
      }
    }
    if (dx.check != null && !(typeof dx.check === "object" && typeof dx.check.ok === "boolean")) errs.push(`${id}: dx.check는 {ok, picked, note, model} 형태예요 (블라인드 풀이 결과)`);
  }

  for (const [f, ms] of fam) {
    const bases = ms.filter(m => m.role === "base");
    if (bases.length !== 1) errs.push(`변형 묶음 ${f}: 기준 문제(base)가 정확히 1개여야 해요 (지금 ${bases.length}개)`);
    if (ms.length < 2) errs.push(`변형 묶음 ${f}: 문제가 2개 이상이어야 해요`);
    if (new Set(ms.map(m => m.facet)).size > 1) errs.push(`변형 묶음 ${f}: 모든 문제의 dx.facet이 같아야 해요`);
    const b = bases[0];
    if (b) for (const m of ms) {
      if (m.role === "iso" && m.depth != null && b.depth != null && m.depth !== b.depth) errs.push(`${m.id}: iso 변형은 기준 문제(${b.id})와 깊이가 같아야 해요`);
      if (m.role === "near" && m.depth != null && b.depth != null && m.depth < b.depth) W.push(`${m.id}: near 변형의 깊이가 기준 문제(${b.id})보다 낮아요`);
    }
  }
  for (const [m, x] of miscs) {
    if (x.retired) continue;
    if (!x.offered) W.push(`오개념 ${m}: 이 오개념을 고를 수 있는 문제가 없어요`);
    const A = x.d.facet, B = x.d.cw;
    if (B && facets.has(B) && ![...miscs.values()].some(y => !y.retired && y.offered && y.d.facet === B && y.d.cw === A))
      W.push(`오개념 ${m}: ${A} → ${B} 방향만 있어요. ${B}를 ${A}로 착각하는 문제(반대 방향)도 두면 좋아요`);
  }
}

const bodyOf = p => { const b = {}; for (const k of BODY_KEYS) if (p[k] !== undefined && p[k] !== null && p[k] !== "") b[k] = p[k]; return b; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 문제 세트를 DB에 넣는다. dry=true면 실제로 넣어 본 뒤 되돌려, 무엇이 바뀔지만 센다.
 * 같은 학기·과목·문제 번호가 있으면 내용이 바뀐 문제만 새 버전을 만든다.
 * hidden=true(또는 팩의 "publish": false)면 새 문제를 숨김으로 넣는다 (관리자가 승인하면 공개). 문제 하나에 "publish": false를 써도 된다.
 * 이미 있는 문제의 공개·숨김 상태는 바꾸지 않는다.
 * 진단 정보(course.topics의 facets, course.misconceptions, 문제의 dx)는 본문이 아니라 학습 리포트 표에 들어간다.
 */
export function importPack(pack, { dry = false, note = "가져오기", hidden = false } = {}) {
  const warnings = [];
  const errors = checkPack(pack, warnings);
  if (errors.length) return { ok: false, errors, warnings };
  const status = hidden || pack.publish === false ? "hidden" : "published";
  const plan = { semester: "existing", course: "existing", chapters: { add: 0, update: 0 }, problems: { add: 0, changed: 0, same: 0, hidden: 0 } };
  const run = () => {
    const t = now(); const S = pack.semester, C = pack.course;
    let sem = db.prepare("SELECT * FROM semester WHERE code = ?").get(S.code);
    if (!sem) {
      plan.semester = "new";
      const r = db.prepare("INSERT INTO semester(code, name, sort) VALUES (?, ?, ?)").run(S.code, S.name || S.code, -Date.now() / 1e3 | 0); sem = { id: Number(r.lastInsertRowid) };
    }
    // 화면·엔진(ctx.js)은 topics를 {코드: 이름}으로 읽는다. 세부 포인트는 facet 표에 따로 둔다.
    const topics = C.topics ? Object.fromEntries(Object.entries(C.topics).map(([k, v]) => [k, typeof v === "string" ? v : v.name])) : null;
    const info = JSON.stringify({ color: C.color || {}, lang: C.lang || "ko", math: !!C.math, files: C.files || {}, concepts: C.concepts || {}, ...(topics ? { topics } : {}) });
    let course = db.prepare("SELECT * FROM course WHERE semester_id = ? AND code = ?").get(sem.id, C.code);
    if (!course) {
      plan.course = "new";
      const n = db.prepare("SELECT COUNT(*) n FROM course WHERE semester_id = ?").get(sem.id).n;
      const r = db.prepare("INSERT INTO course(semester_id, code, short, name, professor, meta, info, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(sem.id, C.code, C.short || C.code, C.name, C.professor || "", C.meta || "", info, n, t);
      course = { id: Number(r.lastInsertRowid) };
    } else {
      db.prepare("UPDATE course SET short=?, name=?, professor=?, meta=?, info=? WHERE id=?").run(C.short || C.code, C.name, C.professor || "", C.meta || "", info, course.id);
    }
    const chId = {};
    pack.chapters.forEach((ch, i) => {
      const old = db.prepare("SELECT * FROM chapter WHERE course_id = ? AND key = ?").get(course.id, ch.key);
      const cinfo = JSON.stringify({ sections: ch.sections || [] });
      if (!old) { plan.chapters.add++; chId[ch.key] = Number(db.prepare("INSERT INTO chapter(course_id, key, title, short, grp, info, sort) VALUES (?,?,?,?,?,?,?)").run(course.id, ch.key, ch.title, ch.short || ch.key, ch.group || "", cinfo, i).lastInsertRowid); }
      else { chId[ch.key] = old.id; if (old.title !== ch.title || old.sort !== i) plan.chapters.update++; db.prepare("UPDATE chapter SET title=?, short=?, grp=?, info=?, sort=? WHERE id=?").run(ch.title, ch.short || ch.key, ch.group || "", cinfo, i, old.id); }
    });
    const cur = new Map();                          // ext_id → { pid, version, kind, body }
    pack.problems.forEach((p, i) => {
      const body = bodyOf(p);
      const old = db.prepare("SELECT * FROM problem WHERE course_id = ? AND ext_id = ?").get(course.id, p.ext_id);
      if (!old) {
        const st = p.publish === false ? "hidden" : status;            // 문제 하나만 숨김으로 넣을 때: "publish": false (본문에는 안 들어감)
        plan.problems.add++; if (st === "hidden") plan.problems.hidden++;
        const pid = Number(db.prepare("INSERT INTO problem(course_id, chapter_id, ext_id, sort, current_version, status) VALUES (?,?,?,?,1,?)").run(course.id, chId[p.chapter], p.ext_id, i, st).lastInsertRowid);
        db.prepare("INSERT INTO problem_version(problem_id, version, kind, star, body, note, created_at) VALUES (?,1,?,?,?,?,?)").run(pid, p.kind, p.star ? 1 : 0, JSON.stringify(body), note, t);
        cur.set(p.ext_id, { pid, version: 1, kind: p.kind, body });
        return;
      }
      const prev = db.prepare("SELECT * FROM problem_version WHERE problem_id = ? AND version = ?").get(old.id, old.current_version);
      const changed = !prev || prev.kind !== p.kind || !!prev.star !== !!p.star || !same(J(prev.body), body);
      if (changed) plan.problems.changed++; else plan.problems.same++;
      db.prepare("UPDATE problem SET chapter_id=?, sort=? WHERE id=?").run(chId[p.chapter], i, old.id);
      let v = old.current_version;
      if (changed) {
        v = old.current_version + 1;
        db.prepare("INSERT INTO problem_version(problem_id, version, kind, star, body, note, created_at) VALUES (?,?,?,?,?,?,?)").run(old.id, v, p.kind, p.star ? 1 : 0, JSON.stringify(body), note, t);
        db.prepare("UPDATE problem SET current_version=? WHERE id=?").run(v, old.id);
        if (!p.dx) carryTags(old.id, old.current_version, v);
      }
      cur.set(p.ext_id, { pid: old.id, version: v, kind: p.kind, body });
    });
    const dx = importDx(course.id, pack, cur, t);
    if (dx) plan.dx = dx;
    return course.id;
  };
  try {
    if (dry) { db.exec("BEGIN"); try { run(); } finally { db.exec("ROLLBACK"); } return { ok: true, dry: true, plan, count: pack.problems.length, warnings }; }
    const courseId = tx(run);
    return { ok: true, plan, courseId, count: pack.problems.length, warnings };
  } catch (e) {
    if (e.packError) return { ok: false, errors: [e.message], warnings };
    throw e;
  }
}
const packError = msg => Object.assign(new Error(msg), { packError: true });

/**
 * 팩의 진단 정보 → kc · facet · misc · item_tag(저자 태그) · family · family_member.
 * 코드는 영원히 안정적이다: 이름을 바꿔도 코드는 그대로, 팩에서 빠진 저자 코드는 status 'retired'로 남기고 다시 쓰지 않는다.
 * 관리자가 고친 행(source/src 'admin')은 덮어쓰지 않는다. 진단 정보가 없는 팩이면 아무것도 하지 않는다.
 */
function importDx(cid, pack, cur, t) {
  const T = pack.course.topics || {}, M = pack.course.misconceptions;
  const hasFacets = Object.values(T).some(v => typeof v === "object" && v.facets);
  const withDx = pack.problems.filter(p => p.dx);
  if (!hasFacets && !withDx.length && !M) return null;
  const out = { kc: { add: 0, update: 0, retire: 0 }, facet: { add: 0, update: 0, retire: 0, draft: 0 }, misc: { add: 0, update: 0, retire: 0 },
    tags: { set: 0, same: 0, admin: 0 }, families: 0, members: 0, vocab_ver: null };
  const ver0 = Number(meta(`vocab_ver:${cid}`) || 0), ver1 = ver0 + 1;
  let changed = false;
  const kcOf = code => code.split(".")[0];

  // 개념(kc): 팩의 topics 코드 그대로
  const chs = new Map();                            // kc → 그 개념 문제가 있는 단원들
  for (const p of pack.problems) for (const k of [p.topic, p.dx?.facet && kcOf(p.dx.facet)]) if (k) { if (!chs.has(k)) chs.set(k, new Set()); chs.get(k).add(p.chapter); }
  const kcOld = new Map(db.prepare("SELECT * FROM kc WHERE course_id = ?").all(cid).map(r => [r.code, r]));
  for (const [code, v] of Object.entries(T)) {
    const o = typeof v === "string" ? { name: v } : v;
    const row = { name: o.name, definition: o.definition || "", confusable: JSON.stringify(o.confusable || []), chapter_keys: JSON.stringify([...(chs.get(code) || [])].sort()) };
    const old = kcOld.get(code);
    if (!old) {
      db.prepare("INSERT INTO kc(course_id, code, chapter_keys, name, definition, confusable, source, status, vocab_ver, updated_at) VALUES (?,?,?,?,?,?,'author','active',?,?)")
        .run(cid, code, row.chapter_keys, row.name, row.definition, row.confusable, ver1, t);
      out.kc.add++; changed = true;
    } else if (old.status === "retired") throw packError(`개념 ${code}은 은퇴한 코드라 다시 쓸 수 없어요. 새 코드를 쓰세요`);
    else if (old.source !== "admin" && (old.name !== row.name || old.definition !== row.definition || old.confusable !== row.confusable || old.chapter_keys !== row.chapter_keys || old.source !== "author" || old.status !== "active")) {
      db.prepare("UPDATE kc SET name=?, definition=?, confusable=?, chapter_keys=?, source='author', status='active', vocab_ver=?, updated_at=? WHERE course_id=? AND code=?")
        .run(row.name, row.definition, row.confusable, row.chapter_keys, ver1, t, cid, code);
      out.kc.update++; changed = true;
    }
  }
  if (hasFacets) for (const [code, old] of kcOld) if (old.source === "author" && old.status !== "retired" && T[code] == null) {
    db.prepare("UPDATE kc SET status='retired', vocab_ver=?, updated_at=? WHERE course_id=? AND code=?").run(ver1, t, cid, code);
    out.kc.retire++; changed = true;
  }

  // 세부 포인트(facet)
  const fOld = new Map(db.prepare("SELECT * FROM facet WHERE course_id = ?").all(cid).map(r => [r.code, r]));
  const fNew = new Map(); let sort = 0;
  for (const [k, v] of Object.entries(T)) if (typeof v === "object" && v.facets)
    for (const [f, d] of Object.entries(v.facets)) fNew.set(`${k}.${f}`, { kc: k, name: d.name || f, statement: d.statement || "", kind: d.kind || "property",
      confusable: JSON.stringify(d.confusable || []), sort: sort++, status: d.status || "active", merged_into: d.merged_into ?? null });
  for (const p of withDx) if (!fNew.has(p.dx.facet) && !fOld.has(p.dx.facet)) {      // topics에 없는 세부 포인트 → 초안
    fNew.set(p.dx.facet, { kc: kcOf(p.dx.facet), name: p.dx.facet.split(".")[1], statement: "", kind: "property", confusable: "[]", sort: sort++, status: "draft", merged_into: null });
    out.facet.draft++;
  }
  for (const [code, r] of fNew) {
    const old = fOld.get(code);
    if (!old) {
      db.prepare(`INSERT INTO facet(course_id, code, kc, name, statement, kind, confusable, sort, source, status, merged_into, vocab_ver, updated_at)
          VALUES (?,?,?,?,?,?,?,?,'author',?,?,?,?)`).run(cid, code, r.kc, r.name, r.statement, r.kind, r.confusable, r.sort, r.status, r.merged_into, ver1, t);
      out.facet.add++; changed = true;
    } else if (old.status === "retired" && r.status !== "retired") throw packError(`세부 포인트 ${code}는 은퇴한 코드라 다시 쓸 수 없어요. 새 코드를 쓰세요`);
    else if (old.source === "admin") continue;
    else if (old.kc !== r.kc || old.name !== r.name || old.statement !== r.statement || old.kind !== r.kind || old.confusable !== r.confusable
      || old.sort !== r.sort || old.status !== r.status || (old.merged_into ?? null) !== r.merged_into || old.source !== "author") {
      db.prepare("UPDATE facet SET kc=?, name=?, statement=?, kind=?, confusable=?, sort=?, source='author', status=?, merged_into=?, vocab_ver=?, updated_at=? WHERE course_id=? AND code=?")
        .run(r.kc, r.name, r.statement, r.kind, r.confusable, r.sort, r.status, r.merged_into, ver1, t, cid, code);
      if (r.status === "retired") out.facet.retire++; else out.facet.update++;
      changed = true;
    }
  }
  if (hasFacets) for (const [code, old] of fOld) if (old.source === "author" && old.status !== "retired" && !fNew.has(code)) {
    db.prepare("UPDATE facet SET status='retired', vocab_ver=?, updated_at=? WHERE course_id=? AND code=?").run(ver1, t, cid, code);
    out.facet.retire++; changed = true;
  }

  // 오개념(misc)
  if (M) {
    const mCh = new Map();                          // 오개념 → 처음 나오는 단원
    for (const p of withDx) for (const m of misCodes(p.kind, p.dx.mis)) if (!mCh.has(m)) mCh.set(m, p.chapter);
    const mOld = new Map(db.prepare("SELECT * FROM misc WHERE course_id = ?").all(cid).map(r => [r.code, r]));
    for (const [code, d] of Object.entries(M)) {
      const r = { facet: d.facet, kc: kcOf(d.facet), cw: d.cw ?? null, belief: d.belief || "", truth: d.truth || "", contrast: d.contrast || "", cue: d.cue || "",
        chapter_key: mCh.get(code) || "", status: d.status === "retired" ? "retired" : "ok" };
      const old = mOld.get(code);
      if (!old) {
        db.prepare(`INSERT INTO misc(course_id, code, chapter_key, kc, cw, belief, truth, contrast, cue, src, status, vocab_ver, updated_at, facet)
            VALUES (?,?,?,?,?,?,?,?,?,'author',?,?,?,?)`).run(cid, code, r.chapter_key, r.kc, r.cw, r.belief, r.truth, r.contrast, r.cue, r.status, ver1, t, r.facet);
        out.misc.add++; changed = true;
      } else if (old.status === "retired" && r.status !== "retired") throw packError(`오개념 ${code}는 은퇴한 코드라 다시 쓸 수 없어요. 새 코드를 쓰세요`);
      else if (old.src === "admin") continue;
      else if (["facet", "kc", "cw", "belief", "truth", "contrast", "cue", "chapter_key", "status"].some(k => (old[k] ?? null) !== (r[k] ?? null)) || old.src !== "author") {
        db.prepare("UPDATE misc SET facet=?, kc=?, cw=?, belief=?, truth=?, contrast=?, cue=?, chapter_key=?, src='author', status=?, vocab_ver=?, updated_at=? WHERE course_id=? AND code=?")
          .run(r.facet, r.kc, r.cw, r.belief, r.truth, r.contrast, r.cue, r.chapter_key, r.status, ver1, t, cid, code);
        if (r.status === "retired") out.misc.retire++; else out.misc.update++;
        changed = true;
      }
    }
    for (const [code, old] of mOld) if (old.src === "author" && old.status !== "retired" && M[code] == null) {
      db.prepare("UPDATE misc SET status='retired', vocab_ver=?, updated_at=? WHERE course_id=? AND code=?").run(ver1, t, cid, code);
      out.misc.retire++; changed = true;
    }
  }
  out.vocab_ver = changed ? bumpMeta(`vocab_ver:${cid}`) : ver0;

  // 문제별 저자 태그
  for (const p of withDx) {
    const c = cur.get(p.ext_id);
    const r = putAuthorTags(c.pid, c.version, p.dx);
    out.tags[r === "admin" ? "admin" : r === "same" ? "same" : "set"]++;
  }

  // 변형 묶음: dx에 family가 없는 문제는 저자 묶음에서 뺀다
  const fams = new Map();
  for (const p of withDx) if (p.dx.family) { if (!fams.has(p.dx.family)) fams.set(p.dx.family, []); fams.get(p.dx.family).push(p); }
  for (const p of withDx) if (!p.dx.family) db.prepare("DELETE FROM family_member WHERE problem_id = ? AND source = 'author'").run(cur.get(p.ext_id).pid);
  for (const [code, ps] of fams) {
    const base = ps.find(p => p.dx.role === "base"), bpid = cur.get(base.ext_id).pid;
    const old = db.prepare("SELECT source, principle FROM family WHERE course_id = ? AND code = ?").get(cid, code);
    if (old?.source !== "admin") db.prepare(`INSERT INTO family(course_id, code, facet, base_problem_id, principle, source, status, updated_at) VALUES (?,?,?,?,?,'author','ok',?)
        ON CONFLICT(course_id, code) DO UPDATE SET facet=excluded.facet, base_problem_id=excluded.base_problem_id, principle=excluded.principle, source='author', status='ok', updated_at=excluded.updated_at`)
      .run(cid, code, base.dx.facet, bpid, base.dx.principle ?? old?.principle ?? "", t);
    out.families++;
    for (const p of ps) {
      const c = cur.get(p.ext_id);
      if (db.prepare("SELECT source FROM family_member WHERE problem_id = ?").get(c.pid)?.source === "admin") continue;
      db.prepare(`INSERT INTO family_member(problem_id, course_id, family, role, delta_type, delta, body_hash, source, conf, updated_at) VALUES (?,?,?,?,?,?,?,'author',3,?)
          ON CONFLICT(problem_id) DO UPDATE SET course_id=excluded.course_id, family=excluded.family, role=excluded.role, delta_type=excluded.delta_type, delta=excluded.delta,
          body_hash=excluded.body_hash, source='author', conf=3, updated_at=excluded.updated_at`)
        .run(c.pid, cid, code, p.dx.role, p.dx.delta?.[0] ?? null, p.dx.delta?.[1] ?? "", bodyHash(c.kind, c.body), t);
      out.members++;
    }
  }
  db.prepare("DELETE FROM family WHERE course_id = ? AND source = 'author' AND code NOT IN (SELECT family FROM family_member WHERE course_id = ?)").run(cid, cid);
  return out;
}

/** dx.mis에 나오는 오개념 코드들 */
function misCodes(kind, mis) {
  if (mis == null) return [];
  if (kind === "ox") { const o = typeof mis === "string" ? { m: mis } : mis; return [o.m, o.mr].filter(Boolean); }
  if (kind === "short") return Array.isArray(mis) ? mis.map(x => x?.m).filter(Boolean) : [];
  return Array.isArray(mis) ? mis.filter(Boolean) : [];
}

/** 저자 dx → item_tag.diag (SPEC §8.2.4 모양 + v2 필드). 보기 번호는 0부터 */
function authorDiag(kind, body, dx) {
  const d = { cf: { facet: 3, depth: 3, mis: 3 } };
  if (dx.depth_why) d.depth_why = dx.depth_why;
  if (dx.facets2?.length) d.facets2 = dx.facets2;
  const mis = dx.mis;
  if (kind === "mc" && Array.isArray(mis)) {
    d.opt = {};
    mis.forEach((m, i) => { if (m !== "") d.opt[i] = m ? { m, d: 3, src: "author", why: body.why?.[i] || "" } : { m: null, d: 0 }; });
  } else if (kind === "ox" && mis != null) {
    const o = typeof mis === "string" ? { m: mis } : mis;
    d.ox = { m: body.ox === false ? (o.m ?? null) : null, d: 2, src: "author", mr: o.mr ?? null };
  } else if (kind === "short" && Array.isArray(mis)) {
    d.short = mis.map(x => ({ m: x.m ?? null, d: 2, ex: x.ex || [], ...(x.pattern ? { pattern: x.pattern } : {}) }));
  } else if (kind === "essay" && Array.isArray(mis)) {
    d.pts = mis.map((m, i) => ({ i, m: m ?? null }));
  }
  return d;
}

/**
 * 저자(또는 관리자)가 정한 진단 정보를 한 문제 버전에 쓴다: facet · depth · mis → item_tag (conf 3, review accepted).
 * dx.check(블라인드 Sonnet 풀이 결과 {ok, picked, note, model})는 item_tag.qa.solver로 옮긴다.
 * 관리자 태그(src 'admin')는 src='admin'으로 부를 때만 바꾼다. → "set" | "same" | "admin" | "missing"
 */
export function putAuthorTags(pid, version, dx, { src = "author" } = {}) {
  const r = db.prepare("SELECT p.course_id, pv.kind, pv.body FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = ? WHERE p.id = ?").get(version, pid);
  if (!r || !dx?.facet) return "missing";
  const old = db.prepare("SELECT * FROM item_tag WHERE problem_id = ? AND version = ?").get(pid, version);
  if (old?.src === "admin" && src !== "admin") return "admin";
  const body = J(r.body), kc = dx.facet.split(".")[0];
  const k2 = [...new Set((dx.facets2 || []).map(f => f.split(".")[0]).filter(k => k !== kc))];
  const kcs = [[kc, k2.length ? 0.7 : 1], ...k2.map(k => [k, 0.3 / k2.length])];
  const qa = { ...J(old?.qa) };
  if (dx.check) qa.solver = { ok: !!dx.check.ok, picked: dx.check.picked ?? null, note: String(dx.check.note || ""), model: String(dx.check.model || "") };
  const row = { body_hash: bodyHash(r.kind, body), vocab_ver: Number(meta(`vocab_ver:${r.course_id}`) || 0), kcs: JSON.stringify(kcs),
    diag: JSON.stringify(authorDiag(r.kind, body, dx)), qa: JSON.stringify(qa), facet: dx.facet, depth: dx.depth ?? null };
  if (old && old.src === src && old.review === "accepted" && old.conf === 3 && ["body_hash", "vocab_ver", "kcs", "diag", "qa", "facet", "depth"].every(k => (old[k] ?? null) === row[k])) return "same";
  db.prepare(`INSERT INTO item_tag(problem_id, version, body_hash, vocab_ver, prompt_ver, model, kcs, diag, qa, review, updated_at, facet, depth, src, conf)
      VALUES (?,?,?,?,0,?,?,?,?,'accepted',?,?,?,?,3)
      ON CONFLICT(problem_id, version) DO UPDATE SET body_hash=excluded.body_hash, vocab_ver=excluded.vocab_ver, prompt_ver=0, model=excluded.model, kcs=excluded.kcs,
      diag=excluded.diag, qa=excluded.qa, review='accepted', updated_at=excluded.updated_at, facet=excluded.facet, depth=excluded.depth, src=excluded.src, conf=3`)
    .run(pid, version, row.body_hash, row.vocab_ver, src, row.kcs, row.diag, row.qa, now(), row.facet, row.depth, src);
  return "set";
}

/**
 * 새 버전이 해설(s)·바른 진술(fix)만 바뀌었으면 저자·관리자 태그와 변형 묶음 지문을 그대로 이어받는다 (DATA §5.3).
 * 관리자 화면에서 문제를 고친 뒤에도 부르면 된다. 이어받았으면 true
 */
export function carryTags(pid, fromV, toV) {
  const [a, b] = [fromV, toV].map(v => db.prepare("SELECT kind, body FROM problem_version WHERE problem_id = ? AND version = ?").get(pid, v));
  if (!a || !b) return false;
  const [ba, bb] = [J(a.body), J(b.body)];
  if (bodyHash(a.kind, ba, { core: true }) !== bodyHash(b.kind, bb, { core: true })) return false;
  const tag = db.prepare("SELECT * FROM item_tag WHERE problem_id = ? AND version = ? AND src IN ('author', 'admin')").get(pid, fromV);
  if (!tag) return false;
  const h = bodyHash(b.kind, bb);
  db.prepare(`INSERT OR REPLACE INTO item_tag(problem_id, version, body_hash, vocab_ver, prompt_ver, model, kcs, diag, qa, review, updated_at, facet, depth, src, conf)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid, toV, h, tag.vocab_ver, tag.prompt_ver, tag.model, tag.kcs, tag.diag, tag.qa, tag.review, now(), tag.facet, tag.depth, tag.src, tag.conf);
  db.prepare("UPDATE family_member SET body_hash = ? WHERE problem_id = ? AND body_hash = ?").run(h, pid, bodyHash(a.kind, ba));
  return true;
}

// ───────── 문제 읽기 ─────────
export function coursePayload(id) {
  const c = db.prepare("SELECT c.*, s.code semester_code, s.name semester_name FROM course c JOIN semester s ON s.id = c.semester_id WHERE c.id = ?").get(id);
  if (!c) return null;
  const chapters = db.prepare("SELECT id, key, title, short, grp, info FROM chapter WHERE course_id = ? ORDER BY sort").all(id)
    .map(ch => ({ id: ch.id, key: ch.key, title: ch.title, short: ch.short, group: ch.grp, ...J(ch.info) }));
  const problems = db.prepare(`SELECT p.id, p.ext_id, p.chapter_id, p.current_version v, pv.kind, pv.star, pv.body
      FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = ? AND p.status = 'published' ORDER BY p.sort`).all(id)
    .map(r => ({ id: r.id, ext_id: r.ext_id, chapter_id: r.chapter_id, v: r.v, kind: r.kind, star: !!r.star, ...J(r.body) }));
  return { id: c.id, code: c.code, short: c.short, name: c.name, professor: c.professor, meta: c.meta,
    semester: { code: c.semester_code, name: c.semester_name }, ...J(c.info), chapters, problems };
}

// ───────── 통계 ─────────
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** 문제(버전)별: 첫 시도 정답률, 풀이 시간 중앙값, 모르겠어요 비율, 오답 쏠림 */
export function problemStats({ courseId = null, since = null } = {}) {
  const where = [], args = [];
  if (courseId) { where.push("p.course_id = ?"); args.push(courseId); }
  const probs = db.prepare(`SELECT p.id, p.ext_id, p.course_id, p.current_version v, p.status, pv.kind, pv.star, pv.body, ch.id chapter_id, ch.title chapter, c.short course
      FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      JOIN chapter ch ON ch.id = p.chapter_id JOIN course c ON c.id = p.course_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.sort, p.sort`).all(...args);
  const evArgs = []; let evWhere = "type IN ('answer_submit','idk','problem_shown')";
  if (since) { evWhere += " AND server_ts >= ?"; evArgs.push(since); }
  if (courseId) { evWhere += " AND problem_id IN (SELECT id FROM problem WHERE course_id = ?)"; evArgs.push(courseId); }
  const rows = db.prepare(`SELECT device_id, problem_id, version, type, payload FROM event WHERE ${evWhere} ORDER BY client_ts`).all(...evArgs);
  const acc = new Map();
  const get = (pid, v) => { const k = pid + ":" + v; if (!acc.has(k)) acc.set(k, { shown: new Set(), first: new Map(), times: [], idk: 0, answers: new Map(), devices: new Set() }); return acc.get(k); };
  for (const r of rows) {
    const a = get(r.problem_id, r.version); const pl = J(r.payload); a.devices.add(r.device_id);
    if (r.type === "problem_shown") a.shown.add(r.device_id);
    else if (r.type === "idk") { a.idk++; if (!a.first.has(r.device_id)) a.first.set(r.device_id, false); }
    else if (r.type === "answer_submit") {
      if (!a.first.has(r.device_id)) { a.first.set(r.device_id, !!pl.correct); if (Number.isFinite(pl.ms) && pl.ms > 0 && pl.ms < 3.6e6) a.times.push(pl.ms); }
      if (!pl.correct && pl.answer !== undefined) { const key = String(pl.answer).slice(0, 80); a.answers.set(key, (a.answers.get(key) || 0) + 1); }
    }
  }
  const nReports = new Map(db.prepare("SELECT problem_id, COUNT(*) n FROM report WHERE status = 'open' GROUP BY problem_id").all().map(r => [r.problem_id, r.n]));
  return probs.map(p => {
    const a = acc.get(p.id + ":" + p.v); const b = J(p.body);
    const firsts = a ? [...a.first.values()] : [];
    const wrong = a ? [...a.answers.entries()].sort((x, y) => y[1] - x[1]) : [];
    const wrongTotal = wrong.reduce((s, x) => s + x[1], 0);
    return { id: p.id, ext_id: p.ext_id, no: b.no || p.ext_id, course_id: p.course_id, course: p.course, chapter_id: p.chapter_id, chapter: p.chapter, kind: p.kind, v: p.v,
      status: p.status, star: !!p.star,
      q: String(b.q || "").replace(/<[^>]+>/g, "").slice(0, 120),
      users: a ? a.devices.size : 0, attempts: firsts.length,
      accuracy: firsts.length ? firsts.filter(Boolean).length / firsts.length : null,
      median_ms: a ? median(a.times) : null,
      idk_rate: a && a.shown.size ? a.idk / a.shown.size : null,
      top_wrong: wrong[0] ? { answer: wrong[0][0], share: wrong[0][1] / wrongTotal, n: wrong[0][1] } : null,
      open_reports: nReports.get(p.id) || 0 };
  });
}

export function overview() {
  const day = new Date(Date.now() - 864e5).toISOString(), week = new Date(Date.now() - 7 * 864e5).toISOString();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    devices: one("SELECT COUNT(*) n FROM device").n,
    consented: one("SELECT COUNT(*) n FROM device WHERE consent = 1").n,
    active_day: one("SELECT COUNT(DISTINCT device_id) n FROM event WHERE server_ts >= ?", day).n,
    active_week: one("SELECT COUNT(DISTINCT device_id) n FROM event WHERE server_ts >= ?", week).n,
    answers_day: one("SELECT COUNT(*) n FROM event WHERE type = 'answer_submit' AND server_ts >= ?", day).n,
    answers_week: one("SELECT COUNT(*) n FROM event WHERE type = 'answer_submit' AND server_ts >= ?", week).n,
    open_reports: one("SELECT COUNT(*) n FROM report WHERE status = 'open'").n,
    courses: db.prepare(`SELECT c.id, c.short, c.name, s.code semester, (SELECT COUNT(*) FROM problem WHERE course_id = c.id AND status = 'published') problems,
        (SELECT COUNT(*) FROM enrollment WHERE course_id = c.id) enrolled FROM course c JOIN semester s ON s.id = c.semester_id ORDER BY s.sort, c.sort`).all(),
  };
}

/** 한 문제의 버전별 첫 시도 정답률·풀이 시간 (수정 전후 비교) */
export function versionStats(problemId) {
  const rows = db.prepare("SELECT device_id, version, type, payload FROM event WHERE problem_id = ? AND type IN ('answer_submit','idk') ORDER BY client_ts").all(problemId);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.version)) by.set(r.version, { first: new Map(), times: [] });
    const a = by.get(r.version); if (a.first.has(r.device_id)) continue;
    const pl = J(r.payload);
    a.first.set(r.device_id, r.type === "answer_submit" && !!pl.correct);
    if (r.type === "answer_submit" && Number.isFinite(pl.ms) && pl.ms > 0 && pl.ms < 3.6e6) a.times.push(pl.ms);
  }
  return [...by.entries()].map(([version, a]) => {
    const f = [...a.first.values()];
    return { version, attempts: f.length, accuracy: f.length ? f.filter(Boolean).length / f.length : null, median_ms: median(a.times) };
  }).sort((x, y) => y.version - x.version);
}

/** 최근 며칠의 날짜별 사용자 수·풀이 수 (한국 시간 기준) */
export function activity(days = 14) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(`SELECT substr(datetime(server_ts, '+9 hours'), 1, 10) d, COUNT(DISTINCT device_id) users,
      SUM(type = 'answer_submit') answers FROM event WHERE server_ts >= ? GROUP BY d ORDER BY d`).all(since);
  const map = new Map(rows.map(r => [r.d, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() + 9 * 36e5 - i * 864e5).toISOString().slice(0, 10);
    const r = map.get(d); out.push({ date: d, users: r ? r.users : 0, answers: r ? Number(r.answers) : 0 });
  }
  return out;
}

// ───────── 백업 ─────────
// 서버를 끄지 않고도 일관된 복사본을 만든다 (SQLite VACUUM INTO). 최근 keep개만 남긴다.
export function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter(f => /^app-\d{8}-\d{4}\.db$/.test(f)).sort().reverse()
    .map(f => { const s = statSync(join(BACKUP_DIR, f)); return { name: f, size: s.size, at: s.mtime.toISOString() }; });
}
export function backup({ keep = 7 } = {}) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const k = new Date(Date.now() + 9 * 36e5).toISOString();          // 한국 시간으로 파일 이름
  const name = `app-${k.slice(0, 10).replace(/-/g, "")}-${k.slice(11, 16).replace(":", "")}.db`;
  const file = join(BACKUP_DIR, name);
  if (!existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  listBackups().slice(keep).forEach(b => unlinkSync(join(BACKUP_DIR, b.name)));
  return listBackups()[0];
}

// ───────── AI 채점 도우미 (서술형) ─────────
export function aiSave({ deviceId, problemId, version, answer, result, model, ms }) {
  return Number(db.prepare("INSERT INTO ai_grade(device_id, problem_id, version, answer, result, model, ms, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(deviceId, problemId, version, answer, JSON.stringify(result), model, ms, now()).lastInsertRowid);
}
/** 사용자가 마지막에 "맞았어요/틀렸어요"를 누르면 그 판정을 붙인다 (자기 기기의 기록만) */
export function aiSetUserVerdict(id, deviceId, verdict) {
  return db.prepare("UPDATE ai_grade SET user_verdict = ? WHERE id = ? AND device_id = ?").run(verdict, id, deviceId).changes;
}
/** 관리자 대시보드: 사용 수, 사용자 판정과의 일치율 (AI가 '맞음'이면 correct, '부분'·'틀림'이면 wrong으로 본다) */
export function aiStats() {
  const rows = db.prepare("SELECT result, user_verdict, ms, created_at FROM ai_grade").all();
  const week = new Date(Date.now() - 7 * 864e5).toISOString();
  let judged = 0, agree = 0, msSum = 0;
  for (const r of rows) {
    msSum += r.ms;
    if (!r.user_verdict) continue;
    judged++;
    const ai = J(r.result).verdict === "correct" ? "correct" : "wrong";
    if (ai === r.user_verdict) agree++;
  }
  return { total: rows.length, week: rows.filter(r => r.created_at >= week).length, judged, agree,
    agreement: judged ? agree / judged : null, avg_ms: rows.length ? Math.round(msSum / rows.length) : null };
}

// ───────── 학습 리포트: 메타 값 · AI 사용량 · 막힌 모델 ─────────
/** insight_meta 값 (없으면 null). value를 주면 저장하고, null이면 지운다 */
export function meta(key, value) {
  if (value === null) { db.prepare("DELETE FROM insight_meta WHERE key = ?").run(key); return null; }
  if (value !== undefined) { db.prepare("INSERT INTO insight_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value)); return String(value); }
  return db.prepare("SELECT value FROM insight_meta WHERE key = ?").get(key)?.value ?? null;
}
/** 숫자 메타 값(tag_rev:<cid> 등)을 1 올리고 새 값을 돌려준다 */
export const bumpMeta = key => Number(db.prepare(`INSERT INTO insight_meta(key, value) VALUES (?, '1')
  ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value`).get(key).value);

// Gemini 무료 한도는 태평양 시간 자정에 풀리므로 사용량도 태평양 날짜로 센다
const PT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayPT = (t = Date.now()) => PT_DAY.format(t);          // "2026-10-25"
const tok = x => Math.max(0, Math.round(Number(x) || 0));
/** 성공한 호출 하나를 그날 사용량에 더한다. usage = { tok_in, tok_out, tok_think } */
export function budgetAdd(day, model, purpose, usage = {}) {
  db.prepare(`INSERT INTO ai_budget(day, model, purpose, calls, tok_in, tok_out, tok_think) VALUES (?,?,?,1,?,?,?)
      ON CONFLICT(day, model, purpose) DO UPDATE SET calls = calls + 1, tok_in = tok_in + excluded.tok_in,
      tok_out = tok_out + excluded.tok_out, tok_think = tok_think + excluded.tok_think`)
    .run(day, model, purpose, tok(usage.tok_in), tok(usage.tok_out), tok(usage.tok_think));
}
/** 오늘(태평양 날짜) 사용량 합계. model이 null이면 모든 모델, purpose를 주면 그 용도만 → { calls, tok_in, tok_out, tok_think } */
export function budgetToday(model = null, purpose = null) {
  return { ...db.prepare(`SELECT COALESCE(SUM(calls), 0) calls, COALESCE(SUM(tok_in), 0) tok_in, COALESCE(SUM(tok_out), 0) tok_out, COALESCE(SUM(tok_think), 0) tok_think
      FROM ai_budget WHERE day = ?1 AND (?2 IS NULL OR model = ?2) AND (?3 IS NULL OR purpose = ?3)`).get(dayPT(), model, purpose) };
}
/** 모델을 until까지 쓰지 않는다 (하루 한도 429 → 태평양 자정, 404 → 24시간). 저장한 시각(ISO)을 돌려준다 */
export function blockModel(model, until, why) {
  const u = new Date(until).toISOString();
  db.prepare("INSERT INTO ai_block(model, until, why) VALUES (?,?,?) ON CONFLICT(model) DO UPDATE SET until = excluded.until, why = excluded.why").run(model, u, String(why || ""));
  return u;
}
/** 막혀 있으면 풀리는 시각(ISO), 아니면 null. 시간이 지난 차단은 지운다 */
export function blocked(model) {
  const r = db.prepare("SELECT until FROM ai_block WHERE model = ?").get(model);
  if (!r) return null;
  const t = now(); if (r.until > t) return r.until;
  db.prepare("DELETE FROM ai_block WHERE model = ? AND until <= ?").run(model, t);
  return null;
}

// ───────── 학습 리포트 v2: 세부 포인트 · 오개념 · 변형 묶음 읽기 (DATA.md §5.4) ─────────
// 코드(kc · facet · misc)는 영원히 같은 뜻이다: 이름을 바꿔도 코드는 그대로, 없앨 때는 status 'retired'로 두고 다시 쓰지 않는다.
// 학습자 페르소나(DECISIONS #8)가 이 코드로 쌓이므로 행을 지우지 않는다.

/** 과목의 세부 포인트. all=true면 은퇴한 것(merged_into 포함)까지 → [{code, kc, name, statement, kind, confusable[], status, merged_into, source}] */
export function facetsOf(courseId, { all = false } = {}) {
  return db.prepare(`SELECT code, kc, name, statement, kind, confusable, status, merged_into, source, vocab_ver FROM facet
      WHERE course_id = ? ${all ? "" : "AND status != 'retired'"} ORDER BY sort, code`).all(courseId)
    .map(r => ({ ...r, confusable: J(r.confusable, []) }));
}

/** 과목의 오개념 (facet을 주면 그 세부 포인트 것만). all=true면 거절·은퇴한 것까지 */
export function miscOf(courseId, facet = null, { all = false } = {}) {
  return db.prepare(`SELECT code, facet, kc, cw, chapter_key, belief, truth, contrast, cue, src, status, vocab_ver FROM misc
      WHERE course_id = ?1 AND (?2 IS NULL OR facet = ?2) ${all ? "" : "AND status NOT IN ('rejected', 'retired')"} ORDER BY code`).all(courseId, facet);
}

/** 문제별 현재 버전 지문 → Map(pid → { hash, kind, body, status, version, star }) */
function currentItems(courseId) {
  return new Map(db.prepare(`SELECT p.id, p.status, p.current_version v, pv.kind, pv.star, pv.body FROM problem p
      JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE p.course_id = ?`).all(courseId)
    .map(r => { const body = J(r.body); return [r.id, { hash: bodyHash(r.kind, body), kind: r.kind, body, status: r.status, version: r.v, star: !!r.star }]; }));
}

/** 변형 묶음 → [{code, facet, base, principle, source, status, members:[{pid, role, delta_type, delta, conf, stale, hidden}]}] (거절된 묶음은 빼고) */
export function familiesOf(courseId) {
  const items = currentItems(courseId);
  const by = new Map(db.prepare("SELECT code, facet, base_problem_id base, principle, source, status FROM family WHERE course_id = ? AND status != 'rejected' ORDER BY code").all(courseId)
    .map(f => [f.code, { ...f, members: [] }]));
  for (const m of db.prepare("SELECT problem_id pid, family, role, delta_type, delta, body_hash, conf FROM family_member WHERE course_id = ? ORDER BY problem_id").all(courseId)) {
    const it = items.get(m.pid);
    by.get(m.family)?.members.push({ pid: m.pid, role: m.role, delta_type: m.delta_type, delta: m.delta, conf: m.conf,
      stale: !it || it.hash !== m.body_hash, hidden: it?.status !== "published" });
  }
  return [...by.values()];
}

/** 태그 한 줄이 지금 버전에 유효하고 믿을 만한가 (conf ≥ 2 또는 사람이 확인, 지문 일치) */
const tagUsable = (tag, it) => tag && it && tag.facet && tag.body_hash === it.hash && !["rejected", "stale"].includes(tag.review)
  && (tag.conf >= 2 || ["accepted", "edited"].includes(tag.review));

/** 한 문제가 '고를 수 있게' 내놓는 오개념들 (d ≥ 2만: 그 오개념의 증거가 될 만한 것) */
function offeredMisc(diag) {
  const out = new Set(), ok = x => x?.m && (x.d ?? 2) >= 2;
  for (const o of Object.values(diag.opt || {})) if (ok(o)) out.add(o.m);
  if (ok(diag.ox)) out.add(diag.ox.m);
  if (diag.ox?.mr) out.add(diag.ox.mr);
  for (const s of diag.short || []) if (ok(s)) out.add(s.m);
  for (const s of diag.pts || []) if (s?.m) out.add(s.m);
  return [...out];
}

/**
 * 세부 포인트마다 문제가 얼마나 갖춰졌는지와 부족한 것 (DATA.md §7). 공개 문제만 세고, 승인 대기(숨김) 문제는 pending으로 따로 센다.
 * 부족분(gaps)은 승인 대기 문제까지 넣어 계산한다 (이미 써 둔 변형을 또 쓰지 않게).
 * → [{facet, kc, name, status, n, d12, d34, deltaTypes[], miscOffers:{m:n}, lead, star, exam, target, pending, gaps:[…]}]
 *   gap: {need:"base", depth:"1-2", n} · {need:"near", depth:"3-4", avoid_delta[], misc, n} · {need:"misc", misc, n} · {need:"more", n}
 */
export function coverage(courseId) {
  const items = currentItems(courseId);
  const tags = db.prepare("SELECT t.* FROM item_tag t JOIN problem p ON p.id = t.problem_id AND t.version = p.current_version WHERE p.course_id = ?").all(courseId);
  const fm = new Map(db.prepare("SELECT problem_id, role, delta_type FROM family_member WHERE course_id = ?").all(courseId).map(r => [r.problem_id, r]));
  const blank = () => ({ n: 0, d12: 0, d34: 0, deltaTypes: [], miscOffers: {} });
  const per = new Map(facetsOf(courseId).map(f => [f.code, { facet: f.code, kc: f.kc, name: f.name, status: f.status, ...blank(), star: false, exam: false, pending: 0, all: blank() }]));
  const add = (c, it, tag) => {
    c.n++; if (tag.depth != null) { if (tag.depth <= 2) c.d12++; else c.d34++; }
    const m = fm.get(tag.problem_id); if (m?.role === "near" && m.delta_type && !c.deltaTypes.includes(m.delta_type)) c.deltaTypes.push(m.delta_type);
    for (const code of offeredMisc(J(tag.diag))) c.miscOffers[code] = (c.miscOffers[code] || 0) + 1;
  };
  for (const tag of tags) {
    const it = items.get(tag.problem_id), c = per.get(tag.facet);
    if (!c || !tagUsable(tag, it)) continue;
    add(c.all, it, tag);
    if (it.status !== "published") { c.pending++; continue; }
    add(c, it, tag);
    if (it.star) c.star = true;
    if (it.body.exams?.length) c.exam = true;
  }
  const miscByFacet = new Map();
  for (const m of miscOf(courseId)) { if (!miscByFacet.has(m.facet)) miscByFacet.set(m.facet, []); miscByFacet.get(m.facet).push(m.code); }
  return [...per.values()].map(({ all, ...c }) => {
    const target = c.star || c.exam ? 6 : 4, gaps = [];
    const lead = (miscByFacet.get(c.facet) || []).map(m => [m, all.miscOffers[m] || 0]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (!all.d12) gaps.push({ need: "base", depth: "1-2", n: 1 });
    const nearN = Math.max(0, 2 - all.deltaTypes.length);
    if (nearN) gaps.push({ need: "near", depth: "3-4", avoid_delta: all.deltaTypes, ...(lead ? { misc: lead[0] } : {}), n: nearN });
    if (lead && lead[1] + nearN < 3) gaps.push({ need: "misc", misc: lead[0], n: 3 - lead[1] - nearN });
    const planned = gaps.reduce((s, g) => s + g.n, 0);
    if (all.n + planned < target) gaps.push({ need: "more", n: target - all.n - planned });
    return { ...c, lead: lead?.[0] ?? null, target, gaps };
  });
}

/** 공개 문제 중 믿을 만한 태그(conf ≥ 2 또는 사람이 확인)가 있는 비율 — v2 관문(≥ 90%)용 → { items, tagged, share } */
export function tagSummary(courseId) {
  const items = currentItems(courseId);
  const tags = new Map(db.prepare("SELECT t.* FROM item_tag t JOIN problem p ON p.id = t.problem_id AND t.version = p.current_version WHERE p.course_id = ?").all(courseId).map(t => [t.problem_id, t]));
  let n = 0, ok = 0;
  for (const [pid, it] of items) if (it.status === "published") { n++; if (tagUsable(tags.get(pid), it)) ok++; }
  return { items: n, tagged: ok, share: n ? ok / n : 0 };
}

/** 과목별 v2 리포트 관문 insight_meta('v2_ready:<cid>'). on을 주면 켜거나(true) 끈다(false) */
export function v2Ready(courseId, on) {
  if (on !== undefined) meta(`v2_ready:${courseId}`, on ? "1" : null);
  return meta(`v2_ready:${courseId}`) === "1";
}

/**
 * 관리자 화면용: 개념·세부 포인트·오개념 하나를 은퇴시킨다 (행은 지우지 않는다). mergedInto는 kc·facet만.
 * 은퇴한 코드는 다시 쓰지 않는다. vocab_ver를 올리고 새 값을 돌려준다
 */
export function retireVocab(courseId, table, code, mergedInto = null) {
  if (!["kc", "facet", "misc"].includes(table)) throw new Error("kc · facet · misc 만 은퇴시킬 수 있어요");
  const ver = bumpMeta(`vocab_ver:${courseId}`);
  const set = table === "misc" ? "status = 'retired'" : "status = 'retired', merged_into = ?4";
  const args = table === "misc" ? [ver, now(), courseId, code] : [ver, now(), courseId, mergedInto, code];
  db.prepare(`UPDATE ${table} SET ${set}, vocab_ver = ?1, updated_at = ?2 WHERE course_id = ?3 AND code = ${table === "misc" ? "?4" : "?5"}`).run(...args);
  return ver;
}
