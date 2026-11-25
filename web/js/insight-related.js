// 학습 리포트 v2: 연관 개념 진단 (docs/insight/v2/RELATED.md §3–§5). 순수 ES 모듈 (DOM·node:* 없음, 브라우저·서버 공용)
// 약한 개념에서 다시 출발하는 PageRank(개인화 PageRank)로 "이 개념도 헷갈리고 있을 수 있어요"를 고른다.
// - r = (1−d)·s + d·P·r 의 고정점 = 구글 행렬 G = d·P + (1−d)·s·1ᵀ 의 고윳값 1에 대한 고유벡터. 거듭 곱해서 구한다
// - 과목 전체의 PageRank π로 나눈 값(rel)으로 순위를 매긴다: 어디에나 이어진 개념이 늘 1등이 되지 않게
// - 단정하지 않는다 (tier 늘 hedged). 이미 '확실히 앎'인 개념은 말하지 않는다

export const REL = Object.freeze({
  d: 0.6, tol: 1e-6, it: 50,
  seed: { illusion: { firm: 1, hedged: 0.6 }, weak: 0.6 },
  relMin: 2, rMin: 0.02, oneStep: 0.2, perSeed: 2, max: 3,
});

const jong = w => { const s = String(w).replace(/[\s'"’”)\]…·.,!?]+$/u, ""), c = s.charCodeAt(s.length - 1);
  return c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : /\d$/.test(s) ? "013678".includes(s[s.length - 1]) : /[lmn]$/i.test(s); };
const wa = w => (jong(w) ? "과" : "와"), eul = w => (jong(w) ? "을" : "를");

/** 열마다 나가는 가중치 합 (P(b|a) = w / sum[a]) */
const sums = G => G.out.map(row => row.reduce((s, e) => s + e[1], 0));

/** 개인화 PageRank. s: 다시 출발하는 분포 (Σ = 1). 나가는 선이 없는 개념의 몫은 s로 돌려보낸다 */
export function pagerank(G, s, d = REL.d, tol = REL.tol, it = REL.it) {
  const K = G.kcs.length, S = G.sum || (G.sum = sums(G));
  let r = Float64Array.from(s);
  for (let n = 0; n < it; n++) {
    const x = new Float64Array(K); let dang = 0;
    for (let a = 0; a < K; a++) {
      if (!r[a]) continue;
      if (!S[a]) { dang += r[a]; continue; }
      const k = d * r[a] / S[a];
      for (const e of G.out[a]) x[e[0]] += k * e[1];
    }
    let diff = 0;
    for (let b = 0; b < K; b++) { x[b] += (1 - d + d * dang) * s[b]; diff += Math.abs(x[b] - r[b]); }
    r = x;
    if (diff < tol) break;
  }
  return r;
}

const PI = new WeakMap();          // 그래프 → 과목 전체 PageRank (출발점이 고른 분포)
const globalOf = (G, d) => { let p = PI.get(G); if (!p) { const K = G.kcs.length; PI.set(G, p = pagerank(G, new Float64Array(K).fill(1 / K), d)); } return p; };

/**
 * raw: depthModel().points (F.kc · dec · probes), G: 서버가 만든 그래프 {kcs, names, out}, V: ctx.v2, Z: { attempted:Set, carded:Set(카드가 있는 포인트 code), P }
 * → det.related[] (RELATED.md §5)
 */
export function related(raw, G, V, Z = {}) {
  const R = { ...REL, ...((Z.P || {}).related || {}) };
  if (!G || !G.kcs || !G.kcs.length || !raw || !raw.length) return [];
  const K = G.kcs.length, at = new Map(G.kcs.map((c, i) => [c, i]));
  // 개념마다: 출발 무게 · 확실히 앎이 있는지 · 자기 카드가 있는지 · 그 개념의 대표 카드
  const s = new Float64Array(K), solid = new Set(), own = new Set(), card = new Map();
  const rank = x => (x.dec.state === "illusion" ? (x.dec.tier === "firm" ? 0 : 1) : x.dec.state === "weak" ? 2 : 9);
  for (const x of raw) {
    const i = at.get(x.F && x.F.kc); if (i == null) continue;
    const d = x.dec;
    if (d.state === "solid") solid.add(i);
    if (d.state === "illusion" || d.state === "weak") {
      own.add(i);
      const w = d.state === "illusion" ? R.seed.illusion[d.tier] || 0 : R.seed.weak;
      if (w > s[i]) s[i] = w;
      if (Z.carded && Z.carded.has(x.code)) { const c = card.get(i); if (!c || rank(x) < rank(c)) card.set(i, x); }
    }
  }
  const tot = s.reduce((a, b) => a + b, 0); if (!tot) return [];
  for (let i = 0; i < K; i++) s[i] /= tot;
  const r = pagerank(G, s, R.d, R.tol, R.it), pi = globalOf(G, R.d), S = G.sum || (G.sum = sums(G));
  // 개념별 확인 문제: 그 개념의 세부 포인트에 붙은, 아직 안 푼 공개 문제 (정의·적용 먼저)
  const facetsOf = new Map();
  for (const F of V.facets.values()) (facetsOf.get(F.kc) || facetsOf.set(F.kc, []).get(F.kc)).push(F.code);
  const probeOf = kc => {
    const C = [];
    for (const f of facetsOf.get(kc) || []) for (const it of V.byFacet.get(f) || []) if (it.status === "published" && !(Z.attempted && Z.attempted.has(it.pid))) C.push({ it, lv: Math.min(4, Math.max(1, +(V.tags.get(it.pid) || {}).depth || 2)) });
    C.sort((a, b) => a.lv - b.lv || a.it.pid - b.it.pid);
    return C.length ? [{ pid: C[0].it.pid, ext: C[0].it.ext, lv: "L" + C[0].lv, role: "related_check" }] : [];
  };
  const edge = (a, b) => G.out[a].find(e => e[0] === b);
  const out = [];
  for (let b = 0; b < K; b++) {
    if (s[b] > 0 || solid.has(b) || own.has(b)) continue;                     // §4.1 1–3
    const rel = pi[b] > 0 ? r[b] / pi[b] : 0;
    if (rel < R.relMin || r[b] < R.rMin) continue;                             // §4.1 4
    // 가장 잘 설명하는 출발 개념 (한 걸음 몫이 가장 큰 것, 카드가 있는 것만)
    let best = -1, bw = 0, one = 0;
    for (const [a] of card) { const e = edge(a, b); if (!e || !S[a]) continue; const c = s[a] * e[1] / S[a]; one += c; if (c > bw) { bw = c; best = a; } }
    if (best < 0 || (1 - R.d) * R.d * one < R.oneStep * r[b]) continue;       // §4.2 한 줄로 말할 수 없으면 뺀다
    const probes = probeOf(G.kcs[b]); if (!probes.length) continue;           // §4.1 5
    const e = edge(best, b), via = [["co_tag", e[2]], ["co_error", e[3]], ["confusable", e[4]]].filter(v => v[1] > 0).sort((p, q) => q[1] - p[1]).slice(0, 2).map(v => v[0]);
    out.push({ b, a: best, rel, via, n_co: via.includes("co_tag") ? e[5] : null, probes });
  }
  out.sort((p, q) => q.rel - p.rel || p.b - q.b);
  const per = new Map(), pick = [];
  for (const x of out) {
    if (pick.length >= R.max || (per.get(x.a) || 0) >= R.perSeed) continue;
    per.set(x.a, (per.get(x.a) || 0) + 1); pick.push(x);
  }
  return pick.map(x => {
    const name = G.names[x.b] || G.kcs[x.b], from = G.names[x.a] || G.kcs[x.a];
    const why = x.via.map(v => v === "co_tag" ? `'${from}'${wa(from)} 같은 문제에 자주 함께 나와요 (${x.n_co}문제)`
      : v === "co_error" ? `'${from}'${eul(from)} 틀린 학습자들이 '${name}'도 자주 틀렸어요` : `'${from}'${wa(from)} 헷갈리기 쉬운 개념이에요`);
    return { kc: G.kcs[x.b], name, from: G.kcs[x.a], from_point: card.get(x.a).code, via: x.via, n_co: x.n_co,
      rel: Math.round(x.rel * 100) / 100, tier: "hedged", probes: x.probes,
      text: { diag: `'${name}'도 헷갈리고 있을 수 있어요.`, why: why.join(". 그리고 ").replace(/([^.])$/, "$1.") } };
  });
}
