// 학습 리포트 엔진 (insight). 순수 ES 모듈: DOM·node:* 없이 숫자와 글만 만든다.
// 서버(server/insight/report.js)는 buildReport(raw, ctx, P, nowDay)만 부른다. 설계: docs/insight/SPEC.md §3–§6, TIME_FACTORS.md
// - 오늘(nowDay, KST 날짜 번호)은 인자로 받는다 → 같은 입력이면 언제나 같은 결과
// - 과목을 이름·번호로 가르지 않는다: 단원·개념(topic)·주의 문장은 모두 데이터에서 정한다
// - 아직 틀린 문제(hidden)에는 정답·바른 진술·해설 문장을 넣지 않는다
// - v2 (docs/insight/v2/ALGORITHM.md): 태그가 붙고 v2_ready인 과목은 세부 포인트 진단(insight-depth.js)을 더한다
import { depthModel, profileOf } from "./insight-depth.js";
export const ENGINE_VER = 2;

// ───────── 공통 ─────────
const KST = 9 * 3600e3, DAY = 864e5, MIN = 60e3;
export const dayOf = ts => Math.floor((Date.parse(ts) + KST) / DAY);
const sig = x => 1 / (1 + Math.exp(-x));
const logit = p => Math.log(p / (1 - p));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpEv = (a, b) => cmpStr(a.ts, b.ts) || (+a.rid || 0) - (+b.rid || 0);
const group = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
const ENT = { "&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
/** HTML → 글 (수식 \( \)은 그대로 둔다) */
export const strip = h => String(h ?? "").replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&(nbsp|lt|gt|amp|quot|#39);/g, m => ENT[m]).replace(/\s+/g, " ").trim();
const cut = (s, n) => (s = String(s ?? ""), s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const TEX = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
/** 수식(\( \), \[ \])은 중간에서 자르지 않고 보이는 길이 n자 안으로 (수식 하나는 TeX 글자 수의 ⅓로 센다).
 *  자리가 모자란 수식만 '[수식]', '…'은 글을 실제로 잘랐을 때만 */
const texW = m => Math.ceil(m.length / 3);
export const visLen = s => String(s ?? "").replace(TEX, m => "x".repeat(texW(m))).length;
export function cutTex(s, n) {
  s = String(s ?? ""); if (visLen(s) <= n) return s;
  let out = "", w = 0, i = 0;
  for (const m of [...s.matchAll(TEX), { index: s.length, 0: "" }]) {
    const txt = s.slice(i, m.index);
    if (w + txt.length > n - 1) return (out + txt.slice(0, n - 1 - w)).trimEnd() + "…";
    out += txt; w += txt.length; i = m.index + m[0].length;
    if (!m[0]) break;
    if (w + texW(m[0]) <= n - 1) { out += m[0]; w += texW(m[0]); }
    else if (texW(m[0]) > 8 && w + 4 <= n - 1) { out += "[수식]"; w += 4; }   // 긴 수식만 자리표시, 짧은 수식은 거기서 끊는다
    else return out.trimEnd() + "…";
  }
  return out.endsWith("[수식]") ? out.slice(0, -4).trimEnd() + "…" : out;   // 끝에 홀로 남은 자리표시는 '…'로 (긴 수식이 잘렸다는 뜻)
}
const LET = "ABCDEFGH";
/** 문제 글 길이 (보이는 길이: 수식은 ⅓로 센다) — 시간 모형의 길이 항 */
export const lenOf = b => (b = b || {}, visLen(strip(b.q)) + visLen(strip(b.stem)) + (Array.isArray(b.opts) ? b.opts.reduce((s, x) => s + visLen(strip(x)), 0) : 0));
/** 정답이 보이는 문제 = 진행 상태가 맞힘·고침 (카드와 같은 규칙: 기록을 지운 문제도 숨긴다) */
const shownSt = s => s === "correct" || s === "resolved";
const KN = { ox: "O/X", mc: "객관식", short: "단답", essay: "서술형" };
const mdDay = d => { const t = new Date(d * DAY); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}`; };
/** 받침 유무 (조사 고르기): 한글·숫자 읽기·영문 l/m/n */
function jong(w) {
  const s = String(w).replace(/[\s'"’”)\]…·.,!?]+$/u, ""), ch = s[s.length - 1] || "", c = ch.charCodeAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 > 0;
  if (/\d/.test(ch)) return "013678".includes(ch);
  return /[lmn]/i.test(ch);
}
const ida = w => (jong(w) ? "이라고" : "라고");
const erf = x => { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
/** 표준정규 분위수 (Acklam) */
function probit(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
    b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
    c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
    d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 0.97575) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ───────── 격자 (SPEC §4.2): θ = −4 … 4, 0.2 간격 41점 ─────────
const NG = 41, GR = Float64Array.from({ length: NG }, (_, j) => -4 + 0.2 * j);
const MEMO = new Map();
/** ctx.lnP가 없을 때 쓰는 같은 메모 (ctx 만드는 쪽도 이것을 그대로 써도 된다) */
export function lnP(g, d) {
  const k = g.toFixed(3) + "|" + d.toFixed(2); let v = MEMO.get(k);
  if (!v) {
    const lp = new Float64Array(NG), lq = new Float64Array(NG);
    for (let j = 0; j < NG; j++) { const p = g + (1 - g) * sig(GR[j] - d); lp[j] = Math.log(p); lq[j] = Math.log(1 - p); }
    if (MEMO.size > 4000) MEMO.clear();
    MEMO.set(k, v = { lp, lq });
  }
  return v;
}
/** 문항 정보량 (θ에서, 추측 바닥 g): θ = d에서 단답 .24 · 객관식4 .15 · O/X .083 */
export function info(theta, d, g) { const s = sig(theta - d), p = g + (1 - g) * s; return ((1 - g) * s * (1 - s)) ** 2 / (p * (1 - p)); }
function postOf(LL, mu, s2) {
  const p = new Float64Array(NG); let mx = -Infinity, z = 0;
  for (let j = 0; j < NG; j++) { p[j] = LL[j] - (GR[j] - mu) ** 2 / s2; if (p[j] > mx) mx = p[j]; }
  for (let j = 0; j < NG; j++) { p[j] = Math.exp(p[j] - mx); z += p[j]; }
  for (let j = 0; j < NG; j++) p[j] /= z;
  return p;
}
const meanOf = p => { let m = 0; for (let j = 0; j < NG; j++) m += p[j] * GR[j]; return m; };
const sdOf = (p, m) => { let v = 0; for (let j = 0; j < NG; j++) v += p[j] * (GR[j] - m) ** 2; return Math.sqrt(v); };
/** P(θ < x): 격자점마다 폭 0.2의 고른 덩어리로 본다 */
const cdf = (p, x) => { let c = 0; for (let j = 0; j < NG; j++) c += p[j] * clamp((x - GR[j] + 0.1) / 0.2, 0, 1); return c; };
const quant = (p, q) => { let c = 0; for (let j = 0; j < NG; j++) { if (c + p[j] >= q) return GR[j] - 0.1 + 0.2 * (q - c) / p[j]; c += p[j]; } return 4.1; };
/** 효과 η의 격자 사후 (TIME_FACTORS §5.1): logit P = logit p̂ + η, 사전 N(0, s²) → P(η < thr) */
function effectBelow(list, s, thr) {
  const l = new Float64Array(NG); let mx = -Infinity, z = 0, c = 0;
  for (let j = 0; j < NG; j++) {
    let v = -(GR[j] ** 2) / (2 * s * s);
    for (const o of list) { const q = sig(logit(clamp(o.p, 0.01, 0.99)) + GR[j]); v += o.y ? Math.log(q) : Math.log(1 - q); }
    l[j] = v; if (v > mx) mx = v;
  }
  for (let j = 0; j < NG; j++) { l[j] = Math.exp(l[j] - mx); z += l[j]; }
  for (let j = 0; j < NG; j++) c += (l[j] / z) * clamp((thr - GR[j] + 0.1) / 0.2, 0, 1);
  return c;
}
/** Beta(1+k, 1+n−k) 격자 */
function betaGrid(k, n, N = 200) {
  const f = new Float64Array(N); let mx = -Infinity, z = 0;
  for (let i = 0; i < N; i++) { const x = (i + 0.5) / N; f[i] = k * Math.log(x) + (n - k) * Math.log(1 - x); if (f[i] > mx) mx = f[i]; }
  for (let i = 0; i < N; i++) { f[i] = Math.exp(f[i] - mx); z += f[i]; }
  for (let i = 0; i < N; i++) f[i] /= z;
  return f;
}
/** 실제 첫 풀이 정답률 c/n의 80% 구간 (Jeffreys: Beta(c+½, n−c+½)) */
function accBand(c, n) {
  if (!n) return [0, 1];
  const N = 400, f = betaGrid(c - 0.5, n - 1, N), at = q => { let s = 0; for (let i = 0; i < N; i++) { if (s + f[i] >= q) return (i + (q - s) / f[i]) / N; s += f[i]; } return 1; };
  return [at(0.1), at(0.9)];
}
/** P(A < B − gap) */
function betaLess(A, B, gap) {
  const N = A.length, F = new Float64Array(N + 1); for (let i = 0; i < N; i++) F[i + 1] = F[i] + A[i];
  let s = 0; for (let j = 0; j < N; j++) { const x = (j + 0.5) / N - gap, i = Math.floor(clamp(x, 0, 1) * N); s += B[j] * F[clamp(i, 0, N)]; }
  return s;
}
const betaAbove = (A, x) => { let s = 0; for (let i = 0; i < A.length; i++) if ((i + 0.5) / A.length > x) s += A[i]; return s; };
/** Beta(k+½, n−k+½) 격자 (Jeffreys) */
function jeffGrid(k, n, N = 200) {
  const f = new Float64Array(N); let mx = -Infinity, z = 0;
  for (let i = 0; i < N; i++) { const x = (i + 0.5) / N; f[i] = (k - 0.5) * Math.log(x) + (n - k - 0.5) * Math.log(1 - x); if (f[i] > mx) mx = f[i]; }
  for (let i = 0; i < N; i++) { f[i] = Math.exp(f[i] - mx); z += f[i]; }
  for (let i = 0; i < N; i++) f[i] /= z;
  return f;
}
const PROB = Float64Array.from({ length: 200 }, (_, i) => probit((i + 0.5) / 200));
/** O/X 치우침 c = −(Φ⁻¹H + Φ⁻¹F)/2 의 사후에서 P(|c| > thr). H: 참인 진술에 O 비율, F: 거짓 진술에 O 비율 */
function oxBiasP(hO, nT, fO, nF, thr) {
  const A = jeffGrid(hO, nT), B = jeffGrid(fO, nF); let s = 0;
  for (let i = 0; i < 200; i++) { if (A[i] < 1e-12) continue; for (let j = 0; j < 200; j++) if (Math.abs(PROB[i] + PROB[j]) > 2 * thr) s += A[i] * B[j]; }
  return s;
}

// ───────── 과목 준비 (ctx마다 한 번, WeakMap) ─────────
const PREP = new WeakMap();
const gOf = (it, P) => it.kind === "ox" ? P.guess.ox : it.kind === "mc" ? 1 / Math.max(2, it.nopt || 4)
  : it.kind === "short" ? (it.body && it.body.num != null ? P.guess.short_num : P.guess.short_text) : P.guess.essay;
const unNum = t => String(t || "").replace(/^[\d.\-–~·\s]+/, "").trim() || String(t || "");
function tagKcs(ctx, pid) {    // P2 태그: [[code, w]] 또는 {kcs, review}
  const t = ctx.tags && ctx.tags.get && ctx.tags.get(pid); if (!t) return null;
  const k = Array.isArray(t) ? t : t.review !== "rejected" ? t.kcs : null;
  return Array.isArray(k) && k.length ? k : null;
}
function prep(ctx, P) {
  const old = PREP.get(ctx); if (old && old.P === P) return old;
  const D = P.diff, T = P.time, items = new Map(), units = new Map();
  ctx.chapters.forEach((c, i) => units.set("c:" + c.key, { key: "c:" + c.key, kind: "chapter", code: c.key, name: c.title || c.key, ch: c.key, sort: i, pids: [] }));
  const all = [...ctx.items.values()].sort((a, b) => a.pid - b.pid);
  // 개념(topic) 이름: ctx.topics → 겹치거나 없으면 그 개념 문제가 가장 많이 모인 단원 제목
  const tch = new Map();
  for (const it of all) if (it.topic && it.status === "published") {
    const m = tch.get(it.topic) || tch.set(it.topic, new Map()).get(it.topic); m.set(it.ch, (m.get(it.ch) || 0) + 1);
  }
  const grp = new Map(ctx.chapters.map(c => [c.key, c.grp || ""]));
  const chOrd = new Map(ctx.chapters.map((c, i) => [c.key, i])), title = new Map(ctx.chapters.map(c => [c.key, c.title || c.key]));
  const domCh = m => [...m].sort((a, b) => (grp.get(a[0]) ? 1 : 0) - (grp.get(b[0]) ? 1 : 0) || b[1] - a[1] || (chOrd.get(a[0]) ?? 99) - (chOrd.get(b[0]) ?? 99))[0][0];
  const given = ctx.topics || {}, cnt = new Map();
  for (const code of tch.keys()) if (given[code]) cnt.set(given[code], (cnt.get(given[code]) || 0) + 1);
  const tName = new Map();
  for (const [code, m] of tch) {
    const g = given[code]; tName.set(code, g && g !== code && cnt.get(g) === 1 ? g : unNum(title.get(domCh(m))));
  }
  // 이름이 겹치면 (한 단원에 개념 둘) 단원 제목을 'A와 B'로 나눠 문제 순서대로 붙인다. 안 되면 (1)(2)를 붙인다
  const firstPid = new Map(); for (const it of all) if (it.topic && !firstPid.has(it.topic)) firstPid.set(it.topic, it.pid);
  for (const [n, codes] of group([...tName.keys()], c => tName.get(c))) {
    if (codes.length < 2) continue;
    const parts = n.split(/(?:와|과)\s+|\s*[·,]\s*|\s+및\s+/).map(x => x.trim()).filter(Boolean);
    const ord = [...codes].sort((a, b) => firstPid.get(a) - firstPid.get(b));
    ord.forEach((c, i) => tName.set(c, parts.length === codes.length ? parts[i] : `${n} (${i + 1})`));
  }
  let topicOrd = 0;
  for (const [code, m] of [...tch].sort((a, b) => (chOrd.get(domCh(a[1])) ?? 99) - (chOrd.get(domCh(b[1])) ?? 99) || cmpStr(a[0], b[0])))
    units.set("t:" + code, { key: "t:" + code, kind: "topic", code, name: tName.get(code), ch: domCh(m), sort: 1000 + topicOrd++, pids: [] });
  let hasMC = false, nPub = 0, nTag = 0;
  // 길이는 보이는 길이로 (수식 TeX 글자 수를 그대로 세면 수학 과목이 모두 '긴 문제'가 된다)
  const lens = new Map(all.map(it => [it.pid, lenOf(it.body)])), ml0 = {};
  for (const k of ["ox", "mc", "short", "essay"]) ml0[k] = med(all.filter(it => it.kind === k && it.status === "published").map(it => lens.get(it.pid))) || 20;
  for (const it of all) {
    const b = it.body || {}, k = it.kind, pub = it.status === "published";
    const d = (D[k] ?? 0) + D.star * (it.star ? 1 : 0) + D.exam * (it.exam ? 1 : 0);
    const q = strip(b.q);
    const calc = (k === "mc" || k === "short") && (b.num != null || (q.match(/\d+(\.\d+)?/g) || []).length >= 3 || /\\\(|\\\[/.test(b.q || ""));
    const lx = Math.log(Math.max(20, lens.get(it.pid)) / Math.max(1, ml0[k]));
    const beta0 = T.b0[k] ? Math.log(T.b0[k]) + (calc ? T.b_calc[k] || 0 : 0) : null, beta = beta0 == null ? null : beta0 + T.b_len * lx;
    const tk = tagKcs(ctx, it.pid);
    const kcs = tk ? tk.map(([c, w]) => ["k:" + c, +w || 0]) : it.topic && units.has("t:" + it.topic) ? [["t:" + it.topic, 1]] : [];
    const I = { pid: it.pid, it, d, g: gOf(it, P), beta, beta0, lx, calc, kcs, uk: ["c:" + it.ch, ...kcs.map(x => x[0])], pub };
    items.set(it.pid, I);
    if (!pub) continue;
    nPub++; if (kcs.length) nTag++; if (k === "mc") hasMC = true;
    for (const key of I.uk) {
      let u = units.get(key);
      if (!u && key.startsWith("k:")) { const c = key.slice(2), n = ctx.kc && ctx.kc[c]; units.set(key, u = { key, kind: "kc", code: c, name: (n && n.name) || c, ch: it.ch, sort: 2000 + units.size, pids: [] }); }
      if (u) u.pids.push(it.pid);
    }
  }
  for (const u of units.values()) {
    const L = u.pids.map(p => items.get(p));
    u.dbar = L.length ? L.reduce((s, I) => s + I.d, 0) / L.length : 0;
    u.exam = L.length ? L.filter(I => I.it.exam).length / L.length : 0;
    u.star = L.length ? L.filter(I => I.it.star).length / L.length : 0;
    u.kinds = new Set(L.map(I => I.it.kind));
  }
  const X = { P, items, units, hasMC, nPub, nTag, topics: tch.size > 0 };
  PREP.set(ctx, X);
  return X;
}

// ───────── 증거 정리 (SPEC §3.2) ─────────
const ANSWER = new Set(["first", "retry", "spaced"]);
const kept = o => !o.rapid && !o.dropped && o.g < 1 && o.w > 0;
const optOf = (kind, a) => {
  a = String(a ?? "").trim();
  if (kind === "mc") { const i = LET.indexOf(a); return a.length === 1 && i >= 0 ? i : null; }
  return kind === "ox" ? (a === "O" ? 1 : a === "X" ? 0 : null) : null;
};
/** 기록 → 관찰. 해설을 본 뒤 고른 답(seen)은 post[]로 빼고, 예전 앱 기록은 약하게 만든다 */
export function normalize(raw, ctx, P, nowDay) {
  const X = prep(ctx, P), W = P.w, TP = P.time, obs = [], post = [];
  const meta = { first: 0, choice: 0, legacy: 0, events: 0, skipped: 0, firstAns: 0, listNoVis: 0 };
  const evs = (raw.events || []).filter(e => e && (e.type === "answer_submit" || e.type === "idk")).sort(cmpEv);
  const by = group(evs, e => e.pid), prog = new Map((raw.progress || []).map(r => [r.pid, r]));
  const grades = group([...(raw.grades || [])].sort((a, b) => cmpStr(a.created_at, b.created_at) || a.id - b.id), g => g.pid);
  // 목록 모드(vis 없음) 풀이 시간: 같은 세션에서 바로 앞 답과의 간격 안에 들 때만 (차례로 푼 경우) min(ms, 간격)
  const lt = new Map(); let pe = null;
  for (const e of evs) {
    const p = e.p && typeof e.p === "object" ? e.p : {};
    if (pe && pe.sid === e.sid && p.mode !== "focus" && !Number.isFinite(p.vis) && Number.isFinite(p.ms) && p.ms > 0) {
      const gap = Date.parse(e.ts) - Date.parse(pe.ts);
      if (gap > 0 && gap <= TP.listGap * MIN && p.ms <= 1.1 * gap) lt.set(e.rid, Math.min(p.ms, gap));
    }
    pe = e;
  }
  const pids = [...new Set([...by.keys(), ...prog.keys(), ...grades.keys()])].sort((a, b) => a - b);
  for (const pid of pids) {
    const I = X.items.get(pid);
    if (!I || !I.pub) { meta.skipped++; continue; }          // 숨긴 문제 · ctx에 없는 문제
    const it = I.it, kind = it.kind, b = it.body || {}, pr = prog.get(pid), gr = grades.get(pid) || [];
    let list = (by.get(pid) || []).filter(e => !(e.v > it.v));
    const att = e => +(e.p || {}).attempt || 1;
    for (let i = list.length - 1; i > 0; i--) if (att(list[i]) === 1 && att(list[i - 1]) > 1) { list = list.slice(i); break; }   // '기록 지우고 다시 풀기' 뒤부터가 지금의 첫 풀이 (지우기 전 풀이는 쓰지 않는다)
    const mk = (src, y, g, w, day) => ({ pid, v: it.v, I, kind, ch: it.ch, uk: I.uk, kcs: I.kcs, src, y, g, w, day, init: false, rapid: false, dropped: false,
      opt: null, optRaw: null, txt: "", answer: "", t: null, ms: null, mode: null, p: null, idk: false, elim: 0, same: true });
    const legacy = !!pr && (!list.length || (+(list[0].p || {}).attempt || 1) > 1);
    let prevDay = null, prev = null, first = false, hadWrong = false; const wrong = new Set();
    if (legacy) {                                            // 예전 앱에서 옮겨 온 기록: 고른 답·시간 없음
      meta.legacy++;
      const nW = list.filter(e => (e.p || {}).correct === false).length;
      const y = list.length ? ((pr.wrong_count | 0) - nW > 0 ? 0 : 1) : (pr.status === "correct" ? 1 : 0);
      const day = list.length ? dayOf(list[0].ts) - 1 : dayOf(pr.updated_at);
      const o = mk("legacy", y, I.g, W.legacy, day); o.init = true;
      if (!list.length && pr.status === "wrong") {
        const op = optOf(kind, pr.last_answer);
        if (op != null) { o.opt = o.optRaw = op; o.choice = true; o.answer = String(pr.last_answer); }
        else if (pr.last_answer === "모르겠어요") o.lidk = true;
        else if (kind === "short" && pr.last_answer) { o.txt = cut(pr.last_answer, 60); o.answer = o.txt; }
      }
      obs.push(o);
      if (!list.length && pr.status === "resolved") {
        const f = mk("legacy_fix", 1, kind === "mc" ? 1 / 3 : kind === "ox" ? 1 : I.g, W.legacy_fix, day);
        if (kind === "ox") f.dropped = true;
        obs.push(f);
      }
      prevDay = day; hadWrong = y === 0; if (o.opt != null && kind === "mc") wrong.add(o.opt);
    }
    for (const e of list) {
      const p = e.p && typeof e.p === "object" ? e.p : {}, t = Date.parse(e.ts), day = dayOf(e.ts), idk = e.type === "idk";
      const ok = !idk && p.correct === true;
      const seen = typeof p.seen === "boolean" ? p.seen : !!(prev && prev.sid === e.sid && t >= prev.t && t - prev.t <= P.seenMin * MIN && !prev.ok);
      const ms = Number.isFinite(p.ms) && p.ms >= 0 ? Math.min(p.ms, TP.cap) : null;
      const cur = { t, ok, sid: e.sid };
      if (seen) {                                            // 오답 뒤 해설이 펼쳐진 채 다시 고름 → 진단에 쓰지 않는다
        post.push({ pid, kind, rid: e.rid, t, day, ok, idk, answer: idk ? "모르겠어요" : String(p.answer ?? ""), ms });
        prev = cur; prevDay = day; hadWrong ||= !ok; continue;
      }
      const isFirst = !first; first = true;
      const att1 = (+p.attempt || 1) === 1, fresh = isFirst && !legacy && att1;
      let src, w, g = I.g, init = false, drop = false, quick = false;
      if (kind === "essay") {
        if (!idk && gr.some(x => Math.abs(Date.parse(x.created_at) - t) <= 10 * MIN)) { prev = cur; prevDay = day; continue; }   // AI 채점이 대신한다
        src = idk ? "idk" : "essay_self"; g = 0; init = fresh;
        w = idk ? (fresh ? W.idk : W.idk_again) : W.self;
        const te = p.mode === "focus" ? ms : Number.isFinite(p.vis) ? p.vis : lt.get(e.rid) ?? null;
        if (idk && te != null && te < TP.quickIdk) { w *= TP.quickIdkW; quick = true; }           // 써 보지 않고 바로 '모르겠어요'
      } else if (idk) { src = "idk"; g = 0; init = fresh; w = fresh ? W.idk : W.idk_again; }
      else if (fresh) { src = "first"; w = W.first; init = true; }
      else {
        const lag = prevDay == null ? 1 : day - prevDay;
        src = lag >= 1 ? "spaced" : "retry";
        if (kind === "mc") { const k = it.nopt || 4; g = src === "spaced" && lag >= 7 ? 1 / k : 1 / Math.max(1, k - wrong.size); }
        if (kind === "ox" && hadWrong && (src === "retry" || lag < 3)) drop = true;   // 내가 틀린 O/X를 다시: 남은 답이 하나뿐
        w = src === "retry" ? W.retry : kind === "ox" ? W.spaced_ox : W.spaced;
      }
      const same = e.v == null || e.v === it.v || (typeof ctx.sameAsCurrent === "function" && !!ctx.sameAsCurrent(pid, e.v));
      const o = mk(src, idk ? 0 : ok ? 1 : 0, g, w, day);
      Object.assign(o, { init, dropped: drop, quick, t, ms, lt: lt.get(e.rid) ?? null, mode: p.mode || "list", p, idk, rid: e.rid, sid: e.sid, elim: wrong.size, same, v: e.v ?? it.v,
        answer: idk ? "모르겠어요" : String(p.answer ?? "") });
      if (!idk) {
        const op = optOf(kind, o.answer); o.optRaw = op; o.opt = same ? op : null;
        if (kind === "short" && !ok) o.txt = cut(o.answer, 60);
        if (kind !== "essay" && o.answer) meta.choice++;
      }
      meta.events++;
      if (init) meta.first++;
      if (src === "first" && kind !== "essay") { meta.firstAns++; if (o.mode !== "focus" && !Number.isFinite(p.vis) && o.lt == null) meta.listNoVis++; }
      obs.push(o);
      if (!ok && !idk && kind === "mc" && o.optRaw != null) wrong.add(o.optRaw);
      prev = cur; prevDay = day; hadWrong ||= !ok;
    }
    gr.forEach((g, i) => {                                   // 서술형 AI 채점: 채점 포인트마다 관찰 하나
      const R = g.result || {}, pts = Array.isArray(R.points) ? R.points : [], np = (b.pts || []).length || pts.length || 1;
      const dis = !!(g.user_verdict && R.verdict && g.user_verdict !== R.verdict), gv = g.user_verdict || R.verdict || null;   // 전체 판정 (내가 고친 판정 우선)
      const dg = diagOf(ctx, pid, g.v ?? it.v, I);
      meta.events++; if (i === 0) meta.first++;
      for (const pt of pts) {
        const y = pt.verdict === "covered" ? 1 : pt.verdict === "partial" ? 0.5 : 0;
        const o = mk("essay_pt", y, 0, Math.min(1, W.essay_pt / np) * (i ? W.regrade : 1) * (dis ? W.disagree : 1), dayOf(g.created_at));
        const kc = dg && dg.diag && (dg.diag.pts || []).find(x => x.i === pt.i);
        if (kc && kc.kc) { o.kcs = [["k:" + kc.kc, 1]]; o.uk = ["c:" + it.ch, "k:" + kc.kc]; }
        Object.assign(o, { init: i === 0, pt: pt.i, ptv: pt.verdict, np, gid: g.id, gok: gv ? gv === "correct" : null, gv, t: Date.parse(g.created_at), miss: pts.filter(x => x.verdict === "missing").length, part: pts.filter(x => x.verdict === "partial").length });
        obs.push(o);
      }
    });
  }
  return { obs, post, meta };
}

// ───────── 행동 기록 붙이기 (TIME_FACTORS §3, §5.5–5.6) ─────────
export function joinAux(obs, raw, P) {
  // unsure: 맞힌 뒤 AI에게 물어봄 (도움 요청) · star: 맞힌 직후 ☆로 담음 (나중에 볼 문제 — 자신 없다는 뜻으로 읽지 않는다)
  const TP = P.time, A = { unsure: new Map(), star: new Map(), assisted: new Set(), dwell: [], on: false };
  const aux = Array.isArray(raw.aux) ? [...raw.aux].sort(cmpEv) : [];
  if (!aux.length) return A;
  A.on = true;
  const ans = group(obs.filter(o => o.t && ANSWER.has(o.src)), o => o.pid);
  const copies = group(aux.filter(e => e.type === "ai_copy").map(e => ({ pid: e.pid, t: Date.parse(e.ts), st: String((e.p || {}).st || "new"), day: dayOf(e.ts) })), e => e.pid);
  for (const [pid, L] of ans) {
    const C = copies.get(pid) || [];
    for (const o of L) if (C.some(c => (c.st === "new" || c.st === "wrong") && c.t <= o.t && o.t - c.t <= TP.assistMin * MIN)) {
      o.assist = true; o.w *= TP.wAssist; A.assisted.add(pid);              // AI에게 물어본 뒤 고른 답
    }
  }
  for (const [pid, C] of copies) for (const c of C) {
    const L = ans.get(pid) || [], lastOk = L.filter(o => o.t <= c.t && o.y === 1).pop();
    if (c.st === "correct" || c.st === "resolved" || lastOk) A.unsure.set(pid, Math.max(A.unsure.get(pid) ?? -1, lastOk ? lastOk.day : c.day));
  }
  for (const e of aux) {
    const p = e.p || {}, t = Date.parse(e.ts);
    if (e.type === "bookmark" && p.on === true) {             // 맞힌 직후 ☆ = 나중에 다시 볼 문제 (다시 확인 후보로만 쓴다)
      const o = (ans.get(e.pid) || []).filter(o => o.y === 1 && o.t <= t && t - o.t <= TP.starMin * MIN).pop();
      if (o) A.star.set(e.pid, Math.max(A.star.get(e.pid) ?? -1, o.day));
    } else if (e.type === "sol_dwell" && Number.isFinite(p.ms)) A.dwell.push({ pid: e.pid, t, ms: p.ms, ok: !!p.ok, day: dayOf(e.ts) });
  }
  return A;
}

// ───────── 풀이 시간 모형 (TIME_FACTORS §2): ln t = β_i − τ + ε ─────────
const TK = ["ox", "mc", "short"];
function tauFit(L, s, TP, tau0 = 0) {   // L: [r = β − ln t]
  let tau = tau0; const c = TP.clip * s;
  for (let k = 0; k < 2; k++) { let sum = 0; for (const r of L) sum += tau + clamp(r - tau, -c, c); tau = (sum / (s * s)) / (1 / TP.s_tau ** 2 + L.length / (s * s)); }
  return tau;
}
export function timeModel(obs, raw, P) {
  const TP = P.time, S = { tau: {}, sig: {}, n: {}, active: {}, blen: {}, timed: [], rapid: 0 };
  S.bOf = I => (I.beta0 == null ? null : I.beta0 + (S.blen[I.it.kind] ?? TP.b_len) * I.lx);   // 문항 시간 강도 β (길이 기울기는 이 학습자·과목에서 추정)
  const all = (raw.events || []).filter(e => e && (e.type === "answer_submit" || e.type === "idk")).map(e => [Date.parse(e.ts), e.pid]).sort((a, b) => a[0] - b[0]);
  const overlap = (t, dur, pid) => {                         // 다른 문제의 답이 이 풀이 시간 안에 있음 → 시간 무효
    let lo = 0, hi = all.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (all[m][0] <= t - dur) lo = m + 1; else hi = m; }
    for (let i = lo; i < all.length && all[i][0] < t; i++) if (all[i][1] !== pid) return true;
    return false;
  };
  const cand = [];
  for (const o of obs) {
    if (!o.t || o.ms == null || o.idk || o.I.beta0 == null || !ANSWER.has(o.src)) continue;
    const vis = Number.isFinite(o.p.vis) ? Math.min(o.p.vis, TP.cap) : null;
    o.tr = o.mode === "focus" ? o.ms : vis ?? o.ms;          // 빠른 답 판정 (목록 모드 ms는 위쪽 경계: 이보다 짧으면 확실히 빠름)
    if (o.src !== "first" || o.assist) continue;
    const tt = o.mode === "focus" ? o.ms : vis ?? o.lt;       // 목록 모드: vis, 없으면 차례로 푼 답의 간격 (normalize)
    if (tt > 0 && !(o.p.away > 0) && !overlap(o.t, tt, o.pid)) { o.tt = tt; cand.push(o); }
  }
  for (const k of TK) { S.tau[k] = 0; S.sig[k] = TP.sigma0[k]; S.n[k] = 0; }
  const flag = () => {                                       // 빠른 답은 첫 풀이만 (다시 푸는 문제는 빨리 답하는 게 당연하다)
    for (const o of obs) if (o.tr != null && o.src === "first") {
      const m = Math.exp(S.bOf(o.I) - S.tau[o.kind]) * 1000, R = TP.rapid;
      const lo = o.kind === "ox" ? clamp(R.oxFrac * m, R.oxLo, R.lo) : R.lo;   // O/X 바닥은 길이에 맞춰 (짧은 진술은 1.5초 안에도 읽는다)
      o.T = clamp(R.frac * m, lo, R.hi); o.rapid = o.tr < o.T;
    }
  };
  const fit = () => {
    for (const k of TK) {
      const rs = cand.filter(o => o.kind === k && !o.rapid).map(o => S.bOf(o.I) - Math.log(o.tt / 1000)), s0 = TP.sigma0[k];
      S.n[k] = rs.length; if (!rs.length) { S.tau[k] = 0; S.sig[k] = s0; continue; }
      let s = s0, tau = tauFit(rs, s, TP);
      let ss = 0; for (const r of rs) ss += Math.min((tau - r) ** 2, (TP.clip * s) ** 2);
      s = Math.sqrt((TP.nu0 * s0 * s0 + ss) / (TP.nu0 + rs.length));
      S.tau[k] = tauFit(rs, s, TP, tau); S.sig[k] = s;
    }
  };
  // 길이 기울기 b_len: 이 과목에서 시간을 잰 답이 nLen개 이상일 때만, 잔차를 자른 회귀를 사전 N(b_len, bSd²) 쪽으로 줄여서
  const slope = () => {
    for (const k of TK) {
      const L = cand.filter(o => o.kind === k && !o.rapid); if (L.length < TP.nLen) continue;
      const x = L.map(o => o.I.lx), y = L.map(o => Math.log(o.tt / 1000) - o.I.beta0), n = L.length, s = S.sig[k], c = TP.clip * s;
      const mx = x.reduce((a, v) => a + v, 0) / n, sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0); if (sxx < 1e-6) continue;
      let b = TP.b_len;
      for (let it = 0; it < 2; it++) {                       // 잘린 잔차로 기울기 다시 재기 (Huber 식, 두 번)
        const a = y.reduce((z, v, i) => z + v - b * x[i], 0) / n;
        let sr = 0; for (let i = 0; i < n; i++) sr += (x[i] - mx) * clamp(y[i] - a - b * x[i], -c, c);
        const bh = b + sr / sxx, wP = 1 / TP.bSd ** 2, wD = sxx / (s * s);
        b = (wP * TP.b_len + wD * bh) / (wP + wD);
      }
      S.blen[k] = clamp(b, 0, 1.5);
    }
  };
  flag(); fit(); slope(); flag(); fit(); flag(); fit();      // 1차(기본 속도) → τ·σ → 길이 기울기 → 2차 → τ·σ
  for (const k of TK) S.active[k] = S.n[k] >= TP.nMin;
  for (const o of cand) {
    if (o.rapid) continue;
    const k = o.kind, b = S.bOf(o.I); o.exp = Math.exp(b - S.tau[k]);
    if (!S.active[k]) continue;
    o.z = (Math.log(o.tt / 1000) - (b - S.tau[k])) / S.sig[k];
    if (o.z > TP.z.idle || o.tt > (TP.idleCap[k] ?? Infinity)) { o.idle = true; continue; }   // 자리를 비운 듯: 시간 증거로 쓰지 않는다
    o.cls = o.z <= TP.z.fast ? "fast" : o.z >= TP.z.slow ? "slow" : "normal";
    S.timed.push(o);
  }
  for (const o of obs) { o.fast = !!(o.rapid || o.cls === "fast"); if (o.rapid) S.rapid++; }
  // 학습 덩어리: 답과 답 사이가 blockGap분 넘게 비면 새 덩어리
  const ev = (raw.events || []).filter(e => e && (e.type === "answer_submit" || e.type === "idk")).map(e => ({ rid: e.rid, t: Date.parse(e.ts), ms: +(e.p || {}).ms || 0 })).sort((a, b) => a.t - b.t || (+a.rid || 0) - (+b.rid || 0));
  const blk = new Map(); let bi = -1, last = -Infinity, start = 0;
  for (const e of ev) { if (e.t - last > TP.fatigue.gap * MIN) { bi++; start = e.t - Math.min(e.ms, TP.cap); } blk.set(e.rid, [bi, start]); last = e.t; }
  for (const o of obs) { const x = o.rid != null && blk.get(o.rid); if (x) { o.block = x[0]; o.late = o.t - x[1] >= TP.fatigue.late * MIN; } }
  S.blocks = bi + 1;
  return S;
}
/** 단원 속도 (TIME_FACTORS §4): 이 단원의 맞힌 답을 다른 단원에서의 내 속도와 비교 */
function unitSpeed(key, S, P) {
  const TP = P.time, U = TP.unit; if (!S.timed.length) return null;
  const inU = S.timed.filter(o => o.y === 1 && o.uk.includes(key));
  if (!inU.length) return null;
  let a = 1 / U.prior ** 2, b = 0; const items = new Set(), rows = [], ref = {};
  for (const k of TK) {
    const mine = inU.filter(o => o.kind === k); if (!mine.length) continue;
    const out = S.timed.filter(o => o.kind === k && !o.uk.includes(key));
    if (out.length < TP.nMin) continue;
    const s = S.sig[k], tr = ref[k] = tauFit(out.map(o => S.bOf(o.I) - Math.log(o.tt / 1000)), s, TP);
    for (const o of mine) {
      const ex = Math.exp(S.bOf(o.I) - tr), d = Math.log(o.tt / 1000 / ex);
      a += 1 / (s * s); b += d / (s * s); items.add(o.pid); rows.push({ o, ex, sec: o.tt / 1000 });
    }
  }
  if (items.size < U.n) return null;
  const v = 1 / a, m = v * b, sd = Math.sqrt(v), L = Math.log(U.ratio);
  const pSlow = 1 - Phi((L - m) / sd), pFast = Phi((-L - m) / sd);
  return { speed: pSlow >= U.p ? "slow" : pFast >= U.p ? "fast" : "normal", ratio: Math.exp(m), n: items.size, rows, ref };
}

// ───────── 숙달 모형 (SPEC §4): 단원·개념별 격자 사후 ─────────
/** → { course:{mean,sd}, chapters[], kcs[], all: Map(key → 단원 결과) } */
export function scoreConcepts(obs, ctx, P, nowDay, lam = (P.time && P.time.srt) || 0) {
  const X = prep(ctx, P), lnp = typeof ctx.lnP === "function" ? ctx.lnP : lnP, H = P.recency, s2u = 2 * P.hier.tau ** 2, s2c = 2 * P.hier.prior_sd ** 2;
  const acc = new Map(), L = [new Float64Array(NG), new Float64Array(NG)];
  const A = key => acc.get(key) || acc.set(key, { LL: [new Float64Array(NG), new Float64Array(NG)], LC: [new Float64Array(NG), new Float64Array(NG)], rows: [] }).get(key);
  const YS = { FW: 0, SW: 0.1, SC: 0.9, FC: 1 };
  for (const o of obs) {
    if (!kept(o)) continue;
    const { lp, lq } = lnp(o.g, o.I.d), r = Math.min(1, Math.max(H.floor, 2 ** (-(nowDay - o.day) / H.half)));
    const q = o.cls === "fast" || o.cls === "slow" ? (o.cls === "fast" ? "F" : "S") + (o.y ? "C" : "W") : null;
    const yc = lam > 0 && q ? (1 - lam) * o.y + lam * YS[q] : o.y;
    for (let m = 0; m < 2; m++) {
      const f = m === 0 ? (o.init ? o.w : 0) : o.w * r; if (!f) continue;
      const y = m === 0 ? o.y : yc, ch = A("c:" + o.ch);
      for (let j = 0; j < NG; j++) { const v = f * (y * lp[j] + (1 - y) * lq[j]); ch.LL[m][j] += v; L[m][j] += v; }
      for (const [k, kw] of o.kcs) {
        const u = A(k);
        for (let j = 0; j < NG; j++) { const v = f * (y * lp[j] + (1 - y) * lq[j]); u.LL[m][j] += kw * v; u.LC[m][j] += v; }
      }
    }
    A("c:" + o.ch).rows.push([o, 1]); for (const [k, kw] of o.kcs) A(k).rows.push([o, kw]);
  }
  const res = new Map(), C = [postOf(L[0], 0, s2c), postOf(L[1], 0, s2c)];
  const course = { mean: meanOf(C[1]), sd: sdOf(C[1], meanOf(C[1])) };
  const LB = P.label;
  for (const [key, a] of acc) {
    const u = X.units.get(key); if (!u) continue;
    const out = { key, kind: u.kind, code: u.code, name: u.name, ch: u.ch, sort: u.sort, dbar: u.dbar };
    const its = [...new Map(a.rows.map(([o]) => [o.pid, o.I])).values()];
    const pAt = th => its.reduce((s, I) => s + I.g + (1 - I.g) * sig(th - I.d), 0) / Math.max(1, its.length);   // 푼 문제들의 예상 정답률 P_o
    for (let m = 0; m < 2; m++) {
      const rest = new Float64Array(NG), sub = u.kind === "chapter" ? a.LL[m] : a.LC[m];
      for (let j = 0; j < NG; j++) rest[j] = L[m][j] - sub[j];
      const mu = meanOf(postOf(rest, 0, s2c)), p = postOf(a.LL[m], mu, s2u), mean = meanOf(p);
      let I = 0;
      for (const [o, kw] of a.rows) if (m === 1 || o.init) {
        const r = m === 0 ? 1 : Math.min(1, Math.max(H.floor, 2 ** (-(nowDay - o.day) / H.half)));
        I += o.w * r * kw * info(mean, o.I.d, o.g);
      }
      const z = { mu, mean, sd: sdOf(p, mean), p, I,
        pDelta: cdf(p, mu + LB.delta), pLow: cdf(p, u.dbar + logit(LB.weakM)), pHigh: 1 - cdf(p, u.dbar + logit(LB.solidM)) };
      let Em = 0; for (let j = 0; j < NG; j++) Em += p[j] * sig(GR[j] - u.dbar); z.Em = Em;
      z.kband = [sig(quant(p, 0.1) - u.dbar), sig(quant(p, 0.9) - u.dbar)];      // 알고 있을 가능성 (추측 제외)
      z.band = [pAt(quant(p, 0.1)), pAt(quant(p, 0.9))];                         // 예상 정답률 (추측 바닥 포함) → 실제 정답률 근처
      out[m === 0 ? "init" : "cur"] = z;
    }
    out.rows = a.rows;
    res.set(key, out);
  }
  const all = [...res.values()].sort((a, b) => a.sort - b.sort);
  return { course, chapters: all.filter(u => u.kind === "chapter"), kcs: all.filter(u => u.kind !== "chapter"), all: res };
}
/** 문제마다 첫 풀이 (예전 기록 포함) → Map(pid → {o, ok}). 서술형 AI 채점은 전체 판정이 '맞음'일 때 (판정이 없으면 모든 포인트를 썼을 때) */
function firstTry(list) {
  const f = new Map();
  for (const o of list) if (o.init) { const x = f.get(o.pid); if (!x || o.day < x.day || (o.day === x.day && (o.t || 0) < (x.t || 0))) f.set(o.pid, o); }
  const out = new Map();
  for (const [pid, o] of f) out.set(pid, { o, ok: o.src === "essay_pt" ? o.gok ?? list.every(z => z.pid !== pid || z.gid !== o.gid || z.y === 1) : !o.idk && !o.lidk && o.y === 1 });
  return out;
}
/** 단원 결과에 이름표 붙이기 (SPEC §4.4) */
function labelUnits(S, P, st) {
  const LB = P.label;
  for (const u of S.all.values()) {
    const items = new Map();                                 // pid → 가장 이른 관찰
    for (const [o] of u.rows) { const x = items.get(o.pid); if (!x || o.day < x.day || (o.day === x.day && (o.t || 0) < (x.t || 0))) items.set(o.pid, o); }
    u.n = items.size;
    const ft = firstTry(u.rows.map(([o]) => o)); u.acc = { c: [...ft.values()].filter(x => x.ok).length, n: ft.size };   // 실제 첫 풀이 정답률
    u.counts = { c: 0, w: 0, idk: 0 };                       // 서술형은 전체 판정이 '맞음'일 때만 맞힘 (부분 점수는 틀림 쪽)
    for (const o of items.values()) u.counts[o.idk || o.lidk ? "idk" : (o.src === "essay_pt" && ft.has(o.pid) ? ft.get(o.pid).ok : o.y >= 0.5) ? "c" : "w"]++;
    const okItems = new Set(u.rows.filter(([o]) => o.y >= 0.5 && !o.idk).map(([o]) => o.pid));
    const shaky = [...okItems].filter(p => st.unsure.has(p) || st.assisted.has(p)).length;   // AI에게 물어보고 맞힌 것 (☆는 넣지 않는다)
    const nonMC = [...items.values()].some(o => o.kind !== "mc") || [...items.keys()].some(p => st.avoided.has(p));
    // 판단 보류: 문제가 너무 적거나, 정보량이 적은데 문제도 pendN개 미만 (쉬운 단원을 다 맞혔다고 보류하지 않게)
    u.why = u.n < LB.minItems ? "few" : u.cur.I < LB.minI && u.n < LB.pendN ? "info" : null;   // 판단 보류 까닭: 문제 수 · 근거(정보량)
    const lab = (z, n) => n < LB.minItems || (z.I < LB.minI && n < LB.pendN) ? "pending"
      : z.pDelta >= LB.weakP || z.pLow >= LB.weakP ? "weak"
      : z.pHigh >= LB.solidP && nonMC && shaky < LB.unsureShare * okItems.size ? "solid" : "ok";
    const nInit = new Set(u.rows.filter(([o]) => o.init).map(([o]) => o.pid)).size;
    u.label = lab(u.cur, u.n); u.initLabel = lab(u.init, nInit);
    if (u.lab0) u.label = u.label === "weak" && u.lab0 !== "weak" ? u.lab0 : u.label;     // SRT 보호: 시간 때문에만 약함이면 무시
    u.watch = u.label === "ok" && u.n >= LB.watchN && u.cur.pDelta >= LB.watchP;          // 약함은 아니지만 상대적으로 낮음 (카드는 만들지 않는다)
    u.mark = null;
    if (u.initLabel === "weak" && u.label !== "weak" && u.label !== "pending") {
      const w0 = u.rows.filter(([o]) => o.init && o.y < 0.5), d0 = Math.max(...w0.map(([o]) => o.day));
      const wp = new Set(w0.map(([o]) => o.pid)), fixOf = new Map();   // 문제마다 '고친 순간'(틀린 뒤 처음 맞힌 답)은 다시 맞힌 것으로 세지 않는다
      for (const [o] of [...u.rows].sort((a, b) => a[0].day - b[0].day || (a[0].t || 0) - (b[0].t || 0))) {
        if (!wp.has(o.pid) || o.src === "essay_pt") continue;
        if (o.y === 0) fixOf.set(o.pid, null); else if (fixOf.get(o.pid) === null && ANSWER.has(o.src) && o.y === 1 && !o.assist) fixOf.set(o.pid, o);
      }
      const later = new Set(u.rows.filter(([o]) => (o.src === "first" || o.src === "spaced") && o.y === 1 && !o.assist && o.day > d0 && o !== fixOf.get(o.pid)).map(([o]) => o.pid));
      const again = [...later].filter(p => wp.has(p)).length;
      if (again >= Math.max(2, Math.ceil(LB.fixShare * wp.size))) u.mark = "fixed";   // 처음 틀린 문제 가운데 max(2, 40%) 이상을 뒤에 다시 맞힘
    } else if ((u.initLabel === "ok" || u.initLabel === "solid") && u.label === "weak") u.mark = "slipping";
  }
}

// ───────── 오개념 판별 (SPEC §5.1; 태그(ctx.diag)가 없으면 []) ─────────
function diagOf(ctx, pid, v, I) {
  const D = ctx.diag; if (!D || !D.size) return null;
  const t = D.get(pid + ":" + v) || D.get(pid); if (!t) return null;
  const tv = t.v ?? I.it.v;
  return tv === v || (tv === I.it.v && typeof ctx.sameAsCurrent === "function" && ctx.sameAsCurrent(pid, v)) ? t : null;
}
const qTag = (t, src, key) => t.review === "accepted" || t.review === "edited" || src === "explanation" || src === "fix" || src === "x" ? "reviewed"
  : t.qa && t.qa.cycle && t.qa.cycle[key] === true ? "pass" : "unverified";
const normTxt = s => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
function shortMatch(txt, pat, body) {
  const a = normTxt(txt);
  return (pat.ex || []).some(x => {
    if (pat.num) { const u = parseFloat(String(txt).replace(/[−–]/g, "-")), v = parseFloat(x); if (!isFinite(u) || !isFinite(v)) return false;
      return Math.abs(u - v) <= (body.tol ?? Math.max(1e-9, Math.abs(v) * 1e-3)); }
    return normTxt(x) === a;
  });
}
/** 한 응답이 오개념 집합 M에 대해 주는 증거: [K, U, M 우도, 지수, 역할] 또는 null */
function evidenceOf(o, t, M, P) {
  const Q = P.misc, dg = t.diag || {}, b = o.I.it.body || {};
  const ws = o.src === "legacy" ? Q.w.legacy : o.src === "first" || o.src === "idk" ? (o.src === "idk" && !o.init ? Q.w.retry : Q.w.first) : o.src === "essay_pt" ? 1 : Q.w.retry;
  const ex = (d, q) => ws * (Q.ed[d] ?? 0) * Q.q[q];
  if (o.kind === "mc") {
    const k = Math.max(2, (o.I.it.nopt || 4) - (o.src === "first" ? 0 : o.elim));
    const A = Object.entries(dg.opt || {}).filter(([, x]) => x && M.has(x.m) && x.d >= 2).map(([i, x]) => [+i, x]);
    if (!A.length) return null;
    const a = A.length, rest = Math.max(0, k - 1 - a), best = A.reduce((s, x) => (x[1].d > s[1].d ? x : s));
    const qb = qTag(t, best[1].src, String(best[0]));
    if (o.idk) return [0.02, 0.25, 0.03, ex(best[1].d, qb), "idk"];
    if (o.y === 1) return [0.9, 1 / k, 0.1, ex(best[1].d, qb), "avoided"];
    if (o.opt == null) return null;
    const hit = A.find(x => x[0] === o.opt);
    if (hit) return [0.1 / (k - 1), 1 / k, (rest > 0 ? 0.8 : 0.9) / a, ex(hit[1].d, qTag(t, hit[1].src, String(hit[0]))), "hit", hit[1]];
    return [0.1 / (k - 1), 1 / k, 0.1 / Math.max(1, rest), ex(best[1].d, qb), "avoided"];
  }
  if (o.kind === "ox") {
    const x = dg.ox; if (!x) return null;
    const tf = b.ox === true, m = tf ? x.mr : x.m; if (!M.has(m) || !(x.d >= 2)) return null;
    const e = ex(x.d, qTag(t, tf ? "inferred" : x.src || "fix", "ox"));
    if (o.idk) return [0.02, 0.25, 0.03, e, "idk"];
    if (o.opt == null) return null;
    return o.opt === (tf ? 0 : 1) ? [0.1, 0.5, 0.85, e, "hit", x] : [0.9, 0.5, 0.15, e, "avoided"];
  }
  if (o.kind === "short") {
    const L = (dg.short || []).filter(x => M.has(x.m) && x.d >= 2); if (!L.length) return null;
    const best = L.reduce((s, x) => (x.d > s.d ? x : s)), e = ex(best.d, qTag(t, best.src, "short"));
    if (o.idk) return [0.02, 0.25, 0.03, e, "idk"];
    if (o.y === 1) return [0.9, 0.2, 0.1, e, "avoided"];
    const hit = L.find(x => shortMatch(o.answer || o.txt, x, b));
    return hit ? [0.02, 0.05, 0.6, ex(hit.d, qTag(t, hit.src, "short")), "hit", hit] : [0.08, 0.75, 0.3, e, "other"];
  }
  if (o.src === "essay_pt") {
    const x = (dg.pts || []).find(z => z.i === o.pt && M.has(z.m)); if (!x) return null;
    if (o.ptv === "missing") return [0.2, 0.5, 0.7, 0.5, "hit", x];
    if (o.ptv === "covered") return [0.8, 0.5, 0.3, 0.5, "avoided"];
  }
  return null;
}
function classify(R, M, P) {
  const Q = P.misc, F = Q.flag;
  let lK = Math.log(Q.prior.K), lU = Math.log(Q.prior.U), lM = Math.log(Q.prior.M);
  const hits = [], avoided = [], items = new Set(), days = new Set();
  let strong = 0;
  for (const { o, t, again } of R) {
    const e = evidenceOf(o, t, M, P); if (!e) continue;
    const x = again ? Q.again : 1;
    lK += e[3] * x * Math.log(e[0]); lU += e[3] * x * Math.log(e[1]); lM += e[3] * x * Math.log(e[2]);
    items.add(o.pid);
    if (e[4] === "hit") { hits.push({ o, tag: e[5] }); days.add(o.day); if (e[5] && e[5].d >= 3 && (e[5].src === "explanation" || e[5].src === "fix" || t.review === "accepted" || t.review === "edited")) strong++; }
    else if (e[4] === "avoided") avoided.push({ o });
  }
  const mx = Math.max(lK, lU, lM), z = Math.exp(lK - mx) + Math.exp(lU - mx) + Math.exp(lM - mx), pM = Math.exp(lM - mx) / z;
  const hitItems = new Set(hits.map(h => h.o.pid)), nh = hitItems.size;
  let flag = pM >= F.sure && (nh >= 3 || (nh >= 2 && strong >= 2)) && days.size >= 2 ? "sure" : pM >= F.likely && nh >= 2 ? "likely" : pM >= F.hyp && nh >= 1 ? "hyp" : null;
  if (hits.length) {                                         // 회복: 마지막 함정 뒤 다른 날 두 번 이상 피함
    const lastDay = Math.max(...hits.map(h => h.o.day)), later = R.filter(r => r.o.day > lastDay);
    const av = new Set(avoided.filter(a => a.o.day > lastDay).map(a => a.o.pid));
    if (av.size >= 2 && classify(later, M, { ...P, misc: { ...Q, flag: { sure: 2, likely: 2, hyp: 2 } } }).pM < F.recovered) flag = "recovered";
  }
  return { pM, hits, avoided, items, sessions: days, flag };
}
/** 오개념마다 → [{m, pM, hits[], avoided[], items:Set, sessions:Set, flag}] */
export function misconceptions(obs, ctx, P) {
  if (!ctx.diag || !ctx.diag.size) return [];
  const byItem = group(obs.filter(o => !o.rapid && !o.dropped && (o.src !== "legacy" || o.choice) && o.src !== "legacy_fix"), o => o.pid);
  const offers = new Map();                                 // m → 응답 목록
  for (const [pid, L] of [...byItem].sort((a, b) => a[0] - b[0])) {
    const S = [...L].sort((a, b) => a.day - b.day || (a.t || 0) - (b.t || 0));
    S.forEach((o, i) => {
      const t = diagOf(ctx, pid, o.v, o.I); if (!t) return;          // 옛 버전이 지금과 다르면 태그 없음 → 개념 증거로만
      const dg = t.diag || {}, ms = new Set();
      Object.values(dg.opt || {}).forEach(x => x && x.m && ms.add(x.m));
      if (dg.ox) { dg.ox.m && ms.add(dg.ox.m); dg.ox.mr && ms.add(dg.ox.mr); }
      (dg.short || []).forEach(x => x.m && ms.add(x.m)); (dg.pts || []).forEach(x => x.m && ms.add(x.m));
      for (const m of ms) (offers.get(m) || offers.set(m, []).get(m)).push({ o, t, again: i > 0 && o.src !== "essay_pt" });
    });
  }
  return [...offers].sort((a, b) => cmpStr(a[0], b[0])).map(([m, R]) => ({ m, ...classify(R, new Set([m]), P), _R: R }));
}
/** 서로 바꿔 쓰는 두 개념 (SPEC §5.2): 태그가 없으면 [] */
export function confusions(miscRes, ctx, P) {
  if (!miscRes.length || !ctx.misc) return [];
  const pairs = new Map();
  for (const r of miscRes) {
    const c = ctx.misc[r.m]; if (!c || !c.cw || !c.kc) continue;
    const key = [c.kc, c.cw].sort().join("~");
    (pairs.get(key) || pairs.set(key, []).get(key)).push(r);
  }
  const up = { hyp: "likely", likely: "sure", sure: "sure" };
  return [...pairs].sort((a, b) => cmpStr(a[0], b[0])).map(([key, rs]) => {
    const M = new Set(rs.map(r => r.m)), seen = new Set(), R = [];
    for (const r of rs) for (const x of r._R) { const k = x.o.pid + "|" + x.o.day + "|" + x.o.src + "|" + (x.o.t || 0); if (!seen.has(k)) { seen.add(k); R.push(x); } }
    const c = classify(R, M, P), [a, b] = key.split("~");
    const dir = h => rs.find(r => r.hits.some(x => x.o === h.o));
    const ab = c.hits.some(h => (ctx.misc[(dir(h) || {}).m] || {}).kc === a), ba = c.hits.some(h => (ctx.misc[(dir(h) || {}).m] || {}).kc === b);
    const both = ab && ba;
    return { a, b, ms: [...M], pM: c.pM, both, hits: c.hits, avoided: c.avoided, flag: both && c.flag && c.flag !== "recovered" ? up[c.flag] : c.flag };
  });
}

// ───────── 풀이 습관 (SPEC §5.4 + TIME_FACTORS §5) ─────────
/** → [{id, prio, stats, evidence[]}] (나중에 하나만 쓴다) */
export function habits(obs, post, ctx, P, Z = {}) {
  const H = P.habit, TP = P.time, out = [], S = Z.time || { timed: [] }, U = Z.units, opt = Z.choice !== false;   // opt: 고른 답 기록이 충분함 (결정 8)
  const firsts = obs.filter(o => o.src === "first" && !o.idk);
  const pOf = R => o => { const u = R && R.all.get("c:" + o.ch); const th = u ? u.cur.mean : 0; return o.g + (1 - o.g) * sig(th - o.I.d); };
  // 기대 정답률: 살펴보는 답(빠른 답·오래 푼 뒤의 답)을 뺀 나머지로 잰 단원 수준에서 → 그 답들이 기대를 끌어내리지 않게
  const pWithout = drop => pOf(scoreConcepts(obs.filter(o => !drop(o)), ctx, P, Z.nowDay ?? 0));
  // qualifier: 한정어(err=qualifier) 거짓 진술을 O라고 답함 — 태그가 있을 때만
  if (opt && ctx.diag && ctx.diag.size) {
    const q = firsts.filter(o => o.kind === "ox" && o.opt === 1 && o.y === 0 && (() => { const t = diagOf(ctx, o.pid, o.I.it.v, o.I); return t && t.diag && t.diag.ox && t.diag.ox.err === "qualifier"; })());
    if (new Set(q.map(o => o.pid)).size >= H.qual_n) out.push({ id: "qualifier", prio: H.prio.qualifier, stats: { k: q.length }, evidence: q });
  }
  // ox_bias: 참·거짓과 상관없이 O(또는 X)로 기우는가 (신호탐지 c)
  const ox = firsts.filter(o => o.kind === "ox" && o.opt != null && typeof o.I.it.body.ox === "boolean");
  const T = ox.filter(o => o.I.it.body.ox), F = ox.filter(o => !o.I.it.body.ox);
  if (opt && T.length >= H.ox_n && F.length >= H.ox_n) {
    const hO = T.filter(o => o.opt === 1).length, fO = F.filter(o => o.opt === 1).length;
    const c = -(probit((hO + 0.5) / (T.length + 1)) + probit((fO + 0.5) / (F.length + 1))) / 2;
    const pc = oxBiasP(hO, T.length, fO, F.length, H.ox_c);              // 적은 기록의 우연한 치우침은 거른다: P(|c| > ox_c) ≥ ox_p
    if (Math.abs(c) > H.ox_c && pc >= H.ox_p) out.push({ id: "ox_bias", prio: H.prio.ox_bias * (pc >= H.ox_head ? 1 : 0.6), stats: { c, p: pc, nT: T.length, nF: F.length, hO, fO, dir: c < 0 ? "accept" : "doubt" },
      evidence: c < 0 ? F.filter(o => o.opt === 1) : T.filter(o => o.opt === 0) });
  }
  // hasty: 내 평소보다 빨리 답한 문제에서 예상보다 많이 틀림 (TIME_FACTORS §5.3)
  const HT = TP.hasty, fast = S.timed.filter(o => o.cls === "fast" && !o.assist);
  let hasty = false;
  if (fast.length >= HT.n) {
    const pHat = pWithout(o => o.cls === "fast"), L = fast.map(o => ({ o, p: pHat(o), y: o.y }));
    const pr = effectBelow(L, HT.s, HT.eta);
    const known = L.filter(x => x.y === 0 && (obs.some(z => z.pid === x.o.pid && z !== x.o && ANSWER.has(z.src) && z.y === 1 && z.day >= x.o.day + 1)
      || (x.p >= HT.pKnown && (U && (U.all.get("c:" + x.o.ch) || {}).label) !== "weak")));
    const kItems = new Set(known.map(x => x.o.pid)), kDays = new Set(known.map(x => x.o.day));
    if (pr >= HT.p && kItems.size >= HT.known && kDays.size >= HT.days) {
      hasty = true;
      out.push({ id: "hasty", prio: H.prio.hasty, stats: { n: fast.length, k: L.filter(x => !x.y).length, exp: L.reduce((s, x) => s + 1 - x.p, 0),
        again: known.filter(x => obs.some(z => z.pid === x.o.pid && ANSWER.has(z.src) && z.y === 1 && z.day > x.o.day)).length }, evidence: known.map(x => x.o) });
    }
  }
  // rapid_wrong: 너무 빠른 답(빠른 답 기준 미만)이 천천히 푼 답보다 확실히 덜 맞음
  const fo = firsts.filter(o => o.mode === "focus" && (o.kind === "ox" || o.kind === "mc") && o.tr != null);
  const rp = fo.filter(o => o.rapid), sl = fo.filter(o => !o.rapid);
  if (!hasty && rp.length >= H.rapid_n && sl.length) {
    const kr = rp.filter(o => o.y).length, ks = sl.filter(o => o.y).length;
    if (betaLess(betaGrid(kr, rp.length), betaGrid(ks, sl.length), H.rapid_gap) >= H.rapid_p)
      out.push({ id: "rapid_wrong", prio: H.prio.rapid_wrong, stats: { n: rp.length, k: rp.length - kr, acc: ks / sl.length }, evidence: rp.filter(o => !o.y) });
  }
  // fb_skip: 틀린 뒤 해설을 읽지 않고 넘김 (sol_dwell이 있을 때만)
  const A = Z.aux;
  if (A && A.dwell.length) {
    const FB = TP.fb, byP = group(obs.filter(o => o.t && ANSWER.has(o.src)), o => o.pid), rows = [];
    for (const d of A.dwell) {
      if (d.ok) continue;
      const o = (byP.get(d.pid) || []).filter(x => x.t <= d.t && d.t - x.t <= P.seenMin * MIN).pop();
      if (!o || o.y !== 0) continue;
      const R = strip(o.I.it.body.s).length / FB.cps * 1000;
      rows.push({ o, d, skip: d.ms < Math.max(FB.min, FB.frac * R) });
    }
    const k = rows.filter(r => r.skip).length;
    A.fb = rows.length ? [k, rows.length] : null;
    if (rows.length >= FB.n && k >= FB.k && betaAbove(betaGrid(k, rows.length), FB.rate) >= FB.p) {
      const sk = rows.filter(r => r.skip), re = sk.filter(r => post.some(x => x.pid === r.o.pid && x.t > r.d.t) || obs.some(x => x.pid === r.o.pid && x.t > r.d.t));
      const reOk = re.filter(r => obs.some(x => x.pid === r.o.pid && x.t > r.d.t && x.y === 1)).length;
      out.push({ id: "fb_skip", prio: H.prio.fb_skip, stats: { n: rows.length, k, sec: Math.round(Math.max(FB.min, med(sk.map(r => r.d.ms)) || 0) / 1000), re: re.length, reOk }, evidence: sk.map(r => r.o) });
    }
  }
  // fatigue: 한 덩어리에서 lateMin분이 지난 뒤 정확도가 떨어짐
  const FT = TP.fatigue, fa = obs.filter(o => o.src === "first" && !o.idk && o.block != null && o.kind !== "essay");
  const late = fa.filter(o => o.late), early = fa.filter(o => !o.late), lb = new Set(late.map(o => o.block));
  if (late.length >= FT.nLate && early.length >= FT.nEarly && lb.size >= FT.blocks) {
    const pHat = pWithout(o => o.late), pr = effectBelow(late.map(o => ({ p: pHat(o), y: o.y })), FT.s, FT.gamma);
    if (pr >= FT.p) {
      const bl = [...lb].map(b => [fa.filter(o => o.block === b && !o.late), fa.filter(o => o.block === b && o.late)]).filter(x => x[0].length && x[1].length);
      const worse = bl.filter(([e, l]) => l.filter(o => o.y).length / l.length < e.filter(o => o.y).length / e.length).length;
      out.push({ id: "fatigue", prio: H.prio.fatigue, stats: { early: early.filter(o => o.y).length / early.length, late: late.filter(o => o.y).length / late.length, nb: bl.length, worse }, evidence: [] });
    }
  }
  // essay_skip: 서술형을 써 보지 않고 넘김 (빠른 '모르겠어요'·30자 미만 답)
  //   분모: 첫 시도가 있는 서술형 전부 (AI 채점을 받은 서술형 포함, 문제마다 하나)
  const es = obs.filter(o => o.kind === "essay" && o.t && (o.src === "idk" || o.src === "essay_self") && o.init);
  const nEs = new Set(obs.filter(o => o.kind === "essay" && o.init && (o.src === "idk" || o.src === "essay_self" || o.src === "essay_pt")).map(o => o.pid)).size;
  const te = o => (o.mode === "focus" ? o.ms : Number.isFinite(o.p.vis) ? o.p.vis : o.lt);   // 목록 모드: vis, 없으면 차례로 푼 간격
  const quick = es.filter(o => (o.idk && te(o) != null && te(o) < TP.quickIdk) || (!o.idk && Number.isFinite(o.p.len) && o.p.len < 30));
  if (quick.length >= H.essay_n && quick.length / nEs >= H.essay_share && betaAbove(betaGrid(quick.length, nEs), H.essay_share) >= H.essay_p)
    out.push({ id: "essay_skip", prio: H.prio.essay_skip, stats: { n: nEs, k: quick.length }, evidence: quick });
  return out.sort((a, b) => b.prio - a.prio);
}

// ───────── 고친 문제 다시 확인 (SPEC §5.5) ─────────
/** → {resolved, confirmed, retried, recent, due:[pid], unsure(☆+AI 후보 수), star, asked, info} */
export function relearning(obs, ctx, nowDay, Z = {}) {
  const status = Z.status || new Map(), post = Z.post || [], A = Z.aux || { unsure: new Map(), star: new Map(), assisted: new Set() }, X = Z.X, SA = A.star || new Map();
  const byP = group(obs, o => o.pid), postP = group(post, x => x.pid), due = [], info = new Map();
  let resolved = 0, confirmed = 0, retried = 0, recent = 0;
  const pubOk = pid => !X || (X.items.get(pid) || {}).pub;
  for (const [pid, st] of [...status].sort((a, b) => a[0] - b[0])) {
    if (st !== "resolved" || !pubOk(pid)) continue;
    resolved++;
    const L = byP.get(pid) || [], Q = postP.get(pid) || [];
    const wrongDays = [...L.filter(o => o.y === 0 && o.src !== "essay_pt").map(o => o.day), ...Q.filter(x => !x.ok).map(x => x.day)];
    const wrongT = [...L.filter(o => o.y === 0 && o.src !== "essay_pt" && o.t).map(o => o.t), ...Q.filter(x => !x.ok).map(x => x.t)];
    const tw = wrongT.length ? Math.max(...wrongT) : -Infinity;
    const right = L.filter(o => ANSWER.has(o.src) && o.y === 1 && !o.assist && o.t > tw).sort((a, b) => a.t - b.t);
    const qfix = Q.filter(x => x.ok && x.t > tw).sort((a, b) => a.t - b.t)[0];   // 해설을 본 뒤 맞힌 답도 고친 순간이 될 수 있다
    const fixQ = !!qfix && (!right[0] || qfix.t <= right[0].t), fix = fixQ ? qfix : right[0];   // 틀린 뒤 처음 맞힌 그 한 번 = 고친 순간 (다시 확인한 것이 아니다)
    const lastWrong = fix ? fix.day : wrongDays.length ? Math.max(...wrongDays) : null;
    const guessed = !!fix && !fixQ && fix.kind === "mc" && fix.ms != null && fix.ms < 6000 && Number.isFinite(tw) && fix.t - tw <= 10000;   // 틀린 직후 곧바로 보기를 바꿔 맞힘 = 찍었을 수 있다
    const ok = (fixQ ? right : right.slice(1)).filter(o => o.day > lastWrong);
    const cd = [...new Set(ok.map(o => o.day))].sort((a, b) => a - b);
    info.set(pid, { lastWrong, conf: cd.length, guessed });
    if (cd.length) confirmed++;
    if (lastWrong != null && L.some(o => ANSWER.has(o.src) && o !== fix && o.day > lastWrong)) retried++;   // 고친 뒤 다른 날 다시 풀어 본 것 (맞힘·틀림 모두)
    else if (lastWrong != null && nowDay - lastWrong <= 3) recent++;                                          // 고친 지 3일 안: 아직 다시 볼 때가 아님
    const since = cd.length ? nowDay - cd[cd.length - 1] : lastWrong == null ? 0 : nowDay - lastWrong;
    if ((!cd.length && lastWrong != null && since >= 1) || (cd.length === 1 && since >= 3) || (cd.length === 2 && since >= 7) || (guessed && !cd.length && since >= 1)) due.push([pid, cd.length ? cd[cd.length - 1] : lastWrong]);
  }
  // 다시 확인 후보: ☆로 담아 둔 맞힌 문제 · AI에게 물어본 문제 (믿음을 짐작하지 않고 '다시 풀어 볼 문제'로만)
  let unsure = 0, star = 0, asked = 0;
  for (const pid of [...new Set([...SA.keys(), ...A.unsure.keys(), ...A.assisted])].sort((a, b) => a - b)) {
    if (!pubOk(pid) || due.some(d => d[0] === pid)) continue;
    const ds = [SA.get(pid), A.unsure.get(pid)].filter(x => x != null);
    const day = ds.length ? Math.max(...ds) : Math.max(...(byP.get(pid) || []).filter(o => o.assist).map(o => o.day));
    if (nowDay - day < 1) continue;
    if ((byP.get(pid) || []).some(o => ANSWER.has(o.src) && o.y === 1 && !o.assist && o.day > day)) continue;
    unsure++; if (SA.has(pid)) star++; else asked++;
    due.push([pid, day]); info.set(pid, { ...(info.get(pid) || {}), unsure: true, star: SA.has(pid) });
  }
  due.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { resolved, confirmed, retried, recent, due: due.map(d => d[0]), unsure, star, asked, guessed: due.filter(d => (info.get(d[0]) || {}).guessed).length, info };
}

// ───────── 문제 유형별 첫 풀이 (태그 없이도: O/X·객관식은 되는데 단답·서술형이 안 됨 등) ─────────
const KO = ["ox", "mc", "short", "essay"];
/** → null 또는 { strong:[kind], weak:[kind], by: {kind: {n, c, idk, g}}, p, wrong: [첫 풀이 오답 관찰] }
 *  추측 바닥을 뺀 정답률로 비교: 가장 나은 유형보다 .15 넘게 낮을 확률 ≥ .9 (Beta 사후, 유형마다 8문제 이상) */
export function formats(obs, P) {
  const FM = P.find.fmt, by = {}, wrong = {};
  for (const { o, ok } of firstTry(obs.filter(kept)).values()) {
    const b = by[o.kind] ||= { n: 0, c: 0, idk: 0, g: 0 }; b.n++; b.g += o.I.g; if (ok) b.c++; else (wrong[o.kind] ||= []).push(o);
    if (o.idk || o.lidk) b.idk++;
    if (o.kind === "essay") {                                // 서술형은 '못 씀 / 써서 일부 맞음 / 완전히 맞음'을 나눠 센다
      const e = b.es ||= { idk: 0, quick: 0, tried: 0, full: 0, partial: 0 };
      if (o.idk || o.lidk) { e.idk++; if (o.quick) e.quick++; } else { e.tried++; if (ok) e.full++; else if (o.gv === "partial" || o.y === 0.5) e.partial++; }
    }
  }
  const ks = KO.filter(k => by[k] && by[k].n >= FM.n); if (ks.length < 2) return null;
  for (const k of ks) by[k].g /= by[k].n;
  const raw = k => by[k].c / by[k].n, adj = (x, k) => (x - by[k].g) / (1 - by[k].g);
  const best = [...ks].sort((a, b) => adj(raw(b), b) - adj(raw(a), a) || KO.indexOf(a) - KO.indexOf(b))[0];
  const G = Object.fromEntries(ks.map(k => [k, betaGrid(by[k].c, by[k].n, 100)]));
  const pGap = (a, b) => { const A = G[a], B = G[b], N = A.length; let s = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (adj((i + 0.5) / N, a) - adj((j + 0.5) / N, b) > FM.d) s += A[i] * B[j]; return s; };
  const pw = {}, weak = ks.filter(k => k !== best && raw(k) < raw(best) - FM.d && (pw[k] = pGap(best, k)) >= FM.p);
  if (!weak.length) return null;
  const strong = ks.filter(k => !weak.includes(k) && raw(k) > Math.max(...weak.map(raw)) + FM.d && weak.every(w => k === best || pGap(k, w) >= FM.p));
  return { strong, weak, by, qs: Math.round(P.time.quickIdk / 1000), p: Math.min(...weak.map(k => pw[k])), wrong: weak.flatMap(k => wrong[k] || []) };
}
/** 약한 단원이 없을 때: 내 다른 단원 수준으로 본 기대보다 첫 풀이가 낮은 단원 (문항 유형·난이도를 맞춘 logit 효과 η의 사후) */
export function relatives(S, obs, P) {
  const R = P.find.rel, out = [];
  for (const u of S.all.values()) {
    if (u.label === "weak") continue;
    const ft = firstTry(u.rows.map(([o]) => o)); if (ft.size < R.n) continue;
    const L = [...ft.values()].map(({ o, ok }) => ({ p: o.I.g + (1 - o.I.g) * sig(u.init.mu - o.I.d), y: ok ? 1 : 0 }));
    const pr = effectBelow(L, R.s, R.eta);
    if (pr >= R.p) out.push({ u, p: pr, c: L.filter(x => x.y).length, n: L.length, exp: L.reduce((s, x) => s + x.p, 0) / L.length });
  }
  const all = [...firstTry(obs.filter(kept)).values()], avg = all.length ? all.filter(x => x.ok).length / all.length : 0;
  return out.sort((a, b) => b.p - a.p || a.c / a.n - b.c / b.n || a.u.sort - b.u.sort).map(x => ({ ...x, avg }));
}

// ───────── 짚어 볼 것 고르기 (SPEC §5.3, §5.6) ─────────
function unitStats(u, st, X) {
  const by = new Map(), info = o => (o.optRaw != null || o.txt || o.idk || o.lidk || o.src === "essay_pt" ? 1 : 0);
  for (const [o] of u.rows) if (o.y < 0.5 || o.idk) {      // 문제마다 하나: 고른 답이 남은 가장 이른 오답, 없으면 가장 이른 오답
    const x = by.get(o.pid); if (!x || info(o) > info(x) || (info(o) === info(x) && (o.day < x.day || (o.day === x.day && (o.t || 0) < (x.t || 0))))) by.set(o.pid, o);
  }
  const W = [...by.values()], s = { wrong: W, nFO: 0, nTX: 0, mc: [], mcUnk: 0, short: [], idk: 0, idkT: 0, idkLong: [], miss: 0, legacy: 0, essay: 0 };
  // 첫 풀이 (문제마다 가장 이른 첫 시도, 예전 기록 포함) → 유형별 맞힘/문제 수
  s.first = { n: 0, c: 0, by: {} };
  for (const { o, ok } of firstTry(u.rows.map(([o]) => o)).values()) { const b = s.first.by[o.kind] ||= { n: 0, c: 0 }; b.n++; s.first.n++; if (ok) { b.c++; s.first.c++; } }
  // 틀린 문제가 몰린 개념(topic): 단원 단위일 때만
  if (u.kind === "chapter" && X) {
    const tc = new Map(); for (const o of W) { const tp = o.I.it.topic, x = tp && X.units.get("t:" + tp); if (x) tc.set(x.name, (tc.get(x.name) || 0) + 1); }
    const top = [...tc].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]));
    for (const k of [1, 2]) if (top.length > k && W.length >= 4 && top.slice(0, k).reduce((z, x) => z + x[1], 0) >= W.length / 2) { s.conc = { names: top.slice(0, k).map(x => x[0]), n: top.slice(0, k).reduce((z, x) => z + x[1], 0) }; break; }
  }
  for (const o of W) {
    const tf = o.I.it.body.ox;
    if (o.idk || o.lidk) { s.idk++; if (o.ms != null && o.mode === "focus" && !(o.p && o.p.away > 0) && o.ms <= 900e3) { s.idkT++;   // 자리를 비운 듯한 시간(탭 이탈·15분 초과)은 고민한 시간으로 읽지 않는다
      if (o.ms >= 60e3) s.idkLong.push(o.ms); } }
    else if (o.src === "essay_pt") s.miss += o.ptv === "missing" ? 1 : 0;
    else if (o.kind === "essay") s.essay++;
    else if (o.kind === "ox" && o.optRaw != null) { if (tf === false && o.optRaw === 1) s.nFO++; else if (tf === true && o.optRaw === 0) s.nTX++; }
    else if (o.kind === "mc" && o.optRaw != null) s.mc.push(o);
    else if (o.kind === "short" && (o.txt || o.answer)) s.short.push(o);
    else s.legacy++;
  }
  const pairs = new Map();                                   // 같은 문제에서 같은 오답 보기를 두 번 (해설 보기 전)
  for (const [o] of u.rows) if (o.kind === "mc" && o.y === 0 && o.optRaw != null) { const k = o.pid + ":" + o.optRaw; pairs.set(k, (pairs.get(k) || 0) + 1); }
  s.scattered = st.choice !== false && s.mc.length >= 2 && ![...pairs.values()].some(n => n >= 2) && !st.repeatM(u);   // 고른 답 기록이 적으면 쓰지 않는다
  return s;
}
/** 오답 관찰 하나가 어느 신호에 들어가는지 (근거 칩을 신호 순서대로 고르려고) */
const sigKey = o => o.idk || o.lidk ? "idk" : o.src === "essay_pt" ? "miss" : o.kind === "essay" ? "essay"
  : o.kind === "ox" && o.optRaw != null ? (o.I.it.body.ox === false && o.optRaw === 1 ? "FO" : o.I.it.body.ox === true && o.optRaw === 0 ? "TX" : "legacy")
  : o.kind === "mc" && o.optRaw != null ? "mc" : o.kind === "short" && (o.txt || o.answer) ? "short" : "legacy";
const durTxt = ms => ms < 120e3 ? "1분 넘게" : `${Math.floor(ms / 60e3)}분 넘게`;
/** → [{txt, key}]: 첫 풀이 성적(예전 기록 포함) → 틀린 문제가 몰린 개념 → 나머지 신호 (많은 것부터, 예전 기록도 개수대로) */
function signalParts(s) {
  const P = [];
  if (s.nFO) P.push([s.nFO, `O라고 답한 거짓 진술 ${s.nFO}개`, "FO"]);
  if (s.nTX) P.push([s.nTX, `X라고 답한 참인 진술 ${s.nTX}개`, "TX"]);
  if (s.mc.length) P.push([s.mc.length, `객관식 오답 ${s.mc.length}개${s.scattered ? "가 서로 다른 보기로 흩어짐" : ""}`, "mc"]);
  if (s.short.length) P.push([s.short.length, `단답 오답 ${s.short.length}개`, "short"]);
  const L = s.idkLong, long = !L.length ? "" : s.idkT === 1 ? ` (시간을 잰 1번은 카드를 ${durTxt(L[0])} 열어 둔 뒤)`
    : L.length === s.idkT ? ` (시간을 잰 ${s.idkT}번 모두 카드를 1분 넘게 열어 둔 뒤)` : ` (시간을 잰 ${s.idkT}번 중 ${L.length}번은 카드를 1분 넘게 열어 둔 뒤)`;
  if (s.idk) P.push([s.idk, `'모르겠어요' ${s.idk}번${long}`, "idk"]);
  if (s.miss) P.push([s.miss, `서술형 핵심 빠짐 ${s.miss}곳`, "miss"]);
  if (s.essay) P.push([s.essay, `서술형 직접 채점 오답 ${s.essay}개`, "essay"]);
  if (s.legacy) P.push([s.legacy - 0.5, `예전 기록 오답 ${s.legacy}개(고른 답 모름)`, "legacy"]);   // 같은 수면 고른 답이 남은 쪽을 앞에
  P.sort((a, b) => b[0] - a[0]);
  const F = s.first, ks = F ? Object.keys(F.by).sort((a, b) => F.by[b].n - F.by[a].n || KO.indexOf(a) - KO.indexOf(b)) : [];
  if (s.conc) P.unshift([0, `틀린 ${s.wrong.length}문제 중 ${s.conc.n}개가 ${s.conc.names.join("·")}`, "conc"]);
  if (F && F.n >= 3 && F.c < F.n) P.unshift([0, `첫 풀이 ${F.n}문제 중 ${F.c}개 맞힘${ks.length > 1 ? ` (${ks.map(k => `${KN[k]} ${F.by[k].c}/${F.by[k].n}`).join(" · ")})` : ""}`, "first"]);
  return P.map(x => ({ txt: x[1], key: x[2] }));
}
/** 근거 칩: 글에 나온 신호 순서대로 하나씩 돌아가며 (고른 답이 남은 것 → 최근 것) */
function chipsBySignal(W, parts, n) {
  const info = o => (o.optRaw != null || o.txt || o.idk || o.lidk ? 1 : 0);
  const by = group([...W].sort((a, b) => info(b) - info(a) || b.day - a.day || a.pid - b.pid), sigKey), keys = parts.map(p => p.key).filter(k => by.has(k));
  for (const k of by.keys()) if (!keys.includes(k)) keys.push(k);
  const out = [];
  for (let r = 0; out.length < n && keys.some(k => by.get(k).length > r); r++) for (const k of keys) { const o = by.get(k)[r]; if (o && out.length < n) out.push(o); }
  return out;
}
const QN = u => `'${u.name}' ${u.kind === "chapter" ? "단원" : "개념"}`;
const HEAD = ["misc", "confusion", "gap", "relative", "unclear"];   // 한 줄 요약·첫 카드로 먼저 쓰는 지식 쪽 결과
// 카드 순서 (1단계 개념 중심, 2026-10-28): 착각·혼동 → 개념 공백·약한 곳 → 다시 확인. 습관·속도·형식은 위 3장에 넣지 않고 det.habits로
const RANK = { misc: 0, confusion: 0, gap: 1, unclear: 1, relative: 2, relearn: 3 };
/** 후보 → 최대 3개 (+ strong, pending) */
export function selectFindings(all, ctx, P) {
  const { S, misc = [], conf = [], hab = [], rel, st } = all, FP = P.find, X = prep(ctx, P), cands = [];
  const units = [...S.all.values()];
  const remaining = u => { const L = X.units.get(u.key).pids; let r = 0; for (const p of L) { const s = st.status.get(p); if (s !== "correct" && s !== "resolved") r++; if (s === "wrong") r++; } return r; };
  const prioU = (u, conf, type) => Math.max(0, 0.8 - u.cur.Em) * (1 + 0.5 * X.units.get(u.key).exam + 0.3 * X.units.get(u.key).star) * Math.log(1 + remaining(u)) * (FP.conf[conf] ?? 1) * FP.type[type];
  const itemsOf = u => new Set(u.rows.map(([o]) => o.pid));
  // 오개념·혼동 (P3)
  const absorbed = new Set();
  for (const c of conf) if (c.flag === "likely" || c.flag === "sure") {
    c.ms.forEach(m => absorbed.add(m));
    const u = S.all.get("k:" + c.a) || null;
    cands.push({ type: "confusion", conf: c.flag, u, items: new Set(c.hits.map(h => h.o.pid)), prio: (u ? prioU(u, c.flag, "confusion") : 0.5 * FP.type.confusion * FP.conf[c.flag]), _: { c } });
  }
  for (const r of misc) if ((r.flag === "likely" || r.flag === "sure") && !absorbed.has(r.m)) {
    const mm = (ctx.misc || {})[r.m] || {}, u = S.all.get("k:" + mm.kc) || null;
    cands.push({ type: "misc", conf: r.flag, u, items: new Set(r.hits.map(h => h.o.pid)), prio: (u ? prioU(u, r.flag, "misc") : 0.5 * FP.type.misc * FP.conf[r.flag]), _: { r } });
  }
  // 약한 단원 → 원인 (개념 공백 / 원인 확인 중), 개념(topic·kc)은 문제가 3개 이상일 때
  for (const u of units) {
    if (u.label !== "weak") continue;
    if (u.kind !== "chapter" && u.n < FP.kcItems) continue;
    const its = itemsOf(u);
    const inU = misc.filter(r => r.pM > 0.5 && r.hits.some(h => its.has(h.o.pid)));
    const hyp = inU.find(r => r.flag === "hyp");
    const s = unitStats(u, st, X);
    const type = hyp ? "misc" : inU.length ? "unclear" : (s.idk + s.miss >= 2 || s.scattered) ? "gap" : "unclear";
    cands.push({ type, conf: hyp ? "hyp" : null, u, items: its, prio: prioU(u, hyp ? "hyp" : null, type === "misc" ? "misc" : type), _: { s, r: hyp } });
  }
  // 약한 단원이 없을 때: 내 다른 단원보다 첫 풀이가 확실히 낮은 단원 (최대 2곳, 카드 이름 '상대적 약점')
  if (!cands.some(c => c.type === "gap" || c.type === "unclear" || (c.type === "misc" && c.conf === "hyp")))
    for (const r of (all.rels || []).slice(0, FP.rel.max)) cands.push({ type: "relative", conf: null, u: r.u, items: itemsOf(r.u), prio: FP.relative * r.p, _: { rel: r, s: unitStats(r.u, st, X) } });
  // 고친 문제 다시 확인
  if (rel.due.length >= FP.relearn_due) cands.push({ type: "relearn", conf: null, u: null, items: new Set(), prio: FP.relearn, _: {} });
  // 습관 + 맞히지만 오래 걸림 (fluency) + 문제 유형별 첫 풀이 차이 (format): 지식 진단이 아니라 '학습 습관 및 시간 메모'로
  const beh = hab.map(h => ({ type: "habit", conf: null, u: null, items: new Set(), prio: h.prio, beh: true, _: { h } }));
  if (all.fmt) beh.push({ type: "format", conf: null, u: null, items: new Set(), prio: FP.format * all.fmt.p, beh: true, _: { fmt: all.fmt } });
  for (const u of units) {
    if (!u.speed || u.speed.speed !== "slow" || (u.label !== "ok" && u.label !== "solid")) continue;
    if (u.kind !== "chapter" && u.n < FP.kcItems) continue;
    const ok = u.speed.rows.filter(r => !st.unsure.has(r.o.pid) && !r.o.assist);
    const its = new Set(ok.map(r => r.o.pid)), bl = new Set(ok.map(r => r.o.block));
    if (ok.length < u.speed.rows.length || its.size < P.time.fluency.items || bl.size < P.time.fluency.blocks) continue;
    beh.push({ type: "fluency", conf: null, u, items: itemsOf(u), prio: P.habit.prio.fluency * (1 + 0.5 * X.units.get(u.key).exam), beh: true, _: { sp: u.speed } });
  }
  const by = (a, b) => b.prio - a.prio || (a.u ? a.u.sort : 9e9) - (b.u ? b.u.sort : 9e9) || cmpStr(a.type, b.type);
  const prim = cands.sort(by), bh = beh.sort(by), pick = [];
  const overlap = (a, b) => {
    if (!a.u || !b.u) return false; if (a.u.key === b.u.key) return true;
    let n = 0; for (const p of a.items) if (b.items.has(p)) n++;
    return n >= FP.overlap * Math.min(a.items.size, b.items.size);
  };
  const free = c => !pick.some(p => overlap(p, c));
  let i = 0; const nextP = () => { while (i < prim.length) { const c = prim[i++]; if (free(c)) return c; } return null; };
  // 지식 쪽 결과만 위 카드(최대 FP.max)에: 착각·혼동 → 개념 공백 → 그 밖. 같은 순위 안에서는 우선도
  const byRank = (a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || by(a, b);
  prim.sort(byRank);
  for (let k = 0; k < FP.max; k++) { const c = nextP(); if (c) pick.push(c); }
  pick.sort(byRank);
  // 습관·속도·형식 메모: 서로 겹치지 않게 최대 3개 (계산은 그대로, 위 카드에는 넣지 않는다)
  const habs = []; for (const c of bh) if (habs.length < 3 && !habs.some(p => p.type === c.type && p.type !== "habit" && overlap(p, c))) habs.push(c);
  const strong = units.filter(u => u.label === "solid" && !pick.some(c => c.u && overlap(c, { u, items: itemsOf(u) })))
    .sort((a, b) => b.cur.pHigh - a.cur.pHigh || b.cur.Em - a.cur.Em || a.sort - b.sort).slice(0, 2);
  const pending = units.filter(u => u.label === "pending" && u.n > 0).sort((a, b) => b.n - a.n || a.sort - b.sort).slice(0, 8);
  return { findings: pick, habits: habs, strong, pending, cands: prim.length + bh.length, beh: bh };
}

// ───────── 오늘의 복습 (SPEC §5.6) ─────────
export function buildPlan(findings, ctx, obs, P, Z = {}) {
  const X = prep(ctx, P), PL = P.plan, st = Z.st, T = Z.time || { tau: {} }, rel = Z.rel || { due: [] };
  const lastDay = new Map(); for (const o of obs) if (o.t) lastDay.set(o.pid, Math.max(lastDay.get(o.pid) ?? -1, o.day));
  const tried = pid => st.status.has(pid) || lastDay.has(pid);
  const secOf = pid => { const I = X.items.get(pid); if (!I) return 60; const b = T.bOf ? T.bOf(I) : I.beta; if (b == null) return PL.cap_s; return Math.min(PL.cap_s, Math.exp(b - (T.tau[I.it.kind] || 0))); };
  const pc = (I, th) => I.g + (1 - I.g) * sig(th - I.d);
  const pubIn = u => X.units.get(u.key).pids.map(p => X.items.get(p)).filter(I => I && I.pub);
  const essayOnly = u => [...X.units.get(u.key).kinds].every(k => k === "essay");
  const KP = { short: 0, mc: 1, ox: 2, essay: 3 };
  const steps = [];
  const step = (f, type, title, pids, read, extra) => {
    if (!pids.length && !read) return;
    const s = { id: "P" + (steps.length + 1), type, title: title(pids.length), scope: "Q:" + pids.join("."), n: pids.length, read: read || null, ...extra };
    steps.push(s); if (f) f.plan = s.id;
  };
  for (const f of findings) {
    const u = f.u, now = Z.nowDay;
    if (f.type === "gap" || f.type === "relative" || f.type === "unclear" || (f.type === "misc" && f.conf === "hyp")) {
      // 같은 단원에서 안 푼 문제 또는 아직 못 맞힌 문제 (하루 이상 지난 것)
      const th = u.cur.mean, L = pubIn(u).filter(I => (I.it.kind !== "essay" || essayOnly(u)) && !shownSt(st.status.get(I.pid)));
      const ok = I => !tried(I.pid) || now - (lastDay.get(I.pid) ?? now) >= 1;
      if (f.type === "gap" || f.type === "relative") {
        // 틀린 문제가 몰린 개념(topic)의 문제를 먼저, 그다음 맞힐 만한 난이도 순
        const W = f.type === "gap" ? (f._.s && f._.s.wrong) || [] : u.rows.map(([o]) => o).filter(o => o.init && (o.y < 0.5 || o.idk));
        const tw = new Map(); for (const o of W) if (o.I.it.topic) tw.set(o.I.it.topic, (tw.get(o.I.it.topic) || 0) + 1);
        const rel = I => tw.get(I.it.topic) || 0;
        const [lo, hi] = PL.band, dist = I => { const p = pc(I, th); return p < lo ? lo - p : p > hi ? p - hi : 0; };
        const pick = L.filter(ok).sort((a, b) => rel(b) - rel(a) || dist(a) - dist(b) || KP[a.it.kind] - KP[b.it.kind] || (tried(a.pid) ? 1 : 0) - (tried(b.pid) ? 1 : 0) || a.pid - b.pid).slice(0, PL.gap_n).map(I => I.pid);
        const ch = u.ch, hasC = ctx.hasConcept && ctx.hasConcept.has(ch);
        let read = { chapter: ch, pid: null };
        if (!hasC) {   // 먼저 읽을 풀이: 첫 시도에 맞힌(정답이 보이는) 문제, 틀린 개념 쪽을 먼저
          const lastOk = u.rows.map(([o]) => o).filter(o => o.src === "first" && o.y === 1 && o.t && shownSt(st.status.get(o.pid)) && X.items.get(o.pid).it.body.s)
            .sort((a, b) => rel(b.I) - rel(a.I) || b.t - a.t || a.pid - b.pid)[0];
          read = { chapter: ch, pid: lastOk ? lastOk.pid : null };
        }
        f._.read = read;
        step(f, f.type, n => `${hasC ? "핵심 정리 읽고 " : read.pid ? "맞힌 문제 풀이 하나 읽고 " : ""}${n}문제${!hasC && !read.pid ? " · 풀고 나서 해설 읽기" : ""}`, pick, hasC || read.pid ? read : null);
      } else {
        const pick = L.filter(I => !tried(I.pid)).sort((a, b) => info(th, b.d, b.g) - info(th, a.d, a.g) || a.pid - b.pid).slice(0, PL.diag_n).map(I => I.pid);
        step(f, "diag", n => `확인용 ${n}문제`, pick.length ? pick : L.filter(ok).slice(0, PL.diag_n).map(I => I.pid), null);
      }
    } else if (f.type === "misc" || f.type === "confusion") {
      const ms = f.type === "misc" ? new Set([f._.r.m]) : new Set(f._.c.ms), offer = [];
      for (const I of [...X.items.values()].filter(I => I.pub)) {
        const t = diagOf(ctx, I.pid, I.it.v, I); if (!t || !t.diag) continue; const d = t.diag;
        if (Object.values(d.opt || {}).some(x => x && ms.has(x.m) && x.d >= 2) || (d.ox && (ms.has(d.ox.m) || ms.has(d.ox.mr)) && d.ox.d >= 2) || (d.short || []).some(x => ms.has(x.m) && x.d >= 2)) offer.push(I.pid);
      }
      const hits = [...new Set((f._.r || f._.c).hits.map(h => h.o.pid))].filter(p => now - (lastDay.get(p) ?? now) >= 1);
      const fresh = offer.filter(p => !tried(p)).slice(0, f.type === "misc" ? 3 : 6);
      step(f, f.type === "misc" ? "misc" : "contrast", n => f.type === "misc" ? `같은 함정, 다른 문제 · ${n}문제` : `섞어서 풀기 · ${n}문제`, [...fresh, ...hits].slice(0, 6), null);
    } else if (f.type === "relearn") {
      step(f, "relearn", n => `고친 문제 다시 확인 · ${n}문제`, rel.due.slice(0, 6), null);
    } else if (f.type === "fluency") {
      const sp = f._.sp, ref = new Map(sp.rows.map(r => [r.o.pid, r.ex]));
      const L = pubIn(u).filter(I => I.it.kind !== "essay" && I.beta != null && ((st.status.get(I.pid) === "correct" || st.status.get(I.pid) === "resolved") ? Z.nowDay - (lastDay.get(I.pid) ?? Z.nowDay) >= 1 : !tried(I.pid)));
      const [a, b] = PL.timed, pick = L.sort((x, y) => (ref.has(y.pid) ? 1 : 0) - (ref.has(x.pid) ? 1 : 0) || x.pid - y.pid).slice(0, b);
      if (pick.length >= a) {
        const target = pick.map(I => clamp(Math.round(ref.get(I.pid) || Math.exp((T.bOf ? T.bOf(I) : I.beta) - (sp.ref[I.it.kind] ?? T.tau[I.it.kind] ?? 0))), 5, 180));
        step(f, "timed", n => `시간 재고 풀기 · ${n}문제 · 문제당 약 ${med(target)}초`, pick.map(I => I.pid), null, { target_s: target });
      }
    } else if (f.type === "habit" && (f._.h.id === "hasty" || f._.h.id === "fb_skip")) {
      const ev = [...new Set(f._.h.evidence.map(o => o.pid))];
      const L = f._.h.id === "hasty" ? ev.filter(p => st.status.get(p) !== "correct" && st.status.get(p) !== "resolved") : ev.filter(p => Z.nowDay - (lastDay.get(p) ?? Z.nowDay) >= 1);
      const chs = new Set(f._.h.evidence.map(o => o.ch));
      const more = f._.h.id === "hasty" ? [...X.items.values()].filter(I => I.pub && chs.has(I.it.ch) && !tried(I.pid) && I.it.kind !== "essay").sort((a, b) => a.pid - b.pid).map(I => I.pid) : [];
      step(f, "redo", n => f._.h.id === "hasty" ? `천천히 다시 풀기 · ${n}문제` : `해설 읽고 다시 풀기 · ${n}문제`, [...L, ...more].slice(0, 5), null);
    } else if (f.type === "habit" && f._.h.id === "ox_bias") {
      // 안 푼 O/X 진술을, 치우침이 많이 나온 단원부터 (진술마다 바뀐 곳을 짚어 보며)
      const nc = new Map(); for (const o of f._.h.evidence) nc.set(o.ch, (nc.get(o.ch) || 0) + 1);
      const chs = [...nc].sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0])).map(x => x[0]);
      const pick = chs.flatMap(c => [...X.items.values()].filter(I => I.pub && I.it.ch === c && I.it.kind === "ox" && !tried(I.pid)).sort((a, b) => a.pid - b.pid)).slice(0, 6).map(I => I.pid);
      step(f, "drill", n => `O/X ${n}문제 · 바뀐 곳 짚고 풀기`, pick, null);
    } else if (f.type === "format") {
      // 약한 유형의 안 푼 문제 · 아직 못 맞힌 문제 (하루 지난 것): 많이 푼 단원부터, 서술형은 2문제까지
      const W = f._.fmt.weak, seenCh = new Map(); for (const o of obs) seenCh.set(o.ch, (seenCh.get(o.ch) || 0) + 1);
      const L = [...X.items.values()].filter(I => I.pub && W.includes(I.it.kind) && seenCh.has(I.it.ch) && (!tried(I.pid) || (!shownSt(st.status.get(I.pid)) && now - (lastDay.get(I.pid) ?? now) >= 1)))
        .sort((a, b) => (tried(a.pid) ? 1 : 0) - (tried(b.pid) ? 1 : 0) || (seenCh.get(b.it.ch) || 0) - (seenCh.get(a.it.ch) || 0) || a.pid - b.pid);
      const by = W.map(k => L.filter(I => I.it.kind === k)), pick = [];   // 유형마다 돌아가며 4문제
      for (let r = 0; pick.length < 4 && by.some(x => x.length > r); r++) for (const x of by) { const I = x[r]; if (I && pick.length < 4 && !(I.it.kind === "essay" && r >= 2)) pick.push(I.pid); }
      const names = W.map(k => KN[k]).join("·"), write = W.every(k => k === "short" || k === "essay");
      step(f, "format", n => write ? `${names} ${n}문제 직접 써 보기` : `${names} ${n}문제`, pick, null);
    }
  }
  // 오늘 묶음: 다시 확인(≤3) → 단계 순서, 12문제·15분 안에서
  const fat = findings.some(f => f.type === "habit" && f._.h.id === "fatigue");
  const budget = (fat ? Math.min(PL.minutes, P.time.fatigue.late) : PL.minutes) * 60, today = [];
  let sec = 0;
  const add = pid => { if (today.includes(pid) || today.length >= PL.items) return; const s = secOf(pid); if (today.length && sec + s > budget) return; today.push(pid); sec += s; };
  rel.due.slice(0, PL.relearn_n).forEach(add);
  for (const s of steps) for (const p of s.scope.slice(2).split(".").filter(Boolean).map(Number)) add(p);
  return { today: { pids: today, minutes: Math.max(today.length ? 1 : 0, Math.ceil(sec / 60)) }, steps };
}

// ───────── 글 만들기 (SPEC §5.7): 문제마다 다른 내용으로 ─────────
const TRAP = /함정|주의|헷갈|혼동/;              // '아니'·'오답'처럼 아무 문장에나 나오는 말은 쓰지 않는다
const ORD = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째"], CIRC = "①②③④⑤⑥";
function sentences(s) {
  const keep = [], t = s.replace(/\\\(.*?\\\)|\\\[.*?\\\]/g, m => `\u0000${keep.push(m) - 1}\u0000`);
  return t.split(/(?<=[.!?])\s+/).map(x => x.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]).trim()).filter(Boolean);
}
const JOSA = /(으로|에서|에게|까지|부터|처럼|보다|이다|하는|하게|하고|하여|해서|이며|이고|은|는|이|가|을|를|의|에|와|과|도|만|로|한|된|인)$/;
const stems = t => new Set((strip(t).replace(TEX, " ").match(/[가-힣A-Za-z0-9]{2,}/g) || []).map(w => w.replace(JOSA, "")).filter(w => w.length >= 2));
/** 고른 답에 맞는 함정 문장. 객관식: ① 그 보기를 가리키는 문장(둘째 보기·③·(C)) ② 그 보기에만 있는 낱말을 2개 이상 담은 문장 ③ 바른 진술(fix).
 *  O/X·단답: 바른 진술(fix), 없으면 '함정·주의·헷갈·혼동' 문장. 맞는 문장이 없으면 "" (엉뚱한 해설 문장을 함정이라 보이지 않게) */
function trapOf(b, o, cap = 160) {
  const S = sentences(strip(b.s)), fix = b.fix ? cutTex("바른 진술: " + strip(b.fix), cap) : "";
  if (o && o.kind === "mc") {
    const i = o.optRaw; if (i == null || !Array.isArray(b.opts) || b.opts[i] == null) return fix;
    const L = LET[i], M = [`[(（]${L}[)）]`, `보기\\s*${L}(?![A-Za-z])`, `(?<![A-Za-z])${L}\\s*보기`];
    if (ORD[i]) M.push(`${ORD[i]}\\s*(보기|선택지|는|은|번)`); if (CIRC[i]) M.push(CIRC[i]);
    const mark = new RegExp(M.join("|"));
    let x = S.find(t => mark.test(t)); if (x) x = x.slice(mark.exec(x).index);    // 그 보기를 가리킨 자리부터 문장 끝까지
    if (!x && o.same !== false) {
      const others = new Set(b.opts.flatMap((t, j) => (j === i ? [] : [...stems(t)]))), mine = [...stems(b.opts[i])].filter(w => !others.has(w));
      const best = S.map(t => [t, mine.filter(w => t.includes(w)).length]).filter(z => z[1] >= 2).sort((p, q) => q[1] - p[1])[0];
      x = best && best[0];
    }
    return x ? cutTex(x, cap) : fix;
  }
  if (fix) return fix;
  const x = S.find(t => TRAP.test(t));
  return x ? cutTex(x, cap) : "";
}
/** 칩 글 길이 한도 (보이는 길이, 수식은 ⅓로 셈 — 계약: stem ≤120 · chosen_text ≤80) */
const CAPS = { stem: 120, opt: 80, trap: 160 };
function chipOf(o, st, role, extra = {}) {
  const I = o.I, b = I.it.body || {}, hid = !shownSt(st.status.get(o.pid)), kind = o.kind, i = o.optRaw, C = CAPS;
  let chosen = "", label, ct = "";
  if (o.idk || o.lidk) { chosen = label = ct = "모르겠어요"; }
  else if (o.src === "essay_pt") label = `핵심 ${o.miss}/${o.np} 빠짐${o.part ? ` · 부분 ${o.part}` : ""}`;
  else if (kind === "mc" && i != null) { chosen = LET[i]; label = `${LET[i]} 고름`; if (o.same && Array.isArray(b.opts) && b.opts[i] != null) ct = cutTex(strip(b.opts[i]), C.opt); }
  else if (kind === "ox" && i != null) { chosen = ct = i ? "O" : "X"; label = chosen + "라고 답함"; }
  else if (kind === "short" && (o.answer || o.txt)) { chosen = ct = cutTex(o.answer || o.txt, C.opt); label = `'${cut(chosen, 16)}'${ida(chosen)} 씀`; }
  else if (kind === "essay") label = o.y ? "직접 채점 · 맞음" : "직접 채점 · 틀림";
  else label = o.src === "legacy" ? (o.y ? "예전 기록 · 맞힘" : "예전 기록 · 틀림") : o.y ? "맞힘" : "틀림";
  if (st.star && st.star.has(o.pid)) label += " · ☆ 담아 둠";
  if (o.assist) label += " · AI 도움";
  return { id: "", pid: o.pid, ext: I.it.ext, ch: I.it.ch, kind, chosen, label, hidden: hid, day: mdDay(o.day), fast: !!o.fast, role,
    stem: cutTex(strip(b.q || b.stem), C.stem), chosen_text: ct, trap: hid || role === "slow" ? "" : trapOf(b, o, C.trap), ...extra };
}
const eun = w => (jong(w) ? "은" : "는"), pct = x => Math.round(x * 100);
const subj = u => (u.kind === "chapter" ? `${QN(u)}의 개념이` : `${QN(u)}이`);       // '…' 단원의 개념이 / '…' 개념이 (개념의 개념 X)
const QUAL = /항상|모든|모두|반드시|오직|뿐|절대|결코|언제나|전혀|유일/;
/** 결과 카드마다 진단 문장·근거 칩 (결정적, 숫자는 모두 엔진이 센 값) */
export function composeText(findings, ctx, Z = {}) {
  const st = Z.st, rel = Z.rel || { due: [], resolved: 0, confirmed: 0, retried: 0, info: new Map() }, now = Z.nowDay ?? 0, taken = new Set();   // taken: 앞선 카드의 근거 문제 (고친 문제 카드에서 되풀이하지 않는다)
  for (const f of findings) {
    const u = f.u, t = { diag: "", truth: "", contrast: "", cue: "", signals: "" }; let ev = [], avoided = 0;
    if (f.type === "gap" || f.type === "unclear") {
      const s = f._.s, parts = signalParts(s), P2 = parts.slice(0, 2).map(p => p.txt), nW = s.wrong.length, hasC = ctx.hasConcept && ctx.hasConcept.has(u.ch);
      t.signals = parts.slice(f.type === "gap" ? 2 : 0).map(p => p.txt).join(" · ");   // 앞의 두 신호는 진단 문장에 이미 있다
      if (f.type === "gap") {
        const rd = f._.read && f._.read.pid, F = s.first, mix = u.kind === "chapter" && (ctx.chapters || []).some(c => c.key === u.ch && c.grp);   // 기출·모의고사 묶음
        let wk = null; if (F) for (const k of Object.keys(F.by)) { const b = F.by[k]; if (b.n >= 4 && b.c / b.n <= 0.5 && (!wk || b.c / b.n < F.by[wk].c / F.by[wk].n)) wk = k; }
        t.diag = mix ? `${QN(u)}에서 막혀요${P2.length ? ": " + P2.join(", ") : ""}.` : `${subj(u)} 아직 잡히지 않은 것 같아요${P2.length ? ": " + P2.join(", ") : ""}.`;
        t.cue = wk ? `${KN[wk]} ${F.by[wk].c}/${F.by[wk].n}${s.conc ? `: ${s.conc.names.join("·")} ${KN[wk]}` : ""}부터 해설을 덮고 풀이 과정을 적어 가며 풀기`
          : hasC ? "핵심 정리를 먼저 읽고, 해설을 덮은 채 문제 풀기"
          : rd ? `맞힌 문제의 풀이를 먼저 다시 읽고, 같은 ${u.kind === "chapter" ? "단원" : "개념"} 문제를 해설 없이 풀기`
          : "해설을 덮고 먼저 풀어 본 뒤, 틀리면 해설에서 막힌 곳 한 줄을 찾아 읽기";
        f.head = `${QN(u)}에서 막혀요${P2.length ? ": " + P2.join(" · ") : ""}.`;
      } else {
        const dom = Math.max(s.nFO, s.nTX, s.mc.length, s.short.length);
        if (s.nFO >= 2 && s.nFO === dom) {
          t.diag = `${QN(u)}에서 O라고 답한 거짓 진술이 ${s.nFO}개예요. 진술 속 바뀐 조건을 놓치는 것일 수 있어요.`;
          t.cue = "O를 누르기 전에 진술에서 바뀔 수 있는 곳(조건·방향·한정어)을 하나 짚기";
        } else if (s.nTX >= 2 && s.nTX === dom) {
          t.diag = `${QN(u)}에서 맞는 진술 ${s.nTX}개를 X라고 답했어요. 정의를 정확히 기억하지 못해 의심하는 것일 수 있어요.`;
          t.cue = "X를 고를 땐 어디가 틀렸는지 한 단어로 짚을 수 있을 때만 고르기";
        } else if (s.mc.length >= 2 && s.mc.length === dom) {
          t.diag = `${QN(u)}의 객관식 ${s.mc.length}문제에서 오답을 골랐어요. 그럴듯한 보기에 끌리는 것일 수 있어요.`;
          t.cue = "고르기 전에 남은 보기가 왜 틀렸는지 한 줄씩 말해 보기";
        } else if (s.short.length >= 2 && s.short.length === dom) {
          const exs = s.short.slice(0, 2).map(o => `'${cut(o.answer || o.txt, 12)}'`).join(", ");
          t.diag = `${QN(u)}의 단답 ${s.short.length}문제를 틀렸어요(${exs}). 공식·계산 단계에서 막히는 것일 수 있어요.`;
          t.cue = "답을 쓰기 전에 쓸 공식을 먼저 적고 단위·부호 확인하기";
        } else {
          t.diag = `${QN(u)}에서 틀린 ${nW}문제의 원인이 아직 한 가지로 모이지 않아요${P2.length ? ` (${P2.join(", ")})` : ""}.`;
          t.cue = "확인용 문제로 어디서 막히는지 먼저 가려 보기";
        }
        f.head = t.diag.split(". ")[0].replace(/\.$/, "") + ".";
      }
      ev = chipsBySignal(s.wrong, parts, 5).map(o => chipOf(o, st, o.idk || o.lidk ? "idk" : "wrong"));
    } else if (f.type === "relative") {
      const r = f._.rel, s = f._.s, parts = signalParts(s), other = u.kind === "chapter" ? "단원" : "개념";
      t.diag = `${QN(u)}${eun(QN(u))} 다른 ${other}보다 첫 풀이 정답률이 낮아요 · ${pct(r.c / r.n)}% (평균 ${pct(r.avg)}%). 약하다고 단정할 정도는 아니지만, 문제 유형·난이도를 감안해도 내 평소보다 낮아요.`;
      t.signals = parts.map(p => p.txt).join(" · ");
      t.cue = f._.read && f._.read.pid ? `맞힌 문제의 풀이를 다시 읽고, 같은 ${other}의 안 푼 문제를 해설 없이 풀어 보기` : `같은 ${other}의 안 푼 문제를 해설을 덮고 풀어 보기`;
      f.head = `${QN(u)}의 첫 풀이 정답률이 다른 ${other}보다 낮아요 (${pct(r.c / r.n)}% · 평균 ${pct(r.avg)}%).`;
      ev = chipsBySignal(s.wrong, parts, 4).map(o => chipOf(o, st, o.idk || o.lidk ? "idk" : "wrong"));
      f.n = r.n;
    } else if (f.type === "format") {
      const F = f._.fmt, raw = k => F.by[k].c / F.by[k].n, S = F.strong, W = F.weak;
      const sc = S.reduce((a, k) => a + F.by[k].c, 0), sn = S.reduce((a, k) => a + F.by[k].n, 0), sN = S.map(k => KN[k]).join("·");
      const write = W.every(k => k === "short" || k === "essay"), recall = write && S.every(k => k === "ox" || k === "mc");
      const wk = W.filter(k => k !== "essay"), E = W.includes("essay") && F.by.essay.es, many = W.every(k => raw(k) < 0.65);
      const eTxt = !E ? "" : !E.tried ? `서술형 ${F.by.essay.n}개는 모두 '모르겠어요'로 넘겼어요.`    // 서술형은 %로 뭉뚱그리지 않는다
        : `서술형은 ${F.by.essay.n}개 중 ${E.idk ? `${E.idk}개를 '모르겠어요'로 넘겼고${E.quick ? `(${E.quick}개는 ${F.qs}초 안에)` : ""}, 써 본 ${E.tried}개 중 ` : ""}완전히 맞힌 건 ${E.full}개예요${E.partial ? ` (부분 점수 ${E.partial}개)` : ""}.`;
      t.diag = `${sN}${eun(sN)} ${sc / sn >= 0.85 ? `대부분 맞히는데(${pct(sc / sn)}%)` : `${pct(sc / sn)}% 맞히는데`}${wk.length ? ` ${wk.map(k => `${KN[k]}(${pct(raw(k))}%)`).join("·")}에서 ${many ? "많이" : "더 자주"} 틀려요.` : ""}${eTxt ? " " + eTxt : ""}${recall ? " 알아보는 건 되는데 떠올려 쓰기가 약해요." : ""}`;
      t.signals = KO.filter(k => F.by[k]).map(k => `${KN[k]} 첫 풀이 ${F.by[k].c}/${F.by[k].n}${F.by[k].idk ? ` ('모르겠어요' ${F.by[k].idk})` : ""}`).join(" · ");
      t.cue = write ? "답을 보기 전에 핵심어를 먼저 떠올려 적고, 그다음 해설·채점과 비교하기" : "고르기 전에 남은 보기·진술이 왜 틀렸는지 한 줄씩 말해 보기";
      f.head = t.diag.replace(/ 알아보는 건.*$/, "");
      const byK = W.map(k => F.wrong.filter(o => o.kind === k).sort((a, b) => (shownSt(st.status.get(b.pid)) ? 1 : 0) - (shownSt(st.status.get(a.pid)) ? 1 : 0) || b.day - a.day || a.pid - b.pid));
      const pk = []; for (let r = 0; pk.length < 4 && byK.some(x => x.length > r); r++) for (const x of byK) if (x[r] && pk.length < 4) pk.push(x[r]);
      ev = pk.map(o => chipOf(o, st, o.idk || o.lidk ? "idk" : "wrong"));
      f.n = KO.filter(k => F.by[k] && F.by[k].n >= 0).reduce((a, k) => a + F.by[k].n, 0);
    } else if (f.type === "misc" || f.type === "confusion") {
      const r = f._.r || f._.c, M = ctx.misc || {}, m = f.type === "misc" ? M[r.m] || {} : M[f._.c.ms[0]] || {};
      const hyp = f.conf === "hyp";
      t.diag = m.belief ? `'${m.belief}'${ida(m.belief)} 보고 있${hyp ? "을 수 있어요" : "어요"}.` : `같은 함정 보기를 ${new Set(r.hits.map(h => h.o.pid)).size}문제에서 골랐어요.`;
      t.truth = m.truth || ""; t.contrast = m.contrast || ""; t.cue = m.cue || "";
      ev = r.hits.map(h => chipOf(h.o, st, "hit")).slice(0, 5);
      avoided = new Set(r.avoided.map(a => a.o.pid)).size;
      if (f.type === "confusion") f.with = { code: f._.c.b, name: ((ctx.kc || {})[f._.c.b] || {}).name || f._.c.b };
      f.head = `${m.belief ? `'${cut(m.belief, 40)}'라는 착각이` : "같은 함정이"} ${new Set(r.hits.map(h => h.o.pid)).size}문제에서 반복돼요.`;
    } else if (f.type === "relearn") {
      const I = rel.info || new Map(), due = rel.due, notRe = due.filter(p => { const x = I.get(p); return x && !x.unsure && !x.conf; }).length;
      t.diag = rel.retried ? `틀렸다가 맞혀서 고친 문제 ${rel.resolved}개 중, 다른 날 다시 풀어 본 건 ${rel.retried}개예요 (그중 ${rel.confirmed}개 맞힘).${notRe ? ` 아직 다시 풀어 보지 않은 문제가 ${notRe}개 남았어요.` : ""}`
        : `틀렸다가 맞혀서 고친 문제 ${rel.resolved}개 중, 다른 날 다시 풀어 본 건 아직 없어요. 다시 풀어 볼 문제가 ${notRe || due.length}개예요.`;
      const ages = due.map(p => I.get(p)).filter(x => x && x.lastWrong != null).map(x => now - x.lastWrong);
      t.signals = `다시 확인할 차례 ${due.length}문제${rel.star ? ` (☆로 담아 둔 ${rel.star}문제 포함)` : ""}${rel.asked ? ` (AI에게 물어본 ${rel.asked}문제 포함)` : ""}${rel.guessed ? ` · 틀린 직후 보기를 바로 바꿔 맞힌 ${rel.guessed}문제 포함` : ""}${ages.length && Math.max(...ages) >= 7 ? ` · 가장 오래된 건 ${Math.max(...ages)}일 전에 고쳤어요` : ""}${due.length > 6 ? " · 오래된 것부터 6개씩" : ""}`;
      const n3 = ages.filter(a => a <= 3).length, n7 = ages.filter(a => a >= 7).length;
      t.cue = ages.length && n3 * 2 > ages.length ? "어제·그제 고친 문제는 해설을 보기 전에 먼저 풀어 보고, 맞히면 며칠 뒤 한 번 더"
        : ages.length && n7 * 2 > ages.length ? "오래전에 고친 문제부터 해설 없이 다시 풀어 보고, 틀린 것만 다음 날 한 번 더"
        : "해설을 보기 전에 먼저 풀고, 맞히면 며칠 뒤 한 번 더 확인";
      const byP = Z.byP, info = o => (o.optRaw != null || o.txt ? 1 : 0), wr = pid => (byP.get(pid) || []).filter(o => o.y === 0).sort((a, b) => info(b) - info(a) || a.day - b.day)[0];
      const fresh = due.filter(p => !taken.has(p));            // 위 카드에 이미 나온 문제는 되도록 빼고
      ev = [...(fresh.length >= 2 ? fresh : due).slice(0, 6)].sort((a, b) => { const x = wr(a), y = wr(b); return (y ? info(y) : 0) - (x ? info(x) : 0); })
        .slice(0, 4).map(pid => { const o = wr(pid); if (!o) return null; const c = chipOf(o, st, "miss"); if (o.src === "legacy") c.label = "예전에 틀림 → 고침"; if ((I.get(pid) || {}).guessed) c.label += " · 바로 바꿔 맞힘"; return c; }).filter(Boolean);
      f.n = rel.resolved;
      f.head = t.diag.split(". ")[0].replace(/\.$/, "") + ".";
    } else if (f.type === "fluency") {
      const sp = f._.sp, rows = [...sp.rows].sort((a, b) => b.sec / b.ex - a.sec / a.ex || a.o.pid - b.o.pid);
      const e = Math.round(med(sp.rows.map(r => r.ex))), a = Math.round(med(sp.rows.map(r => r.sec)));
      t.diag = `${QN(u)}은 맞히고 있지만 비슷한 길이의 문제보다 ${r1(sp.ratio)}배 오래 걸려요 (맞힌 ${sp.n}문제, 내 예상 ${e}초 → 실제 ${a}초).`;
      t.cue = "시험에서는 시간이 점수예요. 목표 시간 안에 답을 정하고, 넘으면 표시하고 넘어가기.";
      ev = rows.slice(0, 3).map(r => chipOf(r.o, st, "slow", { sec: r1(r.sec), rel: r1(r.sec / r.ex) }));
      f.head = `${QN(u)}은 맞히지만 평소의 ${r1(sp.ratio)}배 오래 걸려요.`;
    } else if (f.type === "habit") {
      const h = f._.h, s = h.stats; f.habit = h.id;
      let EV = [...new Map(h.evidence.map(o => [o.pid, o])).values()].sort((a, b) => b.day - a.day || a.pid - b.pid);
      if (h.id === "ox_bias") {
        EV.sort((a, b) => (shownSt(st.status.get(b.pid)) ? 1 : 0) - (shownSt(st.status.get(a.pid)) ? 1 : 0) || b.day - a.day || a.pid - b.pid);   // 해설을 볼 수 있는 것부터
        t.signals = `참인 진술에 O ${s.hO}/${s.nT} · 거짓 진술에 O ${s.fO}/${s.nF}`;
      }
      if (h.id === "ox_bias" && s.dir === "accept") {
        t.diag = `거짓 진술 ${s.nF}개 중 ${s.fO}개를 O라고 답했어요 (참인 진술은 ${s.nT - s.hO ? `${s.nT}개 중 ${s.nT - s.hO}개만 X` : `${s.nT}개 모두 O`}).`;
        // 무엇이 바뀐 진술이었는지 (바른 진술 fix가 짧은 용어 → 용어·분류 바꿔치기, 한정어가 든 진술 → 한정어)
        //   (아직 못 맞힌 문제의 바른 진술은 길이로도 쓰지 않는다: 해설을 볼 수 있는 문제만)
        const SH = EV.filter(o => shownSt(st.status.get(o.pid)));
        const nQ = SH.filter(o => QUAL.test(strip(o.I.it.body.q))).length, nT = SH.filter(o => o.I.it.body.fix && strip(o.I.it.body.fix).length <= 25 && !QUAL.test(strip(o.I.it.body.q))).length;
        t.cue = nT >= 2 && nT >= nQ ? "O를 누르기 전에 진술 속 용어·분류가 제자리에 짝지어졌는지 하나씩 짚기 (바뀐 낱말 하나 찾기)"
          : nQ >= 2 ? "O를 누르기 전에 '모든·항상·만' 같은 한정어가 맞는지 먼저 보기"
          : "O를 누르기 전에 진술의 용어·분류·범위 중 바뀐 곳이 있는지 하나 짚기";
      } else if (h.id === "ox_bias") {
        t.diag = `참인 진술 ${s.nT}개 중 ${s.nT - s.hO}개를 X라고 답했어요 (거짓 진술은 ${s.nF}개 중 ${s.nF - s.fO}개를 X).`;
        t.cue = "X를 고를 땐 어디가 틀렸는지 한 단어로 짚을 수 있는지 확인하기";
      } else if (h.id === "hasty") {
        t.diag = `평소보다 빨리 답한 문제에서 틀려요: 빠른 답 ${s.n}개 중 ${s.k}개 오답 (같은 난이도라면 ${r1(s.exp)}개 예상).${s.again ? ` 그중 ${s.again}문제는 다음 날 다시 맞혔어요.` : ""}`;
        t.cue = "답하기 전에 '항상·모든·만' 같은 조건어를 한 번 더 읽기";
      } else if (h.id === "rapid_wrong") {
        t.diag = `너무 빨리 고른 답 ${s.n}개 중 ${s.k}개가 틀렸어요 (천천히 푼 답은 ${pct(s.acc)}%가 정답).`;
        t.cue = "답을 누르기 전에 묻는 것(문제 끝 문장)을 한 번 더 읽기";
      } else if (h.id === "fb_skip") {
        t.diag = `틀린 뒤 해설을 ${s.sec}초 안에 넘긴 문제가 ${s.n}개 중 ${s.k}개예요.${s.re ? ` 그중 다시 푼 ${s.re}문제는 ${s.reOk}개만 맞혔어요.` : ""}`;
        t.cue = "틀리면 해설에서 함정 문장 하나를 찾아 읽고 넘어가기";
      } else if (h.id === "fatigue") {
        const L = P_LATE(Z);
        t.diag = `${L}분 넘게 이어서 풀면 정확도가 떨어져요: 처음 ${L}분 ${pct(s.early)}% → 그 뒤 ${pct(s.late)}% (${s.nb}번 중 ${s.worse}번의 학습에서).`;
        t.cue = `${Math.max(20, L - 5)}분쯤 풀면 5분 쉬고 이어 풀기`;
      } else if (h.id === "essay_skip") {
        t.diag = `서술형 ${s.n}개 중 ${s.k}개를 써 보지 않고 넘겼어요.`;
        t.cue = "모르면 아는 핵심어 하나라도 적고 채점 받아 보기 — 빠진 부분이 보여요";
      } else if (h.id === "qualifier") {
        t.diag = `'항상·모든·만' 같은 한정어가 바뀐 진술 ${s.k}개를 O라고 답했어요.`;
        t.cue = "한정어에 동그라미 치고 반례 하나 떠올리기";
      }
      const role = h.id === "hasty" || h.id === "rapid_wrong" ? "fast" : "wrong";
      f.n = h.id === "ox_bias" ? s.nT + s.nF : h.id === "fatigue" ? null : s.n;
      ev = EV.slice(0, 4).map(o => chipOf(o, st, role, role === "fast" && o.tt ? { sec: r1(o.tt / 1000), rel: o.exp ? r1(o.tt / 1000 / o.exp) : null } : {}));
      f.head = t.diag.split(": ")[0].replace(/ \(.*$/, "").replace(/\.$/, "") + ".";
      if (h.id === "ox_bias") f.head = (s.dir === "accept" ? "그럴듯한 거짓 진술에 O를 누르는 편이에요: " : "맞는 진술도 X로 의심하는 편이에요: ") + f.head;
    }
    f.text = t; f.ev = ev; f.avoided = avoided; ev.forEach(e => taken.add(e.pid));
    f.hidden_truth = !!(t.truth || t.contrast) && ev.length > 0 && ev.every(e => e.hidden);
    if (f.hidden_truth) t.truth = t.contrast = "";             // 아직 못 맞힌 문제뿐이면 바른 개념 글을 det에 싣지 않는다
  }
  return findings;
}
const P_LATE = Z => (Z.P ? Z.P.time.fatigue.late : 35);

/** 잘 맞히는 곳: 첫 풀이 10문제 이상이고, 정답률의 80% 구간 아래쪽이 75% 이상 (약함·낮은 편이 아닌 것만). 모델 라벨(solid)과 별개로 숫자만 본다 */
function goodUnits(S) {
  return [...S.all.values()].filter(u => u.acc && u.acc.n >= 10 && u.label !== "weak" && u.label !== "pending" && !u.watch)
    .map(u => ({ u, lo: accBand(u.acc.c, u.acc.n)[0] })).filter(x => x.lo >= 0.75)
    .sort((a, b) => b.lo - a.lo || b.u.acc.n - a.u.acc.n || a.u.sort - b.u.sort).slice(0, 4)
    .map(({ u }) => ({ code: u.code, name: u.name, kind: u.kind, c: u.acc.c, n: u.acc.n }));
}

// ───────── 잠김 상태: 지금 풀면 좋은 문제 ─────────
/** A = { def: 모자란 n_eff, w: 첫 풀이 한 문제의 무게, chNeed: 필요한 단원 수, chItems: 단원마다 필요한 문제 수, done: Map(단원 → 푼 문제 수) }
 *  → 열리는 데 필요한 만큼: 새 단원에서 chItems문제씩 + 모자란 n_eff를 채울 만큼 (O/X·객관식 먼저, 최대 12 · 한 번에 풀 수 있는 묶음 크기) */
function nextItems(X, st, obsP, th, A) {
  const by = new Map(), qk = I => (I.it.kind === "ox" || I.it.kind === "mc" ? 0 : 1);
  for (const I of X.items.values()) {
    if (!I.pub || st.status.has(I.pid) || obsP.has(I.pid) || I.it.kind === "essay") continue;
    (by.get(I.it.ch) || by.set(I.it.ch, []).get(I.it.ch)).push(I);
  }
  const done = A.done, dn = c => done.get(c) || 0, ord = c => (X.units.get("c:" + c) || {}).sort;
  for (const L of by.values()) L.sort((a, b) => qk(a) - qk(b) || info(th, b.d, b.g) - info(th, a.d, a.g) || a.pid - b.pid);
  const total = Math.min(12, Math.max(3, Math.ceil(A.def / A.w) + 1)), out = [], at = new Map();
  const take = c => { const I = (by.get(c) || [])[at.get(c) || 0]; if (!I) return false; at.set(c, (at.get(c) || 0) + 1); out.push(I.pid); return true; };
  const q = [...new Set([...done.keys()])].filter(c => dn(c) >= A.chItems).length;
  const open = [...by.keys()].filter(c => dn(c) < A.chItems && by.get(c).length >= A.chItems - dn(c)).sort((a, b) => dn(b) - dn(a) || ord(a) - ord(b));
  for (const c of open.slice(0, Math.max(0, A.chNeed - q))) for (let k = dn(c); k < A.chItems; k++) take(c);   // 단원 조건: 아직 3문제 안 푼 단원 가운데 가까운 곳부터 채운다
  const chs = [...by.keys()].sort((a, b) => dn(a) - dn(b) || ord(a) - ord(b));
  for (let r = 0; out.length < total && r < 12; r++) for (const c of chs) if (out.length < total) take(c);
  return out;
}

// ───────── v2: 세부 포인트 → det (ALGORITHM §8) ─────────
const LVN = { L1: "정의", L2: "적용", L3: "구별", L4: "조건" };
const lvOf = e => "L" + e.d;
/** depthModel 결과 → points·findings·probes. e: 지금까지 쓴 근거 칩 번호, nf: v1 카드 수 (id를 이어 붙인다) */
function depthDoc(DX, ctx, st, e, nf) {
  const V = ctx.v2, chips = new Map(), findings = [], probes = [];
  const chip = (x, role) => {                                // 같은 관찰은 칩 하나 (번호 하나)
    let c = chips.get(x.o); if (c) return c;
    c = { ...chipOf(x.o, st, role, { lv: lvOf(x), point: x.tag.facet }), id: "E" + ++e }; chips.set(x.o, c); return c;
  };
  const fam = pid => V.fam.get(pid) || {};
  const pathOf = F => [F.chTitle || "", F.kcName || F.kc || "", F.name || F.code];
  const points = DX.points.map(x => {
    const F = x.F || {}, d = x.dec;
    return { code: x.code, path: pathOf(F), statement: F.statement || "", state: d.state, tier: d.tier, sub: d.sub, kind: d.kind, why: d.why, depth: x.depth,
      ladder: x.ladder.map(L => ({ lv: L.lv, st: L.st, items: L.es.map(z => ({ pid: z.pid, ext: z.o.I.it.ext, ok: z.resp.r === "C" })) })),
      mis: x.mis, hidden_truth: false, n_items: x.n_items, probes: x.probes, need_variant: x.need_variant };
  });
  const byCode = new Map(points.map(p => [p.code, p]));
  // 카드로 올릴 것: 착각(확실 → 조심) → 덜 다져짐(세부 표시가 있는 것) → 확실히 앎. 최대 6장
  const rank = x => (x.dec.state === "illusion" ? (x.dec.tier === "firm" ? 0 : 2) : x.dec.state === "weak" ? (x.dec.sub ? 3 : 4) : x.dec.state === "solid" ? (x.dec.tier === "firm" ? 5 : 6) : 9);
  const cand = DX.points.filter(x => rank(x) < 9).sort((a, b) => rank(a) - rank(b) || b.n_items - a.n_items || (a.code < b.code ? -1 : 1)).slice(0, 6);
  for (const x of cand) {
    const d = x.dec, F = x.F || {}, name = F.name || x.code, E = x.E.filter(z => !z.second);
    const first = []; { const seen = new Set(); for (const z of E) if (!seen.has(z.pid)) { seen.add(z.pid); first.push(z); } }
    const link = [];                                           // [근거, 역할]
    if (d.state === "illusion" && d.kind === "misc") {
      for (const z of first) if (z.resp.r === "C" && !z.offer.has(d.m)) link.push([z, "base"]);
      const hits = E.filter(z => z.resp.r === "H" && z.resp.m === d.m && !z.legacy), hp = new Set();
      for (const z of hits) { link.push([z, hp.has(z.pid) ? "repeat" : "variant"]); hp.add(z.pid); }
    } else if (d.state === "illusion") {
      for (const z of first) if (z.resp.r === "C" && (fam(z.pid).role === "base" || fam(z.pid).role === "iso")) link.push([z, "base"]);
      for (const z of first) if (fam(z.pid).role === "near" && z.resp.r !== "C") link.push([z, "variant"]);
    } else if (d.state === "solid") for (const z of first.filter(z => z.resp.r === "C").sort((a, b) => b.d - a.d).slice(0, 4)) link.push([z, "base"]);
    else { for (const z of first.filter(z => z.resp.r === "C" && z.d <= 2).slice(0, 2)) link.push([z, "base"]); for (const z of first.filter(z => z.resp.r !== "C").sort((a, b) => b.d - a.d).slice(0, 4)) link.push([z, "variant"]); }
    const L = link.slice(0, 6), ev = L.map(([z, role]) => chip(z, role));
    const chain = L.map(([z, role], i) => ({ role, e: ev[i].id, ext: z.o.I.it.ext, lv: lvOf(z), chosen: ev[i].chosen, ok: z.resp.r === "C",
      text: ev[i].stem, why: z.resp.m && V.misc[z.resp.m] ? V.misc[z.resp.m].belief || "" : "", change: fam(z.pid).delta || "" }));
    const nb = L.filter(([, r]) => r === "base").length, nv = new Set(L.filter(([, r]) => r !== "base").map(([z]) => z.pid)).size;
    const mi = d.m ? V.misc[d.m] || {} : {}, belief = String(mi.belief || "").replace(/(이)?라고 생각함$|라고 생각함$|생각함$/, "").trim() || mi.belief || "";
    const lvMax = (a, ok) => { const z = a.filter(z => (z.resp.r === "C") === ok).sort((p, q) => (ok ? q.d - p.d : p.d - q.d))[0]; return z ? LVN[lvOf(z)] : ""; };
    let title, diag, head;
    if (d.state === "illusion" && d.kind === "misc" && d.tier === "firm") {
      title = "알고 있다고 착각하고 있어요";
      diag = `'${belief}'와 섞고 있어요. 서로 다른 ${nv}문제에서 같은 생각으로 골랐어요${nb ? ` (익숙한 형태 ${nb}문제는 맞혔어요)` : ""}.`;
      head = `${name}: 알고 있다고 착각하는 부분이 있어요.`;
    } else if (d.state === "illusion" && d.kind === "misc") {
      title = "확인해 볼 부분";
      diag = `'${belief}'로 보고 있을 수 있어요. ${nv}문제에서 이렇게 골랐어요. 아래 문제로 확인해 보세요.`;
    } else if (d.state === "illusion") {
      title = "알고 있다고 착각하고 있어요";
      const ch = [...new Set(chain.filter(c => c.role === "variant").map(c => c.change).filter(Boolean))].slice(0, 2).join(", ");
      diag = `익숙한 형태(${nb}문제)는 맞히는데, ${ch ? ch + "처럼 " : ""}살짝 바뀐 ${nv}문제에서 틀려요.`;
      head = `${name}: 익숙한 형태만 맞히고 바뀐 문제에서 틀려요.`;
    } else if (d.state === "solid") {
      title = d.tier === "firm" ? "확실히 알고 있어요" : "잘 아는 것 같아요";
      diag = d.tier === "firm" ? `확실히 알고 있어요. ${lvMax(first, true)} 문제까지 맞혔어요.` : "잘 아는 것 같아요. 한 문제만 더 확인해 볼까요?";
    } else {
      title = "더 다질 부분";
      diag = d.sub === "shallow" ? `${lvMax(first, true)}까지는 맞히는데 ${lvMax(first, false)}에서 막히는 것 같아요.` : d.sub === "gap" ? "아직 잡히지 않은 것 같아요." : "아직 덜 다져진 것 같아요.";
    }
    const truth = d.m ? mi.truth || "" : "", hidden = !!truth && ev.length > 0 && ev.every(c => c.hidden);
    const P = byCode.get(x.code); if (P) P.hidden_truth = hidden;
    if (P && hidden && P.mis) P.mis = { ...P.mis, truth: "" };
    findings.push({ id: "F" + (nf + findings.length + 1), type: d.state, tier: d.tier, sub: d.sub, kind: d.kind, point: x.code, conf: null,
      unit: { kind: "facet", code: x.code, name }, with: null, ...(d.m ? { m: d.m } : {}),
      text: { title, diag, truth: hidden ? "" : truth, cue: mi.cue || "", contrast: "" }, hidden_truth: hidden, chain, evidence: ev,
      avoided: 0, n_items: x.n_items, plan: x.probes.length ? { pids: x.probes.map(p => p.pid) } : null, head: head || null });
  }
  for (const x of DX.points) if (x.probes.length) probes.push({ point: x.code, reason: x.probes[0].reason, pids: x.probes.map(p => p.pid), scope: "Q:" + x.probes.map(p => p.pid).join(".") });
  return { points, findings, probes, excluded: DX.excluded, need: DX.need, raw: DX.points, e };
}

// ───────── 리포트 한 장 (SPEC §6, Contract 4) ─────────
/** dbg(선택): 객체를 주면 중간 결과(hab, S, T, sel)를 채워 준다 (시험·관리자 미리보기용, det에는 영향 없음) */
export function buildReport(raw, ctx, P, nowDay, dbg) {
  const X = prep(ctx, P), G = P.gate;
  const N = normalize(raw, ctx, P, nowDay);
  const aux = joinAux(N.obs, raw, P);
  const T = timeModel(N.obs, raw, P);
  const keptObs = N.obs.filter(kept);
  const n_eff = keptObs.reduce((s, o) => s + o.w, 0);
  // 답 기록 수 (예전 기록 제외): 서술형 AI 채점은 포인트가 아니라 문제마다 한 번
  const evN = new Set(keptObs.filter(o => o.src !== "legacy" && o.src !== "legacy_fix").map(o => (o.src === "essay_pt" ? "g" + o.pid : o.pid + ":" + o.rid))).size;
  const chItems = new Map(); for (const o of keptObs) (chItems.get(o.ch) || chItems.set(o.ch, new Set()).get(o.ch)).add(o.pid);
  const nCh = [...chItems.values()].filter(s => s.size >= G.chItems).length;
  const status = new Map();
  for (const r of raw.progress || []) status.set(r.pid, r.status);
  const base = { v: 2, cid: ctx.cid, fp: raw.fp ?? null };
  // 결정 8: n_eff와 '3문제 이상 푼 단원 수'만으로 연다 (예전 기록 포함)
  if (n_eff < G.n_eff || nCh < G.chapters) {
    const obsP = new Set([...N.obs.map(o => o.pid), ...N.post.map(x => x.pid)]);
    return { ...base, state: "locked", have: { n_eff: r1(n_eff), events: evN, chapters: nCh }, need: { n_eff: G.n_eff, chapters: G.chapters },
      next: { pids: nextItems(X, { status }, obsP, 0, { def: Math.max(0, G.n_eff - n_eff), w: P.w.first || 1, chNeed: G.chapters, chItems: G.chItems, done: new Map([...chItems].map(([c, set]) => [c, set.size])) }) }, narr_state: "off" };
  }
  const choice = N.meta.choice >= G.choice;                  // 고른 답 기록이 충분할 때만 고른 답으로 만드는 진단
  const misc = choice ? misconceptions(N.obs, ctx, P) : [], conf = confusions(misc, ctx, P);
  const avoided = new Set(misc.flatMap(r => r.avoided.map(a => a.o.pid)));
  const repeat = new Map(); for (const r of misc) if (r.hits.length >= 2) for (const h of r.hits) repeat.set(h.o.pid, true);
  const st = { status, unsure: aux.unsure, star: aux.star, assisted: aux.assisted, avoided, choice, repeatM: u => u.rows.some(([o]) => repeat.has(o.pid)) };
  const lam = (P.time && P.time.srt) || 0;
  const S = scoreConcepts(N.obs, ctx, P, nowDay, lam);
  if (lam > 0) { const S0 = scoreConcepts(N.obs, ctx, P, nowDay, 0); labelUnits(S0, P, st); for (const [k, u] of S.all) u.lab0 = (S0.all.get(k) || {}).label; }
  labelUnits(S, P, st);
  for (const u of S.all.values()) u.speed = unitSpeed(u.key, T, P);
  const hab = habits(N.obs, N.post, ctx, P, { time: T, units: S, aux, nowDay, choice });
  const rel = relearning(N.obs, ctx, nowDay, { status, post: N.post, aux, X });
  const fmt = formats(N.obs, P), rels = relatives(S, N.obs, P).filter(r => r.u.kind === "chapter" || r.u.n >= P.find.kcItems);
  const sel = selectFindings({ S, misc, conf, hab, rel, st, fmt, rels }, ctx, P);
  if (dbg) Object.assign(dbg, { hab, S, T, sel, misc, fmt, rels });
  const byP = group(N.obs, o => o.pid);
  const plan = buildPlan(sel.findings, ctx, N.obs, P, { st, time: T, rel, nowDay });
  composeText([...sel.findings, ...sel.habits], ctx, { st, rel, byP, P, nowDay });
  // 근거 칩 번호는 문서 전체에서 하나씩
  let e = 0;
  const card = (f, id) => ({
    id, type: f.type === "habit" ? f.habit === "hasty" || f.habit === "fatigue" || f.habit === "fb_skip" ? f.habit : "habit" : f.type,
    ...(f.type === "habit" ? { habit: f.habit } : {}), conf: f.conf ?? null,
    unit: f.u ? { kind: f.u.kind, code: f.u.code, name: f.u.name } : null, with: f.with || null,
    ...(f._.r && f.type === "misc" ? { m: f._.r.m } : {}),
    text: f.text, hidden_truth: f.hidden_truth, evidence: f.ev.map(x => ({ ...x, id: "E" + ++e })),
    avoided: f.avoided || 0, n_items: f.type === "relative" || f.type === "format" ? f.n : f.u ? f.u.n : f.n ?? new Set(f.ev.map(x => x.pid)).size, plan: f.plan || null,
  });
  const findings = sel.findings.map((f, i) => card(f, "F" + (i + 1)));
  const habitsOut = sel.habits.map((f, i) => card(f, "H" + (i + 1)));       // 학습 습관 및 시간 메모 (화면 맨 아래 접힌 칸)
  const units = [...S.all.values()].filter(u => u.n > 0).sort((a, b) => (a.kind === "chapter" ? 1 : 0) - (b.kind === "chapter" ? 1 : 0) || a.sort - b.sort).map(u => ({
    kind: u.kind, code: u.code, name: u.name, ...(u.kind === "chapter" ? { ch: u.code } : { ch: u.ch }), label: u.label,
    acc: u.acc, band: accBand(u.acc.c, u.acc.n).map(r2), pred: u.cur.band.map(r2), mark: u.mark, ...(u.watch ? { watch: true } : {}), n: u.n, counts: u.counts, speed: u.speed ? u.speed.speed : null, ...(u.label === "pending" ? { why: u.why || "few" } : {}) }));
  // 주의 문장 (모두 데이터에서)
  const caveats = ["relative_only"];
  const legW = keptObs.filter(o => o.src === "legacy" || o.src === "legacy_fix").reduce((s, o) => s + o.w, 0);
  if (n_eff && (legW / n_eff > P.caveat.legacyShare || !choice)) caveats.push("imported_history");   // 고른 답이 적으면 그 진단을 뺐다는 뜻도 함께
  if (!X.hasMC) caveats.push("no_mc");
  const answered = new Set(keptObs.map(o => o.pid)), tagged = [...answered].filter(p => X.items.get(p).kcs.length).length;
  if (answered.size && tagged / answered.size < P.caveat.tagShare) caveats.push("untagged");
  if (T.timed.length < P.time.few) caveats.push("few_timed");
  if (N.meta.firstAns && N.meta.listNoVis / N.meta.firstAns > P.time.listShare) caveats.push("list_time");
  // 시간 요약 (속도와 정확도의 관계는 확실할 때만)
  const ref = {}; for (const k of TK) ref[k] = T.active[k] ? r1(Math.exp(Math.log(P.time.b0[k]) - T.tau[k])) : null;
  const notes = [];
  if (T.timed.length >= P.time.few) {
    for (const k of TK) if (ref[k] != null) notes.push(`${KN[k]}${eun(KN[k])} 한 문제에 보통 ${ref[k]}초 걸려요.`);
    const slow = [...S.all.values()].filter(u => u.speed && u.speed.speed === "slow").sort((a, b) => b.speed.ratio - a.speed.ratio)[0];
    if (slow) notes.push(`${QN(slow)}은 평소의 ${r1(slow.speed.ratio)}배 걸려요.`);
    const NT = P.time.note, fa = T.timed.filter(o => o.cls === "fast"), sl = T.timed.filter(o => o.cls === "slow");
    if (fa.length >= NT.n && sl.length >= NT.n) {
      const kf = fa.filter(o => o.y).length, ks = sl.filter(o => o.y).length, A = betaGrid(kf, fa.length), B = betaGrid(ks, sl.length);
      if (betaLess(A, B, NT.gap) >= NT.p) notes.push(`평소보다 빨리 답한 문제는 ${pct(kf / fa.length)}%, 오래 생각한 문제는 ${pct(ks / sl.length)}% 맞혔어요. 서두르면 더 틀리는 편이에요.`);
      else if (betaLess(B, A, NT.gap) >= NT.p) notes.push(`오래 생각한 문제는 ${pct(ks / sl.length)}%, 빨리 답한 문제는 ${pct(kf / fa.length)}% 맞혔어요. 오래 걸리는 문제는 대개 확실히 모르는 문제예요.`);
    }
  }
  if (T.rapid) notes.push(`너무 빨리 고른 답 ${T.rapid}개는 진단에서 뺐어요.`);
  const time = { speed: null, n_timed: T.timed.length, ref, notes,
    counts: { rapid: T.rapid, fast_wrong: T.timed.filter(o => o.cls === "fast" && !o.y).length, slow_correct: T.timed.filter(o => o.cls === "slow" && o.y).length,
      assisted: aux.assisted.size, unsure: aux.unsure.size, star: aux.star.size, fb_skip: aux.fb ?? null } };
  // 한 줄 요약: 가장 쓸모 있는 참인 문장 (지식 쪽 결과 → 습관·속도 → 사실). '다시 맞힌 것 0개' 같은 문장은 쓰지 않는다
  const sg = sel.strong[0], top = sel.findings.find(f => HEAD.includes(f.type)) || sel.findings.find(f => f.type !== "relearn" && f.head);
  const sgTxt = f => (sg && (!f || !f.u || f.u.key !== sg.key) ? ` ${QN(sg)}은 탄탄해요.` : "");
  let headline;
  if (top) headline = top.head + sgTxt(top);
  else if (sg) headline = `${QN(sg)}은 탄탄하고, 뚜렷한 약점은 아직 보이지 않아요.`;
  else {
    const low = [...S.all.values()].filter(u => u.kind === "chapter" && u.acc && u.acc.n >= P.label.pendN).sort((a, b) => a.acc.c / a.acc.n - b.acc.c / b.acc.n || a.sort - b.sort)[0];
    const all = [...firstTry(keptObs).values()], c = all.filter(x => x.ok).length;
    const LG = N.meta.legacy ? "예전 기록까지 합쳐 " : "";                 // 아래 '근거' 줄의 새 앱 첫 풀이 수와 다른 수라는 걸 밝힌다
    if (low && all.length) headline = `${LG}첫 풀이 ${all.length}문제 중 ${c}개(${pct(c / all.length)}%)를 맞혔어요. 가장 낮은 곳은 ${QN(low)}(${low.acc.n}문제 중 ${low.acc.c}개)${low.watch ? "예요. 표본이 적어 확정은 아니지만 먼저 살펴볼 만해요." : "이지만 약하다고 할 만큼 뚜렷하진 않아요."}`;
    else {
      const lead = all.length ? `${LG}첫 풀이 ${all.length}문제 중 ${c}개(${pct(c / all.length)}%)를 맞혔어요. ` : "";
      headline = sel.pending.length ? `${lead}${sel.pending.length}곳은 근거가 부족해 판단을 미뤘어요. 더 풀면 차이가 보여요.` : `${lead}뚜렷한 약점은 아직 보이지 않아요.`;
    }
  }
  // v2: 세부 포인트 진단 (태그가 붙고 관리자가 켠 과목만. 아니면 v1 리포트 그대로 + v2.on = false)
  const V = ctx.v2, v2 = { on: !!(V && V.ready), why: !V ? "untagged" : V.ready ? null : "not_ready" };
  let D2 = null;
  if (v2.on) {
    const attempted = new Set([...N.obs.map(o => o.pid), ...N.post.map(x => x.pid)]);
    const DX = depthModel(N.obs, N.post, V, P, { attempted, chapterLabel: F => F && F.ch ? (S.all.get("c:" + F.ch) || {}).label : null });
    D2 = depthDoc(DX, ctx, st, e, findings.length);
    e = D2.e; findings.push(...D2.findings);
    const top = D2.findings.find(f => f.tier === "firm" && f.type === "illusion");
    if (top) headline = top.head;
  }
  const profile = profileOf(D2 ? D2.raw : [], { habits: hab.map(h => h.id), formats: fmt ? { strong: fmt.strong, weak: fmt.weak } : { strong: [], weak: [] }, pace: ref });
  return { ...base, state: "ready", frame: "relative", asOf: new Date(nowDay * DAY).toISOString().slice(0, 10),
    basis: { first: N.meta.first, choice: N.meta.choice, legacy: N.meta.legacy, n_eff: r1(n_eff) },
    headline, findings, habits: habitsOut, plan, units, v2,
    ...(D2 ? { points: D2.points, probes: D2.probes, excluded: D2.excluded, need: D2.need } : {}), profile,
    relearn: { resolved: rel.resolved, confirmed: rel.confirmed, retried: rel.retried, due: rel.due, unsure: rel.unsure, star: rel.star, asked: rel.asked },
    strong: sel.strong.map(u => ({ code: u.code, name: u.name })),
    good: goodUnits(S), pending: sel.pending.map(u => ({ code: u.code, name: u.name, n: u.n, why: u.why || "few" })),
    caveats, time, narr_state: "off" };
}
