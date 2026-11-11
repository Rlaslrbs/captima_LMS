// 학습 리포트 v2: 관리자 "진단" 탭 API (맥에서만, 관리자 비밀 주소 아래). 화면은 프론트엔드 담당 admin/
// 과목 현황 · 어휘 확인 · 태그 확인(≤ 20장) · 커버리지 · 새 문제 승인 · 태깅 작업 · 미리보기
// 사용자 기록(device·progress·event·report·bookmark·ai_grade)은 읽기만 한다. 코드(kc·facet·misc)는 지우지 않고 retired로만
import { db, J, now, tx, meta, bumpMeta, budgetToday, dayPT, facetsOf, miscOf, familiesOf, coverage, tagSummary, retireVocab, DEPTH_WHY } from "../db.js";
import * as ai from "../ai.js";
import * as tagger from "./tagger.js";
import { buildDoc } from "./report.js";
import { aiSwitch, setAiSwitch } from "./aidiag.js";

const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);
const T = h => ai.text(h), cut = (s, n) => (s = String(s ?? "").trim(), s.length > n ? s.slice(0, n - 1) + "…" : s);
const ORDER = ["생경론", "공학수학", "경정시", "진인본", "응용통계"];     // 켜는 순서 (DECISIONS)
const bad = (error, status = 400) => ({ $status: status, error });
const courseOk = cid => Number.isInteger(cid) && cid > 0 && !!st("c", "SELECT 1 FROM course WHERE id = ?").get(cid);

/** 문제별 지금 버전의 태그 행들 → Map(pid → row + kind/body/ext/status) */
function current(cid) {
  return new Map(st("cur", `SELECT p.id pid, p.ext_id ext, p.status, p.current_version v, pv.kind, pv.body, t.facet, t.depth, t.diag, t.qa, t.conf, t.src, t.review
      FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      LEFT JOIN item_tag t ON t.problem_id = p.id AND t.version = p.current_version WHERE p.course_id = ? ORDER BY p.sort, p.id`).all(cid)
    .map(r => [r.pid, { ...r, body: J(r.body), diag: J(r.diag), qa: J(r.qa) }]));
}
/** 한 문제가 고를 수 있게 내놓는 오개념 코드 (d ≥ 2) */
function offered(dg) {
  const out = new Set(), ok = x => x && x.m && (x.d ?? 2) >= 2;
  for (const o of Object.values(dg.opt || {})) if (ok(o)) out.add(o.m);
  if (ok(dg.ox)) out.add(dg.ox.m); if (dg.ox && dg.ox.mr) out.add(dg.ox.mr);
  for (const s of dg.short || []) if (ok(s)) out.add(s.m);
  for (const p of dg.pts || []) if (p && p.m) out.add(p.m);
  return [...out];
}
const brief = it => ({ pid: it.pid, ext: it.ext, kind: it.kind, q: cut(T(it.body.q), 140) });

// ───────── 1) 과목 현황 ─────────
function courses() {
  const L = st("cs", "SELECT c.id cid, c.short, c.name FROM course c JOIN semester s ON s.id = c.semester_id ORDER BY s.code DESC, c.sort, c.id").all();
  const out = L.map(c => {
    const t = st("tagN", `SELECT COUNT(*) published, SUM(t.facet IS NOT NULL) tagged, SUM(t.conf >= 2) conf2, SUM(t.conf = 1) conf1, SUM(t.review IN ('accepted','edited')) reviewed
        FROM problem p LEFT JOIN item_tag t ON t.problem_id = p.id AND t.version = p.current_version WHERE p.course_id = ? AND p.status = 'published'`).get(c.cid);
    const S = tagSummary(c.cid), g = J(meta("gold:" + c.cid), null), gate = tagger.gateCheck(c.cid), J2 = tagger.jobsOf(c.cid);
    const sum = k => J2.stages.reduce((s, x) => s + x[k], 0);
    const o = ORDER.findIndex(n => c.short.includes(n) || c.name.includes(n));
    return { cid: c.cid, short: c.short, name: c.name, order: o < 0 ? 99 : o + 1, v2_ready: gate.ready,
      vocab: { ver: +(meta("vocab_ver:" + c.cid) || 0), approved: gate.vocab },
      tags: { published: t.published || 0, tagged: t.tagged || 0, conf2: t.conf2 || 0, conf1: t.conf1 || 0, reviewed: t.reviewed || 0, share: Math.round(S.share * 1000) / 1000 },
      gold: g ? { n: g.n, facet_agree: g.facet_agree, depth_kappa: g.depth_kappa, pass: g.pass } : null,
      jobs: { queued: sum("queued"), running: sum("running"), done: sum("done"), failed: sum("failed"), paused_until: J2.paused_until },
      gate: { vocab: gate.vocab, gold: gate.gold, share90: gate.share90, ok: gate.ok, hold: gate.hold, can_enable: gate.can_enable } };
  }).sort((a, b) => a.order - b.order || a.cid - b.cid);
  const used = {}; for (const r of st("bud", "SELECT model, SUM(calls) n FROM ai_budget WHERE day = ? GROUP BY model").all(dayPT())) used[r.model] = r.n;
  return { courses: out, budget: { day: dayPT(), rpd: ai.RPD, cap60: Math.floor(0.6 * ai.RPD), used, total: budgetToday().calls, grade_first: true }, ai: ai.enabled() };
}

// ───────── 2) 어휘 ─────────
function vocab(cid) {
  const C = current(cid), byF = new Map(), byM = new Map();
  for (const it of C.values()) if (it.facet && it.status === "published" && !["rejected", "stale"].includes(it.review)) {
    (byF.get(it.facet) || byF.set(it.facet, []).get(it.facet)).push(it);
    for (const m of offered(it.diag)) byM.set(m, (byM.get(m) || 0) + 1);
  }
  const kcs = st("kcAll", "SELECT code, name, definition, status, merged_into, source, chapter_keys FROM kc WHERE course_id = ? ORDER BY code").all(cid);
  const facets = facetsOf(cid, { all: true }), miscs = miscOf(cid, null, { all: true });
  const fac = f => ({ code: f.code, name: f.name, statement: f.statement, kind: f.kind, confusable: f.confusable, status: f.status, merged_into: f.merged_into, source: f.source,
    n_items: (byF.get(f.code) || []).length, examples: (byF.get(f.code) || []).slice(0, 2).map(brief),
    misc: miscs.filter(m => m.facet === f.code).map(m => ({ code: m.code, belief: m.belief, truth: m.truth, cue: m.cue, cw: m.cw, status: m.status, src: m.src, n_items: byM.get(m.code) || 0 })) });
  const out = kcs.map(k => ({ code: k.code, name: k.name, definition: k.definition, status: k.status, merged_into: k.merged_into, source: k.source, chapters: J(k.chapter_keys, []), facets: facets.filter(f => f.kc === k.code).map(fac) }));
  // kc 표에 없는 개념의 세부 포인트 (저자 팩의 topic 개념 등)
  const known = new Set(kcs.map(k => k.code)), orphan = [...new Set(facets.filter(f => !known.has(f.kc)).map(f => f.kc))];
  for (const k of orphan) out.push({ code: k, name: k, definition: "", status: "active", merged_into: null, source: "topic", facets: facets.filter(f => f.kc === k).map(fac) });
  const loose = miscs.filter(m => !m.facet).map(m => ({ code: m.code, belief: m.belief, truth: m.truth, cue: m.cue, cw: m.cw, status: m.status, src: m.src, n_items: byM.get(m.code) || 0 }));
  // 단원별 확인용: 초안 개념이 있는 단원 (확인된 단원은 vocab_ch_ok)
  const dch = new Map(); for (const k of out) if (k.status === "draft") for (const c of k.chapters || []) dch.set(c, (dch.get(c) || 0) + 1);
  const chs = st("chT", "SELECT key, title FROM chapter WHERE course_id = ? ORDER BY sort, id").all(cid);
  const draft_chapters = chs.filter(c => dch.has(c.key)).map(c => ({ key: c.key, title: c.title, kcs: dch.get(c.key) }));
  return { ver: +(meta("vocab_ver:" + cid) || 0), approved: tagger.vocabApproved(cid), pending: !!meta("vocab_pending:" + cid), kcs: out, misc_unassigned: loose,
    draft_chapters, chapters_ok: J(meta("vocab_ch_ok:" + cid), []) };
}
const EDIT = { kc: ["name", "definition"], facet: ["name", "statement"], misc: ["belief", "truth", "cue"] };
const LIM = { name: 20, definition: 200, statement: 90, belief: 70, truth: 90, cue: 50 };
function vocabPatch(cid, ops) {
  if (!Array.isArray(ops) || !ops.length) return bad("ops가 필요해요");
  const has = (t, c) => !!db.prepare(`SELECT 1 FROM ${t} WHERE course_id = ? AND code = ?`).get(cid, c);
  const errs = [];
  tx(() => {
    for (const o of ops) {
      const t = o && o.type; if (!EDIT[t]) { errs.push("type은 kc · facet · misc"); continue; }
      if (o.op === "edit") {
        if (!has(t, o.code)) { errs.push(`없는 코드 ${o.code}`); continue; }
        const set = Object.entries(o.set || {}).filter(([k, v]) => EDIT[t].includes(k) && typeof v === "string" && v.trim());
        if (!set.length) continue;
        const srcCol = t === "misc" ? "src" : "source";             // 이름을 바꿔도 코드는 그대로. 관리자가 고친 행은 작업기가 덮어쓰지 않는다
        db.prepare(`UPDATE ${t} SET ${set.map(([k]) => k + " = ?").join(", ")}, ${srcCol} = 'admin', updated_at = ? WHERE course_id = ? AND code = ?`)
          .run(...set.map(([k, v]) => cut(v, LIM[k])), now(), cid, o.code);
      } else if (o.op === "merge") {
        if (!has(t, o.from) || !has(t, o.into) || o.from === o.into) { errs.push(`합치기: ${o.from} → ${o.into}`); continue; }
        if (t === "facet") {                                          // 태그·오개념이 가리키던 세부 포인트를 새 쪽으로 (문제 태그는 사용자 기록이 아님)
          db.prepare("UPDATE item_tag SET facet = ?, updated_at = ? WHERE facet = ? AND problem_id IN (SELECT id FROM problem WHERE course_id = ?)").run(o.into, now(), o.from, cid);
          db.prepare("UPDATE misc SET facet = ? WHERE course_id = ? AND facet = ?").run(o.into, cid, o.from);
          retireVocab(cid, "facet", o.from, o.into);
        } else if (t === "kc") {
          db.prepare("UPDATE facet SET kc = ? WHERE course_id = ? AND kc = ? AND status != 'retired'").run(o.into, cid, o.from);
          db.prepare("UPDATE misc SET kc = ? WHERE course_id = ? AND kc = ?").run(o.into, cid, o.from);
          retireVocab(cid, "kc", o.from, o.into);
        } else {                                                      // 같은 뜻의 오개념: 문제 진단이 가리키던 코드를 새 쪽으로
          for (const r of db.prepare("SELECT t.problem_id, t.version, t.diag FROM item_tag t JOIN problem p ON p.id = t.problem_id WHERE p.course_id = ? AND t.diag LIKE ?").all(cid, `%"${o.from}"%`)) {
            const dg = JSON.parse(JSON.stringify(J(r.diag)), (k, v) => (v === o.from && (k === "m" || k === "mr") ? o.into : v));
            db.prepare("UPDATE item_tag SET diag = ? WHERE problem_id = ? AND version = ?").run(JSON.stringify(dg), r.problem_id, r.version);
          }
          retireVocab(cid, "misc", o.from);
        }
      } else if (o.op === "drop") {
        if (!has(t, o.code)) { errs.push(`없는 코드 ${o.code}`); continue; }
        retireVocab(cid, t, o.code);
        if (t === "facet") db.prepare("UPDATE item_tag SET review = 'stale' WHERE facet = ? AND src = 'llm' AND problem_id IN (SELECT id FROM problem WHERE course_id = ?)").run(o.code, cid);   // 다음 작업 때 다시 태깅
      } else errs.push("op는 edit · merge · drop");
    }
  });
  bumpMeta("tag_rev:" + cid);
  const out = vocab(cid); if (errs.length) out.warnings = errs;
  return out;
}

// ───────── 3) 태그 확인: conf 1이면서 실제로 풀린 문제, 푼 기기가 많은 순서 ≤ 20장 ─────────
function tagcheck(cid) {
  const C = current(cid), fName = new Map(facetsOf(cid, { all: true }).map(f => [f.code, f.name]));
  const n = new Map(st("solvedBy", `SELECT e.problem_id pid, COUNT(DISTINCT e.device_id) n FROM event e JOIN problem p ON p.id = e.problem_id
      WHERE p.course_id = ? AND e.type IN ('answer_submit','idk') GROUP BY e.problem_id`).all(cid).map(r => [r.pid, r.n]));
  const L = [...C.values()].filter(it => it.facet && it.conf === 1 && it.src === "llm" && it.review === "auto" && it.status === "published" && n.get(it.pid))
    .sort((a, b) => n.get(b.pid) - n.get(a.pid) || a.pid - b.pid);
  const cards = L.slice(0, 20).map(it => {
    const s2 = it.qa.second || {}, dg = it.diag;
    const reason = it.qa.fit === "no" ? "검증에서 세부 포인트가 안 맞는다고 했어요"
      : s2.facet && s2.facet !== it.facet ? "두 번째 의견이 다른 세부 포인트를 골랐어요"
      : s2.depth && s2.depth !== it.depth ? `두 번째 의견의 깊이가 달라요 (${s2.depth})` : "확신이 낮아요";
    const alt = [...new Set([s2.facet, ...(dg.facets2 || [])].filter(f => f && f !== it.facet))].map(code => ({ code, name: fName.get(code) || code }));
    const b = it.body, card = { pid: it.pid, ext: it.ext, kind: it.kind, q: cut(T(b.q), 400), facet: { code: it.facet, name: fName.get(it.facet) || it.facet },
      depth: it.depth, depth_why: dg.depth_why || null, reason, answered_by: n.get(it.pid), alt };
    if (it.kind === "mc") { card.opts = (b.opts || []).map(o => cut(T(o), 160)); card.ans = b.ans; }
    if (it.kind === "ox") card.ans = !!b.ox;
    if (it.kind === "short") card.ans = b.a;
    return card;
  });
  return { cards, left: Math.max(0, L.length - cards.length) };
}
function tagcheckPost(pid, body) {
  const p = st("pOf", "SELECT id, course_id cid, current_version v FROM problem WHERE id = ?").get(pid); if (!p) return bad("없는 문제", 404);
  const t = st("tOf", "SELECT facet, depth FROM item_tag WHERE problem_id = ? AND version = ?").get(p.id, p.v); if (!t) return bad("태그가 없는 문제예요", 404);
  let facet = t.facet, depth = t.depth, review = "accepted";
  if (body.action === "fix") {
    if (body.facet != null) { if (!facetsOf(p.cid).some(f => f.code === body.facet)) return bad("없는 세부 포인트예요"); facet = body.facet; }
    if (body.depth != null) { if (![1, 2, 3, 4].includes(+body.depth)) return bad("깊이는 1–4"); depth = +body.depth; }
    review = "edited";
  } else if (body.action !== "ok") return bad("action은 ok · fix");
  st("tFix", "UPDATE item_tag SET facet = ?, depth = ?, conf = 3, src = 'admin', review = ?, updated_at = ? WHERE problem_id = ? AND version = ?").run(facet, depth, review, now(), p.id, p.v);
  bumpMeta("tag_rev:" + p.cid); tagger.gateCheck(p.cid);
  return { pid: p.id, facet, depth, conf: 3, src: "admin", review };
}

// ───────── 4) 커버리지 + 리포트들이 낸 변형 요청 ─────────
function coverageOf(cid) {
  const agg = new Map();
  for (const r of st("dets", "SELECT det FROM insight WHERE course_id = ?").all(cid)) {
    const d = J(r.det, null); if (!d || !Array.isArray(d.need)) continue;      // 잠긴 리포트의 need는 {n_eff, chapters}라 건너뛴다
    for (const x of d.need) { if (!x || !x.facet) continue; const k = [x.facet, x.depth, x.delta_type, x.m || ""].join("|"); const a = agg.get(k) || agg.set(k, { facet: x.facet, depth: x.depth, delta_type: x.delta_type, m: x.m || null, n_learners: 0 }).get(k); a.n_learners++; }
  }
  return { facets: coverage(cid), need: [...agg.values()].sort((a, b) => b.n_learners - a.n_learners) };
}

// ───────── 5) 새 문제 승인: 숨긴 변형 문제, 세부 포인트마다 3개씩 ─────────
function pending(cid) {
  const C = current(cid), fName = new Map(facetsOf(cid, { all: true }).map(f => [f.code, f.name]));
  const fm = new Map(st("fmAll", "SELECT problem_id pid, family, role, delta_type, delta FROM family_member WHERE course_id = ?").all(cid).map(r => [r.pid, r]));
  const base = new Map(familiesOf(cid).map(f => [f.code, f.base]));
  const L = [...C.values()].filter(it => it.status === "hidden" && it.facet && it.qa.pending !== "rejected");
  const by = new Map(); for (const it of L) (by.get(it.facet) || by.set(it.facet, []).get(it.facet)).push(it);
  let shown = 0;
  const groups = [...by].map(([f, items]) => ({ facet: { code: f, name: fName.get(f) || f }, items: items.slice(0, 3).map(it => {
    shown++; const m = fm.get(it.pid) || {}, bp = m.family ? base.get(m.family) : null, b = bp && bp !== it.pid ? C.get(bp) : null;
    return { pid: it.pid, ext: it.ext, kind: it.kind, body: it.body, dx: { depth: it.depth, role: m.role || null, delta_type: m.delta_type || null, delta: m.delta || "", mis: offered(it.diag) },
      solver: it.qa.solver || null, base: b ? { pid: b.pid, ext: b.ext, kind: b.kind, body: b.body } : null };
  }) }));
  return { groups, left: L.length - shown };
}
function pendingPost(body) {
  const pids = Array.isArray(body.pids) ? body.pids.map(Number).filter(Number.isInteger) : [];
  if (!pids.length) return bad("pids가 필요해요");
  if (!["publish", "reject"].includes(body.action)) return bad("action은 publish · reject");
  let done = 0; const cids = new Set();
  tx(() => { for (const pid of pids) {
    const p = st("pOf", "SELECT id, course_id cid, current_version v FROM problem WHERE id = ?").get(pid); if (!p) continue;
    if (body.action === "publish") done += st("pub", "UPDATE problem SET status = 'published' WHERE id = ? AND status = 'hidden'").run(pid).changes;
    else done += st("rej", "UPDATE item_tag SET qa = json_set(qa, '$.pending', 'rejected') WHERE problem_id = ? AND version = ?").run(pid, p.v).changes;   // 숨긴 채로 두고 목록에서만 뺀다
    cids.add(p.cid);
  } });
  for (const c of cids) { bumpMeta("tag_rev:" + c); tagger.gateCheck(c); }
  return { done };
}

// ───────── 6) 태깅 작업 ─────────
function jobsPost(cid, body) {
  const a = body.action;
  if (a === "plan") { const r = tagger.plan(cid); return { ...tagger.jobsOf(cid), plan: r }; }
  if (a === "start") {
    if (!ai.enabled()) return bad("Gemini 키가 없어서 태깅을 시작할 수 없어요", 409);
    const r = tagger.plan(cid); tagger.setRun(cid, true); tagger.startLoop();
    return { ...tagger.jobsOf(cid), plan: r };
  }
  if (a === "pause") { tagger.setRun(cid, false); return tagger.jobsOf(cid); }
  if (a === "enable") { const g = tagger.enableV2(cid); return g.error ? bad(g.error, 409) : { ...tagger.jobsOf(cid), gate: g }; }   // "켜기" 버튼만 v2를 켠다
  if (a === "hold" || a === "unhold") { tagger.setHold(cid, a === "hold"); return { ...tagger.jobsOf(cid), gate: tagger.gateCheck(cid) }; }
  return bad("action은 plan · start · pause · enable · hold · unhold");
}

/** server.js 관리자 표에 섞을 경로들 (req, m, body, d, q) */
const C_ = f => (req, m, body, d, q) => { const cid = +m.cid; return courseOk(cid) ? f(cid, body, q) : bad("없는 과목", 404); };
export const insightAdmin = {
  "GET /api/insight/courses": () => courses(),
  "GET /api/insight/vocab/:cid": C_(cid => vocab(cid)),
  "PATCH /api/insight/vocab/:cid": C_((cid, b) => vocabPatch(cid, b.ops)),
  "POST /api/insight/vocab/:cid/confirm": C_((cid, b) => {                     // body { chapters: ["CH1", …] }면 그 단원 초안만 (단원별 확인)
    const chs = Array.isArray(b && b.chapters) ? b.chapters.map(String).filter(Boolean) : null;
    const r = chs && chs.length ? tagger.confirmVocabChapters(cid, chs) : tagger.confirmVocab(cid); bumpMeta("tag_rev:" + cid); tagger.gateCheck(cid); return r; }),
  "GET /api/insight/tagcheck/:cid": C_(cid => tagcheck(cid)),
  "POST /api/insight/tagcheck/:pid": (req, m, body) => tagcheckPost(+m.pid, body),
  "GET /api/insight/coverage/:cid": C_(cid => coverageOf(cid)),
  "GET /api/insight/pending/:cid": C_(cid => pending(cid)),
  "POST /api/insight/pending": (req, m, body) => pendingPost(body),
  "GET /api/insight/jobs/:cid": C_(cid => ({ ...tagger.jobsOf(cid), gate: tagger.gateCheck(cid) })),
  "POST /api/insight/jobs/:cid": C_((cid, b) => jobsPost(cid, b)),
  // 2단계: 리포트 때 Gemini 오답 진단 스위치 (기본 꺼짐, 관리자만 켠다). body {cid?: number (없으면 전체), on: bool}
  "GET /api/insight/ai": () => ({ ...aiSwitch(), ai: ai.enabled() }),
  "POST /api/insight/ai": (req, m, body) => {
    const cid = body.cid == null ? null : +body.cid; if (cid != null && !courseOk(cid)) return bad("없는 과목", 404);
    if (typeof body.on !== "boolean") return bad("on은 true · false");
    return { ...setAiSwitch(cid, body.on), ai: ai.enabled() };
  },
  "GET /api/insight/preview/:cid": C_((cid, b, q) => {
    const dev = q && q.get ? q.get("device") : null; if (!dev) return bad("device가 필요해요");
    if (!st("dev", "SELECT 1 FROM device WHERE id = ?").get(dev)) return bad("없는 기기", 404);
    return buildDoc(dev, cid) || bad("없는 과목이거나 숨긴 과목이에요", 404);   // 저장하지 않는다
  }),
};

/** 서버가 켜질 때: INSIGHT_TAGGER=1 이거나 관리자가 켜 둔 과목이 있으면 15초 tick을 돈다 */
export function initTagger() {
  if (process.env.INSIGHT_TAGGER === "1" || db.prepare("SELECT 1 FROM insight_meta WHERE key LIKE 'tag_run:%' AND value = '1' LIMIT 1").get()) tagger.startLoop();
}
