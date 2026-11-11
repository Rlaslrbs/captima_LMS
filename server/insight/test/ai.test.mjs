// ai.js · db.js(학습 리포트 도우미) 시험:  node --test "server/insight/test/*.test.mjs"
// 가짜 Gemini(fake-gemini.mjs, 포트 4012 또는 FAKE_PORT)와 버리는 DB 복사본으로만 돈다. 진짜 Gemini는 부르지 않는다.
// 복사본은 INSIGHT_TMP(없으면 OS 임시 폴더) 아래에 VACUUM INTO로 만들고, 끝나면 지운다.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..", "..", "..");
const PORT = +(process.env.FAKE_PORT || 4012), FAKE = `http://127.0.0.1:${PORT}`;
const KEY = "fake-" + randomBytes(8).toString("hex");          // 로그·오류에 나오면 안 되는 값

// 1) 버리는 DB 복사본 (원본은 읽기만)
const TMP = mkdtempSync(join(process.env.INSIGHT_TMP || tmpdir(), "insight-ai-")), DBF = join(TMP, "t.db");
const SRC = join(ROOT, "data", "app.db");
if (existsSync(SRC)) { const s = new DatabaseSync(SRC, { readOnly: true }); s.exec(`VACUUM INTO '${DBF.replace(/'/g, "''")}'`); s.close(); }

// 2) 가짜 Gemini
const fake = spawn(process.execPath, [join(HERE, "fake-gemini.mjs"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, no) => { fake.stdout.on("data", d => /listening/.test(d) && ok()); fake.on("exit", c => no(new Error("fake-gemini가 멈췄어요: " + c))); });
after(() => { fake.kill(); rmSync(TMP, { recursive: true, force: true }); });

// 3) 환경을 정한 뒤에 불러온다 (ai.js·db.js는 불러올 때 환경 변수를 읽는다). 로그는 모아서 검사한다
Object.assign(process.env, { DB_PATH: DBF, GEMINI_API_KEY: KEY, GEMINI_BASE: FAKE, GEMINI_MODEL: "gemini-flash-latest",
  GEMINI_FALLBACK: "gemini-2.5-flash,gemini-flash-lite-latest", GEMINI_RPD: "200" });
for (const k of ["INSIGHT_MODELS", "VERIFY_MODELS"]) delete process.env[k];
const logs = [];
for (const k of ["log", "error", "warn"]) { const o = console[k]; console[k] = (...a) => { logs.push(a.map(String).join(" ")); if (process.env.DEBUG_AI) o(...a); }; }
const ai = await import("../../ai.js"), D = await import("../../db.js");
D.db.exec("DELETE FROM ai_budget; DELETE FROM ai_block;");      // 복사본에 남은 사용량·차단은 지우고 시작

const get = p => fetch(FAKE + p).then(r => r.json());
const post = (p, b = {}) => fetch(FAKE + p, { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
const reqs = async model => (await get("/_log")).filter(q => !model || q.model === model);
const lines = re => logs.filter(l => re.test(l));
const thrown = [];
async function rejects(p) { try { await p; } catch (e) { thrown.push(e); return e; } assert.fail("실패해야 하는데 성공했어요"); }
const SCHEMA = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" }, n: { type: "INTEGER" } }, required: ["ok"] };
const gen = (models, o = {}) => ai.generate({ purpose: "tag", system: "시험", prompt: "안녕", schema: SCHEMA, models, ...o });
const PROBLEM = { id: 990001, v: 1, body: { q: "<p>근접 원인과 궁극 원인을 <b>구분</b>해 설명하시오</p>", a: "근접 원인은 …, 궁극 원인은 …",
  pts: ["근접 원인 = 어떻게", "궁극 원인 = 왜", "모성애 예시"] } };
const ANSWER = "근접 원인은 호르몬처럼 어떻게, 궁극 원인은 왜 진화했는지예요.";
const QUOTA = "AI 사용 한도에 걸렸어요. 잠시 뒤에 다시 해 주세요";

test("schema: 학습 리포트 테이블·인덱스가 모두 생긴다", () => {
  const names = new Set(D.db.prepare("SELECT name FROM sqlite_master").all().map(r => r.name));
  for (const n of ["insight_meta", "kc", "misc", "item_tag", "tag_job", "tag_job_q", "insight", "ai_budget", "ai_block", "item_first", "event_device"]) assert.ok(names.has(n), n);
});

test("채점: 결과 모양·판정 계산·요청 내용·캐시가 그대로", async () => {
  await post("/_reset");
  const r = await ai.gradeEssay(PROBLEM, ANSWER);
  assert.deepEqual(Object.keys(r).sort(), ["cached", "model", "ms", "result"]);
  assert.equal(r.model, "gemini-flash-latest"); assert.equal(r.cached, false); assert.ok(Number.isInteger(r.ms) && r.ms >= 0);
  // 가짜는 1부터 번호를 붙이고 verdict를 "partial"로 보낸다 → 0부터로 고치고 포인트로 다시 계산
  assert.deepEqual(r.result, { verdict: "correct", points: [0, 1, 2].map(i => ({ i, verdict: "covered", reason: `포인트 ${i + 1}을 봤어요.` })), feedback: "가짜 채점 피드백이에요." });
  const q = await reqs();
  assert.equal(q.length, 1);
  assert.deepEqual(Object.keys(q[0].cfg).sort(), ["responseMimeType", "responseSchema", "temperature"]);
  assert.equal(q[0].cfg.temperature, 0); assert.equal(q[0].cfg.responseMimeType, "application/json");
  assert.deepEqual(q[0].cfg.responseSchema.required, ["points", "verdict", "feedback"]);
  assert.match(q[0].system, /^너는 대학 강의의 조교다\./);
  assert.equal(q[0].prompt, ["[문제]", "근접 원인과 궁극 원인을 구분해 설명하시오", "", "[모범 답안]", "근접 원인은 …, 궁극 원인은 …", "",
    "[채점 포인트]", "1. 근접 원인 = 어떻게\n2. 궁극 원인 = 왜\n3. 모성애 예시", "", "[학생 답안 시작]", ANSWER, "[학생 답안 끝]"].join("\n"));
  assert.ok(q[0].hasKey && !q[0].keyInUrl);
  // 공백만 다른 같은 답안은 다시 묻지 않는다
  const r2 = await ai.gradeEssay(PROBLEM, "  " + ANSWER.replace(/ /g, "   ") + "\n");
  assert.deepEqual(r2, { ...r, cached: true });
  assert.equal((await reqs()).length, 1);
  assert.equal((await ai.gradeEssay(PROBLEM, "절반만 썼어요")).result.verdict, "partial");       // 2/3
  assert.equal((await ai.gradeEssay(PROBLEM, "모름 모름")).result.verdict, "wrong");            // 0
  const r3 = await ai.gradeEssay({ id: 990002, v: 1, body: { q: "q", a: "a" } }, "포인트 없는 문제 답안");
  assert.deepEqual(r3.result.points, []); assert.equal(r3.result.verdict, "partial");           // 포인트가 없으면 AI 판정
  assert.equal(D.budgetToday("gemini-flash-latest", "grade").calls, 4);
});

test("genCfg: 모델 계열·용도별 설정", () => {
  assert.deepEqual(ai.genCfg("gemini-2.5-flash", "grade"), { temperature: 0 });
  assert.deepEqual(ai.genCfg("gemini-flash-latest", "grade"), { temperature: 0 });
  assert.deepEqual(ai.genCfg("gemini-2.5-flash", "tag"), { temperature: 0, thinkingConfig: { thinkingBudget: 1024 } });
  assert.deepEqual(ai.genCfg("gemini-2.5-flash", "vocab"), { temperature: 0, thinkingConfig: { thinkingBudget: 2048 } });
  assert.deepEqual(ai.genCfg("gemini-2.5-flash-lite", "verify"), { temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
  assert.deepEqual(ai.genCfg("gemini-2.5-flash", "narr"), { temperature: 0, thinkingConfig: { thinkingBudget: 256 } });
  assert.deepEqual(ai.genCfg("gemini-2.5-flash", "narr", 64), { temperature: 0, thinkingConfig: { thinkingBudget: 64 } });
  assert.deepEqual(ai.genCfg("gemini-flash-latest", "tag"), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(ai.genCfg("gemini-3-flash", "narr"), { thinkingConfig: { thinkingLevel: "low" } });
});

test("503: 다음 모델로 넘기고 10분 쉬게 한다 (로그 한 줄)", async () => {
  await post("/_reset");
  const r = await gen(["a1-fake-503", "a2-fake-ok"]);
  assert.equal(r.model, "a2-fake-ok"); assert.deepEqual(r.out, { ok: true, n: 1 });
  assert.deepEqual(r.usage, { tok_in: 120, tok_out: 45, tok_think: 7 });
  assert.equal(lines(/^Gemini: a1-fake-503 붐빔\(503\) → 10분 동안 건너뛰고 다음 모델을 씀$/).length, 1);
  await gen(["a1-fake-503", "a2-fake-ok"]);
  assert.deepEqual((await reqs()).map(q => q.model), ["a1-fake-503", "a2-fake-ok", "a2-fake-ok"]);
  // 쉬는 모델만 남으면 그래도 다시 시도하고, 로그는 더 남기지 않는다
  const e = await rejects(gen(["a1-fake-503"]));
  assert.equal(e.status, 503); assert.equal(e.code, "busy");
  assert.equal(lines(/a1-fake-503 붐빔/).length, 1);
});

test("시간 초과: 그 모델을 쉬게 하고 다음 모델", async () => {
  const r = await gen(["t1-fake-slow3000", "t2-fake-ok"], { perTry: 300 });
  assert.equal(r.model, "t2-fake-ok");
  assert.equal(lines(/^Gemini: t1-fake-slow3000 시간 초과 → 10분 동안/).length, 1);
});

test("nextMidnightPT: 서머타임이 바뀌는 날도 태평양 자정", () => {
  const at = s => new Date(ai.nextMidnightPT(Date.parse(s))).toISOString();
  assert.equal(at("2026-11-01T06:59:59Z"), "2026-11-01T07:00:00.000Z");     // 10/31 23:59:59 PDT → 11/1 0시 PDT
  assert.equal(at("2026-11-01T08:30:00Z"), "2026-11-02T08:00:00.000Z");     // 11/1 1:30 PDT → 11/2 0시 PST
  assert.equal(at("2026-03-08T09:30:00Z"), "2026-03-09T07:00:00.000Z");     // 3/8 1:30 PST → 3/9 0시 PDT
  assert.equal(at("2026-10-25T12:00:00Z"), "2026-10-26T07:00:00.000Z");
});

test("429 하루 한도: 태평양 자정까지 ai_block에 적고 다음 모델", async () => {
  await post("/_reset");
  const t = Date.now(), r = await gen(["b1-fake-429day", "b2-fake-ok"]);
  assert.equal(r.model, "b2-fake-ok");
  const row = D.db.prepare("SELECT * FROM ai_block WHERE model = ?").get("b1-fake-429day");
  assert.ok(row); assert.match(row.why, /하루 한도/);
  assert.equal(D.blocked("b1-fake-429day"), row.until);
  const u = Date.parse(row.until);
  assert.ok(u > t && u - t <= 25 * 36e5);
  assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(u), "00:00:00");
  assert.equal(D.dayPT(u - 1000), D.dayPT(t)); assert.notEqual(D.dayPT(u), D.dayPT(t));     // retryDelay(23초)가 아니라 다음 태평양 날짜
  // 막힌 모델은 다시 부르지 않는다. 다 막히면 요청 없이 한도 오류
  await gen(["b1-fake-429day", "b2-fake-ok"]);
  const e = await rejects(gen(["b1-fake-429day"]));
  assert.equal(e.status, 429); assert.equal(e.message, QUOTA);
  assert.equal((await reqs("b1-fake-429day")).length, 1);
});

test("429 분당 한도: retryDelay만큼 쉬게 하고 다음 모델 (막지는 않음)", async () => {
  await post("/_reset");
  const r = await gen(["c1-fake-429min", "c2-fake-ok"]);
  assert.equal(r.model, "c2-fake-ok");
  assert.equal(D.blocked("c1-fake-429min"), null);
  assert.equal(lines(/^Gemini: c1-fake-429min 분당 한도\(429\) → 7초 동안 건너뛰고/).length, 1);
  await gen(["c1-fake-429min", "c2-fake-ok"]);
  assert.equal((await reqs("c1-fake-429min")).length, 1);
  const e = await rejects(gen(["c1-fake-429min"]));
  assert.equal(e.status, 429); assert.equal(e.code, "quota");
});

test("400 생각 설정 거부: 같은 모델로 한 번만 빈 설정으로 다시 보내고 기억한다", async () => {
  await post("/_reset");
  const m = "gemini-2.5-flash-fake-400think";
  assert.equal((await gen([m])).model, m);
  let q = await reqs(m);
  assert.equal(q.length, 2);
  assert.equal(q[0].cfg.temperature, 0); assert.deepEqual(q[0].cfg.thinkingConfig, { thinkingBudget: 1024 });
  assert.ok(!("temperature" in q[1].cfg) && !("thinkingConfig" in q[1].cfg));
  await gen([m]);
  q = await reqs(m); assert.equal(q.length, 3); assert.ok(!("thinkingConfig" in q[2].cfg));
  assert.deepEqual(ai.genCfg(m, "tag"), {});
  // 별칭·3.x 계열은 temperature 없이 thinkingLevel low로 먼저 보낸다
  const m2 = "gemini-flash-latest-fake-400think";
  await gen([m2], { purpose: "verify" });
  q = await reqs(m2);
  assert.equal(q.length, 2); assert.deepEqual(q[0].cfg.thinkingConfig, { thinkingLevel: "low" }); assert.ok(!("temperature" in q[0].cfg));
});

test("404 '모델 없음': 1시간 막고 다음 모델", async () => {
  const t = Date.now(), r = await gen(["n1-fake-404", "n2-fake-ok"]);
  assert.equal(r.model, "n2-fake-ok");
  const row = D.db.prepare("SELECT * FROM ai_block WHERE model = ?").get("n1-fake-404");
  assert.match(row.why, /404/); assert.ok(Math.abs(Date.parse(row.until) - t - 36e5) < 6e4);
  const e = await rejects(gen(["n3-fake-404"]));
  assert.equal(e.status, 502); assert.equal(e.message, '모델 "n3-fake-404"을 찾지 못했어요 (모델 이름 확인)');
  const e2 = await rejects(gen(["n3-fake-404"]));                // 막힌 뒤에도 한도 문구가 아니라 모델 이름 오류 (요청 없이)
  assert.deepEqual({ ...e2 }, { ...e }); assert.equal((await reqs("n3-fake-404")).length, 1);
});

test("그냥 404(주소 오류 등)는 막지 않는다: 다음 모델로, 다음 요청은 다시 시도", async () => {
  const real = globalThis.fetch;                                  // 이 모델만 없는 경로로 보내 가짜가 'unknown path' 404를 주게
  globalThis.fetch = (u, o) => real(String(u).replace("/models/g1-fake-ok:", "/nomodels/g1-fake-ok:"), o);
  try {
    await post("/_reset");
    const r = await gen(["g1-fake-ok", "g2-fake-ok"]);
    assert.equal(r.model, "g2-fake-ok");
    assert.equal(D.db.prepare("SELECT 1 FROM ai_block WHERE model = ?").get("g1-fake-ok"), undefined, "막으면 안 된다");
    const e = await rejects(gen(["g1-fake-ok"]));               // 막지 않았으니 다시 보낸다 (가짜는 그 경로를 모름 → 또 404)
    assert.equal(e.status, 502); assert.equal(e.code, "notFound");
    assert.equal(D.db.prepare("SELECT 1 FROM ai_block WHERE model = ?").get("g1-fake-ok"), undefined);
  } finally { globalThis.fetch = real; }
});

test("답을 못 읽으면 parse 오류 (사용량은 그래도 센다)", async () => {
  const e = await rejects(gen(["j1-fake-badjson"]));
  assert.equal(e.status, 502); assert.equal(e.code, "parse");
  assert.equal(D.budgetToday("j1-fake-badjson").calls, 1);
  assert.equal((await rejects(gen(["j2-fake-badbody"]))).code, "parse");
});

test("사용량: ai_budget에 (태평양 날짜, 모델, 용도)별로 쌓인다", async () => {
  const day = D.dayPT();
  await gen(["u1-fake-ok"], { purpose: "vocab" }); await gen(["u1-fake-ok"], { purpose: "vocab" }); await gen(["u1-fake-ok"], { purpose: "verify" });
  const row = D.db.prepare("SELECT * FROM ai_budget WHERE day = ? AND model = ? AND purpose = ?").get(day, "u1-fake-ok", "vocab");
  assert.deepEqual({ ...row }, { day, model: "u1-fake-ok", purpose: "vocab", calls: 2, tok_in: 240, tok_out: 90, tok_think: 14 });
  assert.deepEqual(D.budgetToday("u1-fake-ok"), { calls: 3, tok_in: 360, tok_out: 135, tok_think: 21 });
  assert.equal(D.budgetToday("u1-fake-ok", "verify").calls, 1);
  assert.equal(D.budgetToday(null, "grade").calls, 4);
  assert.deepEqual(D.budgetToday("없는 모델"), { calls: 0, tok_in: 0, tok_out: 0, tok_think: 0 });
});

test("하루 몫: 배경 작업은 RPD의 60%를 쓴 모델을 건너뛰고, 설명은 합쳐서 40%, 채점은 제한 없음", async () => {
  D.db.prepare("INSERT INTO ai_budget(day, model, purpose, calls) VALUES (?, 'h1-fake-ok', 'grade', 120)").run(D.dayPT());
  assert.equal((await gen(["h1-fake-ok", "h2-fake-ok"])).model, "h2-fake-ok");
  const e = await rejects(gen(["h1-fake-ok"])); assert.equal(e.code, "cap"); assert.equal(e.status, 429);
  assert.equal((await gen(["h1-fake-ok"], { purpose: "grade" })).model, "h1-fake-ok");
  D.db.prepare("INSERT INTO ai_budget(day, model, purpose, calls) VALUES (?, 'h3', 'narr', 80)").run(D.dayPT());
  assert.equal((await rejects(gen(["h2-fake-ok"], { purpose: "narr" }))).code, "cap");
  D.db.prepare("DELETE FROM ai_budget WHERE model = 'h3'").run();
});

test("aiLane: 채점은 바로 들어가고, 배경 작업은 거절, 설명은 5초까지 기다린다", async () => {
  const one = (purpose, model, o = {}) => ai.generate({ purpose, prompt: "x", schema: SCHEMA, models: [model], ...o });
  const g = one("grade", "l1-fake-slow800");
  assert.equal(ai.aiLane.busy(), 1);
  const e = await rejects(gen(["l2-fake-ok"]));
  assert.equal(e.code, "lane"); assert.equal(e.status, 503);
  const t = Date.now();
  const g2 = one("grade", "l3-fake-ok");                         // 채점끼리는 기다리지 않는다
  const n = one("narr", "l4-fake-ok");
  assert.equal((await g2).model, "l3-fake-ok"); assert.ok(Date.now() - t < 600);
  assert.equal((await n).model, "l4-fake-ok"); assert.ok(Date.now() - t >= 500);   // 채점이 다 끝난 뒤에야
  await g; assert.ok(ai.aiLane.idle());
  const g3 = one("grade", "l5-fake-slow6000", { perTry: 8000 });
  assert.equal((await rejects(one("narr", "l4-fake-ok"))).code, "lane");          // 5초 넘게 막히면 포기
  await g3; assert.ok(ai.aiLane.idle());
});

test("키 오류: 다음 모델로 넘기지 않고 바로 알린다", async () => {
  const e = await rejects(gen(["k1-fake-400key", "k2-fake-ok"]));
  assert.equal(e.status, 502); assert.equal(e.message, "Gemini API 키가 맞지 않거나 권한이 없어요 (서버 설정 확인)");
  assert.equal((await reqs("k2-fake-ok")).length, 0);
  assert.equal(lines(/^Gemini 오류 k1-fake-400key 400 API key not valid.*\(received \[키\]\)/).length, 1);    // 가짜가 돌려준 키는 지워서 남긴다
  assert.equal((await rejects(gen(["k3-fake-401"]))).code, "key");
  assert.equal((await rejects(gen(["k4-fake-403"]))).code, "key");
});

test("db: meta · bumpMeta · blockModel · blocked", () => {
  assert.equal(D.meta("t:x"), null);
  assert.equal(D.bumpMeta("tag_rev:999"), 1); assert.equal(D.bumpMeta("tag_rev:999"), 2); assert.equal(D.meta("tag_rev:999"), "2");
  assert.equal(D.meta("t:x", "2026-10-26T07:00:00.000Z"), "2026-10-26T07:00:00.000Z"); assert.equal(D.meta("t:x"), "2026-10-26T07:00:00.000Z");
  assert.equal(D.meta("t:x", null), null); assert.equal(D.meta("t:x"), null);
  const u = D.blockModel("zz", Date.now() + 6e4, "시험"); assert.equal(D.blocked("zz"), u);
  D.blockModel("zz", Date.now() - 1000, "지난 차단"); assert.equal(D.blocked("zz"), null);
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM ai_block WHERE model = 'zz'").get().n, 0);
});

const PACK = (p = {}, c = {}) => ({ semester: { code: "zz-9", name: "시험 학기" }, course: { code: "ZZT", name: "시험 과목", ...c },
  chapters: [{ key: "1", title: "1장" }], problems: [{ ext_id: "m1", chapter: "1", kind: "mc", q: "문제", opts: ["가", "나", "다", "라"], ans: 1, ...p }] });
const WHY = ["가라고 생각함", "", "다라고 생각함", "라라고 생각함"];

test("checkPack: 객관식 why는 opts와 같은 개수의 문장 목록, course.topics는 {코드: 이름}", () => {
  assert.deepEqual(D.checkPack(PACK()), []);
  assert.deepEqual(D.checkPack(PACK({ why: WHY })), []);
  assert.deepEqual(D.checkPack(PACK({ why: null })), []);
  for (const why of [["하나", ""], "문장", [1, "", "", ""]]) {
    const errs = D.checkPack(PACK({ why }));
    assert.equal(errs.length, 1); assert.match(errs[0], /^m1: 보기별 착각\(why\)은 보기\(opts\)와 같은 개수의 문장 목록이어야 해요 \(보기 4개, 정답 자리는 ""\)$/);
  }
  assert.ok(D.checkPack(PACK({ why: ["\\(x", "", "", ""] }, { math: true })).some(e => /짝이 안 맞아요/.test(e)));      // why도 수식 검사
  assert.deepEqual(D.checkPack(PACK({}, { topics: { lp: "선형계획" } })), []);
  assert.match(D.checkPack(PACK({}, { topics: ["lp"] }))[0], /course\.topics/);
});

test("importPack: why는 문제 body에, course.topics는 course.info에 남는다", () => {
  const r = D.importPack(PACK({ why: WHY, topic: "lp" }, { topics: { lp: "선형계획" } }));
  assert.ok(r.ok, JSON.stringify(r.errors));
  const info = () => JSON.parse(D.db.prepare("SELECT info FROM course WHERE id = ?").get(r.courseId).info);
  assert.deepEqual(info().topics, { lp: "선형계획" });
  const body = JSON.parse(D.db.prepare(`SELECT pv.body FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = ? AND p.ext_id = 'm1'`).get(r.courseId).body);
  assert.deepEqual(body.why, WHY); assert.equal(body.topic, "lp");
  assert.deepEqual(D.coursePayload(r.courseId).topics, { lp: "선형계획" });
  D.importPack(PACK());                                           // topics가 없는 팩이면 info에 topics 칸을 만들지 않는다
  assert.deepEqual(Object.keys(info()), ["color", "lang", "math", "files", "concepts"]);
});

test("채점: 모든 모델이 막히면 지금까지와 같은 문구", async () => {
  await post("/_reset");
  await post("/_mode", { mode: "429min" });
  let e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 1"));
  assert.deepEqual({ ...e }, { code: "quota", status: 429, message: QUOTA });
  assert.deepEqual((await reqs()).map(q => q.model), ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"]);
  await post("/_mode", { mode: "503" });
  e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 2"));
  assert.equal(e.status, 503); assert.equal(e.message, "AI가 지금 붐벼요. 잠시 뒤에 다시 해 주세요");
  await post("/_mode", { mode: "badjson" });
  e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 3"));
  assert.equal(e.status, 502); assert.equal(e.message, "AI 답을 읽지 못했어요. 직접 채점해 주세요");
  await post("/_mode", { mode: "400" });
  e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 4"));
  assert.equal(e.status, 502); assert.equal(e.message, "AI 채점에 실패했어요. 직접 채점해 주세요");
  await post("/_mode", { mode: "429day" });
  e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 5"));
  assert.equal(e.status, 429); assert.equal(e.message, QUOTA);
  assert.equal(D.db.prepare("SELECT COUNT(*) n FROM ai_block WHERE model IN ('gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest')").get().n, 3);
  const before = (await reqs()).length;                            // 다 막힌 뒤에는 요청 없이 같은 문구
  e = await rejects(ai.gradeEssay(PROBLEM, "한도 시험 답안 6"));
  assert.equal(e.status, 429); assert.equal(e.message, QUOTA);
  assert.equal((await reqs()).length, before);
  assert.equal((await ai.gradeEssay(PROBLEM, ANSWER)).cached, true);    // 캐시된 답안은 그대로 돌려준다
  await post("/_mode", { mode: null });
});

test("키는 어떤 로그·오류·URL에도 나오지 않는다", async () => {
  assert.ok(logs.length > 10);
  for (const l of logs) assert.ok(!l.includes(KEY), "로그: " + l.slice(0, 80));
  assert.ok(thrown.length > 10);
  for (const e of thrown) assert.ok(!JSON.stringify(e).includes(KEY) && !String(e.message).includes(KEY));
  assert.ok((await get("/_log")).every(q => q.hasKey && !q.keyInUrl));
});
