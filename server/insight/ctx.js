// 학습 리포트: 과목 내용 묶음 (Contract 2). 과목의 문제·단원·개념 이름을 한 번 읽어 두고, 내용이 바뀔 때만 다시 만든다.
// 과목을 이름·번호로 가르지 않는다: 단원·개념(topic)·'먼저 읽기'는 모두 DB 내용에서 정한다.
import { db, J } from "../db.js";
import { strip, lnP } from "../../web/js/insight-engine.js";
import { PARAM_VER } from "./params.js";

let contentVer = () => 0;
/** server.js가 관리자 쓰기 횟수(contentVer)를 읽는 함수를 넘겨준다 */
export const useContentVer = fn => { contentVer = fn; };
// contentVer와 data_version은 서버를 켤 때마다 처음부터 센다 → 켠 시각을 붙여, 예전 프로세스가 만든 insight 행과 섞이지 않게
const BOOT = Date.now().toString(36);
const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);

/** 캐시 키: 다른 프로그램의 DB 쓰기(data_version) | 관리자 쓰기 | 태그·개념 사전·보정 판 | 조절값 판 | 서버 켠 시각 */
export function ctxKey(cid) {
  const m = {};
  for (const r of st("meta", "SELECT key, value FROM insight_meta WHERE key IN (?, ?, ?, 'calib_rev')").all("tag_rev:" + cid, "vocab_ver:" + cid, "v2_ready:" + cid)) m[r.key] = r.value;
  return [st("dv", "PRAGMA data_version").get().data_version, contentVer(), m["tag_rev:" + cid] ?? 0, m["vocab_ver:" + cid] ?? 0, m["v2_ready:" + cid] ?? 0, m.calib_rev ?? 0, PARAM_VER, BOOT].join("|");
}

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const eq = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
const H1 = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i;
const unNum = t => String(t || "").replace(/^[\d.\-–~·\s]+/, "").trim();          // "2.7–2.8 블록 행렬과 LU 분해" → "블록 행렬과 LU 분해"
const human = code => String(code).replace(/^t_/, "").replace(/[_-]+/g, " ").trim() || String(code);   // 코드만 남을 때 읽기 쉽게

function build(cid, key) {
  const c = st("course", "SELECT c.id, c.short, c.name, c.visible, c.info, s.visible sv FROM course c JOIN semester s ON s.id = c.semester_id WHERE c.id = ?").get(cid);
  if (!c) return null;
  const info = J(c.info), concepts = info.concepts && typeof info.concepts === "object" ? info.concepts : {};
  const chapters = st("chs", "SELECT key, title, short, grp, sort FROM chapter WHERE course_id = ? ORDER BY sort, id").all(cid)
    .map(r => ({ key: r.key, title: r.title, short: r.short, grp: r.grp, sort: r.sort }));
  // 문제: 지금 버전 하나씩 (숨긴 문제도 넣고 status로 표시 → 엔진이 뺀다)
  const items = new Map(), lens = { ox: [], mc: [], short: [], essay: [] };
  for (const r of st("items", `SELECT p.id, p.ext_id, p.status, p.current_version v, ch.key ch, pv.kind, pv.star, pv.body FROM problem p
      JOIN chapter ch ON ch.id = p.chapter_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = ? ORDER BY p.sort, p.id`).all(cid)) {
    const b = J(r.body), opts = Array.isArray(b.opts) ? b.opts : [];
    const len = strip(b.q).length + strip(b.stem).length + opts.reduce((s, o) => s + strip(o).length, 0);   // 수식은 그대로 센다
    items.set(r.id, { pid: r.id, ext: r.ext_id, ch: r.ch, kind: r.kind, v: r.v, star: r.star ? 1 : 0, status: r.status,
      topic: b.topic != null && b.topic !== "" ? String(b.topic) : null, exam: Array.isArray(b.exams) && b.exams.length > 0,
      len, nopt: r.kind === "mc" ? opts.length : 0, body: b });
    if (r.status === "published" && lens[r.kind]) lens[r.kind].push(len);
  }
  // 옛 버전이 지금 버전과 정답 기준이 같은가 (같으면 옛 기록의 고른 답을 그대로 읽는다). 옛 버전은 필요할 때만 읽어 둔다
  const old = new Map();
  const sameAsCurrent = (pid, v) => {
    const it = items.get(pid); if (!it) return false;
    if (v == null || v === it.v) return true;
    const k = pid + ":" + v; let o = old.get(k);
    if (o === undefined) { const r = st("ver", "SELECT kind, body FROM problem_version WHERE problem_id = ? AND version = ?").get(pid, v); old.set(k, o = r ? { kind: r.kind, b: J(r.body) } : null); }
    if (!o || o.kind !== it.kind) return false;
    const a = o.b, b = it.body;
    return it.kind === "mc" ? eq(a.opts, b.opts) && eq(a.ans, b.ans) : it.kind === "ox" ? eq(a.q, b.q) && eq(a.ox, b.ox)
      : it.kind === "short" ? eq(a.a, b.a) && eq(a.num, b.num) && eq(a.accept, b.accept) : false;
  };
  // 개념(topic) 이름: course.info.topics → 그 개념이 주로 사는 단원(엔진과 같은 규칙)의 '먼저 읽기' 고유한 첫 제목 → 그 단원 제목
  // (여러 단원의 첫 제목이 같으면 '한눈에 보기' 같은 틀 제목이라 쓰지 않는다. 단원 제목은 나누지 않고, 이름이 겹치면 (1)(2)를 붙인다)
  const head = {}, hn = new Map();
  for (const [k, v] of Object.entries(concepts)) { const h = H1.exec(typeof v === "string" ? v : (v && v.html) || ""); if (h && strip(h[1])) head[k] = strip(h[1]); }
  for (const h of Object.values(head)) hn.set(h, (hn.get(h) || 0) + 1);
  const byTopic = new Map();
  for (const it of items.values()) if (it.topic && it.status === "published") { const m = byTopic.get(it.topic) || byTopic.set(it.topic, new Map()).get(it.topic); m.set(it.ch, (m.get(it.ch) || 0) + 1); }
  const given = info.topics && typeof info.topics === "object" ? info.topics : {};
  const grp = new Map(chapters.map((c, i) => [c.key, [c.grp ? 1 : 0, i, unNum(c.title) || c.key]]));
  const dom = m => [...m].sort((a, b) => ((grp.get(a[0]) || [1])[0] - (grp.get(b[0]) || [1])[0]) || b[1] - a[1] || ((grp.get(a[0]) || [0, 99])[1] - (grp.get(b[0]) || [0, 99])[1]))[0][0];
  let topics = null;
  if (byTopic.size) {
    topics = {}; const fromGiven = new Set();
    for (const [code, m] of byTopic) {
      const g = typeof given[code] === "string" && given[code].trim(), d = dom(m);
      if (g) fromGiven.add(code);
      topics[code] = g || (head[d] && hn.get(head[d]) === 1 ? head[d] : "") || (grp.get(d) || [])[2] || human(code);
    }
    const cnt = new Map(); for (const n of Object.values(topics)) cnt.set(n, (cnt.get(n) || 0) + 1);
    const ord = new Map();   // 이름이 겹치면 코드 대신 (1) (2)로 구분
    for (const code of Object.keys(topics)) if (cnt.get(topics[code]) > 1 && !fromGiven.has(code)) { const n = topics[code]; ord.set(n, (ord.get(n) || 0) + 1); topics[code] = `${n} (${ord.get(n)})`; }
  }
  return { key, cid: c.id, name: c.name, short: c.short, lang: info.lang || "ko", math: !!info.math, visible: !!c.visible && !!c.sv,
    chapters, items, sameAsCurrent, topics, hasConcept: new Set(Object.keys(concepts)),
    tags: new Map(), misc: {}, diag: new Map(), kc: {},                     // v1 P2/P3 자리 (v2는 아래 v2 묶음을 쓴다)
    v2: v2Of(cid, items, chapters, topics, sameAsCurrent),
    medLen: { ox: median(lens.ox), mc: median(lens.mc), short: median(lens.short), essay: median(lens.essay) }, lnP };
}

// ───────── v2: 세부 포인트·태그·변형 묶음 (docs/insight/v2/DATA.md §5) ─────────
// 태그가 하나도 없으면 null (엔진은 v1 리포트만). 표·열이 아직 없으면 (이주 전 DB) 조용히 null
const tbl = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch { return null; } };
/** item_tag.diag의 오개념 표시 → 엔진이 읽는 tag.mis (MC 배열 · OX {m, mr} · 단답 [{m, ex, num}] · 서술 [{i, m}]) */
function misOf(kind, dg, nopt) {
  if (dg.mis !== undefined && dg.mis !== null) {                           // 작성자 dx.mis 그대로
    if (kind === "ox") return typeof dg.mis === "string" ? { m: dg.mis, mr: null } : dg.mis && typeof dg.mis === "object" ? { m: dg.mis.m || null, mr: dg.mis.mr || null } : null;
    return dg.mis;
  }
  if (kind === "mc" && dg.opt) {                                            // 태거 모양 {"1": {m, d}} → d ≥ 2만 오개념으로
    const a = Array.from({ length: nopt || 4 }, () => null);
    for (const [i, x] of Object.entries(dg.opt)) if (x && x.m && (x.d ?? 2) >= 2 && +i < a.length) a[+i] = x.m;
    return a;
  }
  if (kind === "ox" && dg.ox) return { m: (dg.ox.d ?? 2) >= 2 ? dg.ox.m || null : null, mr: dg.ox.mr || null };
  if (kind === "short" && Array.isArray(dg.short)) return dg.short.filter(x => x && x.m && (x.d ?? 2) >= 2);
  if (kind === "essay" && Array.isArray(dg.pts)) return dg.pts.filter(x => x && x.m);
  return null;
}
function v2Of(cid, items, chapters, topics, same) {
  const rows = tbl(`SELECT t.problem_id pid, t.version v, t.facet, t.depth, t.src, t.conf, t.diag, t.review FROM item_tag t JOIN problem p ON p.id = t.problem_id
      WHERE p.course_id = ? AND t.facet IS NOT NULL AND t.review NOT IN ('rejected', 'stale') ORDER BY t.problem_id, t.version DESC`, cid);
  if (!rows || !rows.length) return null;
  const tags = new Map();
  for (const r of rows) {
    const it = items.get(r.pid); if (!it || tags.has(r.pid)) continue;
    if (r.v !== it.v && !same(r.pid, r.v)) continue;                          // 옛 버전 태그는 정답 기준이 같을 때만
    const dg = J(r.diag);
    tags.set(r.pid, { facet: r.facet, facets2: Array.isArray(dg.facets2) ? dg.facets2.slice(0, 2) : [], depth: r.depth || dg.depth || null, depth_why: dg.depth_why || null,
      src: r.src || "llm", conf: r.conf ?? 2, review: r.review, mis: misOf(it.kind, dg, it.nopt) });
  }
  const facets = new Map(), misc = {}, fam = new Map(), famOfFacet = new Map(), byFacet = new Map(), bySecond = new Map();
  const kcName = {};
  for (const k of tbl("SELECT code, name FROM kc WHERE course_id = ? AND status != 'retired'", cid) || []) kcName[k.code] = k.name;
  const chTitle = new Map(chapters.map(c => [c.key, c.title || c.key]));
  for (const f of tbl("SELECT code, kc, name, statement, kind, confusable, sort, status FROM facet WHERE course_id = ? AND status != 'retired' ORDER BY sort, code", cid) || [])
    facets.set(f.code, { code: f.code, kc: f.kc, name: f.name, statement: f.statement, kind: f.kind, confusable: J(f.confusable, []), sort: f.sort, status: f.status,
      kcName: kcName[f.kc] || (topics && topics[f.kc]) || f.kc, ch: null, chTitle: "" });
  for (const m of tbl("SELECT code, facet, kc, cw, belief, truth, contrast, cue, status FROM misc WHERE course_id = ? AND status != 'rejected'", cid) || [])
    misc[m.code] = { facet: m.facet, kc: m.kc, cw: m.cw, belief: m.belief, truth: m.truth, contrast: m.contrast, cue: m.cue, status: m.status };
  for (const r of tbl(`SELECT fm.problem_id pid, fm.family, fm.role, fm.delta_type, fm.delta, f.facet FROM family_member fm
      JOIN family f ON f.course_id = fm.course_id AND f.code = fm.family WHERE fm.course_id = ? AND f.status != 'rejected' AND fm.conf >= 2`, cid) || []) {
    fam.set(r.pid, { family: r.family, role: r.role, delta_type: r.delta_type, delta: r.delta || "" });
    (famOfFacet.get(r.facet) || famOfFacet.set(r.facet, []).get(r.facet)).push({ pid: r.pid, role: r.role });
  }
  // 세부 포인트별 문제 (확인 문제 후보)와 그 포인트가 주로 사는 단원
  const chCount = new Map();
  for (const [pid, t] of tags) {
    const it = items.get(pid); if (!it) continue;
    (byFacet.get(t.facet) || byFacet.set(t.facet, []).get(t.facet)).push(it);
    for (const f2 of t.facets2) (bySecond.get(f2) || bySecond.set(f2, []).get(f2)).push(it);
    if (it.status === "published") { const m = chCount.get(t.facet) || chCount.set(t.facet, new Map()).get(t.facet); m.set(it.ch, (m.get(it.ch) || 0) + 1); }
  }
  for (const [code, F] of facets) {
    const m = chCount.get(code); if (!m) continue;
    const ch = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    F.ch = ch; F.chTitle = unNum(chTitle.get(ch) || ch);
  }
  const ready = (st("v2r", "SELECT value FROM insight_meta WHERE key = ?").get("v2_ready:" + cid) || {}).value === "1";
  return { ready, facets, misc, tags, fam, famOfFacet, byFacet, bySecond };
}

const CTX = new Map();          // cid → ctx (최근 8과목)
/** 과목 내용 묶음. 없는 과목이면 null (숨긴 과목은 visible: false) */
export function courseCtx(cid, key = ctxKey(cid)) {
  const o = CTX.get(cid);
  if (o && o.key === key) { CTX.delete(cid); CTX.set(cid, o); return o; }
  CTX.delete(cid);
  const ctx = build(cid, key); if (!ctx) return null;
  CTX.set(cid, ctx); if (CTX.size > 8) CTX.delete(CTX.keys().next().value);
  return ctx;
}
