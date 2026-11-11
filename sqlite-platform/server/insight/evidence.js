// 학습 리포트: 한 기기·한 과목의 풀이 기록 읽기 (Contract 1). SQL만 쓰고 계산은 엔진이 한다.
// event는 event_device(device_id, type, problem_id) 색인으로, progress는 기본 키로 읽는다 (서술형 답안 글은 읽지 않는다).
import { createHash } from "node:crypto";
import { db, J } from "../db.js";
import { ENGINE_VER } from "../../web/js/insight-engine.js";

const ANS = new Set(["answer_submit", "idk"]);
const TYPES = "'answer_submit','idk','ai_copy','sol_dwell','bookmark'";     // 뒤 셋은 행동 기록 (TIME_FACTORS §6, raw.aux)
const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);
const obj = s => { const o = J(s); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; };
const okTs = ts => typeof ts === "string" && Number.isFinite(Date.parse(ts));

/** → { events, progress, grades, aux }. events·aux는 (ts, rid) 순서 */
export function loadRaw(deviceId, cid) {
  const events = [], aux = [];
  let fix = false;
  for (const r of st("ev", `SELECT e.rowid rid, e.problem_id pid, e.version v, e.type, e.session_id sid, e.client_ts ts, e.server_ts sts, e.payload FROM event e
      JOIN problem p ON p.id = e.problem_id WHERE e.device_id = ? AND e.type IN (${TYPES}) AND p.course_id = ? ORDER BY e.client_ts, e.rowid`).all(deviceId, cid)) {
    const ts = okTs(r.ts) ? r.ts : (fix = true, r.sts);              // 기기 시각이 깨졌으면 서버가 받은 시각
    (ANS.has(r.type) ? events : aux).push({ rid: r.rid, pid: r.pid, v: r.v, type: r.type, sid: r.sid, ts, p: obj(r.payload) });
  }
  if (fix) for (const L of [events, aux]) L.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.rid - b.rid));
  const progress = st("pr", `SELECT pr.problem_id pid, pr.version v, pr.status, pr.attempts, pr.wrong_count, pr.last_answer, pr.updated_at FROM progress pr
      JOIN problem p ON p.id = pr.problem_id WHERE pr.device_id = ? AND p.course_id = ?`).all(deviceId, cid).map(r => ({ ...r }));
  const grades = st("gr", `SELECT g.id, g.problem_id pid, g.version v, g.result, g.user_verdict, g.created_at FROM ai_grade g
      JOIN problem p ON p.id = g.problem_id WHERE g.device_id = ? AND p.course_id = ? ORDER BY g.created_at, g.id`).all(deviceId, cid).map(r => {
    const R = obj(r.result), pts = Array.isArray(R.points) ? R.points : [];       // 판정만 (이유·피드백 글은 빼고)
    return { id: r.id, pid: r.pid, v: r.v, result: { verdict: R.verdict ?? null, points: pts.map(x => ({ i: x && x.i, verdict: x && x.verdict })) },
      user_verdict: r.user_verdict, created_at: r.created_at };
  });
  return { events, progress, grades, aux };
}

/** 기록이 바뀌었는지 보는 지문 (SPEC §11.2): 색인만 쓰는 집계 셋 + 과목 내용 키 + 엔진 판 + 한국 날짜. ctxKey를 null로 주면 기록만 본 지문(dfp: 뽑은 뒤 기록이 바뀌었는지) */
export function fingerprint(deviceId, cid, ctxKey, nowDay) {
  const e = st("fe", `SELECT MAX(e.rowid) m, COUNT(*) n FROM event e JOIN problem p ON p.id = e.problem_id
      WHERE e.device_id = ? AND e.type IN (${TYPES}) AND p.course_id = ?`).get(deviceId, cid);
  const p = st("fp", `SELECT MAX(pr.updated_at) m, COUNT(*) n, TOTAL(pr.attempts) a, TOTAL(pr.wrong_count) w,
      TOTAL(pr.status = 'correct') c, TOTAL(pr.status = 'resolved') r FROM progress pr JOIN problem p ON p.id = pr.problem_id
      WHERE pr.device_id = ? AND p.course_id = ?`).get(deviceId, cid);
  const g = st("fg", `SELECT MAX(g.id) m, COUNT(g.user_verdict) n, TOTAL(CASE g.user_verdict WHEN 'correct' THEN g.id WHEN 'wrong' THEN -g.id END) u
      FROM ai_grade g JOIN problem p ON p.id = g.problem_id WHERE g.device_id = ? AND p.course_id = ?`).get(deviceId, cid);
  const s = [e.m, e.n, p.m, p.n, p.a, p.w, p.c, p.r, g.m, g.n, g.u, ...(ctxKey == null ? [] : [ctxKey, ENGINE_VER, nowDay])].join("|");   // ctxKey null = 기록만 (내용·판·날짜 빼고)
  return createHash("sha1").update(s).digest("base64url").slice(0, 20);
}
