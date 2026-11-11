// 학습 리포트 엔진 모의 실험 (SPEC §15.3, TIME_FACTORS §7):  node --test server/insight/test/
// 실제 문제은행 구조(종류·단원·개념·난이도 근사)를 DB 복사본에서 읽고(읽기 전용), 정답을 아는 가짜 학습자를 만들어
// 엔진의 판단이 맞는지 센다. 난수는 씨앗을 고정해 매번 같은 결과가 나온다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as E from "../../../web/js/insight-engine.js";
import { PARAMS as P, merge } from "../params.js";

const HERE = dirname(fileURLToPath(import.meta.url)), DBF = join(HERE, "..", "..", "..", "data", "app.db");
const skip = !existsSync(DBF) && "DB 복사본 없음";
const J = (s, d = {}) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const sig = x => 1 / (1 + Math.exp(-x)), logit = p => Math.log(p / (1 - p));
const LET = "ABCDEFGH";

// ───────── 실제 과목 구조 (Contract 2 모양, 태그 없음) ─────────
function courseCtx(db, cid) {
  const c = db.prepare("SELECT * FROM course WHERE id = ?").get(cid), info = J(c.info);
  const chapters = db.prepare("SELECT key, title, short, grp, sort FROM chapter WHERE course_id = ? ORDER BY sort").all(cid).map(r => ({ ...r }));
  const items = new Map(), lens = {};
  for (const r of db.prepare(`SELECT p.id pid, p.ext_id ext, p.status, p.current_version v, ch.key ch, pv.kind, pv.star, pv.body FROM problem p
      JOIN chapter ch ON ch.id = p.chapter_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE p.course_id = ? AND p.status = 'published'`).all(cid)) {
    const b = J(r.body), len = E.strip(b.q).length + E.strip(b.stem).length + (b.opts || []).map(E.strip).join("").length;
    items.set(r.pid, { pid: r.pid, ext: r.ext, ch: r.ch, kind: r.kind, v: r.v, star: r.star ? 1 : 0, status: r.status, topic: b.topic || null,
      exam: Array.isArray(b.exams) && b.exams.length > 0, len, nopt: r.kind === "mc" ? (b.opts || []).length : 0, body: b });
    (lens[r.kind] ||= []).push(len);
  }
  const md = a => { const s = [...(a || [])].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const codes = [...new Set([...items.values()].map(i => i.topic).filter(Boolean))];
  return { key: "sim|" + cid, cid, name: c.name, short: c.short, chapters, items, sameAsCurrent: () => true,
    topics: codes.length ? Object.fromEntries(codes.map(x => [x, (info.topics || {})[x] || x])) : null,
    hasConcept: new Set(Object.keys(info.concepts || {})), tags: new Map(), misc: {}, diag: new Map(),
    medLen: Object.fromEntries(["ox", "mc", "short", "essay"].map(k => [k, md(lens[k])])), lnP: E.lnP };
}
/** 가짜 오개념 태그: 개념(topic, 없으면 단원)마다 오개념 a·b, 객관식 오답 보기 하나와 거짓 O/X 진술에 번갈아 붙인다 */
function plantTags(ctx, u) {
  const n = new Map();
  for (const it of [...ctx.items.values()].sort((a, b) => a.pid - b.pid)) {
    const kc = kcOf(it), i = n.get(kc) || 0, d = u() < 0.7 ? 3 : 2, src = d === 3 ? "explanation" : "inferred";
    const k = it.nopt || 0, m = `${kc}:${"ab"[i % 2]}`;
    if (it.kind === "mc" && k >= 3 && Number.isInteger(it.body.ans)) {
      const wrong = [...Array(k).keys()].filter(j => j !== it.body.ans), j = wrong[Math.floor(u() * wrong.length)];
      ctx.diag.set(it.pid, { v: it.v, review: "auto", diag: { opt: { [j]: { m, d, src } } } }); n.set(kc, i + 1);
    } else if (it.kind === "ox" && it.body.ox === false) { ctx.diag.set(it.pid, { v: it.v, review: "auto", diag: { ox: { m, d, src: "fix" } } }); n.set(kc, i + 1); }
  }
  const offers = new Map();
  for (const t of ctx.diag.values()) for (const x of [...Object.values(t.diag.opt || {}), t.diag.ox].filter(Boolean)) offers.set(x.m, (offers.get(x.m) || 0) + 1);
  return offers;
}

// ───────── 가짜 학습자 ─────────
function rng(seed) { let s = seed >>> 0 || 1; const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296; u.n = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()); return u; }
const T0 = E.dayOf("2026-10-10T03:00:00Z"), NOW = T0 + 6;
const kcOf = it => (it.topic ? "t:" + it.topic : "c:" + it.ch);
const dOf = it => (P.diff[it.kind] ?? 0) + P.diff.star * it.star + P.diff.exam * (it.exam ? 1 : 0);
const gOf = it => (it.kind === "ox" ? 0.5 : it.kind === "mc" ? 1 / (it.nopt || 4) : it.body.num != null ? 0.02 : 0.05);
/** 문항 시간 강도 (엔진과 같은 식) + 문항마다 고정된 잡음 N(0, .5²) */
function betaOf(ctx, it, noise) {
  const T = P.time, b = it.body, q = E.strip(b.q);
  const calc = (it.kind === "mc" || it.kind === "short") && (b.num != null || (q.match(/\d+(\.\d+)?/g) || []).length >= 3 || /\\\(|\\\[/.test(b.q || ""));
  return Math.log(T.b0[it.kind]) + T.b_len * Math.log(Math.max(20, it.len) / Math.max(1, ctx.medLen[it.kind])) + (calc ? T.b_calc[it.kind] : 0) + noise;
}
const heldBy = (dg, it, M) => {
  if (it.kind === "mc") { const a = Object.entries(dg.diag.opt || {}).filter(([, x]) => M.has(x.m)).map(([i]) => +i); return a.length ? a : null; }
  return it.kind === "ox" && it.body.ox === false && dg.diag.ox && M.has(dg.diag.ox.m) ? [1] : null;
};
/** L: {theta: Map(kc→θ), tau, slow:{kc→δ}, hasty, misc:Set, pi, slip, rapid, n} → { raw (Contract 1), gen[] (만든 사정) } */
function learn(ctx, L, u, inoise) {
  const pool = [...ctx.items.values()].filter(it => it.kind !== "essay" && (it.kind !== "mc" || Number.isInteger(it.body.ans)));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const pick = pool.slice(0, L.n), events = [], progress = [], gen = [];
  let t = (T0 * 864e5) - 9 * 3600e3 + 10 * 3600e3, inBlock = 0, rid = 0, day = 0;
  for (const it of pick) {
    if (inBlock >= 25 + Math.floor(u() * 15)) { inBlock = 0; day++; t = ((T0 + Math.min(5, day >> 1)) * 864e5) - 9 * 3600e3 + (day % 2 ? 20 : 10) * 3600e3; }
    inBlock++;
    const kc = kcOf(it), th = L.theta.get(kc) ?? 0, d = dOf(it), g = gOf(it), k = it.nopt || 4;
    const beta = betaOf(ctx, it, inoise.get(it.pid)), sd = 0.8;
    let z = u.n(), ok, answer, fast = false;
    const dg = ctx.diag.get(it.pid), held = dg && L.misc.size ? heldBy(dg, it, L.misc) : null;
    const rapid = u() < L.rapid;
    if (rapid) ok = u() < g;
    else if (held) {                                            // 오개념을 가진 학습자 (SPEC §5.1 M 상태)
      if (it.kind === "mc") { const r = u(), rest = k - 1 - held.length;
        if (r < L.pi) { answer = LET[held[Math.floor(u() * held.length)]]; ok = false; }
        else ok = r < L.pi + (1 - L.pi) / 2 || rest === 0;
        if (!ok && answer == null) { const w = [...Array(k).keys()].filter(j => j !== it.body.ans && !held.includes(j)); answer = LET[w[Math.floor(u() * w.length)]]; }
      } else ok = u() >= L.pi + 0.05;                          // 거짓 진술에 O
    } else {
      let p = (g + (1 - g) * sig(th - d)) * (1 - L.slip);
      if (L.hasty && u() < 0.3) { fast = true; z = -1.8 + 0.3 * u.n(); p = sig(logit(Math.min(0.99, Math.max(0.01, p))) - 1.6); }
      ok = u() < p;
    }
    const slow = rapid ? 0 : L.slow[kc] || 0;
    const sec = rapid ? Math.exp(beta - L.tau) * 0.03 : Math.exp(beta - L.tau + slow + sd * z);
    const ms = Math.max(200, Math.round(Math.min(sec, 1800) * 1000));
    if (answer == null) {
      if (it.kind === "ox") answer = (it.body.ox === ok) ? "O" : "X";
      else if (it.kind === "mc") { const w = [...Array(k).keys()].filter(j => j !== it.body.ans); answer = LET[ok ? it.body.ans : w[Math.floor(u() * w.length)]]; }
      else answer = ok ? String(it.body.a ?? "정답") : "틀린답";
    }
    t += ms + 2000 + Math.floor(u() * 6000);
    const ts = new Date(t).toISOString();
    events.push({ rid: ++rid, pid: it.pid, v: it.v, type: "answer_submit", sid: "s" + day, ts, p: { kind: it.kind, answer, correct: ok, ms, attempt: 1, self: false, mode: "focus" } });
    progress.push({ pid: it.pid, v: it.v, status: ok ? "correct" : "wrong", attempts: 1, wrong_count: ok ? 0 : 1, last_answer: answer, updated_at: ts });
    gen.push({ rid, kc, slow, fast, rapid });
  }
  if (L.retry) {                                              // 다음 날 틀린 문제 몇 개를 다시 풂 (보통 속도)
    const last = Math.min(5, day >> 1) + 1, pr = new Map(progress.map(r => [r.pid, r]));
    t = ((T0 + last) * 864e5) - 9 * 3600e3 + 15 * 3600e3;
    for (const it of pick) {
      const r = pr.get(it.pid); if (r.status !== "wrong" || u() >= L.retry) continue;
      const th = L.theta.get(kcOf(it)) ?? 0, g = gOf(it), ok = u() < (g + (1 - g) * sig(th - dOf(it))) * (1 - L.slip), k = it.nopt || 4;
      const answer = it.kind === "ox" ? (it.body.ox === ok ? "O" : "X") : it.kind === "mc" ? LET[ok ? it.body.ans : [...Array(k).keys()].filter(j => j !== it.body.ans)[0]] : ok ? String(it.body.a ?? "정답") : "틀린답";
      const ms = Math.round(Math.exp(betaOf(ctx, it, inoise.get(it.pid)) - L.tau + 0.8 * u.n()) * 1000);
      t += ms + 5000; const ts = new Date(t).toISOString();
      events.push({ rid: ++rid, pid: it.pid, v: it.v, type: "answer_submit", sid: "r", ts, p: { kind: it.kind, answer, correct: ok, ms, attempt: 2, self: false, mode: "focus" } });
      Object.assign(r, { status: ok ? "resolved" : "wrong", attempts: 2, wrong_count: ok ? 1 : 2, last_answer: answer, updated_at: ts });
      gen.push({ rid, kc: kcOf(it), slow: 0, fast: false, rapid: false });
    }
  }
  return { raw: { events, progress, grades: [], aux: [] }, gen };
}
function person(ctx, u, o = {}) {
  const tp = (o.mu ?? 0) + 0.6 * u.n(), theta = new Map(), kcs = new Set([...ctx.items.values()].map(kcOf));
  for (const k of [...kcs].sort()) theta.set(k, tp + 0.7 * u.n());
  return { tp, theta, tau: 0.4 * u.n(), slow: {}, hasty: false, misc: new Set(), pi: 0.8, slip: 0.1, rapid: 0.05, n: o.n ?? 160, ...o.L };
}
const hasTopics = ctx => [...ctx.items.values()].some(i => i.topic);
/** 단원별 참값. m = 실수까지 반영한, 추측 없이 맞힐 가능성 (1 − slip)·σ(θ − d̄): 약함의 정의
 *  acc = 그 단원에서 푼 문제들의 참 정답률 (추측 바닥 포함, 실수 반영): units[].pred(예상 정답률 80% 구간)가 재는 것 */
const unitsTruth = (ctx, L, det, raw) => {
  const by = new Map(); for (const it of ctx.items.values()) if (it.kind !== "essay") (by.get(kcOf(it)) || by.set(kcOf(it), []).get(kcOf(it))).push(dOf(it));
  const done = new Set((raw ? raw.events : []).map(e => e.pid)), pAcc = it => (gOf(it) + (1 - gOf(it)) * sig((L.theta.get(kcOf(it)) ?? 0) - dOf(it))) * (1 - L.slip);
  return det.units.filter(u => by.has((u.kind === "chapter" ? "c:" : "t:") + u.code) && (u.kind !== "chapter" || !hasTopics(ctx))).map(u => {
    const k = (u.kind === "chapter" ? "c:" : "t:") + u.code, ds = by.get(k), dbar = ds.reduce((s, x) => s + x, 0) / ds.length, th = L.theta.get(k);
    const its = [...ctx.items.values()].filter(it => it.kind !== "essay" && done.has(it.pid) && kcOf(it) === k);
    const acc = its.length ? its.reduce((s, it) => s + pAcc(it), 0) / its.length : null;
    return { u, m: (1 - L.slip) * sig(th - dbar), m0: sig(th - dbar), acc, delta: th - L.tp };
  });
};
const noiseOf = (ctx, u) => new Map([...ctx.items.keys()].map(p => [p, 0.5 * u.n()]));

// ───────── 1. 숙달: 약함 정밀도 · 80% 띠 포함률 ─────────
test("모의 실험: 약함 정밀도 ≥ 0.8, 80% 띠 포함률 0.70–0.90", { skip }, () => {
  const db = new DatabaseSync(DBF, { readOnly: true }), out = [];
  try {
    for (const [cid, n, mis] of [[4, 70, false], [5, 70, false], [1, 60, false], [4, 50, true]]) {
      const ctx = courseCtx(db, cid), u = rng(1000 + cid + (mis ? 7 : 0)), inoise = noiseOf(ctx, u);
      let weak = 0, weakOk = 0, inBand = 0, nBand = 0, inAcc = 0, nAcc = 0;
      for (let i = 0; i < n; i++) {
        const L = person(ctx, u, { L: mis ? { slip: 0.2 } : {} });
        const { raw } = learn(ctx, L, u, inoise), det = E.buildReport(raw, ctx, P, NOW);
        if (det.state !== "ready") continue;
        for (const { u: x, m, acc, delta } of unitsTruth(ctx, L, det, raw)) {
          if (x.label === "weak") { weak++; if (delta < -0.3 || m < 0.5) weakOk++; }   // 약함의 정의와 같은 참값
          if (x.label !== "pending" && acc != null) { nBand++; if (acc >= x.pred[0] && acc <= x.pred[1]) inBand++; }
          if (x.label !== "pending" && x.acc && x.acc.n) { nAcc++; const a = x.acc.c / x.acc.n; if (a >= x.pred[0] - 0.05 && a <= x.pred[1] + 0.05) inAcc++; }
        }
      }
      const prec = weak ? weakOk / weak : 1, cov = inBand / nBand;
      out.push(`과목 ${cid}${mis ? " (어긋난 모형: slip .2)" : ""}: 약함 ${weak}개 정밀도 ${prec.toFixed(2)} · 띠 포함률 ${cov.toFixed(2)} (${nBand}개) · 실제 첫 풀이 정답률이 예상 띠 ±5%p 안 ${(inAcc / nAcc).toFixed(2)}`);
      if (!mis) { assert.ok(weak >= 30, out.at(-1)); assert.ok(prec >= 0.8, out.at(-1)); assert.ok(cov >= 0.7 && cov <= 0.9, out.at(-1)); }
      else assert.ok(prec >= 0.7, out.at(-1));                               // 모형이 틀려도 크게 무너지지 않음
    }
  } finally { db.close(); }
  console.log("    " + out.join("\n    "));
});

// ───────── 2. 오개념 판별 (SPEC §5.1): likely 정밀도, 오개념 없는 학습자의 헛경보 ─────────
test("모의 실험: 오개념 likely 정밀도 ≥ 0.8, 오개념 없는 학습자 헛경보 < 5%", { skip }, () => {
  const db = new DatabaseSync(DBF, { readOnly: true }), out = [];
  try {
    for (const [cid, n, mis] of [[4, 80, false], [1, 80, false], [4, 60, true]]) {
      const ctx = courseCtx(db, cid), u = rng(2000 + cid + (mis ? 3 : 0)), offers = plantTags(ctx, u), inoise = noiseOf(ctx, u);
      const codes = [...offers].filter(([, k]) => k >= 4).map(([m]) => m).sort();
      let flags = 0, right = 0, pure = 0, pureFlag = 0, pureM = 0, pureMFlag = 0, held = 0, found = 0;
      for (let i = 0; i < n; i++) {
        const k = i % 4, M = new Set();
        while (M.size < k) M.add(codes[Math.floor(u() * codes.length)]);
        const L = person(ctx, u, { mu: k ? 0 : (i % 8 ? -0.8 : 0), L: { misc: M, ...(mis ? { pi: 0.65, slip: 0.2 } : {}) } });
        const { raw } = learn(ctx, L, u, inoise), N = E.normalize(raw, ctx, P, NOW);
        E.timeModel(N.obs, raw, P);
        const all = E.misconceptions(N.obs, ctx, P), R = all.filter(r => r.flag === "likely" || r.flag === "sure");
        flags += R.length; right += R.filter(r => M.has(r.m)).length;
        held += M.size; found += [...M].filter(m => R.some(r => r.m === m)).length;
        if (!k) { pure++; if (R.length) pureFlag++; pureM += all.length; pureMFlag += R.length; }
      }
      // 헛경보율: 오개념 없는 학습자에게 제시된 (학습자, 오개념) 쌍 가운데 likely 이상이 붙은 비율. 학습자 단위 비율도 함께 적는다
      const prec = flags ? right / flags : 1, ff = pureMFlag / Math.max(1, pureM);
      out.push(`과목 ${cid}${mis ? " (어긋난 모형: π −.15, slip .2)" : ""}: likely+ ${flags}개 정밀도 ${prec.toFixed(2)} · 찾아냄 ${found}/${held} · 오개념 없는 ${pure}명: 헛경보 ${pureMFlag}/${pureM}쌍 ${(ff * 100).toFixed(1)}% (한 개라도 붙은 학습자 ${pureFlag}명)`);
      if (!mis) { assert.ok(flags >= 20, out.at(-1)); assert.ok(prec >= 0.8, out.at(-1)); assert.ok(ff < 0.05, out.at(-1)); }
      else assert.ok(prec >= 0.6, out.at(-1));                               // 모형이 어긋나면 정밀도가 떨어진다 (기록만)
    }
  } finally { db.close(); }
  console.log("    " + out.join("\n    "));
});

// ───────── 3. 풀이 시간 (TIME_FACTORS §7) ─────────
test("모의 실험: 시간 — 느린 개념·서두름 정밀도 ≥ .8, 헛경보 < 5%, 시간은 약함을 만들지 않음, |z|>1.645 비율 .08–.12", { skip }, () => {
  const db = new DatabaseSync(DBF, { readOnly: true }), out = [];
  const PS = merge(P, { time: { srt: 0.5 } });
  try {
    for (const [cid, n] of [[4, 300], [5, 300]]) {      // 느린 개념은 드물게 잡히도록(보수적) 만들어 정밀도를 재려면 표본이 커야 한다
      const ctx = courseCtx(db, cid), u = rng(3000 + cid), inoise = noiseOf(ctx, u);
      const kcs = [...new Set([...ctx.items.values()].filter(i => i.kind !== "essay").map(kcOf))].sort();
      const C = { slowU: 0, slowOk: 0, flu: 0, fluOk: 0, fluPlanted: 0, hasty: 0, hastyOk: 0, hastyPlanted: 0, plain: 0, plainFlag: 0, same: 0, cmp: 0, rapDiff: 0, srtOk: 0, ready: 0, z: 0, zx: 0 };
      for (let i = 0; i < n; i++) {
        const kind = ["plain", "slow", "hasty", "slow", "plain", "slow", "plain", "hasty", "slow", "plain"][i % 10];
        const pk = kind === "slow" ? kcs[Math.floor(u() * kcs.length)] : null;
        const L = person(ctx, u, { n: 240, L: { slow: pk ? { [pk]: 0.7 } : {}, hasty: kind === "hasty", retry: 0.6 } });
        const { raw, gen } = learn(ctx, L, u, inoise), D = {}, det = E.buildReport(raw, ctx, P, NOW, D);
        if (det.state !== "ready") continue;
        C.ready++;
        const code = pk && pk.slice(2), key = u => (u.kind === "chapter" ? "c:" : "t:") + u.code;
        const slowUnits = det.units.filter(x => x.speed === "slow" && (x.kind !== "chapter" || !hasTopics(ctx)));
        C.slowU += slowUnits.length; C.slowOk += slowUnits.filter(x => key(x) === pk).length;
        // 카드로 뽑혔는지와 상관없이 후보 단계에서 센다 (습관 칸은 하나라 다른 카드에 밀릴 수 있다)
        const fl = D.sel.beh.filter(c => c.type === "fluency").map(c => c.u), ha = D.hab.some(h => h.id === "hasty");
        C.flu += fl.length; C.fluOk += fl.filter(x => x.key === pk || (x.kind === "chapter" && [...ctx.items.values()].some(it => it.ch === x.code && kcOf(it) === pk))).length;
        if (pk) C.fluPlanted++;
        if (ha) { C.hasty++; if (L.hasty) C.hastyOk++; }
        if (L.hasty) C.hastyPlanted++;
        if (kind === "plain") { C.plain++; if (slowUnits.length || fl.length || D.hab.some(h => h.id === "hasty" || h.id === "fatigue")) C.plainFlag++; }
        // 같은 답에서 심은 느림만 걷어 낸 기록 → 약함 이름표가 같아야 한다 (느림은 약함을 만들지 않음).
        // 시간이 숙달에 들어가는 유일한 길은 빠른 답 거르기라, 그 판정이 달라진 학습자는 따로 센다
        if (pk) {
          const g = new Map(gen.map(x => [x.rid, x])), raw2 = structuredClone(raw);
          for (const e of raw2.events) { const x = g.get(e.rid); if (x.slow) e.p.ms = Math.round(e.p.ms / Math.exp(x.slow)); }
          const rap = r => { const N = E.normalize(r, ctx, P, NOW); E.timeModel(N.obs, r, P); return N.obs.filter(o => o.rapid).map(o => o.rid).join(","); };
          if (rap(raw) !== rap(raw2)) C.rapDiff++;
          else { C.cmp++; const det2 = E.buildReport(raw2, ctx, P, NOW), wk = d => d.units.filter(x => x.label === "weak").map(key).join(","); if (wk(det) === wk(det2)) C.same++; }
        }
        // SRT를 켜도 시간 때문에만 약함이 생기지 않음 (보호 규칙)
        const det3 = E.buildReport(raw, ctx, PS, NOW), w0 = new Set(det.units.filter(x => x.label === "weak").map(key));
        if (det3.units.filter(x => x.label === "weak").every(x => w0.has(key(x)))) C.srtOk++;
        if (kind === "plain") {
          const N = E.normalize(raw, ctx, P, NOW), T = E.timeModel(N.obs, raw, P);
          for (const o of T.timed) { C.z++; if (Math.abs(o.z) > 1.645) C.zx++; }
        }
      }
      const zs = C.zx / C.z, pr = (a, b) => (b ? (a / b).toFixed(2) : "–");
      out.push(`과목 ${cid}: 느린 단원 ${C.slowU}개 정밀도 ${pr(C.slowOk, C.slowU)} · fluency 후보 ${C.flu}개(심은 ${C.fluPlanted}명) 정밀도 ${pr(C.fluOk, C.flu)} · hasty ${C.hasty}명(심은 ${C.hastyPlanted}명) 정밀도 ${pr(C.hastyOk, C.hasty)} · 평범한 ${C.plain}명 헛경보 ${(100 * C.plainFlag / C.plain).toFixed(1)}% · 약함 같음 ${C.same}/${C.cmp} (빠른 답 판정이 달라 뺀 ${C.rapDiff}명) · SRT 보호 ${C.srtOk}/${C.ready} · |z|>1.645 ${zs.toFixed(3)} (${C.z}개)`);
      assert.ok(C.slowU >= 10 && C.slowOk / C.slowU >= 0.8, out.at(-1));
      assert.ok(C.flu >= 5 && C.fluOk / C.flu >= 0.8, out.at(-1));
      assert.ok(C.hasty >= 5 && C.hastyOk / C.hasty >= 0.8, out.at(-1));
      assert.ok(C.plainFlag / C.plain < 0.05, out.at(-1));
      assert.ok(C.cmp >= 10 && C.same === C.cmp, out.at(-1)); assert.equal(C.srtOk, C.ready, out.at(-1));
      assert.ok(zs >= 0.08 && zs <= 0.12, out.at(-1));
    }
  } finally { db.close(); }
  console.log("    " + out.join("\n    "));
});

// ───────── 4. O/X 치우침 (ox_bias): 치우침 없는 학습자에게 헛경보 < 5%, 진짜 치우침은 잡음 ─────────
/** O/X 문제만 푸는 가짜 학습자. 신호탐지: P(O|참) = Φ(d′/2 − c′), P(O|거짓) = Φ(−d′/2 − c′) → 치우침 c = c′ (O로 기울면 c′ < 0) */
function oxLearner(ctx, u, { dprime, c, n }) {
  const pool = [...ctx.items.values()].filter(it => it.kind === "ox" && typeof it.body.ox === "boolean");
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(u() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const events = [], progress = []; let t = T0 * 864e5 - 9 * 3600e3 + 10 * 3600e3, rid = 0;
  const pO = tf => 1 / (1 + Math.exp(-1.7 * ((tf ? dprime / 2 : -dprime / 2) - c)));   // 로지스틱(×1.7) ≈ 정규분포 곡선
  for (const it of pool.slice(0, n)) {
    const sayO = u() < pO(it.body.ox), ok = sayO === it.body.ox, ms = Math.round(4000 + 3000 * u());
    t += ms + 3000 + Math.floor(u() * 5000);
    const ts = new Date(t).toISOString(), answer = sayO ? "O" : "X";
    events.push({ rid: ++rid, pid: it.pid, v: it.v, type: "answer_submit", sid: "s1", ts, p: { kind: "ox", answer, correct: ok, ms, attempt: 1, self: false, mode: "focus" } });
    progress.push({ pid: it.pid, v: it.v, status: ok ? "correct" : "wrong", attempts: 1, wrong_count: ok ? 0 : 1, last_answer: answer, updated_at: ts });
  }
  return { events, progress, grades: [], aux: [] };
}
test("모의 실험: ox_bias — 치우침 없는 학습자 헛경보 < 5% (실제 과목의 O/X 구성), 진짜 치우침은 잡음", { skip }, () => {
  const db = new DatabaseSync(DBF, { readOnly: true }), out = [];
  try {
    for (const [cid, N] of [[4, 250], [5, 250], [3, 250], [1, 250]]) {
      const ctx = courseCtx(db, cid), u = rng(4000 + cid);
      const pool = [...ctx.items.values()].filter(it => it.kind === "ox" && typeof it.body.ox === "boolean"), nT = pool.filter(it => it.body.ox).length, nF = pool.length - nT;
      if (Math.min(nT, nF) < 12) { out.push(`과목 ${cid}: O/X 참 ${nT}·거짓 ${nF} — 12개 미만이라 건너뜀`); continue; }
      let fp = 0, ready = 0, hit = 0, powN = 0, thin = 0, thinFp = 0;
      for (let i = 0; i < N; i++) {
        const dprime = 0.8 + 2.2 * u(), n = 24 + Math.floor(u() * (pool.length - 23));          // 구별력도 푼 개수도 학습자마다
        const raw = oxLearner(ctx, u, { dprime, c: 0, n }), D = {}, det = E.buildReport(raw, ctx, P, NOW, D);
        if (det.state !== "ready") continue;
        ready++; if (D.hab.some(h => h.id === "ox_bias")) fp++;
        if (n < 40) { thin++; if (D.hab.some(h => h.id === "ox_bias")) thinFp++; }
      }
      for (let i = 0; i < N / 2; i++) {                                                   // 심은 치우침: |c| = 0.9 (O 쪽·X 쪽), 문제를 충분히 푼 학습자
        const sgn = i % 2 ? 1 : -1, raw = oxLearner(ctx, u, { dprime: 1.5 + 1.5 * u(), c: 0.9 * sgn, n: pool.length }), D = {}, det = E.buildReport(raw, ctx, P, NOW, D);
        if (det.state !== "ready") continue;
        powN++; const h = D.hab.find(x => x.id === "ox_bias"); if (h && (h.stats.dir === "accept") === (sgn < 0)) hit++;
      }
      out.push(`과목 ${cid} (O/X 참 ${nT}·거짓 ${nF}): 치우침 없는 ${ready}명 헛경보 ${fp} (${(100 * fp / ready).toFixed(1)}%) · 적게 푼(<40) ${thin}명 중 ${thinFp} · 치우침 심은 ${powN}명 중 방향까지 맞게 잡음 ${hit} (${(100 * hit / Math.max(1, powN)).toFixed(0)}%)`);
      assert.ok(ready >= 100 && fp / ready < 0.05, out.at(-1));
      assert.ok(thinFp / Math.max(1, thin) < 0.05, out.at(-1));
      if (Math.min(nT, nF) >= 30) assert.ok(hit / powN >= 0.6, out.at(-1));                // 표본이 충분한 과목에서만 힘을 본다
    }
  } finally { db.close(); }
  console.log("    " + out.join("\n    "));
});
