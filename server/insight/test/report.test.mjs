// 학습 리포트 서버 시험 (ctx.js · evidence.js · report.js · server.js 라우트):  node --test "server/insight/test/*.test.mjs"
// 버리는 DB 복사본 둘(VACUUM INTO, INSIGHT_TMP 또는 OS 임시 폴더): A는 포트 4004(REPORT_PORT) 서버, B는 이 프로세스에서 모양·시간 재기.
// 진짜 Gemini는 부르지 않는다 (GEMINI_BASE = 아무도 듣지 않는 포트). 끝나면 서버를 끄고 복사본을 지운다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..", "..", "..");
const PORT = +(process.env.REPORT_PORT || 4004), BASE = `http://127.0.0.1:${PORT}`, DEAD = `http://127.0.0.1:${+(process.env.DEAD_PORT || 4014)}`;
const KEY = "fake-" + randomBytes(8).toString("hex");          // 로그에 나오면 안 되는 값
const HEAVY = "DEVICE_ID_EXAMPLE";
const rid = () => randomBytes(12).toString("base64url");

// 1) 버리는 복사본: 원본 → A, A → B (둘이 같은 내용이 되게)
const SRC = join(ROOT, "data", "app.db");
const TMP = mkdtempSync(join(process.env.INSIGHT_TMP || tmpdir(), "insight-rep-")), A = join(TMP, "a.db"), B = join(TMP, "b.db");
const vacuum = (from, to) => { const s = new DatabaseSync(from, { readOnly: true }); s.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`); s.close(); };
if (!existsSync(SRC)) throw new Error("data/app.db가 없어요");
vacuum(SRC, A); vacuum(A, B);

// 2) A로 서버 켜기 (복사본에 남은 예전 insight 행은 지우고 시작)
//    원본이 새 서버로 한 번도 안 켜졌으면 insight 표가 없다 → db.js처럼 schema.sql을 먼저 적용 (CREATE IF NOT EXISTS라 있으면 그대로)
{ const a = new DatabaseSync(A); a.exec(readFileSync(join(ROOT, "server", "schema.sql"), "utf8")); a.exec("DELETE FROM insight"); a.close(); }
const logs = [];
const srv = spawn(process.execPath, [join(ROOT, "server", "server.js")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DB_PATH: A, GEMINI_API_KEY: KEY, GEMINI_BASE: DEAD, ADMIN_REMOTE: "" } });
for (const s of [srv.stdout, srv.stderr]) s.on("data", d => logs.push(String(d)));
await new Promise((ok, no) => {
  const t = setTimeout(() => no(new Error("서버가 켜지지 않았어요:\n" + logs.join(""))), 15000);
  srv.stdout.on("data", d => /실행 중/.test(d) && (clearTimeout(t), ok()));
  srv.on("exit", c => { clearTimeout(t); no(new Error(`서버가 멈췄어요 (${c}):\n` + logs.join(""))); });
});
const ext = new DatabaseSync(A);                    // 서버 밖 연결: 확인용 읽기 + 다른 프로그램처럼 고치기 (data_version이 바뀐다)
after(async () => {
  ext.close();
  if (srv.exitCode == null) { srv.kill(); await new Promise(r => srv.once("exit", r)); }
  rmSync(TMP, { recursive: true, force: true });
});

// 3) B로 같은 모듈을 이 프로세스에서 (db.js는 불러올 때 DB_PATH를 읽는다)
process.env.DB_PATH = B;
const D = await import("../../db.js"), C = await import("../ctx.js"), EV = await import("../evidence.js"), R = await import("../report.js");
const ENG = await import("../../../web/js/insight-engine.js"), { PARAMS } = await import("../params.js");
let cver = 1;
class Pk { constructor(buf, type) { this.buf = buf; this.type = type; } }
R.initInsight({ Packed: Pk, contentVer: () => cver });

async function call(path, { dev = HEAVY, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers }; if (dev) h["X-Device"] = dev; if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { }
  return { status: res.status, h: res.headers, json, text };
}
const med = a => pct(a, 0.5);
const timing = r => +((/insight;dur=([\d.]+)/.exec(r.h.get("server-timing") || "") || [])[1] ?? NaN);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
async function newDevice(consent) { const id = rid(); const r = await call("/api/device", { dev: null, method: "POST", body: { id, consent } }); assert.equal(r.status, 200); return id; }

// 뽑은 리포트(결정 7): 엔진 문서 + made_at·ev_rid (저장) + since·can_make (보낼 때)
const SNAP = ["made_at", "dfp", "ev_rid", "since", "stale", "can_make"];
const bare = d => { const o = { ...d, fp: null }; for (const k of SNAP) delete o[k]; return o; };
function checkSnap(d, cid) {
  checkDoc(d, cid);
  assert.ok(isStr(d.made_at) && Number.isFinite(Date.parse(d.made_at)), "made_at"); assert.ok(isInt(d.ev_rid), "ev_rid");
  assert.ok(isInt(d.since.answers) && d.since.answers >= 0, "since"); assert.equal(typeof d.can_make, "boolean");
}
function checkNone(d, cid) {
  assert.deepEqual(Object.keys(d).sort(), ["can_make", "cid", "have", "need", "state", "v"]);
  assert.equal(d.v, 1); assert.equal(d.cid, cid); assert.equal(d.state, "none"); assert.equal(typeof d.can_make, "boolean");
  for (const k of ["n_eff", "events", "chapters"]) assert.ok(isNum(d.have[k]), "have." + k);
  for (const k of ["n_eff", "chapters"]) assert.ok(isNum(d.need[k]), "need." + k);      // 결정 8: 문턱은 n_eff·단원 수만
  assert.equal(d.can_make, d.have.n_eff >= d.need.n_eff && d.have.chapters >= d.need.chapters);
}

// ───────── Contract 4 모양 검사 ─────────
const vlen = s => (ENG.visLen ? ENG.visLen(s) : s.length);          // 보이는 길이 (수식은 엔진 규칙대로 줄여 센다)
const isInt = x => Number.isInteger(x), isNum = x => typeof x === "number" && Number.isFinite(x), isStr = x => typeof x === "string";
const FTYPES = ["misc", "confusion", "gap", "unclear", "habit", "relearn", "fluency", "hasty", "fatigue", "fb_skip", "format", "relative"];
const CAVEATS = ["relative_only", "imported_history", "no_mc", "untagged", "few_timed", "list_time"];
function checkDoc(d, cid) {
  assert.equal(d.v, 1); assert.equal(d.cid, cid); assert.ok(isStr(d.fp) && d.fp.length >= 8, "fp");
  assert.equal(d.narr_state, "off");
  if (d.state === "locked") {
    for (const k of ["n_eff", "events", "chapters"]) assert.ok(isNum(d.have[k]), "have." + k);
    assert.deepEqual(d.need, { n_eff: 30, chapters: 3 });
    assert.ok(Array.isArray(d.next.pids) && d.next.pids.length <= 12 && d.next.pids.every(isInt));
    return;
  }
  assert.equal(d.state, "ready");
  assert.ok(["relative", "absolute"].includes(d.frame)); assert.match(d.asOf, /^\d{4}-\d{2}-\d{2}$/);
  for (const k of ["first", "choice", "legacy", "n_eff"]) assert.ok(isNum(d.basis[k]), "basis." + k);
  assert.ok(isStr(d.headline) && d.headline.length > 5, "headline");
  assert.ok(Array.isArray(d.findings) && d.findings.length <= 3);
  const steps = new Set(d.plan.steps.map(s => s.id)), eids = new Set();
  d.findings.forEach((f, i) => {
    assert.equal(f.id, "F" + (i + 1)); assert.ok(FTYPES.includes(f.type), "type " + f.type);
    assert.ok([null, "sure", "likely", "hyp"].includes(f.conf));
    if (f.unit !== null) { assert.ok(["kc", "topic", "chapter"].includes(f.unit.kind)); assert.ok(isStr(f.unit.code) && isStr(f.unit.name)); }
    assert.ok(f.with === null || (isStr(f.with.code) && isStr(f.with.name)));
    for (const k of ["diag", "truth", "contrast", "cue", "signals"]) assert.ok(isStr(f.text[k]), "text." + k);
    assert.equal(typeof f.hidden_truth, "boolean");
    assert.ok(isInt(f.avoided) && isInt(f.n_items));
    assert.ok(f.plan === null || steps.has(f.plan), "plan " + f.plan);
    for (const e of f.evidence) {
      assert.match(e.id, /^E\d+$/); assert.ok(!eids.has(e.id), "E id 중복"); eids.add(e.id);
      assert.ok(isInt(e.pid) && isStr(e.ext) && isStr(e.ch) && isStr(e.kind) && isStr(e.label) && isStr(e.role));
      assert.equal(typeof e.hidden, "boolean"); assert.equal(typeof e.fast, "boolean"); assert.match(e.day, /^\d{1,2}\/\d{1,2}$/);
      assert.ok(isStr(e.stem) && vlen(e.stem) <= 120, "stem ≤120"); assert.ok(isStr(e.chosen_text) && vlen(e.chosen_text) <= 80, "chosen_text ≤80");
      assert.ok(isStr(e.trap)); if (e.hidden) assert.equal(e.trap, "", "아직 틀린 문제에 함정 문장");
      assert.ok(!/<[a-z][^>]*>/i.test(e.stem), "stem에 HTML");
    }
  });
  assert.ok(Array.isArray(d.plan.today.pids) && d.plan.today.pids.every(isInt) && isNum(d.plan.today.minutes));
  for (const s of d.plan.steps) {
    assert.match(s.id, /^P\d$/); assert.ok(isStr(s.type) && isStr(s.title)); assert.match(s.scope, /^Q:\d+(\.\d+)*$/); assert.ok(isInt(s.n));
    assert.ok(s.read === null || (isStr(s.read.chapter) && (s.read.pid === null || isInt(s.read.pid))));
  }
  for (const u of d.units) {
    assert.ok(["chapter", "topic", "kc"].includes(u.kind)); assert.ok(isStr(u.code) && isStr(u.name) && isStr(u.ch));
    assert.ok(["weak", "watch", "ok", "solid", "pending"].includes(u.label));
    if ("acc" in u) assert.ok(isInt(u.acc.c) && isInt(u.acc.n) && u.acc.c <= u.acc.n, "acc");          // 엔진 쪽이 채우는 중 (있으면 모양만)
    assert.ok(u.band.length === 2 && u.band[0] >= 0 && u.band[1] <= 1 && u.band[0] <= u.band[1], "band");
    assert.ok(u.pred.length === 2 && u.pred[0] <= u.pred[1], "pred");
    assert.ok([null, "fixed", "slipping"].includes(u.mark)); assert.ok(isInt(u.n) && u.n > 0);
    for (const k of ["c", "w", "idk"]) assert.ok(isInt(u.counts[k]));
  }
  assert.ok(isInt(d.relearn.resolved) && isInt(d.relearn.confirmed) && d.relearn.due.every(isInt));
  for (const s of d.strong) assert.ok(isStr(s.code) && isStr(s.name));
  for (const s of d.pending) assert.ok(isStr(s.code) && isStr(s.name) && isInt(s.n));
  assert.ok(d.caveats.every(c => CAVEATS.includes(c)), "caveats " + d.caveats); assert.ok(d.caveats.includes("relative_only"));
  assert.ok([null, "fast", "normal", "slow"].includes(d.time.speed) && isInt(d.time.n_timed) && d.time.notes.every(isStr));
}

// ───────── 시험 ─────────
let enrolled = [], docs = {}, etags = {};
const post = (path, o = {}) => call(path, { ...o, method: "POST" });

test("과목 묶음(ctx): Contract 2 모양 · 주제 이름 · 옛 버전 비교", () => {
  const ids = D.db.prepare("SELECT id FROM course ORDER BY id").all().map(r => r.id);
  for (const cid of ids) {
    const ctx = C.courseCtx(cid);
    assert.equal(ctx.cid, cid); assert.ok(isStr(ctx.key) && ctx.key.split("|").length >= 6);
    assert.ok(isStr(ctx.name) && isStr(ctx.short) && isStr(ctx.lang) && typeof ctx.math === "boolean");
    assert.ok(ctx.chapters.length > 0 && ctx.chapters.every(c => isStr(c.key) && isStr(c.title) && "grp" in c && isInt(c.sort)));
    const n = D.db.prepare("SELECT COUNT(*) n FROM problem WHERE course_id = ?").get(cid).n;
    assert.equal(ctx.items.size, n);
    for (const it of ctx.items.values()) {
      assert.ok(isInt(it.pid) && isStr(it.ext) && isStr(it.ch) && ["ox", "mc", "short", "essay"].includes(it.kind) && isInt(it.v));
      assert.ok([0, 1].includes(it.star) && ["published", "hidden"].includes(it.status) && typeof it.exam === "boolean" && isInt(it.len));
      assert.equal(it.nopt, it.kind === "mc" ? it.body.opts.length : 0);
    }
    const hasTopic = [...ctx.items.values()].some(it => it.topic && it.status === "published");
    assert.equal(ctx.topics === null, !hasTopic, "topics는 topic이 있는 과목만");
    for (const k of ["ox", "mc", "short", "essay"]) assert.ok(isNum(ctx.medLen[k]));
    assert.ok(ctx.tags instanceof Map && ctx.diag instanceof Map && typeof ctx.misc === "object" && ctx.hasConcept instanceof Set);
    const lp = ctx.lnP(0.5, 0); assert.equal(lp.lp.length, 41); assert.equal(ctx.lnP(0.5, 0), lp, "lnP 메모");
    assert.equal(C.courseCtx(cid), ctx, "같은 키면 다시 만들지 않는다");
  }
  assert.equal(C.courseCtx(999999), null);
  // 옛 버전: 기록에 남은 (문제, 버전) 중 지금 버전이 아닌 것을 직접 비교와 맞춰 본다
  const pairs = D.db.prepare(`SELECT DISTINCT p.course_id cid, e.problem_id pid, e.version v FROM event e JOIN problem p ON p.id = e.problem_id
      WHERE e.type = 'answer_submit' AND e.version <> p.current_version`).all();
  let checked = 0;
  for (const { cid, pid, v } of pairs) {
    const ctx = C.courseCtx(cid), it = ctx.items.get(pid), o = D.db.prepare("SELECT kind, body FROM problem_version WHERE problem_id = ? AND version = ?").get(pid, v);
    if (!o) { assert.equal(ctx.sameAsCurrent(pid, v), false); continue; }
    const a = JSON.parse(o.body), b = it.body, eq = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const want = o.kind !== it.kind ? false : it.kind === "mc" ? eq(a.opts, b.opts) && eq(a.ans, b.ans) : it.kind === "ox" ? eq(a.q, b.q) && eq(a.ox, b.ox)
      : it.kind === "short" ? eq(a.a, b.a) && eq(a.num, b.num) && eq(a.accept, b.accept) : false;
    assert.equal(ctx.sameAsCurrent(pid, v), want, `${pid}:${v}`); checked++;
  }
  assert.ok(checked > 0, "비교한 옛 버전이 없어요");
  for (const it of C.courseCtx(4).items.values()) assert.equal(C.courseCtx(4).sameAsCurrent(it.pid, it.v), true);
});

test("주제 이름: course.info.topics → 주로 사는 단원의 고유한 첫 제목 → 단원 제목 (나누지 않음, 겹치면 코드)", () => {
  const cid = D.db.prepare(`SELECT p.course_id cid FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE json_extract(pv.body, '$.topic') IS NOT NULL GROUP BY p.course_id ORDER BY COUNT(*) DESC`).get()?.cid;
  assert.ok(cid, "topic이 있는 과목이 없어요");
  const before = C.courseCtx(cid);
  const codes = Object.keys(before.topics); assert.ok(codes.length >= 2);
  const names = Object.values(before.topics), titles = before.chapters.map(c => c.title.replace(/^[\d.\-–~·\s]+/, "").trim());
  assert.equal(new Set(names).size, names.length, "이름이 서로 달라야 엔진이 단원 제목을 쪼개지 않는다");
  for (const c of codes) {
    const n = before.topics[c];
    assert.notEqual(n, c, "코드 그대로는 안 된다");
    assert.ok(titles.includes(n) || titles.some(t => n === t + " · " + c) || !/^[a-z0-9_ -]+$/i.test(n), `${c}: ${n}`);
  }
  // 주제 하나에 이름을 주고, 다른 주제가 주로 사는 단원에는 고유한 첫 제목을 준다
  const row = D.db.prepare("SELECT info FROM course WHERE id = ?").get(cid), info = JSON.parse(row.info);
  const [c1, c2] = codes;
  const ch2 = [...before.items.values()].filter(it => it.topic === c2 && it.status === "published").reduce((m, it) => m.set(it.ch, (m.get(it.ch) || 0) + 1), new Map());
  const ord = new Map(before.chapters.map((c, i) => [c.key, [c.grp ? 1 : 0, i]]));
  const main2 = [...ch2].sort((a, b) => ord.get(a[0])[0] - ord.get(b[0])[0] || b[1] - a[1] || ord.get(a[0])[1] - ord.get(b[0])[1])[0][0];
  const next = { ...info, topics: { [c1]: "시험용 이름" }, concepts: { ...(info.concepts || {}), [main2]: { html: "<h3>고유한 <b>제목</b></h3><p>…</p>" } } };
  D.db.prepare("UPDATE course SET info = ? WHERE id = ?").run(JSON.stringify(next), cid);
  try {
    cver++;                                                       // 관리자 쓰기처럼 키를 바꾼다
    const ctx = C.courseCtx(cid);
    assert.notEqual(ctx, before);
    assert.equal(ctx.topics[c1], "시험용 이름"); assert.match(ctx.topics[c2], /^고유한 제목( · .+)?$/);
    assert.ok(ctx.hasConcept.has(main2));
    // 엔진도 그 이름을 단원 이름으로 쓴다
    const det = ENG.buildReport(EV.loadRaw(HEAVY, cid), ctx, PARAMS, R.kstDay());
    if (det.state === "ready") { const u = det.units.find(x => x.kind === "topic" && x.code === c1); if (u) assert.equal(u.name, "시험용 이름"); }
  } finally { D.db.prepare("UPDATE course SET info = ? WHERE id = ?").run(row.info, cid); cver++; }
  assert.deepEqual(C.courseCtx(cid).topics, before.topics);
});

test("기록 읽기(evidence): 순서 · 종류 · 개수 · 지문", () => {
  for (const cid of [1, 2, 3, 4, 5]) {
    const raw = EV.loadRaw(HEAVY, cid);
    const cnt = t => D.db.prepare(`SELECT COUNT(*) n FROM event e JOIN problem p ON p.id = e.problem_id WHERE e.device_id = ? AND p.course_id = ? AND e.type IN (${t})`).get(HEAVY, cid).n;
    assert.equal(raw.events.length, cnt("'answer_submit','idk'")); assert.equal(raw.aux.length, cnt("'ai_copy','sol_dwell','bookmark'"));
    assert.ok(raw.events.every(e => e.type === "answer_submit" || e.type === "idk") && raw.aux.every(e => ["ai_copy", "sol_dwell", "bookmark"].includes(e.type)));
    for (const L of [raw.events, raw.aux]) for (let i = 1; i < L.length; i++) assert.ok(L[i - 1].ts < L[i].ts || (L[i - 1].ts === L[i].ts && L[i - 1].rid < L[i].rid), "(ts, rid) 순서");
    for (const e of raw.events) { assert.ok(isInt(e.rid) && isInt(e.pid) && isStr(e.sid) && isStr(e.ts)); assert.equal(typeof e.p, "object"); }
    const np = D.db.prepare("SELECT COUNT(*) n FROM progress pr JOIN problem p ON p.id = pr.problem_id WHERE pr.device_id = ? AND p.course_id = ?").get(HEAVY, cid).n;
    assert.equal(raw.progress.length, np);
    for (const r of raw.progress) assert.deepEqual(Object.keys(r).sort(), ["attempts", "last_answer", "pid", "status", "updated_at", "v", "wrong_count"]);
    for (const g of raw.grades) { assert.ok(isInt(g.id) && isInt(g.pid)); assert.ok(Array.isArray(g.result.points)); assert.ok(!("answer" in g), "답안 글은 읽지 않는다"); }
    const k = C.ctxKey(cid), f = EV.fingerprint(HEAVY, cid, k, 100);
    assert.equal(EV.fingerprint(HEAVY, cid, k, 100), f, "같은 입력 → 같은 지문");
    assert.notEqual(EV.fingerprint(HEAVY, cid, k, 101), f, "날짜가 바뀌면 다른 지문");
    assert.notEqual(EV.fingerprint(HEAVY, cid, k + "x", 100), f, "과목 키가 바뀌면 다른 지문");
  }
  assert.ok(EV.loadRaw(HEAVY, 4).events.filter(e => e.type === "answer_submit").length >= 181);
  const idx = D.db.prepare("EXPLAIN QUERY PLAN SELECT MAX(g.id) FROM ai_grade g JOIN problem p ON p.id = g.problem_id WHERE g.device_id = ? AND p.course_id = ?").all(HEAVY, 4);
  assert.ok(idx.some(r => /ai_grade_device/.test(r.detail)), "ai_grade는 기기 색인으로 읽는다 " + JSON.stringify(idx));
});

test("문턱 어림(gate): 엔진 문턱과 같은 쪽 · 색인 집계만", () => {
  for (const cid of [1, 2, 3, 4, 5]) {
    const g = R.gate(HEAVY, cid), d = R.buildDoc(HEAVY, cid);
    assert.deepEqual(g.need, { n_eff: PARAMS.gate.n_eff, chapters: PARAMS.gate.chapters });
    if (d.state === "ready") assert.equal(g.can_make, true, `${cid}: 엔진은 열리는데 어림이 막으면 안 된다`);
  }
  const fresh = rid(); assert.deepEqual(R.gate(fresh, 4).have, { n_eff: 0, events: 0, chapters: 0 }); assert.equal(R.gate(fresh, 4).can_make, false);
});

test("계산 시간 (이 프로세스, 복사본 B): 데운 뒤 중앙값 — 뽑기 < 20 ms, 보기 < 3 ms, 과목 묶음 < 25 ms", t => {
  const cids = [1, 2, 3, 4, 5];
  R.warmUp(); for (let i = 0; i < 3; i++) for (const cid of cids) R.buildDoc(HEAVY, cid);          // JIT 데우기
  const make = [], view = [], ctxT = [];
  for (let i = 0; i < 15; i++) for (const cid of cids) {
    R.clearInsightCache(); D.db.prepare("DELETE FROM insight WHERE device_id = ? AND course_id = ?").run(HEAVY, cid);
    let t0 = performance.now(); assert.ok(R.makeSnap(HEAVY, cid)); make.push(performance.now() - t0);
    t0 = performance.now(); assert.ok(R.getSnap(HEAVY, cid)); view.push(performance.now() - t0);
  }
  for (let i = 0; i < 10; i++) for (const cid of cids) { cver++; const t0 = performance.now(); C.courseCtx(cid); ctxT.push(performance.now() - t0); }
  const f = x => x.toFixed(2) + " ms";
  t.diagnostic(`뽑기 p50 ${f(med(make))} p95 ${f(pct(make, 0.95))} · 보기 p50 ${f(med(view))} p95 ${f(pct(view, 0.95))} · 과목 묶음 p50 ${f(med(ctxT))} p95 ${f(pct(ctxT, 0.95))}`);
  // 다른 시험 파일이 함께 돌아 CPU가 튈 수 있으니 중앙값으로 회귀만 잡는다 (p95는 위 진단으로)
  assert.ok(med(make) < 20, "뽑기 중앙값"); assert.ok(med(view) < 3, "보기 중앙값"); assert.ok(med(ctxT) < 25, "과목 묶음 중앙값");
});

test("insight 행: 뽑을 때만 쓰고, 지문이 그대로면 같은 리포트 · 보기는 계산하지 않는다", () => {
  R.clearInsightCache(); D.db.prepare("DELETE FROM insight").run();
  const none = JSON.parse(R.getSnap(HEAVY, 4).buf); checkNone(none, 4);
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM insight").get().n, 0, "보기는 행을 만들지 않는다");
  const pk = R.makeSnap(HEAVY, 4), r1 = D.db.prepare("SELECT fp, state, det, updated_at FROM insight WHERE device_id = ? AND course_id = 4").get(HEAVY);
  const d1 = JSON.parse(pk.buf); checkSnap(d1, 4); assert.equal(d1.since.answers, 0); assert.equal(d1.fp, r1.fp);
  assert.deepEqual({ ...JSON.parse(r1.det), since: d1.since, stale: d1.stale, can_make: d1.can_make }, d1, "보낸 것 = 저장한 행 + since·can_make");
  assert.equal(d1.ev_rid, Math.max(...EV.loadRaw(HEAVY, 4).events.map(e => e.rid)));
  assert.deepEqual(bare(d1), bare(R.buildDoc(HEAVY, 4)), "저장한 리포트 = 같은 데이터로 새로 계산한 것");
  for (let i = 0; i < 3; i++) R.makeSnap(HEAVY, 4);
  const r2 = D.db.prepare("SELECT updated_at, det FROM insight WHERE device_id = ? AND course_id = 4").get(HEAVY);
  assert.equal(r2.updated_at, r1.updated_at, "같은 지문이면 다시 쓰지 않는다"); assert.equal(r2.det, r1.det);
  R.clearInsightCache(); assert.equal(R.getSnap(HEAVY, 4).buf.toString(), pk.buf.toString(), "메모리에서 밀려나도 행에서 같은 글");
});

test("기존 API가 그대로: features · catalog · course · progress · events · grade · 예시 파일은 없음", async () => {
  const f = await call("/api/features", { dev: null });
  assert.equal(f.status, 200); assert.deepEqual(f.json, { ai_grade: true, insight: true, insight_ai: false }, "INSIGHT_DEV 없이는 insight_dev가 없다");
  const fx = await call("/js/fixtures/insight-sample.json", { dev: null });
  assert.ok(!/"state"/.test(fx.text) && /<html/i.test(fx.text), "개발용 예시 리포트가 테스터에게 나가면 안 된다");
  const cat = await call("/api/catalog", { dev: null });
  assert.equal(cat.status, 200); assert.ok(cat.json.semesters.length > 0 && cat.json.semesters[0].courses.length > 0);
  assert.equal((await call("/api/catalog", { dev: null, headers: { "If-None-Match": cat.h.get("etag") } })).status, 304);
  const co = await call("/api/course/4", { dev: null });
  assert.equal(co.status, 200); assert.ok(co.json.problems.length > 100 && co.json.chapters.length > 0);
  assert.equal((await call("/api/course/4", { dev: null, headers: { "If-None-Match": co.h.get("etag") } })).status, 304);
  assert.equal((await call("/api/course/999999", { dev: null })).status, 404);
  const pr = await call("/api/me/progress?course=4");
  assert.equal(pr.status, 200);
  assert.equal(pr.json.progress.length, ext.prepare("SELECT COUNT(*) n FROM progress pr JOIN problem p ON p.id = pr.problem_id WHERE pr.device_id = ? AND p.course_id = 4").get(HEAVY).n);
  const dev = await newDevice(true), pid = co.json.problems[0].id;
  const put = await call("/api/me/progress", { dev, method: "PUT", body: { items: [{ problem_id: pid, version: 1, status: "wrong", attempts: 1, wrong_count: 1, last_answer: "B", updated_at: new Date().toISOString() }] } });
  assert.deepEqual(put.json, { saved: 1 });
  assert.equal((await call("/api/me/progress?course=4", { dev })).json.progress[0].last_answer, "B");
  const ev = { id: rid(), type: "problem_shown", session_id: "s-t", problem_id: pid, version: 1, client_ts: new Date().toISOString(), payload: {} };
  assert.deepEqual((await call("/api/events", { dev, method: "POST", body: { events: [ev] } })).json, { stored: 1 });
  assert.deepEqual((await call("/api/events", { dev, method: "POST", body: { events: [ev] } })).json, { stored: 0 });
  const nc = await newDevice(false);
  assert.equal((await call("/api/events", { dev: nc, method: "POST", body: { events: [{ ...ev, id: rid() }] } })).json.stored, 0);
  const essay = co.json.problems.find(p => p.kind === "essay") || ext.prepare("SELECT p.id FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE pv.kind = 'essay' AND p.status = 'published'").get();
  const ox = co.json.problems.find(p => p.kind === "ox");
  assert.equal((await call("/api/grade", { dev, method: "POST", body: { problem_id: essay.id, answer: "충분히 긴 답안이에요", consent: false } })).status, 400);
  assert.equal((await call("/api/grade", { dev, method: "POST", body: { problem_id: ox.id, answer: "충분히 긴 답안이에요", consent: true } })).status, 400);
  const g = await call("/api/grade", { dev, method: "POST", body: { problem_id: essay.id, answer: "충분히 긴 답안이에요", consent: true } });
  assert.ok(g.status >= 500 && isStr(g.json.error), "죽은 Gemini 주소 → 5xx " + g.status);
  assert.equal((await call("/health", { dev: null })).status, 200);
});

test("인증: X-Device 없음·잘못됨·모르는 기기 → 401 (보기·뽑기·개요)", async () => {
  for (const dev of [null, "short", "x".repeat(70), rid() + "AAAA"]) {
    assert.equal((await call("/api/me/insight/4", { dev })).status, 401, String(dev));
    assert.equal((await post("/api/me/insight/4", { dev })).status, 401, String(dev));
    assert.equal((await call("/api/me/insight", { dev })).status, 401);
  }
});

test("보기 → 없음(none) → 뽑기 → 보기는 저장한 것 + since 0 (담은 과목마다, Contract 4 모양)", async t => {
  enrolled = (await call("/api/me/enrollment")).json.courses;
  assert.deepEqual(new Set(enrolled), new Set([1, 2, 3, 4, 5]));
  const states = {};
  for (const cid of enrolled) {
    const g0 = await call("/api/me/insight/" + cid);
    assert.equal(g0.status, 200, g0.text); checkNone(g0.json, cid);
    assert.equal(g0.h.get("cache-control"), "private, no-cache"); assert.match(g0.h.get("vary") || "", /X-Device/);
    assert.deepEqual(g0.json, { v: 1, cid, state: "none", ...R.gate(HEAVY, cid) }, "서버 어림 = 이 프로세스 어림 (같은 데이터)");
    const m = await post("/api/me/insight/" + cid);
    assert.equal(m.status, 200, m.text); checkSnap(m.json, cid); assert.equal(m.json.since.answers, 0);
    assert.match(m.h.get("vary") || "", /X-Device/); assert.ok(Number.isFinite(timing(m)), "Server-Timing");
    assert.deepEqual(bare(m.json), bare(R.buildDoc(HEAVY, cid)), "뽑은 것 = 같은 데이터로 이 프로세스에서 만든 리포트");
    const g1 = await call("/api/me/insight/" + cid);
    assert.equal(g1.status, 200); assert.deepEqual(g1.json, m.json, "보기는 저장한 그대로"); assert.equal(g1.h.get("etag"), m.h.get("etag"));
    assert.equal(g1.h.get("cache-control"), "private, no-cache"); assert.match(g1.h.get("vary") || "", /Accept-Encoding/);
    docs[cid] = m.json; etags[cid] = g1.h.get("etag"); states[cid] = m.json.state;
    t.diagnostic(`${cid} ${m.json.state} 뽑기 ${timing(m).toFixed(2)} ms · 보기 ${timing(g1).toFixed(2)} ms` + (m.json.state === "ready" ? ` · ${m.json.headline}` : ` · ${JSON.stringify(m.json.have)}`));
  }
  assert.ok(Object.values(states).includes("ready"), JSON.stringify(states));
  for (const cid of enrolled) {
    const row = ext.prepare("SELECT fp, state, det FROM insight WHERE device_id = ? AND course_id = ?").get(HEAVY, cid);
    assert.equal(row.fp, docs[cid].fp); assert.equal(row.state, docs[cid].state);
    const { since, stale, can_make, ...saved } = docs[cid]; assert.deepEqual(JSON.parse(row.det), saved);
  }
  // 다시 뽑아도 기록이 그대로면 같은 리포트 (뽑은 때도 그대로)
  const again = await post("/api/me/insight/4");
  assert.deepEqual(again.json, docs[4]);
});

test("304: 같은 ETag면 본문 없이, 보기 서버 시간 < 5 ms (중앙값)", async t => {
  const ms = [];
  for (const cid of enrolled) {
    const r = await call("/api/me/insight/" + cid, { headers: { "If-None-Match": etags[cid] } });
    assert.equal(r.status, 304); assert.equal(r.text, ""); assert.match(r.h.get("vary") || "", /X-Device/);
    const r2 = await call("/api/me/insight/" + cid, { headers: { "If-None-Match": '"nope"' } });
    assert.equal(r2.status, 200); assert.equal(r2.h.get("etag"), etags[cid]);
  }
  for (let i = 0; i < 4; i++) for (const cid of enrolled) ms.push(timing(await call("/api/me/insight/" + cid, { headers: { "If-None-Match": etags[cid] } })));
  t.diagnostic(`보기 서버 시간 p50 ${med(ms).toFixed(2)} ms, p95 ${pct(ms, 0.95).toFixed(2)} ms (n=${ms.length})`);
  assert.ok(med(ms) < 5);
  // 동의한 새 기기: 뽑기 전(none)도 같은 ETag면 304
  const dev = await newDevice(true), first = await call("/api/me/insight/4", { dev });
  assert.equal(first.json.state, "none"); assert.equal(first.json.can_make, false);
  let n304 = 0; for (let i = 0; i < 100; i++) if ((await call("/api/me/insight/4", { dev, headers: { "If-None-Match": first.h.get("etag") } })).status === 304) n304++;
  assert.equal(n304, 100);
  const lk = await post("/api/me/insight/4", { dev });          // 풀지 않은 기기도 뽑을 수는 있다 → 잠김 + 지금 풀면 좋은 문제
  checkSnap(lk.json, 4); assert.equal(lk.json.state, "locked"); assert.ok(lk.json.next.pids.length > 0);
});

test("동의 안 한 기기 → no_consent (보기·뽑기), 없는·숨긴 과목 → 404", async () => {
  const nc = await newDevice(false);
  for (const r of [await call("/api/me/insight/4", { dev: nc }), await post("/api/me/insight/4", { dev: nc })]) {
    assert.equal(r.status, 200); assert.deepEqual(r.json, { v: 1, cid: 4, state: "no_consent" });
  }
  assert.equal(ext.prepare("SELECT COUNT(*) n FROM insight WHERE device_id = ?").get(nc).n, 0, "동의 안 한 기기는 만들지 않는다");
  assert.deepEqual((await call("/api/me/insight", { dev: nc })).json, { courses: {} });
  await call("/api/me/enrollment", { dev: nc, method: "PUT", body: { courses: [4, 1] } });
  assert.deepEqual((await call("/api/me/insight", { dev: nc })).json, { courses: { 4: { state: "no_consent" }, 1: { state: "no_consent" } } });
  for (const p of ["999999", "0", "-1", "abc", "4.5"]) {
    assert.equal((await call("/api/me/insight/" + p)).status, 404, p); assert.equal((await post("/api/me/insight/" + p)).status, 404, p);
  }
  assert.equal((await call("/api/me/insight/999999", { dev: nc })).status, 404, "동의보다 404가 먼저");
  ext.prepare("UPDATE course SET visible = 0 WHERE id = 4").run();
  try {
    assert.equal((await call("/api/me/insight/4")).status, 404); assert.equal((await post("/api/me/insight/4")).status, 404);
    assert.ok(!("4" in (await call("/api/me/insight")).json.courses), "개요에서도 빠진다");
  } finally { ext.prepare("UPDATE course SET visible = 1 WHERE id = 4").run(); }
  const back = await call("/api/me/insight/4");
  assert.equal(back.status, 200); assert.deepEqual(back.json, docs[4], "보기는 계산하지 않으니 과목 키가 바뀌어도 저장한 그대로");
});

test("다른 프로그램이 문제를 숨기면: 보기는 그대로, 뽑기는 그 문제 없이 새로", async () => {
  const ev = docs[4].findings.flatMap(f => f.evidence).find(e => e.kind === "mc") || docs[4].findings[0].evidence[0];
  ext.prepare("UPDATE problem SET status = 'hidden' WHERE id = ?").run(ev.pid);
  try {
    assert.equal((await call("/api/me/insight/4", { headers: { "If-None-Match": etags[4] } })).status, 304, "보기는 계산하지 않는다");
    const r = await post("/api/me/insight/4");
    assert.equal(r.status, 200); checkSnap(r.json, 4); assert.notEqual(r.json.fp, docs[4].fp);
    assert.ok(!r.json.findings.some(f => f.evidence.some(e => e.pid === ev.pid)), "숨긴 문제가 근거에 남았어요");
  } finally { ext.prepare("UPDATE problem SET status = 'published' WHERE id = ?").run(ev.pid); }
  const r = await post("/api/me/insight/4");
  assert.deepEqual(bare(r.json), bare(docs[4])); etags[4] = r.h.get("etag"); docs[4] = r.json;
});

test("개요: 담은 과목마다 저장한 행 + 새 기록 수 + 뽑을 수 있는지 (계산하지 않음)", async t => {
  const t0 = performance.now(), r = await call("/api/me/insight"), wall = performance.now() - t0;
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.json).sort(), ["courses"]);
  assert.deepEqual(new Set(Object.keys(r.json.courses).map(Number)), new Set(enrolled));
  for (const cid of enrolled) {
    const o = r.json.courses[cid], d = docs[cid];
    assert.deepEqual(Object.keys(o).sort(), ["can_make", "made_at", "n_findings", "since", "stale", "state", "top_name", "top_type"]);
    assert.equal(o.state, d.state); assert.equal(o.made_at, d.made_at); assert.deepEqual(o.since, { answers: 0 }); assert.equal(o.can_make, d.can_make);
    if (d.state === "ready") {
      assert.equal(o.n_findings, d.findings.length); assert.equal(o.top_type, d.findings[0] ? d.findings[0].type : null);
      assert.equal(o.top_name, (d.findings[0] && d.findings[0].unit && d.findings[0].unit.name) || null);
    }
  }
  t.diagnostic(`개요 응답 ${wall.toFixed(1)} ms (요청 왕복)`);
  // 이 프로세스(복사본 B): 행이 없으면 none, 계산은 하지 않는다
  R.clearInsightCache(); D.db.prepare("DELETE FROM insight").run();
  const ov = R.overview(HEAVY);
  for (const o of Object.values(ov.courses)) { assert.equal(o.state, "none"); assert.equal(o.since, null); assert.equal(typeof o.can_make, "boolean"); }
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM insight").get().n, 0);
});

test("새 풀이 기록 → 보기의 since가 늘고 (ETag도 바뀜), 뽑으면 지문이 바뀌고 since 0", async t => {
  const before = docs[4], tag1 = etags[1];
  const p = ext.prepare(`SELECT p.id, p.current_version v FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = 4 AND p.status = 'published' AND pv.kind = 'ox'
        AND NOT EXISTS (SELECT 1 FROM progress WHERE device_id = ?1 AND problem_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM event WHERE device_id = ?1 AND problem_id = p.id) ORDER BY p.id LIMIT 1`).get(HEAVY);
  assert.ok(p, "풀지 않은 O/X가 없어요");
  const ev = { id: rid(), type: "answer_submit", session_id: "s-test-" + rid(), problem_id: p.id, version: p.v, client_ts: new Date().toISOString(),
    payload: { kind: "ox", answer: "O", correct: false, ms: 5000, attempt: 1, mode: "focus", seen: false } };
  const shown = { ...ev, id: rid(), type: "problem_shown", payload: {} };              // 답이 아닌 기록은 세지 않는다
  assert.deepEqual((await call("/api/events", { method: "POST", body: { events: [ev, shown] } })).json, { stored: 2 });
  const g = await call("/api/me/insight/4", { headers: { "If-None-Match": etags[4] } });
  assert.equal(g.status, 200, "새 기록 수가 바뀌었으니 304가 오면 안 된다");
  assert.deepEqual(g.json.since, { answers: 1 }); assert.equal(g.json.fp, before.fp, "보기는 다시 계산하지 않는다"); assert.notEqual(g.h.get("etag"), etags[4]);
  assert.deepEqual((await call("/api/me/insight")).json.courses[4].since, { answers: 1 });
  const m = await post("/api/me/insight/4");
  checkSnap(m.json, 4); assert.notEqual(m.json.fp, before.fp); assert.deepEqual(m.json.since, { answers: 0 });
  assert.ok(m.json.ev_rid > before.ev_rid); assert.ok(m.json.made_at >= before.made_at);
  if (m.json.state === "ready" && before.state === "ready") assert.equal(m.json.basis.first, before.basis.first + 1, "첫 풀이 하나가 늘었다");
  t.diagnostic(`새 기록 뒤 뽑기 서버 시간 ${timing(m).toFixed(2)} ms`);
  assert.ok(timing(m) < 100, "뽑기 한 번 (데운 뒤라도 CPU가 튈 수 있어 넉넉히)");
  assert.equal(ext.prepare("SELECT fp FROM insight WHERE device_id = ? AND course_id = 4").get(HEAVY).fp, m.json.fp, "insight 행도 새 지문");
  assert.equal((await call("/api/me/insight/1", { headers: { "If-None-Match": tag1 } })).status, 304, "다른 과목 리포트는 그대로");
  const ov = await call("/api/me/insight");
  assert.deepEqual(ov.json.courses[4].since, { answers: 0 });
  if (m.json.state === "ready") assert.equal(ov.json.courses[4].n_findings, m.json.findings.length);
});

test("기록 지우고 다시 풀기(답 기록 없음) → stale이 켜지고 [새로 뽑기]가 열린다, 문제 내용이 바뀌어도 stale은 아니다", async () => {
  const m0 = await post("/api/me/insight/4"); assert.equal(m0.status, 200);
  const g0 = await call("/api/me/insight/4"); assert.equal(g0.json.stale, false); assert.equal(g0.json.since.answers, 0);
  const row = ext.prepare("SELECT * FROM progress WHERE device_id = ? AND problem_id IN (SELECT id FROM problem WHERE course_id = 4) ORDER BY problem_id LIMIT 1").get(HEAVY);
  ext.prepare("DELETE FROM progress WHERE device_id = ? AND problem_id = ?").run(HEAVY, row.problem_id);
  try {
    const g1 = await call("/api/me/insight/4", { headers: { "If-None-Match": g0.h.get("etag") } });
    assert.equal(g1.status, 200, "기록이 바뀌었으니 304가 아니다"); assert.equal(g1.json.stale, true); assert.equal(g1.json.since.answers, 0);
    assert.equal((await call("/api/me/insight")).json.courses[4].stale, true);
    const m1 = await post("/api/me/insight/4"); assert.equal(m1.json.stale, false); assert.notEqual(m1.json.fp, g0.json.fp);
  } finally {
    const cols = Object.keys(row); ext.prepare(`INSERT INTO progress(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map(c => row[c]));
  }
  const m2 = await post("/api/me/insight/4"); assert.equal(m2.status, 200); docs[4] = m2.json; etags[4] = m2.h.get("etag");
  ext.prepare("UPDATE problem SET status = 'published' WHERE id = ?").run(row.problem_id);   // 내용 쓰기(data_version)만으로는 stale이 아니다
  assert.equal((await call("/api/me/insight/4")).json.stale, false);
});

test("어림은 열림인데 엔진이 잠금으로 낸 리포트: 새로 풀기 전에는 can_make가 꺼져 있다", async () => {
  const m = await post("/api/me/insight/4"); assert.equal(m.status, 200);
  const was = ext.prepare("SELECT state FROM insight WHERE device_id = ? AND course_id = 4").get(HEAVY).state;
  assert.equal(R.gate(HEAVY, 4).can_make, true, "어림은 열림");
  try {
    ext.prepare("UPDATE insight SET state = 'locked' WHERE device_id = ? AND course_id = 4").run(HEAVY); R.clearInsightCache();
    const g = await call("/api/me/insight/4"); assert.equal(g.json.since.answers, 0); assert.equal(g.json.can_make, false, "엔진이 이미 잠금이라 했다");
    assert.equal((await call("/api/me/insight")).json.courses[4].can_make, false);
  } finally { ext.prepare("UPDATE insight SET state = ? WHERE device_id = ? AND course_id = 4").run(was, HEAVY); R.clearInsightCache(); }
  assert.equal((await call("/api/me/insight/4")).json.can_make, true);
});

test("뽑기 한도: 기기마다 하루 30번", async () => {
  const dev = await newDevice(true);
  for (let i = 0; i < 30; i++) assert.equal((await post("/api/me/insight/4", { dev })).status, 200, "회 " + (i + 1));
  const over = await post("/api/me/insight/4", { dev });
  assert.equal(over.status, 429); assert.ok(isStr(over.json.error));
  assert.equal((await call("/api/me/insight/4", { dev })).status, 200, "보기는 따로 센다");
});

test("last_seen: 1분에 한 번만 쓴다", async () => {
  const dev = await newDevice(true), get = () => ext.prepare("SELECT last_seen FROM device WHERE id = ?").get(dev).last_seen;
  const old = "2026-01-01T00:00:00.000Z";
  ext.prepare("UPDATE device SET last_seen = ? WHERE id = ?").run(old, dev);
  await call("/api/me/insight/4", { dev });
  const l1 = get(); assert.notEqual(l1, old); assert.ok(Date.now() - Date.parse(l1) < 10000);
  for (let i = 0; i < 5; i++) { await call("/api/me/insight/4", { dev }); await call("/api/me/insight", { dev }); await call("/api/me/progress?course=4", { dev }); }
  assert.equal(get(), l1, "1분 안에는 다시 쓰지 않는다");
  ext.prepare("UPDATE device SET last_seen = ? WHERE id = ?").run(new Date(Date.now() - 61e3).toISOString(), dev);
  await call("/api/me/insight", { dev });
  assert.ok(Date.now() - Date.parse(get()) < 10000, "1분이 지나면 다시 쓴다");
});

test("서버 로그에 API 키가 없고 오류도 없다", () => {
  const all = logs.join("");
  assert.ok(!all.includes(KEY), "키가 로그에 나왔어요");
  assert.ok(!/TypeError|ReferenceError|SyntaxError|서버 오류|데우기 실패/.test(all), all.slice(-2000));
});
