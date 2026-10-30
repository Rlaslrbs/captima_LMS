// 학습 리포트 엔진 시험:  node --test server/insight/test/
// 합성 기록(가짜 과목)으로 규칙을 하나씩 확인하고, DB 복사본(읽기 전용)의 실제 기록으로 속도·정답 숨김을 확인한다.
// ctx/raw는 이 파일 안의 작은 로더로 만든다 (server/insight/ctx.js · evidence.js와 같은 모양: BUILD Contract 1–2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as E from "../../../web/js/insight-engine.js";
import { PARAMS, PARAM_VER, DEFAULTS, merge } from "../params.js";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, "..", "..", "..");
const P = PARAMS, DAY0 = E.dayOf("2026-10-20T03:00:00Z"), NOW = DAY0 + 5;
const iso = (day, h = 3, m = 0, s = 0) => new Date(day * 864e5 - 9 * 3600e3 + ((h * 60 + m) * 60 + s) * 1e3).toISOString();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} ±${tol}`);

// ───────── 합성 과목 ─────────
/** spec: [[chKey, [kind…]], …] → ctx (Contract 2 모양) */
function fakeCtx(spec, extra = {}) {
  const chapters = spec.map(([key], i) => ({ key, title: `${i + 1}장 단원${key}`, short: key, grp: "", sort: i }));
  const items = new Map(); let pid = 100;
  for (const [ch, kinds] of spec) kinds.forEach((kind, i) => {
    const id = ++pid, b = { q: `${ch} 문제 ${i + 1}: 이 진술을 판단하시오 <b>굵게</b>`, s: `<p>풀이 ${id}. 함정: 조건 ${id}을 반대로 읽기 쉬워요.</p>` };
    if (kind === "ox") { b.ox = i % 2 === 0; if (!b.ox) b.fix = `바른진술 고유문장 ${id}번은 이렇다`; }
    if (kind === "mc") { b.opts = [0, 1, 2, 3].map(k => `보기${k} 고유텍스트 ${id}-${k}`); b.ans = 2; }
    if (kind === "short") { b.a = `정답값${id}`; b.accept = [`정답값${id}`]; }
    if (kind === "essay") { b.a = `모범답안 ${id}`; b.pts = ["핵심 하나", "핵심 둘"]; }
    items.set(id, { pid: id, ext: `${ch}-${i + 1}`, ch, kind, v: 1, star: 0, status: "published", topic: extra.topic ? extra.topic(ch, i) : null,
      exam: false, len: 60, nopt: kind === "mc" ? 4 : 0, body: b });
  });
  return { key: "fake", cid: 9, name: "가짜 과목", short: "가짜", lang: "ko", math: false, chapters, items, sameAsCurrent: () => true,
    topics: extra.topics ?? null, hasConcept: new Set(), tags: new Map(), misc: extra.misc || {}, diag: extra.diag || new Map(),
    medLen: { ox: 60, mc: 60, short: 60, essay: 60 }, lnP: E.lnP };
}
/** 한 기기의 기록 만들기: ans(pid, ok, opts) */
function recorder(ctx) {
  const events = [], progress = new Map(); let rid = 0;
  const ans = (pid, ok, o = {}) => {
    const it = ctx.items.get(pid), day = o.day ?? DAY0, prev = progress.get(pid);
    const at = (prev ? prev.attempts : 0) + 1;
    const answer = o.answer ?? (it.kind === "ox" ? ((it.body.ox === ok) ? "O" : "X") : it.kind === "mc" ? "ABCD"[ok ? it.body.ans : (o.opt ?? 0)] : ok ? it.body.a : (o.text ?? "틀린답"));
    const t = o.ts ?? iso(day, 3, 0, (rid + 1) * 30); rid++;
    events.push({ rid, pid, v: 1, type: o.idk ? "idk" : "answer_submit", sid: o.sid ?? "s" + day, ts: t,
      p: { kind: it.kind, answer: o.idk ? "모르겠어요" : answer, correct: !!ok && !o.idk, ms: o.ms ?? 8000, attempt: o.attempt ?? at, self: false, scope: it.ch, mode: o.mode ?? "focus", ...(o.p || {}) } });
    const wc = (prev ? prev.wrong_count : 0) + (ok && !o.idk ? 0 : 1);
    progress.set(pid, { pid, v: 1, status: ok && !o.idk ? (wc ? "resolved" : "correct") : "wrong", attempts: at, wrong_count: wc, last_answer: o.idk ? "모르겠어요" : answer, updated_at: t });
  };
  return { ans, raw: () => ({ events: [...events], progress: [...progress.values()], grades: [], aux: [] }), events, progress };
}
const pidsOf = (ctx, ch) => [...ctx.items.values()].filter(i => i.ch === ch).map(i => i.pid);

// ───────── 1. 정보량 · 이름표 ─────────
test("정보량: θ = d에서 단답 .24 · 객관식4 .15 · O/X .083", () => {
  near(E.info(0, 0, P.guess.short_num), 0.24, 0.002, "short");
  near(E.info(1.3, 1.3, 0.25), 0.15, 0.001, "mc4");
  near(E.info(-0.3, -0.3, 0.5), 0.0833, 0.001, "ox");
});

test("params: 기본값 · 덮어쓰기 합치기", () => {
  assert.equal(PARAM_VER >= 1, true);
  const m = merge(DEFAULTS, { time: { nMin: 12 }, w: { first: 0.9 } });
  assert.equal(m.time.nMin, 12); assert.equal(m.time.b0.ox, 6); assert.equal(m.w.first, 0.9); assert.equal(m.w.retry, 0.5);
});

test("이름표: 약함 · 탄탄 · 판단 보류 · 객관식만 맞힌 단원은 탄탄이 아님", () => {
  const ctx = fakeCtx([["A", Array(12).fill("short")], ["B", Array(24).fill("short")], ["C", Array(12).fill("mc")],
    ["D", Array(12).fill("short")], ["E", ["ox", "ox", "ox", "ox"]], ["F", Array(12).fill("ox")]]);
  const R = recorder(ctx);
  pidsOf(ctx, "A").forEach(p => R.ans(p, false));                         // 다 틀림
  pidsOf(ctx, "B").forEach(p => R.ans(p, true));                          // 단답 다 맞힘
  pidsOf(ctx, "C").forEach(p => R.ans(p, true));                          // 객관식만 다 맞힘
  pidsOf(ctx, "D").forEach((p, i) => R.ans(p, i % 4 !== 0));              // 3/4
  pidsOf(ctx, "E").slice(0, 2).forEach(p => R.ans(p, true));             // 2문제뿐
  pidsOf(ctx, "F").forEach((p, i) => R.ans(p, i !== 0));                  // 11/12 (전체 수준이 높은 학습자)
  const det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.equal(det.state, "ready");
  const lab = Object.fromEntries(det.units.map(u => [u.code, u.label]));
  assert.equal(lab.A, "weak"); assert.equal(lab.B, "solid"); assert.notEqual(lab.C, "solid"); assert.equal(lab.E, "pending");
  assert.equal(lab.D, "ok");
  const a = det.units.find(u => u.code === "A");
  assert.deepEqual(a.counts, { c: 0, w: 12, idk: 0 }); assert.ok(a.pred[0] < a.pred[1] && a.pred[1] < det.units.find(u => u.code === "B").pred[0], "A 띠가 B 띠보다 아래");
  // 약한 A가 첫 결과, 글에 단원 이름과 실제 신호(단답 오답 12개)가 들어간다
  const f = det.findings.find(x => x.unit && x.unit.code === "A");
  assert.ok(f, "A finding"); assert.match(f.text.diag + f.text.signals, /단원A/); assert.match(f.text.signals, /단답 오답 12개/);
  assert.ok(f.evidence.length >= 3 && f.evidence.every(e => e.hidden && e.trap === "" && /씀$/.test(e.label)));
  assert.match(det.headline, /단원A/);
  assert.ok(det.strong.some(s => s.code === "B"));
  assert.ok(det.plan.steps.some(s => s.id === f.plan && s.n > 0));
});

// ───────── 2. 해설을 본 뒤 고른 답 (seen) · 예전 기록 ─────────
test("seen 추론: 같은 세션에서 O를 22번 → 첫 오답 1개 + 나머지는 post", () => {
  const ctx = fakeCtx([["A", ["ox", "ox", "ox"]]]), pid = 102;              // 102 = 거짓 진술
  const R = recorder(ctx);
  for (let i = 0; i < 22; i++) R.ans(pid, false, { ts: iso(DAY0, 3, 0, i), ms: i ? 150 : 5900 });
  R.ans(pid, true, { ts: iso(DAY0, 3, 1, 10), ms: 37000 });
  const N = E.normalize(R.raw(), ctx, P, NOW);
  const mine = N.obs.filter(o => o.pid === pid);
  assert.equal(mine.length, 1); assert.equal(mine[0].src, "first"); assert.equal(mine[0].y, 0); assert.equal(mine[0].opt, 1);
  assert.equal(N.post.filter(x => x.pid === pid).length, 22);
  assert.equal(N.post.filter(x => x.pid === pid && x.ok).length, 1);
  // 새 기록(seen 값이 있음)은 그 값을 따른다: seen:false면 다시 푼 것으로 센다
  const R2 = recorder(ctx);
  R2.ans(pid, false, { ts: iso(DAY0, 3, 0, 0), p: { seen: false } });
  R2.ans(pid, true, { ts: iso(DAY0, 3, 0, 20), p: { seen: false } });
  const N2 = E.normalize(R2.raw(), ctx, P, NOW);
  assert.deepEqual(N2.obs.map(o => o.src), ["first", "retry"]); assert.equal(N2.post.length, 0);
  assert.equal(N2.obs[1].dropped, true);                                  // O/X를 틀린 뒤 다시: 남은 답이 하나뿐
});

test("예전 기록(legacy): 기록 없는 진행 행 · 고른 답 · 고침 · 첫 기록이 attempt>1", () => {
  const ctx = fakeCtx([["A", ["mc", "mc", "ox", "mc"]]]);
  const progress = [
    { pid: 101, v: 1, status: "correct", attempts: 1, wrong_count: 0, last_answer: "C", updated_at: iso(DAY0 - 3) },
    { pid: 102, v: 1, status: "wrong", attempts: 1, wrong_count: 1, last_answer: "B", updated_at: iso(DAY0 - 3) },
    { pid: 103, v: 1, status: "resolved", attempts: 2, wrong_count: 1, last_answer: "X", updated_at: iso(DAY0 - 3) },
    { pid: 104, v: 1, status: "resolved", attempts: 4, wrong_count: 2, last_answer: "C", updated_at: iso(DAY0) },
  ];
  const events = [
    { rid: 1, pid: 104, v: 1, type: "answer_submit", sid: "s", ts: iso(DAY0, 4), p: { kind: "mc", answer: "A", correct: false, ms: 9000, attempt: 3, mode: "focus" } },
    { rid: 2, pid: 104, v: 1, type: "answer_submit", sid: "s2", ts: iso(DAY0 + 1, 4), p: { kind: "mc", answer: "C", correct: true, ms: 9000, attempt: 4, mode: "focus" } },
  ];
  const N = E.normalize({ events, progress, grades: [] }, ctx, P, NOW);
  const by = pid => N.obs.filter(o => o.pid === pid).map(o => `${o.src}:${o.y}`);
  assert.deepEqual(by(101), ["legacy:1"]);
  assert.deepEqual(by(102), ["legacy:0"]);
  assert.equal(N.obs.find(o => o.pid === 102).opt, 1);                   // 예전 기록의 고른 답 B
  assert.deepEqual(by(103), ["legacy:0", "legacy_fix:1"]);
  assert.equal(N.obs.find(o => o.pid === 103 && o.src === "legacy_fix").dropped, true);   // O/X 고침은 버림
  // 104: wrong_count 2 − 오답 이벤트 1 > 0 → 예전에 한 번 틀림. 날짜 = 첫 이벤트 하루 전. 이후 기록은 retry/spaced
  assert.deepEqual(by(104), ["legacy:0", "spaced:0", "spaced:1"]);
  assert.equal(N.obs.find(o => o.pid === 104 && o.src === "legacy").day, DAY0 - 1);
  const s1 = N.obs.filter(o => o.pid === 104 && o.src === "spaced")[1];
  near(s1.g, 1 / 3, 1e-9, "elim: A를 이미 지움 → 1/3");
  assert.equal(N.meta.legacy, 4); assert.equal(N.meta.first, 0);
});

test("숨긴 문제와 ctx에 없는 문제는 건너뛴다", () => {
  const ctx = fakeCtx([["A", ["ox", "ox"]]]); ctx.items.get(101).status = "hidden";
  const R = recorder(ctx); R.ans(101, true); R.ans(102, true);
  const raw = R.raw(); raw.progress.push({ pid: 999, v: 1, status: "wrong", attempts: 1, wrong_count: 1, last_answer: "O", updated_at: iso(DAY0) });
  const N = E.normalize(raw, ctx, P, NOW);
  assert.deepEqual(N.obs.map(o => o.pid), [102]); assert.equal(N.meta.skipped, 2);
});

// ───────── 3. 빠른 답 기준 · 시간 모형 ─────────
test("빠른 답 기준: 예측 중앙값의 10%, 1.5–10초, 서술형은 없음", () => {
  const ctx = fakeCtx([["A", ["ox", "mc", "short", "essay", "mc"]]]);
  ctx.items.get(105).body.num = 3; ctx.items.get(105).body.q = "x = 3일 때 값은?";   // 계산 문항 (calc)
  const R = recorder(ctx);
  R.ans(101, true, { ms: 1400 }); R.ans(102, true, { ms: 1900 }); R.ans(103, true, { ms: 1600 });
  R.ans(104, true, { ms: 500, p: { self: true } }); R.ans(105, true, { ms: 5000 });
  const N = E.normalize(R.raw(), ctx, P, NOW), T = E.timeModel(N.obs, R.raw(), P);
  const o = pid => N.obs.find(x => x.pid === pid);
  near(o(101).T, 1500, 1, "ox 6s×.1 → 하한 1.5s"); assert.equal(o(101).rapid, true);
  near(o(102).T, 2000, 150, "mc 20s×.1"); assert.equal(o(102).rapid, true);
  assert.equal(o(103).rapid, false);                                       // 단답 1.5s 기준 → 1.6s는 빠른 답 아님
  assert.equal(o(104).rapid, false); assert.equal(o(104).T, undefined);   // 서술형
  near(o(105).T, 0.1 * 20 * Math.exp(P.time.b_calc.mc) * 1000, 300, "계산 객관식"); assert.equal(o(105).rapid, true);
  assert.equal(T.rapid, 3);
});

test("시간 모형: 한 학습자의 τ·σ 추정, z 분포, 겹친 창·자리 비움 제외", () => {
  const ctx = fakeCtx([["A", Array(40).fill("ox")], ["B", Array(40).fill("ox")]]);
  const R = recorder(ctx); let rng = 7;
  const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  const tau = 0.4, sd = 0.7; let k = 0;
  for (const it of ctx.items.values()) {
    const t = 6 * Math.exp(-tau + sd * gauss());
    R.ans(it.pid, rnd() < 0.8, { ts: iso(DAY0, 3, 0, (k += 400)), ms: Math.round(t * 1000), p: it.pid === 101 ? { away: 1 } : {} });
  }
  const raw = R.raw(), N = E.normalize(raw, ctx, P, NOW), T = E.timeModel(N.obs, raw, P);
  near(T.tau.ox, tau, 0.2, "τ"); near(T.sig.ox, sd, 0.15, "σ");
  assert.ok(T.active.ox); assert.ok(!N.obs.find(o => o.pid === 101).tt);   // 탭을 떠난 풀이는 시간 증거 아님
  const z = T.timed.map(o => o.z), ext = z.filter(x => Math.abs(x) > 1.645).length / z.length;
  assert.ok(ext > 0.03 && ext < 0.2, "|z|>1.645 비율 " + ext);
  // 다른 문제의 답이 이 풀이 시간 안에 있으면 무효
  const ctx2 = fakeCtx([["A", ["ox", "ox"]]]), R2 = recorder(ctx2);
  R2.ans(101, true, { ts: iso(DAY0, 3, 0, 10), ms: 5000 }); R2.ans(102, true, { ts: iso(DAY0, 3, 0, 12), ms: 8000 });
  const N2 = E.normalize(R2.raw(), ctx2, P, NOW); E.timeModel(N2.obs, R2.raw(), P);
  assert.ok(N2.obs.find(o => o.pid === 101).tt); assert.ok(!N2.obs.find(o => o.pid === 102).tt);
});

test("도움·☆: AI 복사 뒤 답은 ×0.3, 맞힌 직후 ☆는 '나중에 볼 문제'로만 (자신 없음이라 하지 않음)", () => {
  const ctx = fakeCtx([["A", ["ox", "ox", "ox"]]]), R = recorder(ctx);
  R.ans(101, true, { ts: iso(DAY0, 3, 10) }); R.ans(102, true, { ts: iso(DAY0, 3, 20) });
  const raw = R.raw();
  raw.aux = [{ rid: 90, pid: 101, v: 1, type: "ai_copy", ts: iso(DAY0, 3, 5), p: { st: "new" } },
    { rid: 91, pid: 102, v: 1, type: "bookmark", ts: iso(DAY0, 3, 21), p: { on: true } }];
  const N = E.normalize(raw, ctx, P, NOW), A = E.joinAux(N.obs, raw, P);
  const o = N.obs.find(x => x.pid === 101);
  assert.equal(o.assist, true); near(o.w, P.time.wAssist, 1e-9);
  assert.ok(A.star.has(102) && !A.unsure.has(102) && !A.star.has(101), "☆는 star로만 (믿음 unsure가 아님)");
  const rel = E.relearning(N.obs, ctx, NOW, { status: new Map(raw.progress.map(r => [r.pid, r.status])), post: N.post, aux: A });
  assert.deepEqual(rel.due, [101, 102]); assert.equal(rel.star, 1); assert.equal(rel.asked, 1);
  assert.ok(!JSON.stringify(E.buildReport(raw, ctx, P, NOW)).includes("자신 없"), "det 어디에도 '자신 없음' 표현 없음");
});

// ───────── 4. 오개념 판별 (SPEC §5.1 worked checks, ±0.01) ─────────
test("오개념 pM: 여섯 가지 계산 예", () => {
  const run = (mcHits, mcD, oxHits, avoidMC = 0) => {
    const spec = [["A", [...Array(mcHits + avoidMC).fill("mc"), ...Array(oxHits).fill("ox")]]];
    const ctx = fakeCtx(spec), diag = new Map(); ctx.diag = diag;
    let i = 0; const R = recorder(ctx);
    for (const it of ctx.items.values()) {
      if (it.kind === "mc") { diag.set(it.pid, { v: 1, review: "auto", diag: { opt: { 1: { m: "m1", d: mcD, src: "explanation" } } } }); R.ans(it.pid, i < mcHits ? false : true, { opt: 1 }); }
      else { it.body.ox = false; diag.set(it.pid, { v: 1, review: "auto", diag: { ox: { m: "m1", d: 3, src: "fix" } } }); R.ans(it.pid, false); }
      i++;
    }
    const N = E.normalize(R.raw(), ctx, P, NOW), M = E.misconceptions(N.obs, ctx, P);
    assert.equal(M.length, 1); return M[0];
  };
  const cases = [[[2, 3, 0], 0.79, "likely"], [[2, 2, 0], 0.72, "likely"], [[1, 3, 0, 1], 0.24, null],
    [[0, 3, 2], 0.51, "hyp"], [[0, 3, 4], 0.76, "likely"], [[1, 3, 2], 0.78, "likely"]];
  for (const [args, pM, flag] of cases) { const r = run(...args); near(r.pM, pM, 0.01, JSON.stringify(args)); assert.equal(r.flag, flag, JSON.stringify(args)); }
  assert.deepEqual(E.misconceptions([], fakeCtx([["A", ["ox"]]]), P), []);   // 태그 없으면 []
  assert.deepEqual(E.confusions([], fakeCtx([["A", ["ox"]]]), P), []);
});

// ───────── 5. 정답 숨김 · 결정성 ─────────
/** 아직 틀린 문제의 정답 쪽 글(정답 보기·a·accept·fix·해설 함정 문장)이 det 어디에도 없어야 한다 */
function leaks(det, ctx, status) {
  // 해설을 볼 수 있는 칩의 함정 문장은 그 문제 자신의 해설이다 (다른 문제의 정답 낱말이 거기 우연히 나와도 노출이 아니다)
  const J = JSON.stringify(det, (k, v) => (k === "trap" && typeof v === "string" ? undefined : v)), bad = [];
  for (const [pid, st] of status) {
    if (st !== "wrong") continue;
    const it = ctx.items.get(pid); if (!it) continue;
    const b = it.body || {}, S = [];
    if (it.kind === "mc" && Array.isArray(b.opts) && b.opts[b.ans] != null) S.push(E.strip(b.opts[b.ans]));
    if (it.kind !== "ox" && b.a) S.push(E.strip(b.a));
    (b.accept || []).forEach(x => S.push(E.strip(x)));
    if (b.fix) S.push(E.strip(b.fix));
    const s = E.strip(b.s);
    if (s) s.split(/(?<=[.!?])\s+/).filter(x => /함정|주의|헷갈|혼동|아니|오답/.test(x)).forEach(x => S.push(x.slice(0, 60)));
    for (const x of S) if (x.length >= 6 && J.includes(JSON.stringify(x).slice(1, -1))) bad.push(`${pid}: ${x.slice(0, 40)}`);
  }
  for (const f of det.findings || []) for (const e of f.evidence) if (e.hidden) assert.equal(e.trap, "", "숨긴 칩의 함정 문장");
  return bad;
}
test("정답 숨김: 아직 틀린 문제는 hidden·trap 없음·정답 글 없음", () => {
  const ctx = fakeCtx([["A", ["mc", "mc", "ox", "ox", "short", "short", "mc", "ox", "short", "mc"]], ["B", Array(10).fill("ox")], ["C", Array(10).fill("mc")]]);
  const R = recorder(ctx);
  pidsOf(ctx, "A").forEach((p, i) => R.ans(p, false, { day: DAY0 + (i % 3) }));
  pidsOf(ctx, "A").slice(0, 3).forEach(p => R.ans(p, true, { day: DAY0 + 3 }));   // 몇 개는 다시 맞힘 → 함정 문장 보임
  pidsOf(ctx, "B").forEach((p, i) => R.ans(p, i % 4 !== 0)); pidsOf(ctx, "C").forEach((p, i) => R.ans(p, i % 2 === 0));
  const raw = R.raw(), det = E.buildReport(raw, ctx, P, NOW), st = new Map(raw.progress.map(r => [r.pid, r.status]));
  assert.equal(det.state, "ready");
  assert.deepEqual(leaks(det, ctx, st), []);
  const ev = det.findings.flatMap(f => f.evidence);
  assert.ok(ev.some(e => e.hidden) && ev.some(e => !e.hidden && e.trap), "숨긴 칩과 함정 문장이 있는 칩이 둘 다 있다");
  for (const e of ev) { assert.ok(E.visLen(e.stem) <= 120 && !/<b>/.test(e.stem)); assert.ok(E.visLen(e.chosen_text) <= 80); assert.match(e.day, /^\d+\/\d+$/); }
});

test("결정성: 같은 입력(순서를 섞어도) → 같은 det", () => {
  const ctx = fakeCtx([["A", Array(10).fill("ox")], ["B", Array(10).fill("mc")], ["C", Array(10).fill("short")]]);
  const R = recorder(ctx);
  [...ctx.items.keys()].forEach((p, i) => R.ans(p, i % 3 !== 1, { day: DAY0 + (i % 4), ms: 3000 + 977 * (i % 7) }));
  const raw = R.raw(), a = JSON.stringify(E.buildReport(raw, ctx, P, NOW));
  const sh = { ...raw, events: [...raw.events].reverse(), progress: [...raw.progress].reverse() };
  assert.equal(JSON.stringify(E.buildReport(sh, fakeCtx([["A", Array(10).fill("ox")], ["B", Array(10).fill("mc")], ["C", Array(10).fill("short")]]), P, NOW)), a);
  assert.equal(JSON.stringify(E.buildReport(structuredClone(raw), ctx, P, NOW)), a);
});

test("잠김: 기준 미달이면 have/need와 여러 단원의 다음 문제 (≤12)", () => {
  const ctx = fakeCtx([["A", Array(6).fill("ox")], ["B", Array(6).fill("mc")], ["C", Array(6).fill("short")], ["D", Array(6).fill("ox")]]);
  const R = recorder(ctx); pidsOf(ctx, "A").slice(0, 4).forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.equal(det.state, "locked"); assert.equal(det.have.events, 4); assert.deepEqual(det.need, { n_eff: 30, chapters: 3 });
  assert.ok(det.next.pids.length > 5 && det.next.pids.length <= 12 && new Set(det.next.pids.map(p => ctx.items.get(p).ch)).size >= 3);
  assert.equal(det.narr_state, "off");
});

test("잠김: '지금 풀면 좋은 문제'를 모두 풀면 실제로 열린다 (새 단원에서 3문제씩, 모자란 만큼)", () => {
  const ctx = fakeCtx([["A", Array(12).fill("ox")], ["B", Array(12).fill("mc")], ["C", Array(12).fill("ox")], ["D", Array(12).fill("short")]]);
  const R = recorder(ctx); pidsOf(ctx, "A").forEach(p => R.ans(p, true)); pidsOf(ctx, "B").slice(0, 10).forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.equal(det.state, "locked"); assert.equal(det.have.chapters, 2);
  const nx = det.next.pids; assert.ok(nx.length >= Math.ceil(30 - det.have.n_eff) && nx.length <= 12, String(nx.length));
  assert.ok(nx.filter(p => ctx.items.get(p).ch === "C").length >= 3 || nx.filter(p => ctx.items.get(p).ch === "D").length >= 3, "새 단원 한 곳에서 3문제 이상");
  nx.forEach(p => R.ans(p, true, { day: DAY0 + 1 }));
  assert.equal(E.buildReport(R.raw(), ctx, P, NOW).state, "ready");
});

// ───────── 5b. 행동 신호 (TIME_FACTORS §4–§5) ─────────
const jit = i => Math.exp(0.25 * Math.sin(i * 2.399));                     // 결정적인 흔들림 (σ ≈ .18)
test("fluency: 맞히지만 다른 단원보다 2.5배 느림 → 카드·느린 칩(sec, rel)·시간 재고 풀기(target_s)", () => {
  const ctx = fakeCtx([["A", Array(16).fill("ox")], ["B", Array(16).fill("ox")], ["C", Array(16).fill("ox")]]), R = recorder(ctx);
  let i = 0;
  for (const ch of ["A", "B", "C"]) pidsOf(ctx, ch).slice(0, 12).forEach((p, k) => {
    const day = DAY0 + (k % 2), ms = Math.round(6000 * (ch === "A" ? 2.5 : 1) * jit(++i));
    R.ans(p, k !== 4 && k !== 5, { day, ms, ts: iso(day, ch === "A" ? 3 : ch === "B" ? 5 : 7, k, 0) });   // 참·거짓 하나씩 틀림 (O/X 치우침 없음)
  });
  const D = {}, det = E.buildReport(R.raw(), ctx, P, NOW, D);
  const a = det.units.find(u => u.code === "A");
  assert.equal(a.speed, "slow"); assert.equal(det.units.find(u => u.code === "B").speed, "normal");
  const f = det.findings.find(x => x.type === "fluency");
  assert.ok(f, "fluency 카드"); assert.equal(f.unit.code, "A");
  assert.match(f.text.diag, /단원A.*2\.\d배 오래 걸려요 \(맞힌 \d+문제, 내 예상 \d+초 → 실제 \d+초\)/);
  assert.ok(f.evidence.length === 3 && f.evidence.every(e => e.role === "slow" && e.sec > 10 && e.rel > 1.8 && e.trap === ""));
  const st = det.plan.steps.find(x => x.id === f.plan);
  assert.equal(st.type, "timed"); assert.ok(st.n >= 4 && st.target_s.length === st.n && st.target_s.every(t => t >= 5 && t <= 180));
  assert.match(st.title, /^시간 재고 풀기 · \d문제 · 문제당 약 \d+초$/);
  assert.ok(st.target_s.every(t => t < 12), "목표 시간은 다른 단원에서의 내 속도 (6초 근처)");
  assert.match(det.headline, /단원A.*평소의 2\.\d배/);
  assert.ok(det.time.n_timed >= 30 && det.time.ref.ox > 4 && det.time.ref.ox < 9 && det.time.notes.some(n => /평소의 2\.\d배/.test(n)));
  // ☆(나중에 볼 문제)는 탄탄·fluency에 영향이 없고, 칩에는 '☆ 담아 둠' 사실만 (자신 없음이라 하지 않음)
  const raw = R.raw(); raw.aux = pidsOf(ctx, "A").slice(0, 6).map((p, k) => { const e = raw.events.find(x => x.pid === p); return { rid: 900 + k, pid: p, v: 1, type: "bookmark", ts: new Date(Date.parse(e.ts) + 5000).toISOString(), p: { on: true } }; });
  const det2 = E.buildReport(raw, ctx, P, NOW);
  assert.ok(det2.findings.some(x => x.type === "fluency"));
  assert.ok(!JSON.stringify(det2).includes("자신 없"));
  assert.ok(det2.findings.flatMap(x => x.evidence).every(e => !e.label.includes("☆") || raw.aux.some(b => b.pid === e.pid)));
  // AI에게 물어보고 맞힌 문제가 ⅓ 이상이면 탄탄이 아니고, 물어본 답은 시간 증거에서 빠진다
  const raw3 = R.raw(); raw3.aux = pidsOf(ctx, "A").slice(0, 6).map((p, k) => { const e = raw3.events.find(x => x.pid === p); return { rid: 950 + k, pid: p, v: 1, type: "ai_copy", ts: new Date(Date.parse(e.ts) - 5000).toISOString(), p: { st: "new" } }; });
  const det3 = E.buildReport(raw3, ctx, P, NOW);
  assert.notEqual(det3.units.find(u => u.code === "A").label, "solid");
  const asked = new Set(raw3.aux.map(b => b.pid)); assert.ok(det3.findings.filter(x => x.type === "fluency").flatMap(x => x.evidence).every(e => !asked.has(e.pid)));
});

test("fatigue: 한 덩어리에서 35분이 지나면 정확도가 떨어짐 (3번의 학습), 30분 안에 끊어 풀면 없음", () => {
  const ctx = fakeCtx(["A", "B", "C", "D", "E", "F"].map(c => [c, Array(30).fill("ox")])), R = recorder(ctx), all = [...ctx.items.keys()];
  let n = 0;
  for (let b = 0; b < 3; b++) for (let k = 0; k < 60; k++) {
    const p = all[n++], late = k >= 37;
    R.ans(p, late ? k % 5 < 2 : k % 10 !== 0, { day: DAY0 + b, ts: iso(DAY0 + b, 2, k, 0), ms: Math.round(6000 * jit(n)) });
  }
  const D = {}; E.buildReport(R.raw(), ctx, P, NOW, D);
  const h = D.hab.find(x => x.id === "fatigue");
  assert.ok(h, "fatigue"); assert.ok(h.stats.early > 0.85 && h.stats.late < 0.5 && h.stats.nb === 3 && h.stats.worse === 3);
  // 같은 답을 20문제(약 30분)마다 한 시간씩 쉬며 풀면 덩어리가 35분을 넘지 않아 fatigue 없음
  const R2 = recorder(ctx); n = 0;
  for (let b = 0; b < 3; b++) for (let k = 0; k < 60; k++) { const p = all[n++]; R2.ans(p, k >= 37 ? k % 5 < 2 : k % 10 !== 0, { day: DAY0 + b, ts: iso(DAY0 + b, 2 + Math.floor(k / 20), (k % 20) * 1.5, 0), ms: 6000 }); }
  const D2 = {}; E.buildReport(R2.raw(), ctx, P, NOW, D2);
  assert.ok(!D2.hab.some(x => x.id === "fatigue"));
});

test("fb_skip: 틀린 뒤 해설을 3초 안에 넘김 (sol_dwell) · 목록 모드 시간 주의 · 빠른 서술형 '모르겠어요'는 약하게", () => {
  const ctx = fakeCtx([["A", Array(12).fill("mc")], ["B", Array(12).fill("mc")], ["C", [...Array(10).fill("mc"), "essay", "essay"]]]), R = recorder(ctx);
  const ps = [...pidsOf(ctx, "A"), ...pidsOf(ctx, "B"), ...pidsOf(ctx, "C").slice(0, 10)];
  ps.forEach((p, k) => R.ans(p, k % 3 !== 0, { day: DAY0 + (k % 2), mode: "list", ts: iso(DAY0 + (k % 2), 3, 8 * k, 0) }));   // 답 사이가 5분을 넘음 → 시간을 못 잼
  const [e1, e2] = pidsOf(ctx, "C").slice(10);
  R.ans(e1, false, { idk: true, ms: 4000, ts: iso(DAY0, 9) }); R.ans(e2, false, { idk: true, ms: 90000, ts: iso(DAY0, 10) });
  const raw = R.raw();
  raw.aux = raw.events.filter(e => e.p.correct === false && e.type === "answer_submit").map((e, k) => ({ rid: 500 + k, pid: e.pid, v: 1, type: "sol_dwell", ts: new Date(Date.parse(e.ts) + 3000).toISOString(), p: { ms: k < 8 ? 1200 : 20000, ok: false } }));
  const D = {}, det = E.buildReport(raw, ctx, P, NOW, D), N = E.normalize(raw, ctx, P, NOW);
  assert.deepEqual(det.time.counts.fb_skip, [8, 12]);
  const h = D.hab.find(x => x.id === "fb_skip"); assert.ok(h); assert.equal(h.stats.k, 8);
  assert.ok(det.caveats.includes("list_time") && det.caveats.includes("few_timed"));
  near(N.obs.find(o => o.pid === e1).w, P.w.idk * P.time.quickIdkW, 1e-9); near(N.obs.find(o => o.pid === e2).w, P.w.idk, 1e-9);
  const f = det.findings.find(x => x.type === "fb_skip");
  if (f) { assert.match(f.text.diag, /^틀린 뒤 해설을 \d+초 안에 넘긴 문제가 12개 중 8개예요/); assert.ok(f.evidence.length > 0); }
});

test("cutTex: 보이는 길이로 세고, 수식은 중간에서 자르지 않고, 짧은 수식을 [수식]으로 바꾸지 않고, 자르지 않았으면 …이 없다", () => {
  const s = "가나다 \\(A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\)일 때 det A를 구하시오. " + "설명 ".repeat(40);
  const c = E.cutTex(s, 60);
  assert.ok(E.visLen(c) <= 60 && c.endsWith("…")); assert.equal((c.match(/\\\(/g) || []).length, (c.match(/\\\)/g) || []).length);
  assert.ok(c.includes("\\begin{bmatrix}") && c.includes("\\end{bmatrix}\\)"), "수식은 통째로");
  assert.equal(E.cutTex("짧은 \\(x\\)", 60), "짧은 \\(x\\)");
  assert.match(E.cutTex("\\(" + "x+".repeat(80) + "\\) 다음 글", 40), /^\[수식\] 다음 글…?$/);
  // 수식이 여럿이어도 짧은 수식(\det C)은 남는다: TeX 글자 수가 아니라 보이는 길이로 세므로
  const m = "\\(\\det C\\)와 \\(\\det D\\)와 \\(\\det E\\)의 곱을 구하시오. 보기는 다음과 같습니다 그리고 더 긴 설명이 이어집니다";
  const mc = E.cutTex(m, 40);
  assert.ok(!mc.includes("[수식]") && mc.includes("\\(\\det C\\)") && mc.includes("\\(\\det E\\)"), mc);
  // 글을 자르지 않았으면 …이 없다 (보이는 길이가 한도 안이면 TeX 글자 수가 많아도 그대로)
  const ok = "\\(" + "a+".repeat(20) + "\\)입니다";
  assert.equal(E.cutTex(ok, 30), ok); assert.ok(E.visLen(ok) <= 30 && ok.length > 30);
  const tail = E.cutTex("가나다라 마바사 아자차카 \\(" + "x+".repeat(60) + "\\)", 24);
  assert.ok(tail.endsWith("…") && !tail.includes("[수식]"), "끝에 홀로 남은 자리표시는 …: " + tail);
  assert.equal(E.cutTex("", 10), ""); assert.ok(!E.cutTex("가".repeat(50), 10).includes("[수식]"));
});

// ───────── 6. 실제 기록 (DB 복사본, 읽기 전용) ─────────
const DBF = join(ROOT, "data", "app.db"), HEAVY = "DEVICE_ID_EXAMPLE";
const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
function courseCtx(db, cid) {   // Contract 2 (server/insight/ctx.js와 같은 모양)
  const c = db.prepare("SELECT * FROM course WHERE id = ?").get(cid), info = J(c.info);
  const chapters = db.prepare("SELECT key, title, short, grp, sort FROM chapter WHERE course_id = ? ORDER BY sort").all(cid).map(r => ({ ...r }));
  const items = new Map(), lens = {};
  for (const r of db.prepare(`SELECT p.id pid, p.ext_id ext, p.status, p.current_version v, ch.key ch, pv.kind, pv.star, pv.body FROM problem p
      JOIN chapter ch ON ch.id = p.chapter_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE p.course_id = ?`).all(cid)) {
    const b = J(r.body), len = E.strip(b.q).length + E.strip(b.stem).length + (b.opts || []).map(E.strip).join("").length;
    items.set(r.pid, { pid: r.pid, ext: r.ext, ch: r.ch, kind: r.kind, v: r.v, star: r.star ? 1 : 0, status: r.status, topic: b.topic || null,
      exam: Array.isArray(b.exams) && b.exams.length > 0, len, nopt: r.kind === "mc" ? (b.opts || []).length : 0, body: b });
    if (r.status === "published") (lens[r.kind] ||= []).push(len);
  }
  const md = a => { const s = [...(a || [])].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const vers = db.prepare("SELECT kind, body FROM problem_version WHERE problem_id = ? AND version = ?"), memo = new Map();
  const sameAsCurrent = (pid, v) => {
    const it = items.get(pid); if (!it) return false; if (v === it.v) return true;
    const k = pid + ":" + v; if (!memo.has(k)) { const r = vers.get(pid, v); memo.set(k, r ? { kind: r.kind, b: J(r.body) } : null); }
    const o = memo.get(k), eq = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null), a = o && o.b, b = it.body;
    if (!o || o.kind !== it.kind) return false;
    return it.kind === "mc" ? eq(a.opts, b.opts) && eq(a.ans, b.ans) : it.kind === "ox" ? eq(a.q, b.q) && eq(a.ox, b.ox) : it.kind === "short" ? eq(a.a, b.a) && eq(a.num, b.num) && eq(a.accept, b.accept) : false;
  };
  const codes = [...new Set([...items.values()].map(i => i.topic).filter(Boolean))];
  const topics = codes.length ? Object.fromEntries(codes.map(code => {
    const given = info.topics && info.topics[code]; if (given) return [code, given];
    const ch = [...items.values()].find(i => i.topic === code).ch, h = info.concepts && info.concepts[ch];
    const m = h && /<h[1-4][^>]*>(.*?)<\/h[1-4]>/.exec(typeof h === "string" ? h : h.html || "");
    return [code, m ? E.strip(m[1]) : code];
  })) : null;
  return { key: "test|" + cid, cid, name: c.name, short: c.short, lang: info.lang, math: !!info.math, chapters, items, sameAsCurrent, topics,
    hasConcept: new Set(Object.keys(info.concepts || {})), tags: new Map(), misc: {}, diag: new Map(),
    medLen: Object.fromEntries(["ox", "mc", "short", "essay"].map(k => [k, md(lens[k])])), lnP: E.lnP };
}
function loadRaw(db, dev, cid) {   // Contract 1 (server/insight/evidence.js와 같은 모양)
  const ev = types => db.prepare(`SELECT e.rowid rid, e.problem_id pid, e.version v, e.type, e.session_id sid, e.client_ts ts, e.payload FROM event e
      JOIN problem p ON p.id = e.problem_id WHERE e.device_id = ? AND e.type IN (${types}) AND p.course_id = ? ORDER BY e.client_ts, e.rowid`).all(dev, cid)
    .map(r => ({ rid: r.rid, pid: r.pid, v: r.v, type: r.type, sid: r.sid, ts: r.ts, p: J(r.payload) }));
  return {
    events: ev("'answer_submit','idk'"),
    progress: db.prepare(`SELECT pr.problem_id pid, pr.version v, pr.status, pr.attempts, pr.wrong_count, pr.last_answer, pr.updated_at FROM progress pr
      JOIN problem p ON p.id = pr.problem_id WHERE pr.device_id = ? AND p.course_id = ?`).all(dev, cid).map(r => ({ ...r })),
    grades: db.prepare(`SELECT g.id, g.problem_id pid, g.version v, g.result, g.user_verdict, g.created_at FROM ai_grade g
      JOIN problem p ON p.id = g.problem_id WHERE g.device_id = ? AND p.course_id = ?`).all(dev, cid).map(r => ({ ...r, result: J(r.result) })),
    aux: ev("'ai_copy','sol_dwell','bookmark'"),
  };
}

test("실제 기록: 과목마다 20ms 안, 정답 숨김, 결정성, 620번 22× O 묶음", { skip: !existsSync(DBF) && "DB 복사본 없음" }, () => {
  const db = new DatabaseSync(DBF, { readOnly: true });
  const nowDay = E.dayOf("2026-10-25T03:00:00Z"), out = [];
  try {
    const cids = db.prepare("SELECT id FROM course ORDER BY sort, id").all().map(r => r.id);
    for (const cid of cids) {
      const ctx = courseCtx(db, cid), raw = loadRaw(db, HEAVY, cid);
      for (let i = 0; i < 3; i++) E.buildReport(raw, ctx, P, nowDay);       // 데우기
      const n = 10, t0 = performance.now(); let det;
      for (let i = 0; i < n; i++) det = E.buildReport(raw, ctx, P, nowDay);
      const ms = (performance.now() - t0) / n;
      assert.ok(ms < 20, `과목 ${cid}: ${ms.toFixed(2)}ms`);
      assert.equal(JSON.stringify(E.buildReport(structuredClone(raw), ctx, P, nowDay)), JSON.stringify(det));
      const st = new Map(raw.progress.map(r => [r.pid, r.status]));
      assert.deepEqual(leaks(det, ctx, st), [], `과목 ${cid} 정답 노출`);
      assert.ok(["ready", "locked"].includes(det.state));
      if (det.state === "ready") {
        for (const f of det.findings) { assert.ok(f.text.diag.length > 0); for (const e of f.evidence) assert.ok(ctx.items.get(e.pid).status === "published"); }
        assert.ok(JSON.stringify(det).length < 40000, "det 크기");
      }
      const N = E.normalize(raw, ctx, P, nowDay);
      for (const o of N.obs) assert.equal(ctx.items.get(o.pid).status, "published");
      if (cid === 5) assert.ok(N.meta.skipped >= 8, "숨긴 경정시 문제 " + N.meta.skipped);
      if (ctx.items.has(620)) {                                             // 2.6:2.2-10e — 예전 기록 + O 22번 + X
        const o = N.obs.filter(x => x.pid === 620), p = N.post.filter(x => x.pid === 620);
        assert.deepEqual(o.map(x => `${x.src}:${x.y}${x.dropped ? "d" : ""}`), ["legacy:0", "spaced:0d"]);
        assert.equal(p.length, 22); assert.equal(p.filter(x => x.ok).length, 1);
      }
      out.push(`${cid} ${ctx.short}: ${det.state} ${ms.toFixed(2)}ms` + (det.state === "ready" ? ` · ${det.findings.map(f => f.type + (f.unit ? ":" + f.unit.code : "")).join(", ")}` : ""));
    }
  } finally { db.close(); }
  console.log("    " + out.join("\n    "));
});

// ───────── 7. 검증 라운드 1 고침 ─────────
/** 문제 본문을 바꿔 쓰기 */
const setBody = (ctx, pid, o) => Object.assign(ctx.items.get(pid).body, o);
/** 여러 단원에 O/X를 고르게 깔고 (참·거짓 번갈아) 학습자 기록을 만든다: 게이트(30·단원 3곳)를 넘기려는 바탕 */
const fillerCtx = (extra = []) => fakeCtx([["A", Array(12).fill("ox")], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")], ...extra]);

test("기록을 지우고 다시 풀기: 진행 행이 없거나 못 맞힌 문제는 칩·함정·읽을 풀이에서 숨김 (카드와 같은 규칙)", () => {
  const ctx = fakeCtx([["A", Array(10).fill("mc")], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")]]);
  for (const p of pidsOf(ctx, "A")) setBody(ctx, p, { s: `<p>정답은 셋째 보기예요. 둘째 보기는 조건을 반대로 읽은 함정이에요. 풀이 ${p}.</p>`, fix: undefined });
  const R = recorder(ctx), A = pidsOf(ctx, "A");
  A.forEach((p, i) => R.ans(p, false, { opt: 1, day: DAY0 + (i < 6 ? 2 : 0) }));        // 둘째 보기(B)를 골라 모두 틀림 (앞 6개가 가장 최근)
  A.slice(6, 8).forEach(p => R.ans(p, true, { day: DAY0 + 3 }));                          // 둘 다 나중에 맞힘 → 고침 (해설 보임)
  pidsOf(ctx, "B").forEach((p, i) => R.ans(p, i % 5 !== 0)); pidsOf(ctx, "C").forEach((p, i) => R.ans(p, i % 5 !== 0));
  const raw = R.raw(), reset = new Set(A.slice(0, 4));
  raw.progress = raw.progress.filter(r => !reset.has(r.pid));                              // resetOne: 진행 행만 지워지고 옛 오답 기록은 남음
  const D = {}, det = E.buildReport(raw, ctx, P, NOW, D), shown = new Set(raw.progress.filter(r => r.status === "correct" || r.status === "resolved").map(r => r.pid));
  const ev = det.findings.flatMap(f => f.evidence);
  assert.ok(ev.some(e => reset.has(e.pid)), "지운 문제가 칩에 있다");
  for (const e of ev) {
    assert.equal(e.hidden, !shown.has(e.pid), `칩 ${e.pid}: 카드처럼 맞힘·고침만 보임`);
    if (e.hidden) assert.equal(e.trap, "");
  }
  assert.ok(ev.filter(e => !e.hidden && e.trap).every(e => /^둘째 보기는 조건을 반대로 읽은 함정이에요\./.test(e.trap)), "보이는 칩은 고른 보기(B=둘째)를 가리킨 문장");
  // 지운 문제 풀이를 '먼저 읽기'로 권하지 않고, 아직 못 맞힌 문제의 글이 det 어디에도 없다
  for (const s of det.plan.steps) if (s.read && s.read.pid) assert.ok(shown.has(s.read.pid));
  const st = new Map(raw.progress.map(r => [r.pid, r.status])); for (const p of reset) st.set(p, "wrong");
  assert.deepEqual(leaks(det, ctx, st), []);
});

test("함정 문장: 고른 보기를 가리키는 문장만 (둘째 보기·③·(C)·보기 글 낱말), 그저 '아니'가 든 문장은 안 씀, 없으면 비움", () => {
  const ctx = fakeCtx([["A", Array(6).fill("mc")], ["B", Array(10).fill("ox")], ["C", Array(10).fill("ox")], ["D", Array(10).fill("ox")]]);
  const [p1, p2, p3, p4, p5, p6] = pidsOf(ctx, "A");
  const gen = "이 문제는 정의를 묻는 문제예요. 그것은 아니에요. ";
  setBody(ctx, p1, { s: gen + "둘째 보기는 평균을 분산으로 착각한 함정이에요. 셋째 보기가 정답이에요." });                         // B → 둘째
  setBody(ctx, p4, { s: gen + "계산 과정은 위와 같아요 (det = 2 주의) 첫째 보기는 부호를, 둘째 보기는 전치를 실수한 것입니다." });   // B → 둘째 보기부터 끝까지
  setBody(ctx, p2, { s: gen + "(C) 보기는 단위를 빼먹은 값이에요. 정답은 (D)예요." });                                        // C → (C)
  setBody(ctx, p3, { s: gen + "정답은 셋째 보기예요." });                                                                    // 문장 없음 → ""
  setBody(ctx, p5, { s: gen + "표준오차 계산에서 표본 크기 제곱근으로 나누지 않으면 틀려요. 정답은 셋째예요.", opts: ["표본 크기 제곱근으로 나누지 않은 표준오차", "평균", "정답값", "분산"] });   // A → 보기 글의 낱말 2개 이상
  const R = recorder(ctx);
  R.ans(p1, false, { opt: 1 }); R.ans(p1, true, { day: DAY0 + 2 });
  R.ans(p2, false, { opt: 2 }); R.ans(p2, true, { day: DAY0 + 2 });
  R.ans(p3, false, { opt: 0 }); R.ans(p3, true, { day: DAY0 + 2 });
  R.ans(p5, false, { opt: 0 }); R.ans(p5, true, { day: DAY0 + 2 });
  R.ans(p4, false, { opt: 1 }); R.ans(p4, true, { day: DAY0 + 2 }); R.ans(p6, false, { opt: 0 });
  for (const c of ["B", "C", "D"]) pidsOf(ctx, c).forEach((p, i) => R.ans(p, i % 6 !== 0));
  const det = E.buildReport(R.raw(), ctx, P, NOW), tr = Object.fromEntries(det.findings.flatMap(f => f.evidence).filter(e => !e.hidden).map(e => [e.pid, e.trap]));
  assert.equal(tr[p1], "둘째 보기는 평균을 분산으로 착각한 함정이에요.");
  assert.equal(tr[p2], "(C) 보기는 단위를 빼먹은 값이에요.");
  assert.equal(tr[p3], "", "고른 보기를 가리키는 문장이 없으면 비운다 (정답 보기 설명을 함정이라 보이지 않게)");
  assert.match(tr[p5], /^표준오차 계산에서 표본 크기 제곱근/);
  for (const t of Object.values(tr)) assert.ok(!/^그것은 아니에요/.test(t) && !/^이 문제는/.test(t), "아무 문장에나 든 '아니'로 고르지 않는다");
  assert.equal(tr[p4], "둘째 보기는 전치를 실수한 것입니다.", "여러 보기를 한 문장에 설명해도 고른 보기 자리부터");
  assert.equal(Object.keys(tr).length, 5);
});

test("보기 이름은 A–D (원문자 ①②③ 없음), 근거 칩 라벨 'C 고름'", () => {
  const ctx = fakeCtx([["A", Array(10).fill("mc")], ["B", Array(10).fill("ox")], ["C", Array(10).fill("ox")]]);
  const R = recorder(ctx); pidsOf(ctx, "A").forEach((p, i) => R.ans(p, false, { opt: [0, 2, 3][i % 3] }));
  pidsOf(ctx, "B").forEach((p, i) => R.ans(p, i % 5 !== 0)); pidsOf(ctx, "C").forEach((p, i) => R.ans(p, i % 5 !== 0));
  const det = E.buildReport(R.raw(), ctx, P, NOW), ev = det.findings.flatMap(f => f.evidence).filter(e => e.kind === "mc");
  assert.ok(ev.length >= 3 && ev.every(e => /^[A-D] 고름$/.test(e.label) && /^[A-D]$/.test(e.chosen)));
  assert.ok(!/[①-⑩]/.test(JSON.stringify(det)));
});

test("ox_bias: 치우침이 분명하면 카드 + 구체적 다음 걸음(안 푼 O/X 드릴), 아직 못 맞힌 문제는 먼저 보이지 않음", () => {
  const ctx = fakeCtx([["A", Array(26).fill("ox")], ["B", Array(26).fill("ox")], ["C", Array(26).fill("ox")]]);
  const R = recorder(ctx); let k = 0;
  for (const ch of ["A", "B", "C"]) pidsOf(ctx, ch).slice(0, 22).forEach(p => {        // 참 진술은 모두 O(맞음), 거짓 진술은 40%만 X로 거름
    const it = ctx.items.get(p), t = it.body.ox; k++;
    R.ans(p, t ? true : k % 5 < 2, { day: DAY0 + (k % 3), ts: iso(DAY0 + (k % 3), 3, 0, k * 20) });
  });
  const D = {}, det = E.buildReport(R.raw(), ctx, P, NOW, D), h = D.hab.find(x => x.id === "ox_bias");
  assert.ok(h && h.stats.dir === "accept" && h.stats.p >= 0.9, "ox_bias");
  const f = det.findings.find(x => x.habit === "ox_bias"); assert.ok(f, "카드");
  assert.match(f.text.diag, /^거짓 진술 \d+개 중 \d+개를 O라고 답했어요/); assert.ok(f.text.cue.length > 20 && !/^$/.test(f.text.cue));
  const st = det.plan.steps.find(s => s.id === f.plan); assert.ok(st && st.type === "drill" && st.n >= 3 && /^Q:\d+/.test(st.scope));
  assert.ok(st.scope.slice(2).split(".").every(p => !new Set(R.events.map(e => e.pid)).has(+p)), "안 푼 O/X");
  const ev = f.evidence, firstHidden = ev.findIndex(e => e.hidden), lastShown = ev.map(e => e.hidden).lastIndexOf(false);
  assert.ok(firstHidden < 0 || lastShown < firstHidden, "해설을 볼 수 있는 칩이 먼저");
  assert.ok(ev.every(e => !e.hidden || e.trap === ""));
});

test("format: 알아보기(O/X)는 되는데 떠올려 쓰기(단답)가 안 되면 카드 + 안 푼 단답 걸음, 숫자는 엔진이 센 값", () => {
  const ctx = fakeCtx([["A", [...Array(12).fill("ox"), ...Array(8).fill("short")]], ["B", [...Array(12).fill("ox"), ...Array(8).fill("short")]], ["C", [...Array(12).fill("ox"), ...Array(10).fill("short")]]]);
  const R = recorder(ctx); let k = 0;
  for (const ch of ["A", "B", "C"]) {
    const ids = pidsOf(ctx, ch), ox = ids.filter(p => ctx.items.get(p).kind === "ox"), sh = ids.filter(p => ctx.items.get(p).kind === "short");
    ox.forEach(p => { k++; R.ans(p, k % 12 !== 0, { ts: iso(DAY0, 3, 0, k * 20) }); });
    sh.slice(0, 8).forEach(p => { k++; R.ans(p, k % 4 === 0, { ts: iso(DAY0, 3, 0, k * 20), text: "엉뚱한 답" + k }); });
  }
  const D = {}, det = E.buildReport(R.raw(), ctx, P, NOW, D), f = det.findings.find(x => x.type === "format");
  assert.ok(f, "format 카드"); assert.equal(D.fmt.weak.join(), "short"); assert.deepEqual(D.fmt.strong, ["ox"]);
  const ox = D.fmt.by.ox, sh = D.fmt.by.short;
  assert.match(f.text.diag, new RegExp(`^O/X는 대부분 맞히는데\\(${Math.round(100 * ox.c / ox.n)}%\\) 단답\\(${Math.round(100 * sh.c / sh.n)}%\\)에서 (많이|더 자주) 틀려요\\. 알아보는 건 되는데 떠올려 쓰기가 약해요\\.$`));
  assert.match(f.text.signals, new RegExp(`O/X 첫 풀이 ${ox.c}/${ox.n} · 단답 첫 풀이 ${sh.c}/${sh.n}`));
  const st = det.plan.steps.find(s => s.id === f.plan); assert.equal(st.type, "format"); assert.match(st.title, /^단답 \d+문제 직접 써 보기$/);
  assert.ok(st.scope.slice(2).split(".").every(p => ctx.items.get(+p).kind === "short"));
  assert.equal(det.headline.startsWith("O/X는 대부분 맞히는데"), true, "헤드라인은 이 문장");
  // 유형 차이가 없으면 카드가 없다
  const R2 = recorder(ctx); k = 0; for (const it of ctx.items.values()) { k++; R2.ans(it.pid, k % 6 !== 0, { ts: iso(DAY0, 3, 0, k * 20) }); }
  assert.ok(!E.buildReport(R2.raw(), ctx, P, NOW).findings.some(x => x.type === "format"));
});

test("relative: 약함은 아니어도 내 평균보다 첫 풀이가 확실히 낮은 단원은 '상대적 약점' (정직한 문구)", () => {
  const ctx = fakeCtx(["A", "B", "C", "D"].map(c => [c, Array(14).fill("short")]));
  const R = recorder(ctx); let k = 0;
  for (const ch of ["A", "B", "C", "D"]) pidsOf(ctx, ch).forEach((p, i) => { k++; R.ans(p, ch === "D" ? i % 2 === 0 : i % 7 !== 0, { ts: iso(DAY0, 3, 0, k * 20) }); });
  const D = {}, det = E.buildReport(R.raw(), ctx, P, NOW, D);
  const lab = Object.fromEntries(det.units.map(u => [u.code, u.label]));
  const f = det.findings.find(x => x.type === "relative");
  if (lab.D !== "weak") {
    assert.ok(f && f.unit.code === "D", "relative 카드 " + JSON.stringify(lab));
    assert.match(f.text.diag, /^'단원D' 단원은 다른 단원보다 첫 풀이 정답률이 낮아요 · 50% \(평균 \d+%\)\./);
    assert.ok(det.plan.steps.some(s => s.id === f.plan && s.n > 0));
    assert.equal(det.units.find(u => u.code === "D").acc.c, 7);
  } else assert.ok(!f, "약함이면 relative 없음");
});

test("게이트(결정 8): 예전 기록이 대부분인 과목도 n_eff·3개 단원이면 열림, 고른 답 기록이 적다는 주의, 답 3개면 잠김", () => {
  const ctx = fakeCtx(["A", "B", "C", "D", "E", "F"].map(c => [c, Array(10).fill("short")]));
  const progress = [...ctx.items.values()].map((it, i) => ({ pid: it.pid, v: 1, status: i % 4 === 3 ? "wrong" : "correct", attempts: 1, wrong_count: i % 4 === 3 ? 1 : 0,
    last_answer: i % 4 === 3 ? "엉뚱한 답" : it.body.a, updated_at: iso(DAY0 - 2 - (i % 3)) }));
  const raw = { events: [], progress, grades: [], aux: [] };
  const det = E.buildReport(raw, ctx, P, NOW);
  assert.equal(det.state, "ready"); assert.equal(det.basis.legacy, 60); assert.equal(det.basis.first, 0);
  assert.ok(det.caveats.includes("imported_history"), "고른 답 기록이 적다는 주의");
  assert.ok(det.findings.every(f => !["misc", "confusion"].includes(f.type) && f.habit !== "ox_bias"));
  assert.ok(det.units.every(u => u.acc.n >= 0) && det.units.find(u => u.code === "A").acc.n === 10);
  // 단원이 둘뿐이면 n_eff가 넘어도 잠김, 답이 3개면 잠김
  const two = { ...raw, progress: progress.filter(r => ctx.items.get(r.pid).ch === "A" || ctx.items.get(r.pid).ch === "B") };
  const d2 = E.buildReport(two, ctx, P, NOW); assert.equal(d2.state, "locked"); assert.equal(d2.have.chapters, 2);
  const R = recorder(ctx); pidsOf(ctx, "A").slice(0, 3).forEach(p => R.ans(p, true));
  const d3 = E.buildReport(R.raw(), ctx, P, NOW); assert.equal(d3.state, "locked"); assert.deepEqual(d3.need, { n_eff: 30, chapters: 3 });
  assert.equal(d3.have.events, 3);
});

test("게이트: 서술형 AI 채점은 포인트 수가 아니라 한 번으로 센다 (events)", () => {
  const ctx = fakeCtx([["A", ["essay", "ox", "ox", "ox"]]]), R = recorder(ctx), e = pidsOf(ctx, "A")[0];
  pidsOf(ctx, "A").slice(1).forEach(p => R.ans(p, true));
  const raw = R.raw();
  raw.grades = [{ id: 1, pid: e, v: 1, result: { verdict: "partial", points: [0, 1, 2, 3, 4].map(i => ({ i, verdict: "covered" })) }, user_verdict: null, created_at: iso(DAY0, 4) }];
  const det = E.buildReport(raw, ctx, P, NOW);
  assert.equal(det.state, "locked"); assert.equal(det.have.events, 4, "ox 3 + 서술형 1번");
});

test("essay_skip: 분모는 첫 시도가 있는 서술형 전부 (AI 채점을 받은 서술형 포함)", () => {
  const mk = (nQuick, nGraded) => {
    const ctx = fakeCtx([["A", [...Array(nQuick + nGraded).fill("essay")]], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")], ["D", Array(12).fill("ox")]]);
    const R = recorder(ctx), es = pidsOf(ctx, "A");
    es.slice(0, nQuick).forEach((p, i) => R.ans(p, false, { idk: true, ms: 4000, ts: iso(DAY0, 3, 0, 30 * (i + 1)) }));
    for (const c of ["B", "C", "D"]) pidsOf(ctx, c).forEach((p, i) => R.ans(p, i % 6 !== 0));
    const raw = R.raw();
    raw.grades = es.slice(nQuick).map((p, i) => ({ id: i + 1, pid: p, v: 1, result: { verdict: "partial", points: [{ i: 0, verdict: "covered" }, { i: 1, verdict: "missing" }] }, user_verdict: null, created_at: iso(DAY0, 5, i) }));
    const D = {}; E.buildReport(raw, ctx, P, NOW, D); return D.hab.find(h => h.id === "essay_skip");
  };
  assert.equal(mk(4, 4), undefined, "4/8이면 절반 넘지 않음 (옛 분모였다면 4/4)");
  const h = mk(8, 2); assert.ok(h && h.stats.n === 10 && h.stats.k === 8);
});

test("목록 모드 시간: 차례로 푼 답은 간격으로 재고, 띄엄띄엄이면 시간 분석에서 빼고 list_time 주의", () => {
  const ctx = fakeCtx([["A", Array(20).fill("ox")], ["B", Array(20).fill("ox")], ["C", Array(20).fill("ox")]]);
  const run = gap => { const R = recorder(ctx); let k = 0;
    for (const it of ctx.items.values()) { k++; R.ans(it.pid, k % 5 !== 0, { mode: "list", ms: Math.round(5000 * jit(k)), ts: iso(DAY0, 3, 0, k * gap) }); }
    const raw = R.raw(), det = E.buildReport(raw, ctx, P, NOW); return { det, T: E.timeModel(E.normalize(raw, ctx, P, NOW).obs, raw, P) }; };
  const a = run(14);                                                       // 14초 간격 ≥ ms → 차례로 푼 것
  assert.ok(a.det.time.n_timed >= 30 && !a.det.caveats.includes("list_time"), "n_timed " + a.det.time.n_timed);
  const b = run(900);                                                      // 15분 간격 → 알 수 없음
  assert.equal(b.det.time.n_timed, 0); assert.ok(b.det.caveats.includes("list_time"));
  // 보이는 시간(vis)이 있으면 그 값을 쓴다 (간격과 상관없이)
  const R = recorder(ctx); let k = 0;
  for (const it of ctx.items.values()) { k++; R.ans(it.pid, k % 5 !== 0, { mode: "list", ms: 90000, ts: iso(DAY0, 3, 0, k * 900), p: { vis: Math.round(5000 * jit(k)) } }); }
  assert.ok(E.buildReport(R.raw(), ctx, P, NOW).time.n_timed >= 30);
});

test("시간 모형: 길이 기울기는 과목에서 추정(줄임), 빠른 답은 첫 풀이만, 짧은 O/X 1.3초는 빠른 답 아님, 아주 긴 O/X는 자리 비움", () => {
  const spec = [["A", Array(30).fill("ox")], ["B", Array(30).fill("ox")]], ctx = fakeCtx(spec);
  ctx.items.forEach((it, pid) => { it.body.q = "가".repeat(20 + ((pid * 37) % 100)); it.body.s = "<p>풀이</p>"; });
  const slope = b => { const R = recorder(ctx); let k = 0;
    for (const it of ctx.items.values()) { k++; const L = Math.max(20, E.lenOf(it.body)); R.ans(it.pid, true, { ts: iso(DAY0, 3, 0, k * 60), ms: Math.round(6000 * (L / 60) ** b * jit(k)) }); }
    const raw = R.raw(), N = E.normalize(raw, ctx, P, NOW); return E.timeModel(N.obs, raw, P).blen.ox; };
  const hi = slope(1.0), lo = slope(0.0);
  assert.ok(hi > 0.65 && hi <= 1.5, "긴 글일수록 오래 걸리는 학습자: " + hi); assert.ok(lo < 0.4 && lo >= 0, "길이와 무관한 학습자: " + lo);
  // 빠른 답 표시는 첫 풀이만
  const c2 = fakeCtx([["A", ["ox", "ox", "ox", "ox"]]]), R = recorder(c2), [a, b, c, d] = pidsOf(c2, "A");
  R.ans(a, true, { ms: 300 }); R.ans(b, true, { ms: 300 }); R.ans(b, true, { ms: 250, day: DAY0 + 3 });          // b: 다음 날 다시 풀기는 빨라도 괜찮다
  for (const p of [a, b, d]) setBody(c2, p, { q: "긴 진술 ".repeat(10) }); setBody(c2, c, { q: "짧은 진술 ".repeat(4) }); R.ans(c, true, { ms: 1100 });                                                      
  const N = E.normalize(R.raw(), c2, P, NOW); E.timeModel(N.obs, R.raw(), P);
  const ob = (pid, src) => N.obs.find(o => o.pid === pid && o.src === src);
  assert.equal(ob(a, "first").rapid, true); assert.equal(ob(b, "first").rapid, true); assert.equal(ob(b, "spaced").rapid, false);
  assert.ok(ob(c, "first").T < 1500 && ob(c, "first").T >= P.time.rapid.oxLo, "빠른 답 바닥은 진술 길이에 맞춰 낮아진다 " + ob(c, "first").T);
  assert.equal(ob(c, "first").rapid, false, "짧은 진술은 1.1초에도 읽는다");
  // 자리 비움: O/X 한 문제가 몇 분 → 시간 증거에서 빠짐
  const c3 = fakeCtx([["A", Array(40).fill("ox")]]), R3 = recorder(c3); let k = 0;
  for (const it of c3.items.values()) { k++; R3.ans(it.pid, true, { ts: iso(DAY0, 3, 0, k * 200), ms: it.pid === 105 ? 200000 : Math.round(6000 * jit(k)) }); }
  const N3 = E.normalize(R3.raw(), c3, P, NOW), T3 = E.timeModel(N3.obs, R3.raw(), P), o = N3.obs.find(x => x.pid === 105);
  assert.ok(o.idle && !T3.timed.includes(o));
});

test("문구: 개념(topic) 단원은 '개념의 개념' 없이, 판단 보류는 까닭(few·info)과 함께", () => {
  const ctx = fakeCtx([["A", Array(24).fill("short")], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")], ["D", ["ox", "ox"]]],
    { topic: (ch, i) => (ch === "A" ? (i < 12 ? "t1" : "t2") : null), topics: { t1: "행렬식", t2: "고윳값" } });
  const R = recorder(ctx);
  pidsOf(ctx, "A").forEach((p, i) => R.ans(p, i >= 12, { day: DAY0 + (i % 2), idk: i < 4 }));   // t1 전부 틀림(4개는 모르겠어요), t2 전부 맞힘
  pidsOf(ctx, "B").forEach((p, i) => R.ans(p, i % 6 !== 0)); pidsOf(ctx, "C").forEach((p, i) => R.ans(p, i % 6 !== 0));
  pidsOf(ctx, "D").forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW), all = JSON.stringify(det);
  assert.ok(!/개념의 개념/.test(all));
  const f = det.findings.find(x => x.unit && x.unit.kind === "topic");
  assert.ok(f, "개념 단원 카드");
  assert.match(f.text.diag, /^'행렬식' 개념이 아직 잡히지 않은 것 같아요/);
  assert.deepEqual(det.pending.map(p => [p.code, p.why]), [["D", "few"]]);
});

test("고침 표시(fixed): 처음 틀린 문제 가운데 max(2, 40%) 이상을 뒤에 다시 맞혀야", () => {
  const run = nAgain => {
    const ctx = fakeCtx([["A", Array(20).fill("short")], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")]]), R = recorder(ctx), A = pidsOf(ctx, "A");
    A.forEach((p, i) => R.ans(p, i >= 14, { day: DAY0 }));                                    // 앞 14개 틀림 → 처음엔 약함
    for (let d = 1; d <= 3; d++) A.slice(14).forEach(p => R.ans(p, true, { day: DAY0 + d }));  // 맞힌 6개를 사흘 더 맞힘 (현재 수준을 끌어올림)
    A.slice(0, nAgain).forEach(p => R.ans(p, true, { day: DAY0 + 4 }));                       // 틀린 문제를 맞혀 고침 (이 한 번은 '다시 맞힘'이 아니다)
    A.slice(0, nAgain).forEach(p => R.ans(p, true, { day: DAY0 + 6 }));                       // 다른 날 다시 맞힘
    pidsOf(ctx, "B").forEach((p, i) => R.ans(p, i % 6 !== 0)); pidsOf(ctx, "C").forEach((p, i) => R.ans(p, i % 6 !== 0));
    return E.buildReport(R.raw(), ctx, P, NOW).units.find(u => u.code === "A");
  };
  const few = run(2), many = run(14);
  assert.equal(few.label, "ok"); assert.equal(few.mark, null, "14개 중 2개만 다시 맞힘 (필요 6개)");
  assert.equal(run(0).mark, null, "고친 순간만으로는 표시하지 않는다");
  assert.equal(many.mark, "fixed", JSON.stringify(many));
});

test("band: 추측 바닥을 넣은 예상 정답률 구간이라 실제 정답률(acc) 근처, made_at은 엔진이 넣지 않음", () => {
  const ctx = fakeCtx([["A", Array(16).fill("ox")], ["B", Array(16).fill("ox")], ["C", Array(16).fill("ox")]]), R = recorder(ctx); let k = 0;
  for (const it of ctx.items.values()) { k++; R.ans(it.pid, k % 2 === 0, { ts: iso(DAY0, 3, 0, k * 20) }); }       // 찍은 것처럼 50%
  const det = E.buildReport(R.raw(), ctx, P, NOW);
  for (const u of det.units) { assert.deepEqual(u.acc, { c: 8, n: 16 }); assert.ok(u.pred[0] <= 0.5 + 0.12 && u.pred[1] >= 0.5 - 0.12 && u.pred[0] >= 0.45, `${u.code} ${u.pred}`); assert.ok(u.band[0] < 0.5 && u.band[1] > 0.5 && u.band[0] < u.band[1], `${u.code} band ${u.band}: 실제 정답률(8/16)을 품은 구간`); }
  assert.ok(!("made_at" in det));
});

test("고친 문제 다시 확인: 헤드라인으로 쓰지 않고(0개 확인 같은 말), 글은 상태에 따라", () => {
  const ctx = fakeCtx([["A", Array(28).fill("ox")], ["B", Array(14).fill("ox")], ["C", Array(14).fill("ox")]]), R = recorder(ctx);
  const A = pidsOf(ctx, "A"), B = pidsOf(ctx, "B"), C = pidsOf(ctx, "C");
  A.slice(0, 4).forEach(p => { R.ans(p, false, { day: DAY0, ts: iso(DAY0, 3, 0, p) }); R.ans(p, true, { day: DAY0, ts: iso(DAY0, 3, 1, p) }); });   // 같은 날 틀리고 고침
  A.slice(4).forEach(p => R.ans(p, true)); B.forEach(p => R.ans(p, true)); C.forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW), f = det.findings.find(x => x.type === "relearn");
  assert.ok(f, "relearn 카드"); assert.equal(f.text.diag, "틀렸다가 맞혀서 고친 문제 4개 중, 다른 날 다시 풀어 본 건 아직 없어요. 다시 풀어 볼 문제가 4개예요.");
  assert.ok(!/0개|고친 문제를 날을 바꿔 다시 풀어 본/.test(det.headline) && !det.headline.includes("고친 뒤"), det.headline);
  assert.match(det.headline, /^(첫 풀이 \d+문제 중|뚜렷한|.*탄탄)/);
});

test("예전 기록 오답과 '모르겠어요'가 글·칩에서 사라지지 않는다", () => {
  const ctx = fakeCtx([["A", Array(12).fill("mc")], ["B", Array(10).fill("ox")], ["C", Array(10).fill("ox")], ["D", Array(10).fill("ox")]]);
  const A = pidsOf(ctx, "A"), progress = [];
  A.forEach((p, i) => progress.push({ pid: p, v: 1, status: i < 10 ? "wrong" : "correct", attempts: 1, wrong_count: i < 10 ? 1 : 0, last_answer: i === 0 || i === 1 ? "모르겠어요" : i < 10 ? "(없음)" : "C", updated_at: iso(DAY0 - 3) }));
  const R = recorder(ctx); for (const c of ["B", "C", "D"]) pidsOf(ctx, c).forEach((p, i) => R.ans(p, i % 5 !== 0));
  const raw = R.raw(); raw.progress.push(...progress);
  const det = E.buildReport(raw, ctx, P, NOW), f = det.findings.find(x => x.unit && x.unit.code === "A");
  assert.ok(f, "A 카드"); assert.ok(!/첫 풀이 12문제/.test(f.text.signals), "진단 문장에 있는 신호는 되풀이하지 않는다"); assert.match(f.text.diag, /예전 기록 오답 8개/); assert.match(f.text.signals, /'모르겠어요' 2번/);
  assert.ok(f.evidence.some(e => e.role === "idk" && e.label === "모르겠어요"), "모르겠어요 칩이 앞쪽에");
  assert.match(f.text.diag, /첫 풀이 12문제 중 2개 맞힘/);
});

test("시간 메모: 속도와 정확도의 관계는 확실할 때만 (서두르면 틀림 / 대조군은 말 없음)", () => {
  const ctx = fakeCtx([["A", Array(40).fill("ox")], ["B", Array(40).fill("ox")], ["C", Array(40).fill("ox")]]);
  const qn = p => { let lo = -6, hi = 6; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, c = 0.5 * (1 + Math.sign(m) * (1 - Math.exp(-0.7 * Math.abs(m) * 1.414))); if (c < p) lo = m; else hi = m; } return (lo + hi) / 2; };
  const run = rule => { const R = recorder(ctx); let k = 0;
    for (const it of ctx.items.values()) { const g = qn((k + 0.5) / 120); R.ans(it.pid, rule(g, k), { ts: iso(DAY0, 3, 0, 30 * ++k), ms: Math.round(6000 * Math.exp(0.7 * g)) }); }
    return E.buildReport(R.raw(), ctx, P, NOW).time.notes; };
  const hasty = run((g, k) => (g < -1 ? k % 5 === 0 : k % 10 !== 0));       // 빠른 답(z < −1)은 20%만, 나머지는 90% 맞힘
  assert.ok(hasty.some(n => /서두르면 더 틀리는 편이에요/.test(n)), JSON.stringify(hasty));
  const flat = run((g, k) => k % 4 !== 0);                                   // 속도와 상관없이 75%
  assert.ok(!flat.some(n => /서두르면|확실히 모르는/.test(n)), JSON.stringify(flat));
  assert.ok(flat.some(n => /^O\/X는 한 문제에 보통 [\d.]+초 걸려요\.$/.test(n)), JSON.stringify(flat));
});

// ───────── 최종 보강 ─────────
const readyBase = (kindA = "ox") => {
  const ctx = fakeCtx([["A", Array(12).fill(kindA)], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")]]), R = recorder(ctx);
  return { ctx, R, A: pidsOf(ctx, "A"), B: pidsOf(ctx, "B"), C: pidsOf(ctx, "C") };
};
test("고친 문제: 틀린 뒤 처음 맞힌 그 한 번은 '다시 맞힌 것'이 아니다 (다른 날 한 번 더 맞혀야)", () => {
  const { ctx, R, A, B, C } = readyBase();
  R.ans(A[0], false, { day: DAY0, ts: iso(DAY0, 3, 0, 5) }); R.ans(A[0], true, { day: DAY0 + 1, ts: iso(DAY0 + 1, 3) });   // 틀림 → 다음 날 고침
  A.slice(1).forEach(p => R.ans(p, true)); B.forEach(p => R.ans(p, true)); C.forEach(p => R.ans(p, true));
  let det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.deepEqual([det.relearn.resolved, det.relearn.confirmed, det.relearn.retried], [1, 0, 0], "고친 순간은 확인이 아니다");
  R.ans(A[0], true, { day: DAY0 + 3, ts: iso(DAY0 + 3, 3) });
  det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.deepEqual([det.relearn.confirmed, det.relearn.retried], [1, 1]);
});
test("고친 문제: 예전 앱 오답 + 새 앱 한 번 맞힘 = 고친 것뿐 (확인 0)", () => {
  const { ctx, R, A, B, C } = readyBase();
  R.ans(A[0], true, { day: DAY0 + 1, attempt: 2, ts: iso(DAY0 + 1, 3) });
  const raw = R.raw(); raw.progress = [{ pid: A[0], v: 1, status: "resolved", attempts: 2, wrong_count: 1, last_answer: "A", updated_at: iso(DAY0 + 1, 3) }];
  A.slice(1).forEach(p => R.ans(p, true)); B.forEach(p => R.ans(p, true)); C.forEach(p => R.ans(p, true));
  const r2 = R.raw(); r2.progress = [...r2.progress.filter(x => x.pid !== A[0]), ...raw.progress];
  const det = E.buildReport(r2, ctx, P, NOW);
  assert.deepEqual([det.relearn.resolved, det.relearn.confirmed, det.relearn.retried], [1, 0, 0]);
  assert.ok(det.relearn.due.includes(A[0]), "다시 풀어 볼 문제");
});
test("지우고 다시 풀기: 지우기 전 풀이는 첫 풀이가 아니다 (지운 뒤 첫 시도가 첫 풀이)", () => {
  const { ctx, R, A, B, C } = readyBase();
  R.ans(A[0], true, { day: DAY0, attempt: 2, ts: iso(DAY0, 3, 0, 1) });                    // 지우기 전
  R.ans(A[0], false, { day: DAY0 + 1, attempt: 1, ts: iso(DAY0 + 1, 3, 0, 1) });             // 지운 뒤 첫 시도: 틀림
  R.ans(A[0], true, { day: DAY0 + 1, attempt: 2, ts: iso(DAY0 + 1, 3, 5, 1) });
  A.slice(1).forEach(p => R.ans(p, true)); B.forEach(p => R.ans(p, true)); C.forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW), a = det.units.find(u => u.code === "A");
  assert.deepEqual(a.acc, { c: 11, n: 12 });
});
test("고친 문제: 틀린 직후 보기를 바로 바꿔 맞힌 객관식은 '찍어서 맞힘'으로 다시 확인 대상", () => {
  const { ctx, R, A, B, C } = readyBase("mc");
  A.slice(0, 3).forEach((p, i) => { R.ans(p, false, { day: DAY0, ts: iso(DAY0, 3, i, 1), opt: 0 }); R.ans(p, true, { day: DAY0, ts: iso(DAY0, 3, i, 4), ms: 1500, p: { seen: false } }); });
  A.slice(3).forEach(p => R.ans(p, true)); B.forEach(p => R.ans(p, true)); C.forEach(p => R.ans(p, true));
  const det = E.buildReport(R.raw(), ctx, P, NOW);
  assert.equal(det.relearn.resolved, 3); assert.ok(det.relearn.due.includes(A[0]));
  const f = det.findings.find(x => x.type === "relearn"); assert.ok(f && /바로 바꿔 맞힌 3문제/.test(f.text.signals), JSON.stringify(f && f.text));
});
test("band는 실제 첫 풀이 정답률(c/n)의 80% 구간, 서술형 헤드라인은 %로 뭉뚱그리지 않는다", () => {
  const ctx = fakeCtx([["A", Array(12).fill("ox")], ["B", Array(12).fill("ox")], ["C", Array(12).fill("ox")], ["D", Array(12).fill("essay")]]), R = recorder(ctx);
  for (const c of ["A", "B", "C"]) pidsOf(ctx, c).forEach(p => R.ans(p, true));
  pidsOf(ctx, "D").forEach((p, i) => R.ans(p, false, { idk: true, ms: i < 3 ? 3000 : 40000 }));
  const det = E.buildReport(R.raw(), ctx, P, NOW), f = det.findings.find(x => x.type === "format");
  assert.ok(f, "format 카드"); assert.match(f.text.diag, /서술형 12개는 모두 '모르겠어요'로 넘겼어요/); assert.ok(!/서술형\(\d+%\)/.test(f.text.diag), f.text.diag);
  for (const u of det.units) assert.ok(u.band[0] <= u.acc.c / u.acc.n && u.acc.c / u.acc.n <= u.band[1], `${u.code} ${u.band}`);
});
