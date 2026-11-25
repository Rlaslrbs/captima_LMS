// 학습 리포트: 과목별 개념(kc) 그래프 — 연관 개념 진단(docs/insight/v2/RELATED.md §2)의 입력.
// 엔진(web/js/insight-related.js)이 이 그래프 위에서 개인화 PageRank를 돌린다. 여기서는 SQL로 모으고 가중치만 만든다.
// - E1 같은 문제에 함께 붙은 개념 · E2 여러 학습자가 함께 틀린 개념(집계만, 내 기록은 빼고) · E3 태그의 헷갈리는 짝
// - 학습자 기록 표는 읽기만 한다. 기기 번호는 그래프 밖으로 나가지 않는다
import { db, J } from "../db.js";

export const G2 = Object.freeze({
  mix: { e1: 0.35, e2: 0.45, e3: 0.20 }, mixNoE2: { e1: 0.80, e3: 0.20 },
  minBoth: 20, minMissBoth: 5, prior: 10,           // E2: 둘 다 푼 기기 ≥ 20, 둘 다 틀린 기기 ≥ 5, 기준 비율로 10기기만큼 당긴다
  kcMin: 0.25,                                      // 문제의 개념 비중이 이만큼은 돼야 '그 개념을 푼 것'으로 센다
  rapidMs: 1500,                                    // 이보다 빠른 첫 답은 뺀다 (params time.rapid.lo와 같게)
});
const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);

/** 과목 스위치 insight_meta 'related:<cid>' (기본 꺼짐). on을 주면 켜거나(true) 끈다(false) */
export function relatedOn(cid, on) {
  if (on !== undefined) {
    if (on) st("relSet", "INSERT INTO insight_meta(key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run("related:" + cid);
    else st("relDel", "DELETE FROM insight_meta WHERE key = ?").run("related:" + cid);
  }
  return (st("relGet", "SELECT value FROM insight_meta WHERE key = ?").get("related:" + cid) || {}).value === "1";
}

/** 문제마다 개념 비중 { pid → [[kcIdx, w]…] } (Σw = 1). item_tag.kcs + 세부 포인트의 개념(주 0.5 · 둘째 0.25) */
function itemKcs(cid, idx, facetKc, items) {
  const out = new Map();
  for (const r of st("tags", `SELECT t.problem_id pid, t.version v, t.kcs, t.facet, t.diag, t.conf FROM item_tag t JOIN problem p ON p.id = t.problem_id
      WHERE p.course_id = ? AND t.review NOT IN ('rejected', 'stale') ORDER BY t.problem_id, t.version DESC`).all(cid)) {
    if (out.has(r.pid) || (r.conf ?? 2) < 2) continue;
    const it = items.get(r.pid); if (!it || r.v !== it.v) continue;
    const w = new Map(), add = (k, x) => { const i = idx.get(k); if (i != null && x > 0) w.set(i, (w.get(i) || 0) + x); };
    for (const x of J(r.kcs, [])) if (Array.isArray(x)) add(x[0], +x[1] || 0);
    if (r.facet && facetKc.has(r.facet)) { const k = facetKc.get(r.facet), i = idx.get(k); if (i != null && !w.has(i)) add(k, 0.5); }
    for (const f2 of (J(r.diag, {}).facets2 || []).slice(0, 2)) { const k = facetKc.get(f2), i = idx.get(k); if (i != null && !w.has(i)) add(k, 0.25); }
    const s = [...w.values()].reduce((a, b) => a + b, 0); if (!s) continue;
    out.set(r.pid, [...w].map(([i, x]) => [i, x / s]));
  }
  return out;
}

/** 기기마다 '푼 개념'과 '틀린 개념' (첫 풀이만, 너무 빠른 답 · 서술형 · 기록 지운 뒤 다시 푼 것 제외). untilTs·fromTs: 그 사이 첫 풀이만 (검증용) */
export function deviceSets(cid, kcsOf, untilTs = null, fromTs = null) {
  const dev = new Map(); let cur = null, seen = null;
  for (const r of st("first", `SELECT e.device_id d, e.problem_id pid, e.type, e.client_ts ts, json_extract(e.payload, '$.correct') ok, json_extract(e.payload, '$.ms') ms,
      json_extract(e.payload, '$.attempt') att, pv.kind FROM event e JOIN problem p ON p.id = e.problem_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = ? AND p.status = 'published' AND e.type IN ('answer_submit', 'idk') ORDER BY e.device_id, e.problem_id, e.client_ts, e.rowid`).all(cid)) {
    if (r.d !== cur) { cur = r.d; seen = new Set(); }
    if (seen.has(r.pid)) continue;
    seen.add(r.pid);                                                       // 첫 답 하나만 본다 (이어진 다시 풀기는 건너뛴다)
    if ((untilTs && !(r.ts < untilTs)) || (fromTs && r.ts < fromTs)) continue;
    if (r.kind === "essay" || (r.att != null && +r.att > 1)) continue;
    if (r.type !== "idk" && Number.isFinite(r.ms) && r.ms < G2.rapidMs) continue;
    const ks = kcsOf.get(r.pid); if (!ks) continue;
    const miss = r.type === "idk" || r.ok !== 1;
    const D = dev.get(r.d) || dev.set(r.d, { att: new Set(), miss: new Set() }).get(r.d);
    for (const [i, w] of ks) if (w >= G2.kcMin) { D.att.add(i); if (miss) D.miss.add(i); }
  }
  return dev;
}

/** 기기 집합 → 쌍 집계 (K×K): N 둘 다 풀었음 · MA[a][b] 둘 다 푼 기기 중 a를 틀림 · M11 둘 다 틀림 */
function pairCounts(K, dev) {
  const N = new Uint32Array(K * K), MA = new Uint32Array(K * K), M11 = new Uint32Array(K * K);
  for (const D of dev.values()) addDevice(K, N, MA, M11, D, 1);
  return { N, MA, M11 };
}
function addDevice(K, N, MA, M11, D, s) {
  const A = [...D.att];
  for (const a of A) for (const b of A) {
    if (a === b) continue;
    const j = a * K + b;
    N[j] += s;
    if (D.miss.has(a)) { MA[j] += s; if (D.miss.has(b)) M11[j] += s; }
  }
}

/** 과목의 바탕 그래프 (E1 · E3 · E2 집계). 하루 한 번 또는 태그가 바뀔 때만 다시 만든다 */
function baseOf(cid, ctx, untilTs = null) {
  const kcs = [], names = [], idx = new Map(), merged = new Map();
  for (const k of st("kcs", "SELECT code, name, confusable, status, merged_into FROM kc WHERE course_id = ? ORDER BY code").all(cid)) {
    if (k.status === "retired") { if (k.merged_into) merged.set(k.code, k.merged_into); continue; }
    idx.set(k.code, kcs.length); kcs.push(k.code); names.push(k.name);
  }
  for (const [a, b] of merged) if (idx.has(b)) idx.set(a, idx.get(b));   // 합쳐진 개념은 합친 쪽으로
  const K = kcs.length;
  const facetKc = new Map();
  for (const f of st("fkc", "SELECT code, kc, confusable FROM facet WHERE course_id = ? AND status != 'retired'").all(cid)) facetKc.set(f.code, f.kc);
  const items = ctx.items, kcsOf = itemKcs(cid, idx, facetKc, items);
  // E1: 같은 문제에 함께 붙은 개념 (공개 문제만, 'n문제'를 학습자에게 말할 수 있게)
  const E1 = new Float64Array(K * K), NCO = new Uint16Array(K * K);
  for (const [pid, ks] of kcsOf) {
    if (ks.length < 2 || (items.get(pid) || {}).status !== "published") continue;
    for (const [a, wa] of ks) for (const [b, wb] of ks) if (a !== b) { E1[a * K + b] += wa * wb; NCO[a * K + b]++; }
  }
  // E3: 태그에 적힌 헷갈리는 짝 (개념 1 · 오개념의 cw 1 · 세부 포인트 0.5). 겹치면 큰 값
  const E3 = new Float64Array(K * K), link = (a, b, w) => { const i = idx.get(a), j = idx.get(b); if (i == null || j == null || i === j) return; E3[i * K + j] = Math.max(E3[i * K + j], w); E3[j * K + i] = Math.max(E3[j * K + i], w); };
  for (const k of st("kcs2", "SELECT code, confusable FROM kc WHERE course_id = ? AND status != 'retired'").all(cid)) for (const b of J(k.confusable, [])) link(k.code, b, 1);
  for (const m of st("cw", "SELECT kc, cw FROM misc WHERE course_id = ? AND status NOT IN ('rejected', 'retired') AND cw IS NOT NULL AND cw != ''").all(cid)) link(m.kc, m.cw, 1);
  for (const f of st("fconf", "SELECT kc, confusable FROM facet WHERE course_id = ? AND status != 'retired'").all(cid)) for (const g of J(f.confusable, [])) if (facetKc.has(g)) link(f.kc, facetKc.get(g), 0.5);
  const dev = deviceSets(cid, kcsOf, untilTs);
  return { K, kcs, names, E1, NCO, E3, dev, kcsOf, cnt: pairCounts(K, dev) };
}

/** 바탕 그래프 + 한 기기 → 엔진이 읽는 그래프. 그 기기의 기록은 E2에서 뺀다 (내 틀림이 나를 '예측'하지 않게) */
export function finish(B, deviceId, only = null) {
  const { K, E1, E3, NCO } = B, N = B.cnt.N.slice(), MA = B.cnt.MA.slice(), M11 = B.cnt.M11.slice();
  const me = deviceId != null ? B.dev.get(deviceId) : null;
  if (me) addDevice(K, N, MA, M11, me, -1);
  const E2 = new Float64Array(K * K);
  for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
    if (a === b) continue;
    const j = a * K + b, n = N[j], m11 = M11[j], ma = MA[j], mb = MA[b * K + a];
    if (n < G2.minBoth || m11 < G2.minMissBoth || !ma || !mb) continue;
    const pb = mb / n, cond = (m11 + G2.prior * pb) / (ma + G2.prior), lift = cond / pb;
    if (lift > 1) E2[j] = lift - 1;
  }
  const mx = A => { let m = 0; for (const x of A) if (x > m) m = x; return m; };
  const m1 = mx(E1), m2 = mx(E2);
  let mix = m2 > 0 ? G2.mix : { ...G2.mixNoE2, e2: 0 };
  if (only) mix = { e1: 0, e2: 0, e3: 0, ...only };                       // 검증용: 일부 출처만
  const out = [];
  for (let a = 0; a < K; a++) {
    const row = [];
    for (let b = 0; b < K; b++) {
      if (a === b) continue;
      const j = a * K + b, e1 = m1 ? E1[j] / m1 : 0, e2 = m2 ? E2[j] / m2 : 0, e3 = E3[j];
      const w = mix.e1 * e1 + mix.e2 * e2 + mix.e3 * e3;
      if (w > 0) row.push([b, w, mix.e1 * e1, mix.e2 * e2, mix.e3 * e3, NCO[j]]);
    }
    out.push(row);
  }
  return { v: 1, kcs: B.kcs, names: B.names, out, e2: m2 > 0 };
}

const BASE = new Map();          // cid → { key, B } (최근 8과목)
/** 리포트 한 장에 쓸 그래프. key: 과목 내용 키(ctx.key) + 한국 날짜 → 하루 한 번 또는 태그가 바뀌면 다시 만든다 */
export function graphFor(cid, ctx, deviceId, day) {
  const key = ctx.key + "|" + day;
  let o = BASE.get(cid);
  if (!o || o.key !== key) {
    o = { key, B: baseOf(cid, ctx) };
    BASE.delete(cid); BASE.set(cid, o); if (BASE.size > 8) BASE.delete(BASE.keys().next().value);
  }
  if (!o.B.K) return null;
  return finish(o.B, deviceId);
}

/** 검증용 (tools/related-backtest.mjs): 그 시각 전 기록만으로 바탕 그래프 */
export const baseUntil = (cid, ctx, untilTs) => baseOf(cid, ctx, untilTs);
