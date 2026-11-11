// 문제노트 플랫폼 서버.  실행: node server/server.js   (Node 24 내장 기능만 사용)
// 환경 변수: PORT(기본 4000), HOST(기본 127.0.0.1 — 같은 와이파이의 폰에서 쓰려면 0.0.0.0)
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, normalize, basename } from "node:path";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { gzipSync, brotliCompressSync, constants as Z } from "node:zlib";
import { db, ROOT, DATA, now, J, tx, importPack, checkPack, coursePayload, problemStats, overview, versionStats, activity, backup, listBackups, BACKUP_DIR, aiSave, aiSetUserVerdict, aiStats, carryTags } from "./db.js";
import * as ai from "./ai.js";
import { initInsight, getSnap, makeSnap, overview as insightOverview, courseVisible, warmUp } from "./insight/report.js";
import { insightAdmin, initTagger } from "./insight/admin.js";

const PORT = +process.env.PORT || 4000;
const HOST = process.env.HOST || "127.0.0.1";

// 관리자 비밀 주소: 처음 실행할 때 만들어 data/admin_path.txt에 저장
const ADMIN_FILE = join(DATA, "admin_path.txt");
if (!existsSync(ADMIN_FILE)) writeFileSync(ADMIN_FILE, "admin-" + randomBytes(9).toString("hex") + "\n");
const ADMIN = "/" + readFileSync(ADMIN_FILE, "utf8").trim();

// ───────── 바깥(Cloudflare Tunnel)에서 온 요청 ─────────
// Tunnel은 맥 안의 cloudflared가 127.0.0.1로 넘겨 준다. Cloudflare가 붙이는 CF-Connecting-IP 헤더로 바깥 요청을 구분한다.
// 관리자 로그인이 생기기 전까지 관리자 화면은 맥 안에서만 열린다 (ADMIN_REMOTE=1이면 바깥에서도 열림).
const viaTunnel = req => !!(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
const clientIp = req => String(req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "");
const ADMIN_REMOTE = process.env.ADMIN_REMOTE === "1";
// 관리자 화면은 이 맥 자신(127.0.0.1)에서 온 요청만 받는다. HOST=0.0.0.0으로 켜도 같은 와이파이의 다른 기기는 못 들어온다
const fromThisMac = req => !viaTunnel(req) && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// 관리자 비밀번호 보호 (ADMIN_PASSWORD 환경 변수 지정 시 동작, 미지정 시 맥 로컬 비밀 주소로 동작)
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const adminSessions = new Map(); // token -> expiryMs
function getAdminCookie(req) {
  const cookie = String(req.headers["cookie"] || "");
  const m = cookie.match(/\bmn_admin_token=([A-Za-z0-9_-]{24,64})\b/);
  return m ? m[1] : null;
}
function isAdminAuthed(req) {
  if (!ADMIN_PASSWORD) return true;
  const tok = getAdminCookie(req);
  if (!tok) return false;
  const exp = adminSessions.get(tok) || 0;
  if (Date.now() > exp) { adminSessions.delete(tok); return false; }
  return true;
}

// 요청 횟수 제한 (메모리, 키별). 학교 와이파이처럼 여러 명이 한 IP를 쓸 수 있어 넉넉하게 잡는다.
const hits = new Map();
function limited(key, max, ms) {
  const t = Date.now(); let h = hits.get(key);
  if (!h || t > h.reset) { h = { n: 0, reset: t + ms }; hits.set(key, h); }
  return ++h.n > max;
}
setInterval(() => { const t = Date.now(); for (const [k, h] of hits) if (t > h.reset) hits.delete(k); }, 6e4).unref();
const LIMITS = {                                   // [최대 횟수, 시간(ms), 기준]
  "POST /api/device": [300, 36e5, "ip"],
  "POST /api/events": [120, 6e4, "device"],
  "POST /api/reports": [60, 36e5, "ip"],
  "POST /api/transfer": [10, 36e5, "device"],
  "POST /api/transfer/claim": [20, 6e5, "ip"],    // 6자리 코드를 마구 넣어 보는 것 막기
  "POST /api/grade": [40, 36e5, "device"],         // AI 채점 도우미 (비용·한도 보호)
  "GET /api/me/insight": [120, 36e5, "device"],     // 학습 리포트 개요
  "GET /api/me/insight/:cid": [240, 36e5, "device"],
  "POST /api/me/insight/:cid": [30, 864e5, "device"],   // 리포트 뽑기 (엔진 계산은 여기서만)
};

// 보안 헤더: 다른 사이트에 끼워 넣기 금지, 파일 형식 추측 금지, 스크립트는 우리 서버와 MathJax(jsdelivr)만
const SEC = {
  "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

// ───────── 압축 · 캐시 ─────────
// 1KB가 넘는 글(JSON·HTML·JS·CSS)은 brotli(브라우저가 받으면) 또는 gzip으로 줄여 보낸다.
const encOf = req => { const ae = String(req.headers["accept-encoding"] || ""); return /\bbr\b/.test(ae) ? "br" : /\bgzip\b/.test(ae) ? "gzip" : null; };
const squeeze = (buf, enc) => enc === "br"
  ? brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 5, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } })
  : gzipSync(buf, { level: 6 });
const etagOf = buf => '"' + createHash("sha1").update(buf).digest("base64url").slice(0, 20) + '"';

/** 한 번 만든 응답(원본 + 압축본)을 기억해 두었다가 다시 쓴다. 바뀌지 않았으면 304로 본문 없이 답한다 */
class Packed {
  constructor(buf, type) { this.buf = buf; this.type = type; this.etag = etagOf(buf); this.z = {}; }
  body(enc) { return !enc || this.buf.length < 1024 ? [this.buf, null] : [this.z[enc] ||= squeeze(this.buf, enc), enc]; }
}
function sendPacked(req, res, pk, cache = "no-cache", extra = {}) {
  const h = { ...SEC, "Content-Type": pk.type, "Cache-Control": cache, ETag: pk.etag, Vary: "Accept-Encoding", ...extra };
  if (String(req.headers["if-none-match"] || "").split(/\s*,\s*/).includes(pk.etag)) { res.writeHead(304, h); return res.end(); }
  const [buf, enc] = pk.body(encOf(req));
  res.writeHead(200, { ...h, "Content-Length": buf.length, ...(enc ? { "Content-Encoding": enc } : {}) });
  res.end(req.method === "HEAD" ? undefined : buf);
}

// 과목 목록·과목 문제는 문제·과목이 바뀔 때까지 같은 응답을 쓴다.
// 바뀌는 때: 관리자 웹에서 쓰기(contentVer), 다른 프로그램이 DB를 고침(import.js 등 → SQLite data_version)
let contentVer = 1;
const apiCache = new Map();
const dataVersion = () => db.prepare("PRAGMA data_version").get().data_version;
function cachedJson(key, make) {
  const k = contentVer + "." + dataVersion() + "|" + key;
  if (!apiCache.has(k)) {
    const v = make(); if (v == null) return null;
    if (apiCache.size > 40) apiCache.clear();
    apiCache.set(k, new Packed(Buffer.from(JSON.stringify(v)), "application/json; charset=utf-8"));
  }
  return apiCache.get(k);
}
// 학습 리포트는 기기마다 따로 캐시한다 (server/insight/report.js). 관리자 쓰기 횟수만 넘겨준다
initInsight({ Packed, contentVer: () => contentVer });

// ───────── 작은 도우미 ─────────
const send = (res, code, body, headers = {}) => {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(isObj ? JSON.stringify(body) : String(body));
  const enc = buf.length >= 1024 && res.req ? encOf(res.req) : null;      // 관리자 통계처럼 큰 응답도 줄여 보낸다
  if (enc) buf = squeeze(buf, enc);
  res.writeHead(code, { ...SEC, "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store",
    "Content-Length": buf.length, ...(enc ? { "Content-Encoding": enc, Vary: "Accept-Encoding" } : {}), ...headers });
  res.end(buf);
};
const fail = (res, code, msg) => send(res, code, { error: msg });
async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error("요청이 너무 커요"), { status: 413 }); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("JSON 형식이 아니에요"), { status: 400 }); }
}
const str = (v, max) => String(v ?? "").slice(0, max);
const isId = v => typeof v === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(v);

/** 사용자 요청: 헤더 X-Device의 익명 ID로 기기를 찾는다. last_seen은 1분에 한 번만 DB에 쓴다 (메모리 디바운스 + DB 락 경합 방지) */
const deviceSeen = new Map();
function device(req) {
  const id = req.headers["x-device"];
  if (!isId(id)) return null;
  const d = db.prepare("SELECT * FROM device WHERE id = ?").get(id);
  if (d) {
    const t = Date.now(), last = deviceSeen.get(id) || 0;
    const ago = new Date(t - 6e4).toISOString();
    if (t - last > 6e4 && !(d.last_seen >= ago)) {
      deviceSeen.set(id, t);
      db.prepare("UPDATE device SET last_seen = ? WHERE id = ? AND last_seen < ?").run(now(), id, ago);
    }
  }
  return d || null;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of deviceSeen) if (t - v > 864e5) deviceSeen.delete(k); }, 36e5).unref();

// ───────── 정적 파일 (web/, admin/) ─────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const TEXT = new Set([".html", ".js", ".css", ".json", ".svg"]);
const fileCache = new Map();          // 글 파일: 경로 → { mtime, size, pk }
function serveStatic(req, res, base, rel) {
  const p = normalize(join(base, rel || "index.html"));
  if (!p.startsWith(base)) return fail(res, 403, "forbidden");
  let file = p;
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(base, "index.html");   // 한 페이지 앱: 모르는 경로는 index로
  if (!existsSync(file)) return fail(res, 404, "not found");
  const ext = extname(file), type = TYPES[ext] || "application/octet-stream", st = statSync(file);
  if (TEXT.has(ext)) {                // 파일이 바뀌면(수정 시각·크기) 다시 읽어 압축한다
    let c = fileCache.get(file);
    if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) { c = { mtime: st.mtimeMs, size: st.size, pk: new Packed(readFileSync(file), type) }; fileCache.set(file, c); }
    return sendPacked(req, res, c.pk);
  }
  const etag = '"' + st.size.toString(36) + "-" + Math.floor(st.mtimeMs).toString(36) + '"';
  const h = { ...SEC, "Content-Type": type, ETag: etag, "Cache-Control": ext === ".woff2" ? "public, max-age=604800" : "no-cache" };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, h); return res.end(); }
  res.writeHead(200, { ...h, "Content-Length": st.size });
  createReadStream(file).pipe(res);
}

// ───────── 사용자 API ─────────
const INSIGHT_DEV = process.env.INSIGHT_DEV === "1";
function insightRoute(m, d, fn) {
  const cid = +m.cid;
  if (!Number.isInteger(cid) || cid <= 0 || !courseVisible(cid)) return { $status: 404, error: "없는 과목이에요" };
  if (!d.consent) return { v: 1, cid, state: "no_consent" };
  const t = performance.now(), pk = fn(d.id, cid);
  if (!pk) return { $status: 404, error: "없는 과목이에요" };
  return { $packed: pk, $cache: "private, no-cache",
    $headers: { Vary: "Accept-Encoding, X-Device", "Server-Timing": `insight;dur=${(performance.now() - t).toFixed(2)}` } };
}
const user = {
  // 화면이 켜고 끌 기능 (insight_ai: AI 정리, P4). insight_dev: 개발용 예시 리포트 (INSIGHT_DEV=1로 켠 서버에서만)
  "GET /api/features": () => ({ ai_grade: ai.enabled(), insight: true, insight_ai: false, ...(INSIGHT_DEV ? { insight_dev: true } : {}) }),

  // AI 채점 도우미 (서술형). body: { problem_id, answer, consent: true }. 최종 판정은 사용자가 한다
  "POST /api/grade": async (req, m, body, d) => {
    if (!ai.enabled()) return { $status: 503, error: "AI 채점이 꺼져 있어요" };
    if (body.consent !== true) return { $status: 400, error: "AI 채점 동의가 필요해요" };
    const p = db.prepare(`SELECT p.id, p.current_version v, p.status, pv.kind, pv.body FROM problem p
        JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE p.id = ?`).get(+body.problem_id);
    if (!p || p.status !== "published") return { $status: 404, error: "없는 문제예요" };
    if (p.kind !== "essay") return { $status: 400, error: "서술형 문제만 AI 채점을 할 수 있어요" };
    const answer = str(body.answer, 4000).trim();
    if (answer.length < 5) return { $status: 400, error: "답안을 조금 더 써 주세요" };
    try {
      const r = await ai.gradeEssay({ id: p.id, v: p.v, body: J(p.body) }, answer);
      const id = aiSave({ deviceId: d.id, problemId: p.id, version: p.v, answer, result: r.result, model: r.model, ms: r.cached ? 0 : r.ms });
      return { id, ...r.result, model: r.model, cached: r.cached };
    } catch (e) { return { $status: e.status || 502, error: e.message || "AI 채점에 실패했어요" }; }
  },
  "PUT /api/grade/:id": (req, m, body, d) => {     // 사용자의 최종 판정을 붙인다 (일치율 계산)
    const v = ["correct", "wrong"].includes(body.verdict) ? body.verdict : null;
    if (!v) return { $status: 400, error: "verdict는 correct / wrong" };
    return { saved: aiSetUserVerdict(+m.id, d.id, v) };
  },

  "GET /api/catalog": () => ({ $packed: cachedJson("catalog", () => {
    const sems = db.prepare("SELECT id, code, name FROM semester WHERE visible = 1 ORDER BY sort, code DESC").all();
    const courses = db.prepare(`SELECT c.id, c.semester_id, c.code, c.short, c.name, c.professor, c.meta, c.info,
        (SELECT COUNT(*) FROM problem WHERE course_id = c.id AND status = 'published') problems
        FROM course c WHERE c.visible = 1 ORDER BY c.sort`).all();
    return { semesters: sems.map(s => ({ ...s, courses: courses.filter(c => c.semester_id === s.id).map(({ info, semester_id, ...c }) => {
      const i = J(info); return { ...c, color: i.color, lang: i.lang, math: i.math }; }) })) };
  }) }),
  "GET /api/course/:id": (req, m) => {
    const pk = cachedJson("course:" + (+m.id), () => coursePayload(+m.id));
    return pk ? { $packed: pk } : { $status: 404, error: "없는 과목이에요" };
  },

  "POST /api/device": (req, m, body) => {
    const id = body.id; if (!isId(id)) return { $status: 400, error: "기기 ID가 잘못됐어요" };
    const t = now(); const old = db.prepare("SELECT * FROM device WHERE id = ?").get(id);
    if (!old) db.prepare("INSERT INTO device(id, nickname, consent, created_at, last_seen) VALUES (?,?,?,?,?)").run(id, str(body.nickname, 20), body.consent ? 1 : 0, t, t);
    else db.prepare("UPDATE device SET nickname = COALESCE(?, nickname), consent = COALESCE(?, consent), last_seen = ? WHERE id = ?")
      .run(body.nickname === undefined ? null : str(body.nickname, 20), body.consent === undefined ? null : (body.consent ? 1 : 0), t, id);
    return db.prepare("SELECT id, nickname, consent, created_at FROM device WHERE id = ?").get(id);
  },
  "GET /api/me": (req, m, b, d) => {
    const rows = db.prepare(`SELECT p.course_id, pr.status, COUNT(*) n, MAX(pr.updated_at) last FROM progress pr JOIN problem p ON p.id = pr.problem_id
        WHERE pr.device_id = ? GROUP BY p.course_id, pr.status`).all(d.id);
    const by = {};
    for (const r of rows) { const c = by[r.course_id] ||= { correct: 0, wrong: 0, resolved: 0, last: "" }; c[r.status] = r.n; if (r.last > c.last) c.last = r.last; }
    return { id: d.id, nickname: d.nickname, consent: !!d.consent, created_at: d.created_at, courses: by };
  },
  "GET /api/me/enrollment": (req, m, b, d) => ({ courses: db.prepare("SELECT course_id FROM enrollment WHERE device_id = ? ORDER BY sort").all(d.id).map(r => r.course_id) }),
  "PUT /api/me/enrollment": (req, m, body, d) => {
    const ids = [...new Set((body.courses || []).map(Number).filter(Number.isInteger))].slice(0, 50);
    tx(() => {
      db.prepare("DELETE FROM enrollment WHERE device_id = ?").run(d.id);
      const ins = db.prepare("INSERT INTO enrollment(device_id, course_id, sort, added_at) SELECT ?, id, ?, ? FROM course WHERE id = ?");
      ids.forEach((cid, i) => ins.run(d.id, i, now(), cid));
    });
    return { courses: ids };
  },
  "GET /api/me/progress": (req, m, b, d, q) => {
    const cid = +q.get("course");
    const rows = db.prepare(`SELECT pr.problem_id, pr.version, pr.status, pr.attempts, pr.wrong_count, pr.last_answer, pr.updated_at
        FROM progress pr JOIN problem p ON p.id = pr.problem_id WHERE pr.device_id = ? AND (? = 0 OR p.course_id = ?)`).all(d.id, cid || 0, cid || 0);
    return { progress: rows };
  },
  "PUT /api/me/progress": (req, m, body, d) => {
    const items = (Array.isArray(body.items) ? body.items : [body]).slice(0, 500);
    const up = db.prepare(`INSERT INTO progress(device_id, problem_id, version, status, attempts, wrong_count, last_answer, updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(device_id, problem_id) DO UPDATE SET version=excluded.version, status=excluded.status, attempts=excluded.attempts,
        wrong_count=excluded.wrong_count, last_answer=excluded.last_answer, updated_at=excluded.updated_at WHERE excluded.updated_at >= progress.updated_at`);
    const del = db.prepare("DELETE FROM progress WHERE device_id = ? AND problem_id = ?");
    let n = 0;
    const serverNow = now();
    tx(() => items.forEach(it => {
      const pid = +it.problem_id; if (!Number.isInteger(pid)) return;
      if (it.delete) { del.run(d.id, pid); n++; return; }
      if (!["correct", "wrong", "resolved"].includes(it.status)) return;
      let uat = str(it.updated_at, 40) || serverNow;
      const tParsed = Date.parse(uat);
      // 클라이언트 시계가 5분 이상 앞선 경우 서버 시간으로 보정해 이후 정상 기록이 거부되는 결함 방지
      if (!Number.isFinite(tParsed) || tParsed > Date.now() + 5 * 6e4) uat = serverNow;
      up.run(d.id, pid, +it.version || 1, it.status, +it.attempts || 1, +it.wrong_count || 0, str(it.last_answer, 600), uat); n++;
    }));
    return { saved: n };
  },
  "GET /api/me/bookmarks": (req, m, b, d) => ({ bookmarks: db.prepare(`SELECT bm.problem_id, p.course_id, bm.added_at FROM bookmark bm
      JOIN problem p ON p.id = bm.problem_id WHERE bm.device_id = ? ORDER BY bm.added_at DESC`).all(d.id) }),
  "PUT /api/me/bookmarks": (req, m, body, d) => {             // items: [{ problem_id, on, at }]
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500);
    const add = db.prepare("INSERT INTO bookmark(device_id, problem_id, added_at) SELECT ?, id, ? FROM problem WHERE id = ? ON CONFLICT DO NOTHING");
    const del = db.prepare("DELETE FROM bookmark WHERE device_id = ? AND problem_id = ?");
    let n = 0;
    tx(() => items.forEach(it => {
      const pid = +it.problem_id; if (!Number.isInteger(pid)) return;
      if (it.on) add.run(d.id, str(it.at, 40) || now(), pid); else del.run(d.id, pid);
      n++;
    }));
    return { saved: n };
  },
  "GET /api/me/resume": (req, m, b, d) => ({ resume: Object.fromEntries(db.prepare("SELECT scope_key, problem_id FROM resume WHERE device_id = ?").all(d.id).map(r => [r.scope_key, r.problem_id])) }),
  "PUT /api/me/resume": (req, m, body, d) => {
    if (!body.scope_key || !Number.isInteger(+body.problem_id)) return { $status: 400, error: "scope_key, problem_id가 필요해요" };
    db.prepare(`INSERT INTO resume(device_id, scope_key, problem_id, updated_at) VALUES (?,?,?,?)
        ON CONFLICT(device_id, scope_key) DO UPDATE SET problem_id=excluded.problem_id, updated_at=excluded.updated_at`).run(d.id, str(body.scope_key, 200), +body.problem_id, now());
    return { ok: true };
  },
  // 학습 리포트 (server/insight/). 풀이 기록에 동의한 기기만. 보기(GET)는 저장한 것만, 뽑기(POST)만 계산한다 (결정 7)
  // 기기마다 내용이 달라 private + Vary: X-Device, 그대로면 304
  "GET /api/me/insight": (req, m, b, d) => insightOverview(d.id, { consent: !!d.consent }),
  "GET /api/me/insight/:cid": (req, m, b, d) => insightRoute(m, d, getSnap),
  "POST /api/me/insight/:cid": (req, m, b, d) => insightRoute(m, d, makeSnap),
  "POST /api/events": (req, m, body, d) => {
    if (!d.consent) return { stored: 0, skipped: "동의하지 않은 기기는 기록을 모으지 않아요" };
    const evs = (body.events || []).slice(0, 200); const t = now(); let n = 0;
    const ins = db.prepare("INSERT OR IGNORE INTO event(id, device_id, session_id, problem_id, version, type, client_ts, server_ts, payload) VALUES (?,?,?,?,?,?,?,?,?)");
    tx(() => evs.forEach(e => {
      if (!isId(e.id) || typeof e.type !== "string") return;
      n += Number(ins.run(e.id, d.id, str(e.session_id, 64), Number.isInteger(+e.problem_id) && e.problem_id !== null ? +e.problem_id : null,
        Number.isInteger(+e.version) ? +e.version : null, str(e.type, 32), str(e.client_ts, 40) || t, t, JSON.stringify(e.payload || {}).slice(0, 2000)).changes);
    }));
    return { stored: n };
  },
  "POST /api/reports": (req, m, body, d) => {
    const p = db.prepare("SELECT id, current_version FROM problem WHERE id = ?").get(+body.problem_id);
    if (!p) return { $status: 400, error: "없는 문제예요" };
    const cat = ["answer", "explanation", "typo", "other"].includes(body.category) ? body.category : "other";
    const msg = str(body.message, 1000).trim();
    if (!msg && cat === "other") return { $status: 400, error: "내용을 적어 주세요" };
    const recent = db.prepare("SELECT COUNT(*) n FROM report WHERE device_id = ? AND created_at >= ?").get(d.id, new Date(Date.now() - 36e5).toISOString()).n;
    if (recent >= 20) return { $status: 429, error: "제보가 너무 많아요. 잠시 뒤에 다시 보내 주세요" };
    const r = db.prepare("INSERT INTO report(device_id, problem_id, version, category, message, created_at) VALUES (?,?,?,?,?,?)").run(d.id, p.id, p.current_version, cat, msg, now());
    return { id: Number(r.lastInsertRowid) };
  },
  "GET /api/me/reports": (req, m, b, d) => ({ reports: db.prepare(`SELECT r.id, r.category, r.message, r.status, r.admin_note, r.created_at, r.resolved_at,
      p.ext_id, c.short course, c.id course_id, p.id problem_id FROM report r JOIN problem p ON p.id = r.problem_id JOIN course c ON c.id = p.course_id
      WHERE r.device_id = ? ORDER BY r.created_at DESC`).all(d.id) }),
  "POST /api/transfer": (req, m, b, d) => {
    db.prepare("DELETE FROM transfer_code WHERE device_id = ? OR expires_at < ?").run(d.id, now());
    let code; do code = String(randomInt(0, 1e6)).padStart(6, "0"); while (db.prepare("SELECT 1 FROM transfer_code WHERE code = ?").get(code));
    const exp = new Date(Date.now() + 10 * 6e4).toISOString();
    db.prepare("INSERT INTO transfer_code(code, device_id, expires_at) VALUES (?,?,?)").run(code, d.id, exp);
    return { code, expires_at: exp };
  },
  "POST /api/transfer/claim": (req, m, body) => {
    // 기록 열쇠(= 기기 ID, 바뀌지 않음)를 넣으면 그 기기로 바로 이어 쓴다. 주소가 바뀌어 브라우저 저장소를 잃었을 때 되찾는 용도
    const key = String(body.key ?? "").trim();
    if (key) {
      const dv = isId(key) && db.prepare("SELECT id FROM device WHERE id = ?").get(key);
      return dv ? { device_id: dv.id } : { $status: 404, error: "열쇠가 맞지 않아요" };
    }
    const code = str(body.code, 6);
    const row = db.prepare("SELECT * FROM transfer_code WHERE code = ? AND expires_at >= ?").get(code, now());
    if (!row) return { $status: 404, error: "코드가 없거나 시간이 지났어요" };
    db.prepare("DELETE FROM transfer_code WHERE code = ?").run(code);
    return { device_id: row.device_id };   // 새 기기는 이 ID를 저장해 같은 기록을 이어 쓴다
  },
};

// ───────── 관리자 API (비밀 주소 아래) ─────────
const admin = {
  "GET /api/reports/unread-count": () => ({ open_reports: db.prepare("SELECT COUNT(*) n FROM report WHERE status = 'open'").get().n }),
  "GET /api/overview": () => ({ ...overview(), ai: { enabled: ai.enabled(), model: ai.MODEL, ...aiStats() } }),
  "GET /api/activity": (req, m, b, d, q) => ({ days: activity(Math.min(90, Math.max(1, +q.get("days") || 14))) }),
  "GET /api/stats/problems": (req, m, b, d, q) => ({ problems: problemStats({ courseId: +q.get("course") || null, since: q.get("since") || null }) }),
  "GET /api/reports": (req, m, b, d, q) => {
    const st = q.get("status") || "open";
    return { reports: db.prepare(`SELECT r.*, p.ext_id, p.current_version, c.short course, c.id course_id, d.nickname FROM report r
        JOIN problem p ON p.id = r.problem_id JOIN course c ON c.id = p.course_id LEFT JOIN device d ON d.id = r.device_id
        WHERE (? = 'all' OR r.status = ?) ORDER BY r.created_at DESC LIMIT 500`).all(st, st) };
  },
  "PATCH /api/reports/:id": (req, m, body) => {
    const st = ["open", "fixed", "rejected"].includes(body.status) ? body.status : null;
    if (!st) return { $status: 400, error: "status는 open/fixed/rejected" };
    db.prepare("UPDATE report SET status = ?, admin_note = ?, resolved_at = ? WHERE id = ?").run(st, str(body.admin_note, 500), st === "open" ? null : now(), +m.id);
    return db.prepare("SELECT * FROM report WHERE id = ?").get(+m.id);
  },
  "GET /api/semesters": () => ({ semesters: db.prepare("SELECT * FROM semester ORDER BY sort, code DESC").all() }),
  "POST /api/semesters": (req, m, body) => {
    const code = str(body.code, 10).trim(); if (!/^\d{2}-(1|2|S|W)$/.test(code)) return { $status: 400, error: "학기 코드는 26-1, 26-2 같은 형식이에요 (계절학기는 26-S, 26-W)" };
    if (db.prepare("SELECT 1 FROM semester WHERE code = ?").get(code)) return { $status: 409, error: "이미 있는 학기예요" };
    const r = db.prepare("INSERT INTO semester(code, name, sort) VALUES (?,?,?)").run(code, str(body.name, 30) || code, -(+code.slice(0, 2) * 10 + ({ 1: 1, S: 2, 2: 3, W: 4 })[code[3]]));
    return db.prepare("SELECT * FROM semester WHERE id = ?").get(Number(r.lastInsertRowid));
  },
  "PATCH /api/semesters/:id": (req, m, body) => {
    if (body.visible !== undefined) db.prepare("UPDATE semester SET visible = ? WHERE id = ?").run(body.visible ? 1 : 0, +m.id);
    if (body.name) db.prepare("UPDATE semester SET name = ? WHERE id = ?").run(str(body.name, 30), +m.id);
    return db.prepare("SELECT * FROM semester WHERE id = ?").get(+m.id);
  },
  "GET /api/courses": () => ({ courses: db.prepare(`SELECT c.id, c.semester_id, s.code semester, c.code, c.short, c.name, c.professor, c.meta, c.visible, c.sort,
      (SELECT COUNT(*) FROM problem WHERE course_id = c.id) problems FROM course c JOIN semester s ON s.id = c.semester_id ORDER BY s.sort, c.sort`).all() }),
  "PATCH /api/courses/:id": (req, m, body) => {
    const c = db.prepare("SELECT * FROM course WHERE id = ?").get(+m.id); if (!c) return { $status: 404, error: "없는 과목" };
    db.prepare("UPDATE course SET short=?, name=?, professor=?, meta=?, visible=?, sort=? WHERE id=?").run(
      str(body.short ?? c.short, 20), str(body.name ?? c.name, 60), str(body.professor ?? c.professor, 30), str(body.meta ?? c.meta, 120),
      body.visible === undefined ? c.visible : (body.visible ? 1 : 0), Number.isInteger(body.sort) ? body.sort : c.sort, c.id);
    return db.prepare("SELECT * FROM course WHERE id = ?").get(c.id);
  },
  "POST /api/import": (req, m, body, d, q) => importPack(body, { dry: q.get("dry") === "1", note: "관리자 웹에서 올림" }),
  "GET /api/backups": () => ({ backups: listBackups(), dir: BACKUP_DIR }),
  "POST /api/backups": () => ({ made: backup(), backups: listBackups() }),
  "GET /api/course/:id": (req, m) => coursePayload(+m.id) || { $status: 404, error: "없는 과목" },
  "GET /api/problems/:id": (req, m) => {
    const p = db.prepare("SELECT p.*, c.short course, ch.title chapter FROM problem p JOIN course c ON c.id = p.course_id JOIN chapter ch ON ch.id = p.chapter_id WHERE p.id = ?").get(+m.id);
    if (!p) return { $status: 404, error: "없는 문제" };
    const versions = db.prepare("SELECT version, kind, star, body, note, created_at FROM problem_version WHERE problem_id = ? ORDER BY version DESC").all(p.id).map(v => ({ ...v, star: !!v.star, body: J(v.body) }));
    const stats = problemStats({ courseId: p.course_id }).find(s => s.id === p.id);
    const reports = db.prepare("SELECT * FROM report WHERE problem_id = ? ORDER BY created_at DESC").all(p.id);
    const info = J(db.prepare("SELECT info FROM course WHERE id = ?").get(p.course_id).info);
    return { ...p, math: !!info.math, files: info.files || {}, versions, stats, version_stats: versionStats(p.id), reports };
  },
  "PUT /api/problems/:id": (req, m, body) => {
    const p = db.prepare("SELECT * FROM problem WHERE id = ?").get(+m.id); if (!p) return { $status: 404, error: "없는 문제" };
    const cur = db.prepare("SELECT * FROM problem_version WHERE problem_id = ? AND version = ?").get(p.id, p.current_version);
    const kind = body.kind || cur.kind;
    const cinfo = J(db.prepare("SELECT info FROM course WHERE id = ?").get(p.course_id).info);     // 수식 과목인지 (수식 검사)
    const pk = { semester: { code: "x" }, course: { code: "x", name: "x", math: !!cinfo.math }, chapters: [{ key: "c" }], problems: [{ ...body.body, ext_id: p.ext_id, chapter: "c", kind }] };
    const errs = checkPack(pk); if (errs.length) return { $status: 400, error: errs.join(" / ") };
    const v = p.current_version + 1;
    tx(() => {
      db.prepare("INSERT INTO problem_version(problem_id, version, kind, star, body, note, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(p.id, v, kind, body.star === undefined ? cur.star : (body.star ? 1 : 0), JSON.stringify(body.body), str(body.note, 200) || "관리자 수정", now());
      db.prepare("UPDATE problem SET current_version = ? WHERE id = ?").run(v, p.id);
      carryTags(p.id, p.current_version, v);                     // 학습 리포트 v2: 해설·바른 진술만 고쳤으면 저자·관리자 태그를 이어받는다
    });
    return { id: p.id, version: v };
  },
  "PATCH /api/problems/:id": (req, m, body) => {
    if (!["published", "hidden"].includes(body.status)) return { $status: 400, error: "status는 published/hidden" };
    db.prepare("UPDATE problem SET status = ? WHERE id = ?").run(body.status, +m.id); return { ok: true };
  },
  ...insightAdmin,                                               // 학습 리포트 v2 "진단" 탭 (server/insight/admin.js)
};

// 경로 패턴 → 정규식
const compile = table => Object.entries(table).map(([k, fn]) => {
  const [method, path] = k.split(" ");
  const names = []; const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
  return { key: k, method, re, names, fn, needsDevice: path.startsWith("/api/me") || path.startsWith("/api/grade") || ["/api/events", "/api/reports", "/api/transfer"].includes(path) };
});
const USER = compile(user), ADMINR = compile(admin);

async function handle(routes, req, res, path, q, { limit, isAdmin }) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const mm = path.match(r.re); if (!mm) continue;
    const m = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(mm[i + 1])]));
    let d = null;
    if (!isAdmin && LIMITS[r.key]) {
      const [max, ms, by] = LIMITS[r.key];
      const who = by === "device" && isId(req.headers["x-device"]) ? req.headers["x-device"] : clientIp(req);
      if (limited(r.key + "|" + who, max, ms)) return fail(res, 429, "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요");
    }
    // AI 채점: 기기 ID 위조 공격 방어를 위해 IP 기준 시간당 30회 추가 제한
    if (!isAdmin && r.key === "POST /api/grade") {
      if (limited("POST /api/grade:ip|" + clientIp(req), 30, 36e5)) return fail(res, 429, "AI 채점 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요");
    }
    if (!isAdmin && r.needsDevice) { d = device(req); if (!d) return fail(res, 401, "기기 등록이 필요해요 (POST /api/device)"); }
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req, limit) : {};
    const out = await r.fn(req, m, body, d, q);
    if (isAdmin && req.method !== "GET") contentVer++;          // 관리자가 무언가 바꿨으면 캐시를 새로
    if (out && out.$packed) return sendPacked(req, res, out.$packed, out.$cache, out.$headers);
    const status = out && out.$status; if (status) delete out.$status;
    return send(res, status || 200, out ?? {});
  }
  return fail(res, 404, "없는 API예요");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url.replace(/^\/+/, "/"), "http://x"); const path = decodeURIComponent(url.pathname);
    if (limited("all|" + clientIp(req), 3000, 6e4)) return fail(res, 429, "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요");
    if (path === "/health") return send(res, 200, { ok: true, time: now() });
    if ((path === ADMIN || path.startsWith(ADMIN + "/")) && !fromThisMac(req) && !ADMIN_REMOTE) return fail(res, 404, "not found");   // 맥 밖(Tunnel·와이파이)에서는 관리자 화면이 없는 것처럼
    if (path === ADMIN) { res.writeHead(301, { ...SEC, Location: ADMIN + "/" }); return res.end(); }
    if (path.startsWith(ADMIN + "/")) {
      const rest = path.slice(ADMIN.length);
      // 비밀번호가 설정된 경우 로그인/인증 처리
      if (ADMIN_PASSWORD) {
        if (rest === "/login" && req.method === "POST") {
          const b = await readBody(req, 1024);
          if (b.password === ADMIN_PASSWORD) {
            const tok = randomBytes(24).toString("base64url");
            adminSessions.set(tok, Date.now() + 12 * 36e5); // 12시간 유효
            res.writeHead(200, { ...SEC, "Set-Cookie": `mn_admin_token=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`, "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: true }));
          }
          return fail(res, 401, "비밀번호가 올바르지 않아요");
        }
        if (rest === "/logout" && req.method === "POST") {
          const tok = getAdminCookie(req); if (tok) adminSessions.delete(tok);
          res.writeHead(200, { ...SEC, "Set-Cookie": `mn_admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`, "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        }
        if (!isAdminAuthed(req)) {
          if (rest.startsWith("/api/")) return fail(res, 401, "관리자 로그인이 필요해요");
          const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>관리자 로그인 · 문제노트</title><link rel="stylesheet" href="/css/app.css"><style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}.c{width:100%;max-width:320px;background:var(--bg-card,#fff);border:1px solid var(--border,#e5e5ea);border-radius:18px;padding:28px 24px;box-shadow:0 8px 30px rgba(0,0,0,.06)}h1{font-size:20px;margin:0 0 8px}p{font-size:13px;color:var(--muted,#86868b);margin:0 0 20px}input{width:100%;box-sizing:border-box;padding:12px;font-size:15px;border-radius:10px;border:1px solid var(--border,#d1d1d6);margin-bottom:14px;outline:none}button{width:100%;padding:12px;font-size:15px;font-weight:600;border:none;border-radius:10px;background:var(--accent,#0071e3);color:#fff;cursor:pointer}.err{color:#ff3b30;font-size:13px;margin-bottom:12px;display:none}</style></head><body><div class="c"><h1>관리자 로그인</h1><p>관리자 비밀번호를 입력하세요.</p><form id="f"><div id="e" class="err"></div><input type="password" id="p" placeholder="비밀번호" required autofocus><button type="submit">로그인</button></form></div><script>document.getElementById("f").onsubmit=async ev=>{ev.preventDefault();const e=document.getElementById("e");e.style.display="none";try{const r=await fetch("${ADMIN}/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("p").value})});if(!r.ok){const d=await r.json();throw new Error(d.error||"로그인 실패");}location.reload();}catch(ex){e.textContent=ex.message;e.style.display="block";}};</script></body></html>`;
          res.writeHead(200, { ...SEC, "Content-Type": "text/html; charset=utf-8" });
          return res.end(html);
        }
      }
      if (rest.startsWith("/backup-file/")) {                                   // 백업 파일 내려받기
        const name = basename(rest.slice("/backup-file/".length));
        if (!/^app-\d{8}-\d{4}\.db$/.test(name) || !existsSync(join(BACKUP_DIR, name))) return fail(res, 404, "없는 백업이에요");
        res.writeHead(200, { ...SEC, "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" });
        return createReadStream(join(BACKUP_DIR, name)).pipe(res);
      }
      if (rest.startsWith("/api/")) return await handle(ADMINR, req, res, rest, url.searchParams, { limit: 8e6, isAdmin: true });
      return serveStatic(req, res, join(ROOT, "admin"), rest.slice(1));
    }
    if (path.startsWith("/api/")) return await handle(USER, req, res, path, url.searchParams, { limit: 2e5, isAdmin: false });
    if (path.startsWith("/admin")) return fail(res, 404, "not found");        // 비밀 주소가 아닌 /admin… 은 숨긴다
    if (INSIGHT_DEV && path === "/js/fixtures/insight-sample.json") return serveStatic(req, res, join(ROOT, "docs", "insight", "fixtures"), "insight-sample.json");   // 개발용 예시 (테스터에게는 없음)
    return serveStatic(req, res, join(ROOT, "web"), path.slice(1));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : "서버 오류");
  }
});

// 매일 자동 백업: 켤 때와 한 시간마다 확인해서, 마지막 백업이 20시간보다 오래됐으면 새로 만든다
function autoBackup() {
  try { const last = listBackups()[0]; if (!last || Date.now() - new Date(last.at) > 20 * 36e5) { const b = backup(); console.log("백업 만듦:", b.name); } }
  catch (e) { console.error("백업 실패:", e.message); }
}
autoBackup(); setInterval(autoBackup, 36e5).unref();

server.on("error", e => {           // 이미 켜져 있을 때 알아보기 쉬운 안내
  if (e.code === "EADDRINUSE") {
    console.error(`\n${PORT} 포트에 이미 문제노트 서버(또는 다른 프로그램)가 켜져 있어요.\n  - 켜 둔 터미널에서 Ctrl+C로 끈 뒤 다시 실행하거나\n  - 무엇이 쓰는지 보기: lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, HOST, () => {
  setImmediate(warmUp);
  initTagger();                                                 // 학습 리포트 v2 태깅: 관리자가 켜 둔 과목이 있을 때만 (실제 Gemini 키 필요)                                         // 학습 리포트: 첫 뽑기가 엔진 데우기를 기다리지 않게
  const base = `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`;
  const lan = HOST === "0.0.0.0" ? Object.values(networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => `http://${a.address}:${PORT}/`) : [];
  console.log(`문제노트 서버 실행 중\n  사용자 웹   ${base}/` + (lan.length ? `\n  같은 와이파이 폰   ${lan.join("  ")}` : "") +
    `\n  관리자 웹   ${base}${ADMIN}/   (이 맥에서만 열림${ADMIN_PASSWORD ? " · 비밀번호 보호 켜짐" : ""})` +
    `\n  AI 채점    ${ai.enabled() ? `켜짐 (${ai.MODEL}, 키: ${ai.keySource()})` : "꺼짐 (GEMINI_API_KEY 또는 data/gemini_key.txt 없음)"}\n  (끄려면 Ctrl+C)`);
});
