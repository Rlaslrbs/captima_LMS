// 학습 리포트: 기기·과목별 '뽑은' 리포트 한 장 (결정 7). 계산은 web/js/insight-engine.js (화면과 같은 파일)의 buildReport 하나.
// - 보기(GET)는 계산하지 않는다: 저장한 insight 행 + 그 뒤에 쌓인 새 기록 수(since) + 뽑을 수 있는지(can_make)
// - 뽑기(POST)만 엔진을 돌린다. 지문(fp)이 그대로면 같은 리포트를 돌려주고, 바뀌었으면 그 행 하나를 덮어쓴다 (지난 리포트는 남기지 않는다)
import { db, J, now } from "../db.js";
import { buildReport } from "../../web/js/insight-engine.js";
import { PARAMS } from "./params.js";
import { courseCtx, ctxKey, useContentVer } from "./ctx.js";
import { aiOn, startDiag, aiPending } from "./aidiag.js";
import { loadRaw, fingerprint } from "./evidence.js";

let Packed = null;
/** server.js가 켤 때 한 번: 응답 묶음 클래스(Packed)와 관리자 쓰기 횟수(contentVer)를 읽는 함수 */
export function initInsight(o) { Packed = o.Packed; if (o.contentVer) useContentVer(o.contentVer); }

export const kstDay = (t = Date.now()) => Math.floor((t + 9 * 3600e3) / 864e5);
const TYPE = "application/json; charset=utf-8";
const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);
const LRU = new Map(), MAX = 300;        // "기기|과목" → { sig, pk }: 같은 행·같은 새 기록 수면 압축본·ETag를 다시 쓴다
const ANS = "'answer_submit','idk'";

/** 새로 계산한 리포트 (캐시·저장 없이). 없는 과목·숨긴 과목이면 null. 시험·관리자 미리보기도 쓴다 */
export function buildDoc(deviceId, cid, day = kstDay(), key = ctxKey(cid), fp = fingerprint(deviceId, cid, key, day), raw = loadRaw(deviceId, cid)) {
  const ctx = courseCtx(cid, key); if (!ctx || !ctx.visible) return null;
  raw.fp = fp;
  return buildReport(raw, ctx, PARAMS, day);
}

/** 뽑을 만큼 풀었는가: 색인 집계 둘로 엔진 문턱(gate: n_eff·단원 수)을 어림한다 (엔진을 돌리지 않음). 첫 풀이 1 · 다시 풀기 0.5 · 예전 기록 0.6 */
export function gate(deviceId, cid) {
  const G = PARAMS.gate, W = PARAMS.w, chs = new Map(), seen = new Set();
  const add = (ch, pid) => (chs.get(ch) || chs.set(ch, new Set()).get(ch)).add(pid);
  let n = 0, events = 0;
  for (const r of st("gev", `SELECT e.problem_id pid, ch.key ch, COUNT(*) n FROM event e JOIN problem p ON p.id = e.problem_id JOIN chapter ch ON ch.id = p.chapter_id
      WHERE e.device_id = ? AND e.type IN (${ANS}) AND p.course_id = ? AND p.status = 'published' GROUP BY e.problem_id`).all(deviceId, cid)) {
    n += W.first + W.retry * (r.n - 1); events += r.n; seen.add(r.pid); add(r.ch, r.pid);
  }
  for (const r of st("gpr", `SELECT pr.problem_id pid, ch.key ch FROM progress pr JOIN problem p ON p.id = pr.problem_id JOIN chapter ch ON ch.id = p.chapter_id
      WHERE pr.device_id = ? AND p.course_id = ? AND p.status = 'published'`).all(deviceId, cid)) if (!seen.has(r.pid)) { n += W.legacy; add(r.ch, r.pid); }
  const have = { n_eff: Math.round(n * 10) / 10, events, chapters: [...chs.values()].filter(s => s.size >= G.chItems).length };
  const need = { n_eff: G.n_eff, chapters: G.chapters };                  // 결정 8: 엔진도 n_eff와 단원 수만 본다 (답 기록 수 events는 보여 주기만)
  return { can_make: have.n_eff >= need.n_eff && have.chapters >= need.chapters, have, need };
}
/** 리포트를 뽑은 뒤 새로 쌓인 답 수 (answer_submit·idk, 행 번호 > 뽑을 때의 마지막 번호) */
const since = (deviceId, cid, rid) => st("since", `SELECT COUNT(*) n FROM event e JOIN problem p ON p.id = e.problem_id
    WHERE e.device_id = ? AND e.type IN (${ANS}) AND e.rowid > ? AND p.course_id = ?`).get(deviceId, rid || 0, cid).n;
const rowOf = (deviceId, cid) => st("row", `SELECT fp, det, updated_at, narr, json_extract(det, '$.ev_rid') rid, json_extract(det, '$.made_at') made_at, json_extract(det, '$.dfp') dfp, state FROM insight
    WHERE device_id = ? AND course_id = ? AND json_extract(det, '$.made_at') IS NOT NULL`).get(deviceId, cid);

/** 뽑은 뒤 풀이 기록이 바뀌었는가 (답 기록 없이도: 기록 지우고 다시 풀기·채점 수정). 뽑을 때의 기록 지문(dfp)과 지금 것을 견준다. 문제 내용·서버 판 바뀜은 세지 않는다 */
const staleOf = (deviceId, cid, row) => row.dfp != null && row.dfp !== fingerprint(deviceId, cid, null);
// 잠금 리포트를 뽑은 뒤 새로 풀지도 않았고 기록도 안 바뀌었으면, 어림 문턱을 넘었어도 엔진이 이미 '아직'이라고 한 것이다
const canMake = (g, row, n, stale) => g.can_make && !(row.state === "locked" && n === 0 && !stale);

// 화면(프론트엔드) 모양: {id, kind, point?, wrong, depth?, fix, evidence:[{pid, ext, ok}]} — 검증한 칸만
const aiCard = f => ({ id: f.id, kind: "illusion", ...(f.concept && f.concept.src === "facet" && f.concept.code ? { point: f.concept.code } : {}),
  concept: f.concept ? f.concept.name : null, wrong: f.belief, fix: [f.truth, f.cue].filter(Boolean).join(" → "), chosen: f.chosen, evidence: [{ pid: f.pid, ext: f.ext, ok: false }] });
// 저장한 리포트 글 끝에 since·stale·can_make를 붙인다 (다시 읽어 풀지 않음). 같은 행·같은 값이면 지난 Packed를 그대로
function packRow(deviceId, cid, row) {
  const n = since(deviceId, cid, row.rid), stale = staleOf(deviceId, cid, row), can = canMake(gate(deviceId, cid), row, n, stale), k = deviceId + "|" + cid;
  // 2단계 AI 진단 (DECISIONS #10): 같은 리포트(fp)에 붙은 것만 "ai"로. 도는 중이면 {state:"pending"}, 스위치가 꺼졌으면 아무것도 없다
  const A = J(row.narr, null), aiDoc = A && A.kind === "ai_diag" && A.fp === row.fp && aiOn(cid) ? { state: "ready", findings: A.findings || [] }
    : aiPending(deviceId, cid) ? { state: "pending" } : null;
  const sig = row.updated_at + "|" + row.fp + "|" + n + "|" + can + "|" + stale + "|" + (aiDoc ? aiDoc.state : "");
  const e = LRU.get(k); if (e && e.sig === sig) { LRU.delete(k); LRU.set(k, e); return e.pk; }
  const pk = new Packed(Buffer.from(row.det.slice(0, row.det.lastIndexOf("}")) + `,"since":{"answers":${n}},"stale":${stale},"can_make":${can}${aiDoc ? `,"ai":${JSON.stringify(aiDoc)}` : ""}${aiDoc && aiDoc.state === "ready" && aiDoc.findings.length ? `,"ai_findings":${JSON.stringify(aiDoc.findings.map(aiCard))}` : ""}}`), TYPE);
  LRU.delete(k); LRU.set(k, { sig, pk }); if (LRU.size > MAX) LRU.delete(LRU.keys().next().value);
  return pk;
}

/** 보기: 저장한 리포트(+ since, can_make), 없으면 { state: "none", can_make, have, need }. 엔진은 돌리지 않는다 */
export function getSnap(deviceId, cid) {
  const row = rowOf(deviceId, cid);
  if (row) return packRow(deviceId, cid, row);
  return new Packed(Buffer.from(JSON.stringify({ v: 1, cid, state: "none", ...gate(deviceId, cid) })), TYPE);
}

/** 뽑기: 지문이 그대로면 저장한 것, 아니면 새로 만들어 그 행을 덮어쓴다. 없는 과목·숨긴 과목이면 null */
export function makeSnap(deviceId, cid) {
  const day = kstDay(), key = ctxKey(cid), fp = fingerprint(deviceId, cid, key, day), old = rowOf(deviceId, cid);
  if (old && old.fp === fp) return packRow(deviceId, cid, old);
  const dfp = fingerprint(deviceId, cid, null), raw = loadRaw(deviceId, cid), det = buildDoc(deviceId, cid, day, key, fp, raw);
  if (!det) return null;
  const s = JSON.stringify({ ...det, made_at: now(), dfp, ev_rid: raw.events.reduce((m, e) => Math.max(m, e.rid), 0) });
  st("put", `INSERT INTO insight(device_id, course_id, fp, state, det, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(device_id, course_id) DO UPDATE SET fp = excluded.fp, state = excluded.state, det = excluded.det, updated_at = excluded.updated_at`)
    .run(deviceId, cid, fp, det.state, s, now());                   // 서술형 정리(narr…) 칸은 그대로 둔다 (P4가 여기서 만든다)
  if (det.state === "ready" && aiOn(cid)) startDiag(deviceId, cid, fp);   // 뒤에서: 실패해도 학습자에게는 결정적 리포트 그대로   // 뒤에서: 실패해도 학습자에게는 결정적 리포트 그대로
  return packRow(deviceId, cid, rowOf(deviceId, cid));
}

/** 담은 과목마다 한 줄 요약: 저장한 행 + 새 기록 수 + 뽑을 수 있는지만 (계산하지 않는다) */
export function overview(deviceId, { consent = true } = {}) {
  const courses = {};
  const cids = st("enr", `SELECT e.course_id cid FROM enrollment e JOIN course c ON c.id = e.course_id JOIN semester s ON s.id = c.semester_id
      WHERE e.device_id = ? AND c.visible = 1 AND s.visible = 1 ORDER BY e.sort, e.course_id`).all(deviceId).map(r => r.cid);
  for (const cid of cids) {
    if (!consent) { courses[cid] = { state: "no_consent" }; continue; }
    const r = st("sum", `SELECT state, json_extract(det, '$.made_at') made_at, json_extract(det, '$.ev_rid') rid, json_extract(det, '$.dfp') dfp, json_array_length(det, '$.findings') nf,
        json_extract(det, '$.findings[0].type') tt, json_extract(det, '$.findings[0].unit.name') tn FROM insight
        WHERE device_id = ? AND course_id = ? AND json_extract(det, '$.made_at') IS NOT NULL`).get(deviceId, cid);
    const g = gate(deviceId, cid), n = r ? since(deviceId, cid, r.rid) : 0, stale = r ? staleOf(deviceId, cid, r) : false, can_make = r ? canMake(g, r, n, stale) : g.can_make;
    courses[cid] = r ? { state: r.state, made_at: r.made_at, since: { answers: n }, stale, can_make, n_findings: r.nf ?? null, top_type: r.tt ?? null, top_name: r.tn ?? null }
      : { state: "none", made_at: null, since: null, can_make, n_findings: null, top_type: null, top_name: null };
  }
  return { courses };
}

/** 과목이 있고 보이는가 (라우트가 동의 확인보다 먼저 404를 가른다) */
export const courseVisible = cid => !!st("vis", "SELECT 1 FROM course c JOIN semester s ON s.id = c.semester_id WHERE c.id = ? AND c.visible = 1 AND s.visible = 1").get(cid);

/** 켠 직후 한 번: 보이는 과목의 내용 묶음을 만들고 빈 기록으로 엔진을 한 번 돌려 둔다 (첫 뽑기가 JIT·묶음 만들기를 기다리지 않게) */
export function warmUp() {
  for (const { id } of db.prepare("SELECT c.id FROM course c JOIN semester s ON s.id = c.semester_id WHERE c.visible = 1 AND s.visible = 1").all()) {
    try { const ctx = courseCtx(id); if (ctx) buildReport({ events: [], progress: [], grades: [], aux: [], fp: null }, ctx, PARAMS, kstDay()); }
    catch (e) { console.error("[insight] 데우기 실패", id, e && e.message); }
  }
}

/** 시험용: 메모리 캐시 비우기 */
export const clearInsightCache = () => LRU.clear();
