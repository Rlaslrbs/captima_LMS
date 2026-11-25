// 연관 개념 진단 검증 (docs/insight/v2/RELATED.md §8). 운영 DB가 아니라 복사본에서만 돈다.
// 사용법: node tools/related-backtest.mjs <복사본 DB 경로>
//   과목마다 첫 풀이 시각의 중앙값에서 기록을 자른다. 앞쪽 기록만으로 그래프·진단·연관 개념을 만들고,
//   그 개념을 뒤쪽에서 처음 풀었을 때 틀렸는지 본다. 같은 기기의 '아무 개념'·'가장 어려운 개념' 찍기와 견준다.
//   화면에는 과목별 합계만 찍는다 (기기 번호는 찍지 않는다).
import { resolve } from "node:path";
import { realpathSync, existsSync } from "node:fs";

const path = process.argv[2];
if (!path || !existsSync(path)) { console.error("복사본 DB 경로를 주세요: node tools/related-backtest.mjs <경로>"); process.exit(1); }
const live = resolve(import.meta.dirname, "../data/app.db");
if (existsSync(live) && realpathSync(path) === realpathSync(live)) { console.error("운영 DB(data/app.db)에서는 돌리지 않아요. VACUUM INTO로 만든 복사본을 주세요."); process.exit(1); }
process.env.DB_PATH = resolve(path);           // db.js를 읽기 전에 정해야 한다

const { db } = await import("../server/db.js");
const { courseCtx } = await import("../server/insight/ctx.js");
const { baseUntil, finish, deviceSets } = await import("../server/insight/graph.js");
const { loadRaw } = await import("../server/insight/evidence.js");
const { buildReport, dayOf } = await import("../web/js/insight-engine.js");
const { PARAMS } = await import("../server/insight/params.js");

const MIN_ALL = 30, MIN_BEFORE = 10, MIN_AFTER = 5;
const MODES = [
  { name: "기본 (E1+E2+E3, d .6)", only: null, d: 0.6 },
  { name: "같은 문제만 (E1)", only: { e1: 1 }, d: 0.6 },
  { name: "기본, d .5", only: null, d: 0.5 },
  { name: "기본, d .7", only: null, d: 0.7 },
  { name: "기본, d .85", only: null, d: 0.85 },
];
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "—");

for (const { id: cid, name } of db.prepare("SELECT c.id, c.name FROM course c ORDER BY c.id").all()) {
  const ctx0 = courseCtx(cid); if (!ctx0 || !ctx0.v2) continue;               // 태그가 없는 과목은 건너뛴다
  const ctx = { ...ctx0, v2: { ...ctx0.v2, ready: true } };                   // 검증에서는 v2를 켠 것처럼
  const ts = db.prepare(`SELECT e.client_ts ts FROM event e JOIN problem p ON p.id = e.problem_id
      WHERE p.course_id = ? AND e.type IN ('answer_submit', 'idk') ORDER BY e.client_ts`).all(cid).map(r => r.ts);
  if (ts.length < 100) { console.log(`\n[${name}] 기록이 적어 건너뜀 (${ts.length})`); continue; }
  const cut = ts[ts.length >> 1], day = dayOf(cut);
  const B = baseUntil(cid, ctx, cut);
  if (!B.K) continue;
  const after = deviceSets(cid, B.kcsOf, null, cut);
  // 앞쪽 기록에서 개념별 틀림 비율 (가장 어려운 개념 찍기용)
  const att = new Float64Array(B.K), miss = new Float64Array(B.K);
  for (const D of B.dev.values()) for (const i of D.att) { att[i]++; if (D.miss.has(i)) miss[i]++; }
  const hard = i => (att[i] >= 5 ? miss[i] / att[i] : 0);
  const devices = db.prepare(`SELECT e.device_id d, COUNT(DISTINCT e.problem_id) n FROM event e JOIN problem p ON p.id = e.problem_id
      WHERE p.course_id = ? AND e.type IN ('answer_submit', 'idk') GROUP BY e.device_id HAVING n >= ?`).all(cid, MIN_ALL).map(r => r.d);
  console.log(`\n[${name}] 개념 ${B.K}개 · 함께 틀림 연결 ${B.dev.size}기기 기준 · 검증 기기 후보 ${devices.length}`);
  for (const M of MODES) {
    let used = 0, named = 0, ev = 0, hit = 0, rndN = 0, rndHit = 0, hardN = 0, hardHit = 0;
    for (const d of devices) {
      const pre = B.dev.get(d), post = after.get(d);
      if (!pre || !post || pre.att.size < MIN_BEFORE || post.att.size < MIN_AFTER) continue;
      const raw = loadRaw(d, cid);
      raw.events = raw.events.filter(e => e.ts < cut); raw.aux = raw.aux.filter(e => e.ts < cut);
      raw.progress = raw.progress.filter(p => p.updated_at && p.updated_at < cut); raw.grades = raw.grades.filter(g => g.created_at < cut);
      raw.graph = finish(B, d, M.only);
      const det = buildReport(raw, ctx, { ...PARAMS, related: { d: M.d } }, day);
      const rel = det.related || [];
      used++; named += rel.length;
      const idx = new Map(B.kcs.map((c, i) => [c, i]));
      for (const x of rel) { const b = idx.get(x.kc); if (post.att.has(b) && !pre.att.has(b)) { ev++; if (post.miss.has(b)) hit++; } }
      // 같은 기기 기준선: 앞에서 안 풀고 뒤에서 처음 푼 개념들
      const fresh = [...post.att].filter(i => !pre.att.has(i));
      if (fresh.length) {
        rndN += 1; rndHit += fresh.filter(i => post.miss.has(i)).length / fresh.length;
        const h = fresh.sort((a, b) => hard(b) - hard(a))[0]; hardN++; if (post.miss.has(h)) hardHit++;
      }
    }
    const prec = ev ? hit / ev : 0, base = hardN ? hardHit / hardN : 0;
    console.log(`  ${M.name}: 기기 ${used} · 연관 개념 ${named}개 · 뒤에서 확인된 것 ${ev}개 · 맞힌 비율(틀림 예측) ${pct(hit, ev)}`
      + ` | 아무 개념 ${pct(rndHit, rndN)} · 가장 어려운 개념 ${pct(hardHit, hardN)} · 배수 ${base ? (prec / base).toFixed(2) : "—"}`
      + ` | 통과 ${ev >= 20 && prec >= 0.65 && base && prec / base >= 1.3 ? "예" : ev < 20 ? "표본 부족" : "아니요"}`);
  }
}
