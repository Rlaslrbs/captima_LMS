// 기기 · 내 강의실 · 풀이 기록 · 이어 풀기 · 이벤트를 관리한다.
// - 모든 기록은 먼저 이 브라우저(localStorage)에 저장한다 → 화면이 바로 바뀌고, 오프라인에서도 동작한다.
// - 데이터 수집에 동의한 기기만 서버와 동기화하고 이벤트를 보낸다. 동의하지 않으면 기록은 이 기기에만 남는다.
import { LS, rid } from "./util.js";

const listeners = new Set();
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = what => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });

export const S = {
  device: LS.get("device", null),          // { id, nickname, consent }
  enroll: LS.get("enroll", []),            // 담은 과목 id (순서 = 화면 순서)
  progress: LS.get("progress", {}),        // problem_id → { status, attempts, wrong_count, last_answer, updated_at, version, cid }
  resume: LS.get("resume", {}),            // scope_key → problem_id
  saved: LS.get("saved", {}),              // 나중에 볼 문제: problem_id → { cid, at }
  last: LS.get("last", {}),                // course_id → { set, at }  (홈의 "이어 풀기")
  exam: LS.get("exam", {}),                // course_id → "YYYY-MM-DD" 시험일 (이 기기에만 저장)
  catalog: null,                           // GET /api/catalog
  online: navigator.onLine,
};
const pending = Object.assign({ progress: {}, enroll: false, resume: {}, saved: {} }, LS.get("pending", {}));
pending.saved ||= {};
const savePending = () => LS.set("pending", pending);
const synced = () => !!(S.device && S.device.consent);

// ───────── 서버 요청 ─────────
export async function api(method, path, body, { keepalive = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (S.device) headers["X-Device"] = S.device.id;
  let res;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), keepalive }); }
  catch (e) { setOnline(false); throw e; }          // 서버에 닿지 못함 (인터넷 끊김·서버 꺼짐)
  setOnline(true);                                   // 응답이 왔으면 연결된 것 (오류 응답이어도)
  let data = null; try { data = await res.json(); } catch { }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

// ───────── 기기 ─────────
export const hasDevice = () => !!S.device;
/** 받아 둔 학습 리포트(ins:<과목>)를 모두 지운다: 기기가 바뀌면 지난 기기 리포트를 그리지 않게 */
function dropInsight() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("mn:ins:")) localStorage.removeItem(k); } } catch { }
}
export async function createDevice({ consent, nickname = "" }) {
  dropInsight();
  S.device = { id: rid(16), nickname, consent: !!consent }; LS.set("device", S.device);
  try { await api("POST", "/api/device", S.device); } catch { }
  if (consent) uploadAll();
  emit("device");
}
export async function updateDevice(patch) {
  const was = synced();
  Object.assign(S.device, patch); LS.set("device", S.device);
  await api("POST", "/api/device", { id: S.device.id, ...patch });
  if (!was && synced()) uploadAll();          // 동의로 바꾸면 이 기기에만 있던 기록을 올린다
  emit("device");
}
/** 기기 이동: 받은 ID로 바꾸고, 그 ID의 기록을 서버에서 받아 온다. 이 기기에만 있던 기록은 버린다. */
export async function adoptDevice(id) {
  S.device = { id, nickname: "", consent: true };
  const me = await api("GET", "/api/me");
  S.device = { id, nickname: me.nickname || "", consent: !!me.consent }; LS.set("device", S.device);
  S.enroll = []; S.progress = {}; S.resume = {}; S.last = {}; S.saved = {};
  pending.progress = {}; pending.enroll = false; pending.resume = {}; pending.saved = {}; savePending();
  ["enroll", "progress", "resume", "last", "saved"].forEach(k => LS.set(k, S[k])); dropInsight();
  await pull(); emit("all");
}

// ───────── 과목 목록 ─────────
export async function loadCatalog() {
  try { S.catalog = await api("GET", "/api/catalog"); LS.set("catalog", S.catalog); }
  catch { S.catalog = S.catalog || LS.get("catalog", { semesters: [] }); }
  return S.catalog;
}
export function courseMeta(id) {
  for (const s of (S.catalog?.semesters || [])) for (const c of s.courses) if (c.id === id) return { ...c, semester: s };
  return null;
}
const courseCache = new Map();
export async function loadCourse(id) {
  if (courseCache.has(id)) return courseCache.get(id);
  let c;
  try { c = await api("GET", "/api/course/" + id); LS.set("course:" + id, c); }
  catch (e) { c = LS.get("course:" + id, null); if (!c) throw e; }
  courseCache.set(id, c);
  return c;
}

// ───────── 내 강의실 ─────────
export const isEnrolled = id => S.enroll.includes(id);
export function setEnroll(ids) {
  S.enroll = [...new Set(ids)]; LS.set("enroll", S.enroll);
  if (synced()) { pending.enroll = true; savePending(); flushSoon(); }
  emit("enroll");
}
export const toggleEnroll = id => setEnroll(isEnrolled(id) ? S.enroll.filter(x => x !== id) : [...S.enroll, id]);

// ───────── 풀이 기록 ─────────
export function saveProgress(pid, rec) {
  S.progress[pid] = rec; LS.set("progress", S.progress);
  if (synced()) { pending.progress[pid] = rec; savePending(); flushSoon(); }
  emit("progress");
}
export function deleteProgress(pids) {
  pids.forEach(pid => { delete S.progress[pid]; if (synced()) pending.progress[pid] = { delete: true }; });
  LS.set("progress", S.progress); if (synced()) { savePending(); flushSoon(); }
  emit("progress");
}
/** 과목별 집계: { c, r, w, done, all } */
export function courseCounts(cid, all) {
  let c = 0, r = 0, w = 0, last = "";
  for (const k in S.progress) {
    const p = S.progress[k]; if (p.cid !== cid) continue;
    if (p.status === "correct") c++; else if (p.status === "resolved") r++; else if (p.status === "wrong") w++;
    if (p.updated_at > last) last = p.updated_at;
  }
  return { c, r, w, done: c + r + w, all: all ?? 0, last };
}

// ───────── 이어 풀기 ─────────
export function setResume(key, pid) {
  if (S.resume[key] === pid) return;
  S.resume[key] = pid; LS.set("resume", S.resume);
  if (synced()) { pending.resume[key] = pid; savePending(); flushSoon(2000); }
}
// ───────── 시험일 · D-day ─────────
export function setExam(cid, date) {
  if (date) S.exam[cid] = date; else delete S.exam[cid];
  LS.set("exam", S.exam); emit("exam");
}
/** 시험까지 남은 날 (오늘 = 0). 시험일이 없거나 지났으면 null */
export function dday(cid) {
  const d = S.exam[cid]; if (!d) return null;
  const t = new Date(), today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const [y, m, dd] = d.split("-").map(Number), n = Math.round((Date.UTC(y, m - 1, dd) - today) / 864e5);
  return n >= 0 ? n : null;
}
export const ddText = n => n === 0 ? "D-day" : "D-" + n;

// ───────── 나중에 볼 문제 (문제 카드의 책갈피) ─────────
export const isSaved = pid => !!S.saved[pid];
export function toggleSaved(pid, cid) {
  const on = !S.saved[pid], at = new Date().toISOString();
  if (on) S.saved[pid] = { cid, at }; else delete S.saved[pid];
  LS.set("saved", S.saved);
  if (synced()) { pending.saved[pid] = { on, at }; savePending(); flushSoon(); }
  emit("saved");
  return on;
}
export const savedCount = cid => Object.values(S.saved).filter(v => v.cid === cid).length;

export function setLast(cid, set, title = "") { S.last[cid] = { set, title, at: new Date().toISOString() }; LS.set("last", S.last); }   // title: 홈 "이어서 공부하기"에 보여 줄 범위 이름

// ───────── 서버와 동기화 ─────────
let flushT = null, flushing = false;
function flushSoon(ms = 800) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
export async function flush() {
  if (!synced() || flushing) return;
  flushing = true;
  try {
    const pids = Object.keys(pending.progress);
    for (let i = 0; i < pids.length; i += 400) {
      const chunk = pids.slice(i, i + 400);
      await api("PUT", "/api/me/progress", { items: chunk.map(pid => ({ problem_id: +pid, ...pending.progress[pid] })) });
      chunk.forEach(pid => delete pending.progress[pid]); savePending();
    }
    if (pending.enroll) { await api("PUT", "/api/me/enrollment", { courses: S.enroll }); pending.enroll = false; savePending(); }
    const sv = Object.entries(pending.saved);
    if (sv.length) { await api("PUT", "/api/me/bookmarks", { items: sv.map(([pid, v]) => ({ problem_id: +pid, ...v })) }); sv.forEach(([pid]) => delete pending.saved[pid]); savePending(); }
    for (const [k, pid] of Object.entries(pending.resume)) { await api("PUT", "/api/me/resume", { scope_key: k, problem_id: pid }); delete pending.resume[k]; savePending(); }
    setOnline(true);
  } catch (e) { if (!e.status) setOnline(false); flushSoon(15000); }
  finally { flushing = false; }
}
function uploadAll() {
  for (const [pid, rec] of Object.entries(S.progress)) pending.progress[pid] = rec;
  pending.enroll = true; Object.assign(pending.resume, S.resume);
  for (const [pid, v] of Object.entries(S.saved)) pending.saved[pid] = { on: true, at: v.at };
  savePending(); flush();
}
/** 서버의 기록을 받아 이 기기 기록과 합친다 (더 최근 것이 이김) */
export async function pull() {
  if (!synced()) return;
  try {
    const en = await api("GET", "/api/me/enrollment");
    if (!pending.enroll) { S.enroll = en.courses; LS.set("enroll", S.enroll); }
    const rs = await api("GET", "/api/me/resume");
    for (const [k, pid] of Object.entries(rs.resume)) if (!(k in pending.resume)) S.resume[k] = pid;
    LS.set("resume", S.resume);
    const bm = await api("GET", "/api/me/bookmarks");             // 나중에 볼 문제: 서버 목록 + 아직 못 보낸 이 기기 변경
    const next = {}; for (const b of bm.bookmarks) next[b.problem_id] = { cid: b.course_id, at: b.added_at };
    for (const [pid, v] of Object.entries(pending.saved)) { if (v.on) next[pid] = S.saved[pid] || { cid: null, at: v.at }; else delete next[pid]; }
    S.saved = next; LS.set("saved", S.saved);
    const cids = new Set([...S.enroll, ...Object.values(S.progress).map(p => p.cid)]);
    for (const cid of cids) await pullCourse(cid, false);
    LS.set("progress", S.progress); setOnline(true); emit("all");
  } catch (e) { if (!e.status) setOnline(false); }
}
export async function pullCourse(cid, notify = true) {
  if (!synced()) return;
  const { progress } = await api("GET", "/api/me/progress?course=" + cid);
  const seen = new Set();
  for (const row of progress) {
    const pid = row.problem_id; seen.add(String(pid));
    if (pending.progress[pid]) continue;
    const mine = S.progress[pid];
    if (!mine || (row.updated_at || "") >= (mine.updated_at || "")) {
      const { problem_id, ...rest } = row; S.progress[pid] = { ...rest, cid };
    }
  }
  // 다른 기기에서 지운 기록: 서버에서 유효한 응답이 왔을 때만 반영 (네트워크 불안정 시 로컬 기록 전멸 방지)
  if (Array.isArray(progress) && progress.length > 0) {
    for (const pid in S.progress) if (S.progress[pid].cid === cid && !seen.has(pid) && !pending.progress[pid]) delete S.progress[pid];
  }
  if (notify) { LS.set("progress", S.progress); emit("all"); }
}
// 연결 상태. 끊기면 15초마다 서버(/health)를 확인해서, 다시 닿으면 표시를 지우고 밀린 기록·이벤트를 보낸다
let probeT = null;
function setOnline(v) {
  if (S.online !== v) { S.online = v; emit("online"); }
  if (v && probeT) { clearInterval(probeT); probeT = null; }
  if (!v && !probeT) probeT = setInterval(async () => {
    try { const r = await fetch("/health", { cache: "no-store" }); if (r.ok) { setOnline(true); flush(); sendEvents(); } } catch { }
  }, 15000);
}

// ───────── 이벤트 (풀이 로그) ─────────
// 모아서 보내고, 오프라인이면 브라우저에 쌓아 두었다가 다시 보낸다.
const SESSION = (() => { try { let s = sessionStorage.getItem("mn:session"); if (!s) { s = rid(12); sessionStorage.setItem("mn:session", s); } return s; } catch { return rid(12); } })();
// 이번 브라우저 세션(탭)이 시작된 시각과 그 안에서 몇 번째 답인지 (모든 과목 공통) → answer_submit의 sess·pos (오래 풀면 정확도가 떨어지는지 보려고)
const SS = { get: k => { try { return sessionStorage.getItem("mn:" + k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem("mn:" + k, String(v)); } catch { } } };
let sessAt = +SS.get("sessAt"); if (!sessAt) { sessAt = Date.now(); SS.set("sessAt", sessAt); }
let ansN = +SS.get("ansN") || 0;
export const sessionSec = () => Math.round((Date.now() - sessAt) / 1000);
export function nextPos() { ansN++; SS.set("ansN", ansN); return ansN; }
let evq = LS.get("evq", []);
let evT = null, evBusy = false;
export function track(type, { problem_id = null, version = null, ...payload } = {}) {
  if (!synced()) return;
  evq.push({ id: rid(16), session_id: SESSION, type, problem_id, version, client_ts: new Date().toISOString(), payload });
  if (evq.length > 200) evq = evq.slice(-200);       // 아주 오래 오프라인일 때 저장 공간 보호 (200개 상한)
  LS.set("evq", evq);
  clearTimeout(evT); evT = setTimeout(sendEvents, evq.length >= 20 ? 0 : 4000);
}
export async function sendEvents({ keepalive = false } = {}) {
  if (!synced() || evBusy || !evq.length) return;
  evBusy = true;
  const batch = evq.slice(0, 200);
  try {
    await api("POST", "/api/events", { events: batch }, { keepalive });
    const sent = new Set(batch.map(e => e.id)); evq = evq.filter(e => !sent.has(e.id)); LS.set("evq", evq);
    setOnline(true);
    if (evq.length) setTimeout(sendEvents, 300);
  } catch (e) { if (!e.status) setOnline(false); clearTimeout(evT); evT = setTimeout(sendEvents, 20000); }
  finally { evBusy = false; }
}

// 탭을 숨기거나 닫을 때 남은 것 보내기, 다시 연결되면 보내기
let hiddenAt = 0, hiddenTotal = 0;
export const hiddenMs = () => hiddenTotal + (hiddenAt ? Date.now() - hiddenAt : 0);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); track("visibility", { state: "hidden" }); sendEvents({ keepalive: true }); flush(); }
  else { if (hiddenAt) hiddenTotal += Date.now() - hiddenAt; hiddenAt = 0; track("visibility", { state: "visible" }); }
});
window.addEventListener("online", () => { setOnline(true); flush(); sendEvents(); });
window.addEventListener("offline", () => setOnline(false));

export function startSession() {
  track("session_start", {
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    device: matchMedia("(hover: none) and (pointer: coarse)").matches ? (Math.min(screen.width, screen.height) >= 700 ? "tablet" : "phone") : "desktop",
  });
  flush(); sendEvents();
}

if (!S.online) setOnline(false);          // 처음 열 때부터 끊겨 있었으면 확인을 시작
