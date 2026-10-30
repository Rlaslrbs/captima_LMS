// 학습 리포트 v2: 세부 포인트(facet)마다 깊이(확실히 앎 K · 얕게 앎 S · 모름 N) × 착각(오개념 m 하나) 진단. 순수 ES 모듈 (DOM·node:* 없음)
// 설계: docs/insight/v2/ALGORITHM.md §2–§6. 엔진(insight-engine.js)이 normalize·timeModel 뒤의 관찰(obs)을 넘겨 부른다.
// - 상태는 (D, H) 3 × (1 + |M|)개를 다 세어 정확한 사후를 낸다. 모집단으로 맞추는 값은 없다 (작은 표본에서 DINA류 추정은 불안정)
// - 같은 입력이면 언제나 같은 결과. 과목을 이름·번호로 가르지 않는다

/** 기본 조절값 (P.v2가 있으면 같은 키를 덮어쓴다) */
export const V2 = Object.freeze({
  prior: { D: { K: 0.40, S: 0.35, N: 0.25 }, weak: { K: 0.25, S: 0.40, N: 0.35 }, solid: { K: 0.55, S: 0.30, N: 0.15 }, m: 0.10, mAll: 0.30 },
  idk: { K: 0.02, S: 0.10, N: 0.35, H: 0.03 },
  slip: [0.08, 0.10, 0.15, 0.15],          // 깊이 1–4에서 K의 실수
  q: [0.85, 0.60, 0.25, 0.25],             // 깊이 1–4에서 S가 아는 몫 (P = g + (1−g)·q)
  holder: { mc: { C: 0.12, H: 0.75, W: 0.13 }, ox: { C: 0.20, H: 0.80 }, short: { C: 0.15, H: 0.55 }, pt: { H: 0.7 } },
  nonHolderShort: 0.03, afterFb: 0.5,
  w: { first: 1, retry: 0.3, spaced: 0.7, legacy: 0.6, pt: 1, pt_m: 0.5 },
  trust: { 3: 1, 2: 0.85, 1: 0.7 }, second: 0.3,
  burstMs: 3000, rapidShare: 0.5,
  rule: {
    misc: { firm: 0.70, hits: 2, hedged: 0.55 },
    familiar: { S: 0.65, near: 2, mMax: 0.5 },
    solid: { firm: 0.80, hedged: 0.70, items: 3, mMax: 0.30 },
    weak: { SN: 0.70, items: 2, shallow: 0.65, gap: 0.70 },
    depthP: 0.7,
  },
  probes: 3, minItems: 2,
});
const DT = ["object", "condition", "qualifier", "reverse", "neighbour", "combine", "repr"];

const isObj = x => x && typeof x === "object" && !Array.isArray(x);
const mergeP = (a, b) => { if (!isObj(b)) return a; const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(a[k]) ? mergeP(a[k], v) : v; return o; };
const PV = new WeakMap();
const paramsOf = P => { const k = P || {}; let v = PV.get(k); if (!v) PV.set(k, v = mergeP(V2, k.v2)); return v; };
const lv = d => Math.min(4, Math.max(1, +d || 2));
const H2 = p => (p > 0 ? -p * Math.log(p) : 0);

// ───────── 한 문제의 '오개념을 고를 수 있는가' (태그 mis 읽기) ─────────
/** tag.mis 모양: MC 배열(opts와 같은 길이, "" 정답 · null 없음 · 코드) / OX {m, mr} / 단답 [{m, ex, num}] / 서술 [{i, m}] */
function offers(tag, it) {
  const mis = tag && tag.mis, out = new Set();
  if (!mis) return out;
  if (it.kind === "mc" && Array.isArray(mis)) for (const x of mis) { if (x) out.add(x); }
  else if (it.kind === "ox" && isObj(mis)) { const b = it.body || {}; const m = b.ox === true ? mis.mr : mis.m; if (m) out.add(m); }
  else if (Array.isArray(mis)) for (const x of mis) if (x && x.m) out.add(x.m);
  return out;
}
const normTxt = s => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
function shortHit(o, pats, body) {
  const a = o.answer || o.txt || "";
  for (const p of pats || []) for (const x of p.ex || []) {
    if (p.num) { const u = parseFloat(String(a).replace(/[−–]/g, "-")), v = parseFloat(x); if (isFinite(u) && isFinite(v) && Math.abs(u - v) <= (body.tol ?? Math.max(1e-9, Math.abs(v) * 1e-3))) return p.m; }
    else if (normTxt(x) === normTxt(a)) return p.m;
  }
  return null;
}
/** 응답 하나 → { r: C|W|I|H, m: 고른 오개념 코드 | null } */
function respOf(o, tag) {
  if (o.idk || o.lidk) return { r: "I", m: null };
  if (o.src === "essay_pt") {
    if (o.ptv === "covered") return { r: "C", m: null };
    const x = Array.isArray(tag.mis) ? tag.mis.find(z => z && z.i === o.pt) : null;
    return { r: x && x.m && o.ptv === "missing" ? "H" : "W", m: x && o.ptv === "missing" ? x.m || null : null, partial: o.ptv === "partial" };
  }
  if (o.y === 1) return { r: "C", m: null };
  const it = o.I.it, mis = tag.mis;
  if (o.src === "legacy") return { r: "W", m: null };            // 예전 기록은 고른 답이 있어도 착각 근거로 쓰지 않는다
  if (it.kind === "mc" && Array.isArray(mis) && o.opt != null) { const m = mis[o.opt]; return m ? { r: "H", m } : { r: "W", m: null }; }
  if (it.kind === "ox" && isObj(mis) && o.opt != null) { const m = it.body && it.body.ox === true ? mis.mr : mis.m; return m ? { r: "H", m } : { r: "W", m: null }; }
  if (it.kind === "short" && Array.isArray(mis)) { const m = shortHit(o, mis, it.body || {}); return m ? { r: "H", m } : { r: "W", m: null }; }
  return { r: "W", m: null };
}

// ───────── 우도 (ALGORITHM §3.3) ─────────
/** e: 증거 하나 {kind, k(보기 수), g, d(깊이 1–4), resp, offer:Set, aOf(m), fb, legacy, pt} · (D, h): 상태 */
function lik(e, D, h, Q) {
  const holds = h && !e.legacy && e.offer.has(h);
  if (holds) {
    const pI = Q.idk.H;
    if (e.resp.r === "I") return pI;
    const nI = 1 - pI;
    if (e.pt) { const H = Q.holder.pt.H; return e.resp.r === "H" && e.resp.m === h ? H : e.resp.r === "C" ? 1 - H : (1 - H) / 2; }
    if (e.kind === "ox") { const T = Q.holder.ox; return nI * (e.resp.r === "C" ? T.C : T.H); }
    if (e.kind === "short") { const T = Q.holder.short; return nI * (e.resp.r === "C" ? T.C : e.resp.r === "H" && e.resp.m === h ? T.H : 1 - T.C - T.H); }
    const T = Q.holder.mc, a = Math.max(1, e.aOf(h)), rest = Math.max(0, e.k - 1 - a);
    if (e.resp.r === "C") return nI * T.C;
    if (e.resp.r === "H" && e.resp.m === h) return nI * (rest > 0 ? T.H : T.H + T.W) / a;
    return nI * (rest > 0 ? T.W / rest : 1e-3);
  }
  const pI = Q.idk[D];
  if (e.resp.r === "I") return pI;
  const nI = 1 - pI, i = e.d - 1, g = e.g;
  const pc = D === "K" ? 1 - Q.slip[i] : D === "S" ? g + (1 - g) * Q.q[i] : g;
  if (e.pt) { const c = D === "K" ? 1 - Q.slip[i] : D === "S" ? Q.q[i] : 0.05; return e.resp.r === "C" ? c : e.resp.partial ? 0.5 : 1 - c; }
  if (e.resp.r === "C") return nI * pc;
  if (e.legacy) return nI * (1 - pc);
  if (e.kind === "short") { const s = Q.nonHolderShort; return nI * Math.max(1e-3, e.resp.r === "H" ? (1 - pc) * s : (1 - pc) * (1 - s)); }
  let pw = nI * (1 - pc) / Math.max(1, e.k - 1);
  if (e.resp.r === "H" && e.fb) pw *= Q.afterFb;              // 답을 본 뒤에도 같은 틀린 생각을 다시 고름: 가진 사람이 아니면 드물다
  return pw;
}

/** 상태 목록과 사전 */
function states(ms, prior, Q) {
  const pm = ms.length ? Math.min(Q.prior.m, Q.prior.mAll / ms.length) : 0, p0 = 1 - pm * ms.length, S = [];
  for (const D of ["K", "S", "N"]) { S.push({ D, h: null, lp: Math.log(prior[D] * p0) }); for (const m of ms) S.push({ D, h: m, lp: Math.log(prior[D] * pm) }); }
  return S;
}
function posterior(S, E, Q) {
  const L = S.map(s => { let l = s.lp; for (const e of E) l += e.x * Math.log(Math.max(1e-9, lik(e, s.D, s.h, Q))); return l; });
  const mx = Math.max(...L), z = L.reduce((a, l) => a + Math.exp(l - mx), 0);
  return L.map(l => Math.exp(l - mx) / z);
}
function summary(S, p, ms) {
  const o = { K: 0, S: 0, N: 0, m: {} };
  for (const m of ms) o.m[m] = 0;
  S.forEach((s, i) => { o[s.D] += p[i]; if (s.h) o.m[s.h] += p[i]; });
  return o;
}
const entropy = p => p.reduce((a, x) => a + H2(x), 0);

// ───────── 증거 모으기 ─────────
/** obs → 세부 포인트별 증거. 같은 문제·같은 답을 3초 안에 다시 낸 것은 하나로 (원래 기록은 그대로 둔다) */
function collect(obs, post, V, Q) {
  const tags = V.tags, byF = new Map(), burst = { n: 0 }, seenP = new Set();
  const byPid = new Map();
  for (const o of obs) (byPid.get(o.pid) || byPid.set(o.pid, []).get(o.pid)).push(o);
  for (const x of post || []) seenP.add(x.pid);
  // 해설을 본 뒤 3초 안에 같은 답을 다시 낸 것 (post[] 쪽): 진단에는 원래 안 쓰지만 몇 번이었는지는 센다
  const pp = new Map(); for (const x of post || []) (pp.get(x.pid) || pp.set(x.pid, []).get(x.pid)).push(x);
  for (const L of pp.values()) { L.sort((a, b) => a.t - b.t); for (let i = 1; i < L.length; i++) if (L[i].answer === L[i - 1].answer && L[i].t - L[i - 1].t < Q.burstMs) burst.n++; }
  let rapid = 0;
  for (const [pid, L0] of byPid) {
    const tag = tags.get(pid); if (!tag || !tag.facet) continue;
    const L = [...L0].sort((a, b) => (a.day - b.day) || ((a.t || 0) - (b.t || 0)));
    let last = null, firstDay = null;
    for (const o of L) {
      if (o.src === "legacy_fix" || o.src === "essay_self") continue;
      if (o.rapid) { rapid++; continue; }
      if (last && o.t && last.t && o.answer && o.answer === last.answer && o.t - last.t < Q.burstMs) { burst.n++; continue; }
      let w, fb = false;
      if (o.src === "first" || (o.src === "idk" && o.init)) w = Q.w.first;
      else if (o.src === "legacy") w = Q.w.legacy;
      else if (o.src === "essay_pt") w = Q.w.pt * (o.init ? 1 : 0.5);
      else if (o.src === "spaced" || (o.src === "idk" && firstDay != null && o.day > firstDay)) { w = Q.w.spaced; fb = true; }
      else { if (o.kind === "ox") { last = o; continue; } w = Q.w.retry; }   // 같은 날 다시: O/X는 남은 답이 하나뿐이라 뺀다
      if (firstDay == null) firstDay = o.day;
      const it = o.I.it, offer = offers(tag, it), resp = respOf(o, tag);
      const kind = it.kind, k = kind === "mc" ? Math.max(2, (it.nopt || 4) - (o.src === "retry" ? o.elim || 0 : 0)) : kind === "ox" ? 2 : 2;
      const g = o.src === "essay_pt" ? 0 : kind === "mc" ? 1 / k : o.g;
      const aOf = m => (Array.isArray(tag.mis) ? tag.mis.filter(x => x === m).length : 1);
      const trust = Q.trust[tag.conf] ?? Q.trust[2];
      const base = { o, pid, kind, k, g, d: lv(tag.depth), resp, offer, aOf, fb, legacy: o.src === "legacy", pt: o.src === "essay_pt", tag,
        x: w * trust * (o.src === "essay_pt" && resp.r === "H" ? Q.w.pt_m : 1) };
      const add = (f, x) => { if (!V.facets.has(f)) return; (byF.get(f) || byF.set(f, []).get(f)).push(x); };
      add(tag.facet, base);
      for (const f2 of tag.facets2 || []) if (f2 !== tag.facet) add(f2, { ...base, x: base.x * Q.second, second: true, offer: new Set(), resp: base.resp.r === "H" ? { r: "W", m: null } : base.resp });
      last = o;
    }
  }
  return { byF, burst: burst.n, rapid, seenP };
}

// ───────── 판정 (ALGORITHM §5) ─────────
function decide(f, E, sum, ms, V, Q) {
  const R = Q.rule, items = new Set(E.filter(e => !e.second).map(e => e.pid)), n = items.size;
  const firstOf = new Map(); for (const e of E) if (!e.second && !firstOf.has(e.pid)) firstOf.set(e.pid, e);
  const fam = V.fam;
  const near = pid => (fam.get(pid) || {}).role === "near", baseish = pid => { const r = (fam.get(pid) || {}).role; return r === "base" || r === "iso"; };
  const hitItems = m => new Set(E.filter(e => !e.second && !e.legacy && e.resp.r === "H" && e.resp.m === m).map(e => e.pid));
  const hitItemsTrusted = m => new Set(E.filter(e => !e.second && !e.legacy && e.resp.r === "H" && e.resp.m === m && (e.tag.conf ?? 2) >= 2).map(e => e.pid));
  const mTop = ms.slice().sort((a, b) => sum.m[b] - sum.m[a] || (a < b ? -1 : 1))[0] || null, pm = mTop ? sum.m[mTop] : 0;
  const anyM = Math.max(0, ...ms.map(m => sum.m[m]));
  const hardOK = [...firstOf.values()].some(e => e.resp.r === "C" && (e.d >= 3 || near(e.pid))) || E.some(e => !e.second && e.resp.r === "C" && (e.d >= 3 || near(e.pid)));
  const easyOK = E.some(e => !e.second && e.resp.r === "C" && e.d <= 2), hardMiss = E.some(e => !e.second && e.resp.r !== "C" && e.d >= 3);
  const out = { state: "pending", tier: null, sub: null, kind: null, m: null, why: null };
  // 1. 착각 (같은 틀린 생각, 서로 다른 문제 2개)
  if (mTop && pm >= R.misc.firm && hitItemsTrusted(mTop).size >= R.misc.hits) return { ...out, state: "illusion", tier: "firm", kind: "misc", m: mTop };
  // 2. 착각 (익숙한 형태는 맞히고, 살짝 바꾼 문제 2개를 틀림)
  const nearWrong = new Set([...firstOf.values()].filter(e => near(e.pid) && e.resp.r !== "C" && !e.legacy && (e.o.src === "first" || e.o.src === "idk")).map(e => e.pid));
  if ([...firstOf.values()].some(e => baseish(e.pid) && e.resp.r === "C") && nearWrong.size >= R.familiar.near && sum.S >= R.familiar.S && anyM <= R.familiar.mMax)
    return { ...out, state: "illusion", tier: "firm", kind: "familiar", near: [...nearWrong] };
  // 3. 확실히 앎
  if (sum.K >= R.solid.firm && anyM < R.solid.mMax && n >= R.solid.items && hardOK) return { ...out, state: "solid", tier: "firm" };
  // 4. 착각일 수 있음 (한 문제만으로도) + 확인 문제
  if (mTop && pm >= R.misc.hedged && hitItems(mTop).size >= 1) return { ...out, state: "illusion", tier: "hedged", kind: "misc", m: mTop };
  // 5. 잘 아는 것 같음
  if (sum.K >= R.solid.hedged && anyM < R.solid.mMax && n >= R.solid.items) return { ...out, state: "solid", tier: "hedged" };
  // 6. 덜 다져짐 (얕게 앎 / 모름은 세부 표시)
  if (sum.S + sum.N >= R.weak.SN && n >= R.weak.items) {
    const sub = sum.S >= R.weak.shallow && easyOK && hardMiss ? "shallow" : sum.N >= R.weak.gap ? "gap" : null;
    return { ...out, state: "weak", tier: "hedged", sub };
  }
  // 7. 판단 보류
  const kinds = new Set(E.filter(e => !e.second).map(e => e.kind));
  const famF = V.famOfFacet.get(f), nearAvail = famF && famF.some(x => x.role === "near");
  out.why = n < Q.minItems ? "few_items" : kinds.size === 1 && n >= 2 && (kinds.has("ox") || kinds.has("mc")) ? "one_format"
    : nearAvail && ![...items].some(near) ? "no_variant" : "few_items";
  return out;
}
const rapidWhy = (out, f, E, rapidBy, Q) => {
  const r = rapidBy.get(f) || 0, n = E.filter(e => !e.second).length;
  if (out.state === "pending" && r > 0 && r / (r + n) > Q.rapidShare) out.why = "rapid_only";
  return out;
};

/** 깊이 사다리와 '어디까지 되는가' (depth) */
function ladderOf(E, sum, Q) {
  const L = [1, 2, 3, 4].map(d => {
    const es = E.filter(e => !e.second && e.d === d), first = new Map();
    for (const e of es) if (!first.has(e.pid)) first.set(e.pid, e);
    const ok = [...first.values()].filter(e => e.resp.r === "C").length, n = first.size;
    return { lv: "L" + d, st: !n ? "none" : ok === n ? "ok" : ok === 0 ? "miss" : "mixed", es: [...first.values()] };
  });
  let depth = null;
  for (let d = 4; d >= 1; d--) {
    const pC = sum.K * (1 - Q.slip[d - 1]) + sum.S * Q.q[d - 1];
    const okHere = L[d - 1].es.some(e => e.resp.r === "C");
    const okBelow = new Set(E.filter(e => !e.second && e.d <= d && e.resp.r === "C").map(e => e.pid)).size;
    if (pC >= Q.rule.depthP && okHere && okBelow >= 2) { depth = "L" + d; break; }
  }
  return { ladder: L, depth };
}

// ───────── 확인 문제 (ALGORITHM §6): 기대 정보 이득 ─────────
function probeCands(f, V, attempted) {
  const L = V.byFacet.get(f) || [], out = [];
  for (const it of L) if (it.status === "published" && !attempted.has(it.pid)) out.push({ it, second: false });
  for (const it of V.bySecond.get(f) || []) if (it.status === "published" && !attempted.has(it.pid)) out.push({ it, second: true });
  return out;
}
function eig(S, p, cand, V, ms, Q) {
  const it = cand.it, tag = V.tags.get(it.pid) || {}, kind = it.kind;
  const k = kind === "mc" ? Math.max(2, it.nopt || 4) : 2, g = kind === "mc" ? 1 / k : kind === "ox" ? 0.5 : kind === "short" ? 0.05 : 0;
  const offer = cand.second ? new Set() : offers(tag, it);
  const aOf = m => (Array.isArray(tag.mis) ? tag.mis.filter(x => x === m).length : 1);
  const resps = [{ r: "C", m: null, n: 1 }, { r: "I", m: null, n: 1 }];
  for (const m of ms) if (offer.has(m)) resps.push({ r: "H", m, n: kind === "mc" ? aOf(m) : 1 });
  const wn = kind === "mc" ? Math.max(0, k - 1 - [...offer].reduce((s, m) => s + aOf(m), 0)) : kind === "ox" && offer.size ? 0 : 1;
  if (wn > 0) resps.push({ r: "W", m: null, n: wn });
  const e0 = { kind, k, g, d: lv(tag.depth), offer, aOf, fb: false, legacy: false, pt: false, x: cand.second ? Q.second : 1 };
  const H0 = entropy(p); let EH = 0, mass = 0;
  for (const r of resps) {
    const e = { ...e0, resp: r }, L = S.map(s => r.n * lik(e, s.D, s.h, Q) ** e.x);
    const pr = L.reduce((a, l, i) => a + l * p[i], 0); if (pr <= 0) continue;
    const q = L.map((l, i) => l * p[i] / pr); EH += pr * entropy(q); mass += pr;
  }
  return mass > 0 ? H0 - EH / mass : 0;
}

// ───────── 한 과목 ─────────
/**
 * obs·post: normalize()+timeModel() 뒤의 관찰. V: ctx.v2 (facets, misc, tags, fam, byFacet …). Z: { chapterLabel(ch) → "weak"|"solid"|… , attempted:Set }
 * → { points:[…], excluded:{rapid, burst}, profile:{…}, need:[…] }   (근거 칩은 엔진이 만든다: e.o를 넘긴다)
 */
export function depthModel(obs, post, V, P, Z = {}) {
  const Q = paramsOf(P);
  const { byF, burst, rapid } = collect(obs, post, V, Q);
  const rapidBy = new Map();
  for (const o of obs) if (o.rapid) { const t = V.tags.get(o.pid); if (t && t.facet) rapidBy.set(t.facet, (rapidBy.get(t.facet) || 0) + 1); }
  const attempted = Z.attempted || new Set([...obs.map(o => o.pid), ...(post || []).map(x => x.pid)]);
  const points = [], need = [];
  const facetOrder = [...byF.keys()].sort((a, b) => ((V.facets.get(a) || {}).sort ?? 0) - ((V.facets.get(b) || {}).sort ?? 0) || (a < b ? -1 : 1));
  for (const f of facetOrder) {
    const E = byF.get(f); if (!E.filter(e => !e.second).length) continue;
    const F = V.facets.get(f);
    const ms = [...new Set(E.flatMap(e => [...e.offer]))].filter(m => !V.misc[m] || V.misc[m].status !== "rejected").sort();
    const lab = Z.chapterLabel ? Z.chapterLabel(F) : null;
    const prior = lab === "weak" ? Q.prior.weak : lab === "solid" ? Q.prior.solid : Q.prior.D;
    const S = states(ms, prior, Q), p = posterior(S, E, Q), sum = summary(S, p, ms);
    const dec = rapidWhy(decide(f, E, sum, ms, V, Q), f, E, rapidBy, Q);
    const { ladder, depth } = ladderOf(E, sum, Q);
    // 확인 문제: 조심 문구·판단 보류에만 (확실한 '확실히 앎'에는 없음)
    let probes = [], need_variant = false;
    if (!(dec.state === "solid" && dec.tier === "firm")) {
      const mLead = dec.m || (ms.length ? ms.slice().sort((a, b) => sum.m[b] - sum.m[a])[0] : null);
      const reason = dec.state === "solid" ? "confirm_solid" : (mLead && sum.m[mLead] >= 0.3) || dec.state === "illusion" ? "illusion_or_slip" : "depth_unknown";
      const seenFam = new Set(E.map(e => (V.fam.get(e.pid) || {}).family).filter(Boolean)), seenNear = E.some(e => (V.fam.get(e.pid) || {}).role === "near");
      const C = probeCands(f, V, attempted).map(c => {
        const fm = V.fam.get(c.it.pid) || {}, tg = V.tags.get(c.it.pid) || {};
        let s = eig(S, p, c, V, ms, Q);
        if (!seenNear && fm.role === "near") s *= 1.25;                       // 기준·겉모습만 바꾼 문제만 봤으면 살짝 바꾼 문제를 먼저
        if (mLead && !c.second && offers(tg, c.it).has(mLead)) s *= 1.2;       // 가장 의심되는 착각을 고를 수 있는 문제
        if (reason === "depth_unknown" && lv(tg.depth) >= 3) s *= 1.1;
        if (fm.family && seenFam.has(fm.family) && fm.role !== "near") s *= 0.9;
        return { c, s, fm, tg };
      }).filter(x => x.s > 1e-4).sort((a, b) => b.s - a.s || a.c.it.pid - b.c.it.pid);
      const pick = [], fams = new Set();
      for (const x of C) { if (pick.length >= Q.probes) break; if (x.fm.family && fams.has(x.fm.family) && C.length > Q.probes) continue; pick.push(x); if (x.fm.family) fams.add(x.fm.family); }
      probes = pick.map(x => ({ pid: x.c.it.pid, ext: x.c.it.ext, lv: "L" + lv(x.tg.depth), role: x.fm.role || null, reason }));
      if (!probes.length && dec.state !== "solid") {
        need_variant = true;
        const used = new Set(E.map(e => (V.fam.get(e.pid) || {}).delta_type).filter(Boolean));
        need.push({ facet: f, depth: E.some(e => e.d >= 3) ? 4 : 3, delta_type: DT.find(t => !used.has(t)) || "object", m: mLead || null });
      }
    }
    const mi = dec.m ? V.misc[dec.m] || {} : null;
    points.push({
      code: f, F, E, sum, ms, dec, ladder, depth, probes, need_variant,
      mis: mi ? { code: dec.m, belief: mi.belief || "", truth: mi.truth || "", ...(mi.cue ? { cue: mi.cue } : {}) } : null,
      n_items: new Set(E.filter(e => !e.second).map(e => e.pid)).size,
    });
  }
  return { points, excluded: { rapid, burst }, need };
}

/** det v2 profile 블록 (개인 맞춤 AI의 씨앗, 결정적) — DECISIONS §8 */
export function profileOf(points, Z = {}) {
  const facets = {};
  for (const x of points) facets[x.code] = { state: x.dec.state, tier: x.dec.tier, ...(x.dec.sub ? { sub: x.dec.sub } : {}), depth: x.depth, n: x.n_items };
  const misc = [];
  for (const x of points) for (const m of x.ms) { const p = x.sum.m[m]; if (p >= 0.3) misc.push({ code: m, facet: x.code, p: Math.round(p * 100) / 100, tier: x.dec.m === m ? x.dec.tier : null }); }
  misc.sort((a, b) => b.p - a.p || (a.code < b.code ? -1 : 1));
  return { profile_v: 1, facets, misc: misc.slice(0, 20), habits: Z.habits || [], formats: Z.formats || { strong: [], weak: [] }, pace: Z.pace || {} };
}
