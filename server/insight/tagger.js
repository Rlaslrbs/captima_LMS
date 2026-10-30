// 학습 리포트 v2: 문제 태깅 작업기 (docs/insight/v2/DATA.md §8, SPEC §8.4). 과목 하나씩 A 어휘 → B 합치기 → (관리자 확인) → C 문제 → D 두 번째 의견 → E 변형 묶음 → F 검증.
// - 프롬프트·스키마는 DB 담당의 데이터 파일 (server/insight/prompts/<단계>.md|.json). 여기서는 읽고, 자리표시를 채우고, 답을 검사해 표에 쓴다
// - 모든 Gemini 호출은 ai.js generate() 하나로 (하루 몫 60%·채점 먼저는 거기서 지킨다). 진짜 키가 없으면 돌지 않는다
// - 사용자 기록(device·progress·event·report·bookmark·ai_grade)은 읽기만 한다. 관리자가 고친 태그(review accepted/edited, src admin)는 덮어쓰지 않는다
//   CLI: node server/insight/tagger.js --course 4 [--stage vocab|merge|tag|second|family|verify] [--limit 40] [--dry]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, J, now, tx, meta, bumpMeta, budgetToday, blocked, bodyHash, facetsOf, miscOf, tagSummary, v2Ready, FACET_KINDS, DELTA_TYPES, DEPTH_WHY } from "../db.js";
import * as ai from "../ai.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, "prompts"), GOLD = join(HERE, "gold");
export const STAGES = ["vocab", "merge", "tag", "second", "family", "verify"];
const PURPOSE = { vocab: "vocab", merge: "vocab", tag: "tag", second: "verify", family: "tag", verify: "verify" };
const BATCH = { ox: 8, mc: 4, short: 5, essay: 3, second: 12, family: 4, verify: 8 };
const DELTA = DELTA_TYPES;
const LET = "ABCDEFGH";
const Q = {}, st = (k, sql) => Q[k] ||= db.prepare(sql);
const cut = (s, n) => (s = String(s ?? "").trim(), s.length > n ? s.slice(0, n - 1) + "…" : s);
const T = h => ai.text(h);
const isObj = x => x && typeof x === "object" && !Array.isArray(x);

// ───────── 프롬프트 파일 ─────────
const PCACHE = new Map();
/** <단계>.md (system, 첫 줄 <!-- prompt_ver: N -->) + <단계>.json (responseSchema). 없으면 null */
export function promptOf(name) {
  const md = join(PROMPTS, name + ".md"), js = join(PROMPTS, name + ".json");
  if (!existsSync(md) || !existsSync(js)) return null;
  const key = name; const o = PCACHE.get(key); if (o) return o;
  const sys = readFileSync(md, "utf8"), m = /prompt_ver:\s*(\d+)/.exec(sys.split("\n")[0] || "");
  const p = { system: sys.replace(/^<!--[\s\S]*?-->\s*/, ""), schema: JSON.parse(readFileSync(js, "utf8")), ver: m ? +m[1] : 1 };
  PCACHE.set(key, p); return p;
}
const tagStage = kind => "tag_" + kind;
/** 스키마 안의 enum 자리표시("$q" "$f" "$k" "$m" "$v")를 배치의 실제 목록으로 */
function fillSchema(s, E) {
  if (Array.isArray(s)) return s.map(x => fillSchema(x, E));
  if (!isObj(s)) return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "enum" && Array.isArray(v)) {
      const dyn = v.some(x => typeof x === "string" && x.startsWith("$")), out = [];
      for (const x of v) { if (typeof x === "string" && x.startsWith("$") && E[x.slice(1)]) out.push(...E[x.slice(1)]); else out.push(x); }
      const L = [...new Set(out.map(String))];
      // 긴 목록을 enum으로 주면 Gemini가 400 "too many states"로 거절한다 → 문자열로 받고 서버가 걸러 낸다 (모든 ref는 아래에서 목록과 대조)
      if (dyn && L.length > 8) o.description = ((s.description ? s.description + " " : "") + "값은 다음 중 하나: " + L.slice(0, 80).join(", ")).slice(0, 1500);
      else o[k] = L;
    }
    else if (["minItems", "maxItems", "minLength", "maxLength", "pattern"].includes(k)) continue;   // 겹친 배열 제약은 Gemini가 "too many states"로 거절 → 개수·길이는 서버가 자른다
    else o[k] = fillSchema(v, E);
  }
  return o;
}
const fillText = (s, V) => s.replace(/\{(\w+)\}/g, (m, k) => (V[k] != null ? String(V[k]) : m));

// ───────── 문제 내용 ─────────
export { bodyHash };                                         // 지문은 db.js 하나 (familiesOf·tagSummary와 같은 값)
const TRAP = /함정|주의|혼동|헷갈|착각|오해/;
const traps = s => T(s).split(/(?<=[.!?。])\s+|\n+/).filter(x => TRAP.test(x)).map(x => cut(x, 160)).slice(0, 3);
function itemText(ref, it) {
  const b = it.body, L = [`${ref} (${{ ox: "O/X", mc: "객관식", short: "단답", essay: "서술형" }[it.kind]})`];
  if (b.stem) L.push("지문: " + cut(T(b.stem), 300));
  L.push("문제: " + cut(T(b.q), 400));
  if (it.kind === "mc" && Array.isArray(b.opts)) { b.opts.forEach((o, i) => L.push(`  ${LET[i]}. ${cut(T(o), 160)}`)); L.push("정답: " + (Array.isArray(b.ans) ? b.ans.map(i => LET[i]).join(",") : LET[b.ans] ?? "")); }
  if (it.kind === "ox") L.push("정답: " + (b.ox ? "O (참)" : "X (거짓)") + (b.fix ? ` · 바른 진술: ${cut(T(b.fix), 160)}` : ""));
  if (it.kind === "short") L.push("정답: " + cut([b.a, ...(b.accept || [])].filter(x => x != null).join(" / "), 120));
  if (it.kind === "essay" && Array.isArray(b.pts)) b.pts.forEach((p, i) => L.push(`  채점 포인트 ${i}: ${cut(T(p), 140)}`));
  if (Array.isArray(b.why)) b.why.forEach((w, i) => w && L.push(`  보기 ${LET[i]} 설명: ${cut(T(w), 140)}`));
  for (const t of traps(b.s)) L.push("함정 문장: " + t);
  return L.join("\n");
}

// ───────── 과목 자료 ─────────
function courseOf(cid) {
  const c = st("c", "SELECT id, name, short, info FROM course WHERE id = ?").get(cid); if (!c) return null;
  const info = J(c.info), chapters = st("chs", "SELECT id, key, title FROM chapter WHERE course_id = ? ORDER BY sort, id").all(cid);
  const items = st("its", `SELECT p.id pid, p.ext_id ext, p.status, p.current_version v, ch.key ch, pv.kind, pv.star, pv.body FROM problem p
      JOIN chapter ch ON ch.id = p.chapter_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
      WHERE p.course_id = ? ORDER BY p.sort, p.id`).all(cid).map(r => ({ ...r, body: J(r.body) }));
  const conc = k => { const v = (info.concepts || {})[k]; return cut(T(typeof v === "string" ? v : (v && v.html) || ""), 1500); };
  const topics = info.topics && typeof info.topics === "object" ? info.topics : {};
  const pub = items.filter(i => i.status === "published");
  const topicMode = pub.length > 0 && pub.filter(i => i.body.topic).length / pub.length >= 0.8;   // 문제 대부분에 topic이 있으면 그것이 개념(kc)
  return { cid, name: c.name, short: c.short, lang: info.lang || "ko", math: !!info.math, chapters, items, conc, topics, topicMode };
}
const langNote = C => (C.lang === "en" ? "문항은 영어다. 답은 한국어로 쓰고 전문 용어는 괄호 안에 영어로 둔다." : "") + (C.math ? " \\( \\) 안은 수식으로 읽어라." : "");
const vocabVer = cid => +(meta("vocab_ver:" + cid) || 0);
/** 어휘가 쓸 수 있는 상태인가: 초안이 남지 않았고, 관리자가 확인했거나 저자 팩의 어휘(source author)로 채워져 있다 */
export function vocabApproved(cid) {
  if (meta("vocab_pending:" + cid)) return false;
  const r = st("vstat", "SELECT SUM(status = 'draft') draft, SUM(status = 'active') act, SUM(status = 'active' AND source = 'author') auth FROM facet WHERE course_id = ?").get(cid);
  if (!r || !r.act || r.draft) return false;
  return !!meta("vocab_ok:" + cid) || r.auth === r.act;
}

// ───────── 일감 만들기 ─────────
/** 수요 순서 (SPEC §8.4): 첫 풀이를 틀린 기기 ×3 + 푼 기기 ×2 + 객관식 + ★ ½ + 기출 ½ */
function prio(cid) {
  const m = new Map();
  for (const r of st("dem", `SELECT e.problem_id pid, COUNT(DISTINCT e.device_id) n, COUNT(DISTINCT CASE WHEN json_extract(e.payload, '$.correct') = 0 OR e.type = 'idk' THEN e.device_id END) w
      FROM event e JOIN problem p ON p.id = e.problem_id WHERE p.course_id = ? AND e.type IN ('answer_submit','idk') GROUP BY e.problem_id`).all(cid)) m.set(r.pid, 3 * r.w + 2 * r.n);
  return it => (m.get(it.pid) || 0) + (it.kind === "mc" ? 1 : 0) + 0.5 * (it.star ? 1 : 0) + 0.5 * (Array.isArray(it.body.exams) && it.body.exams.length ? 1 : 0);
}
function addJob(cid, stage, ref) {
  if (st("hasJob", "SELECT 1 FROM tag_job WHERE course_id = ? AND stage = ? AND ref = ? AND state IN ('queued','running')").get(cid, stage, ref)) return 0;
  st("addJob", "INSERT INTO tag_job(course_id, stage, ref, state, created_at, updated_at) VALUES (?,?,?,'queued',?,?)").run(cid, stage, ref, now(), now());
  return 1;
}
/** 해야 할 문제 (C 단계): 지금 버전에 태그가 없거나, 어휘 판·프롬프트 판이 낡은 것. 관리자가 고친 태그는 그대로 */
function needTag(C) {
  const out = [], live = new Set(facetsOf(C.cid).filter(f => f.status === "active").map(f => f.code));
  for (const it of C.items) {
    if (it.status !== "published" && it.status !== "hidden") continue;
    const P = promptOf(tagStage(it.kind)); if (!P) continue;
    const r = st("tagRow", "SELECT version, vocab_ver, prompt_ver, review, src, facet FROM item_tag WHERE problem_id = ? AND version = ?").get(it.pid, it.v);
    if (r && (r.review === "accepted" || r.review === "edited" || r.src === "admin" || r.src === "author")) continue;
    if (r && r.prompt_ver >= P.ver && r.facet && live.has(r.facet) && r.review !== "stale") continue;   // 판 번호만 오른 것은 다시 부르지 않는다 (쓰던 세부 포인트가 은퇴했을 때만)
    if (!r && carry(it)) continue;
    out.push(it);
  }
  return out;
}
/** 같은 내용의 옛 버전에 태그가 있으면 부르지 않고 옮긴다 (SPEC §8.4 carry-over) */
function carry(it) {
  const h = bodyHash(it.kind, it.body);
  const r = st("carry", "SELECT * FROM item_tag WHERE problem_id = ? AND body_hash = ? AND version != ? AND review NOT IN ('rejected','stale') ORDER BY version DESC LIMIT 1").get(it.pid, h, it.v);
  if (!r) return false;
  st("carryIns", `INSERT OR IGNORE INTO item_tag(problem_id, version, body_hash, vocab_ver, prompt_ver, model, kcs, diag, qa, review, updated_at, facet, depth, src, conf)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(it.pid, it.v, h, r.vocab_ver, r.prompt_ver, r.model, r.kcs, r.diag, r.qa, r.review, now(), r.facet, r.depth, r.src, r.conf);
  return true;
}
/**
 * 과목의 일감을 큐에 넣는다. 어휘가 아직 확인 전이면 A·B만, 확인 뒤면 C·D·E·F.
 * → { added: {stage: n}, waiting: "vocab_confirm" | null }
 */
export function plan(cid) {
  const C = courseOf(cid); if (!C) return { error: "없는 과목" };
  const added = {}, add = (s, ref) => { added[s] = (added[s] || 0) + addJob(cid, s, ref); };
  if (!vocabApproved(cid)) {
    for (const ch of C.chapters) if (C.items.some(i => i.ch === ch.key && i.status === "published")) add("vocab", ch.key);
    add("merge", "course");
    return { added, waiting: "vocab_confirm" };
  }
  const P = prio(cid), todo = needTag(C).sort((a, b) => P(b) - P(a) || a.pid - b.pid);
  const by = new Map(); for (const it of todo) { const k = it.ch + "|" + it.kind; (by.get(k) || by.set(k, []).get(k)).push(it); }
  for (const [k, L] of by) { const n = BATCH[k.split("|")[1]] || 4; for (let i = 0; i < L.length; i += n) add("tag", L.slice(i, i + n).map(it => it.pid + ":" + it.v).join(",")); }
  add("second", "course"); add("family", "course"); add("verify", "course");
  return { added, waiting: null };
}

// ───────── A. 단원 어휘 (개념·세부 포인트·오개념 초안) ─────────
const facetsOfCourse = cid => facetsOf(cid), miscOfCourse = cid => miscOf(cid);
// 새 코드는 은퇴·거절된 것까지 모든 행의 최댓값 + 1 (코드는 다시 쓰지 않는다). m### · F### · c## 는 작업기 몫
const maxNum = (rows, re) => rows.reduce((m, x) => Math.max(m, +((re.exec(x.code) || [0, 0])[1])), 0);
const nextMisc = cid => "m" + String(maxNum(miscOf(cid, null, { all: true }), /^m(\d+)$/) + 1).padStart(3, "0");
async function runVocab(C, job) {
  const P = promptOf("vocab"); if (!P) throw fail("프롬프트 파일 vocab이 없어요");
  const ch = C.chapters.find(c => c.key === job.ref); if (!ch) return { done: true };
  let L = C.items.filter(i => i.ch === ch.key && i.status === "published");
  if (L.length > 60) L = [...L.filter(i => i.body.fix || traps(i.body.s).length), ...L.filter(i => !(i.body.fix || traps(i.body.s).length))].slice(0, 60);
  const q = L.map((_, i) => "q" + (i + 1));
  const kcs = C.topicMode ? [...new Set(L.map(i => i.body.topic).filter(Boolean))] : ["k1", "k2", "k3", "k4", "k5", "k6"];
  const prompt = [`[과목] ${C.name}`, `[단원] ${ch.title}`, C.conc(ch.key) ? `[배운 내용]\n${C.conc(ch.key)}` : "",
    C.topicMode ? `[개념(고정)]\n${kcs.map(k => `${k} | ${C.topics[k] || k}`).join("\n")}` : "", "[문항]", ...L.map((it, i) => itemText(q[i], it))].filter(Boolean).join("\n\n");
  const out = await call("vocab", P, { course: C.name, lang_note: langNote(C) }, prompt, { q, k: kcs, f: ["f1", "f2", "f3", "f4", "f5"] });
  // 검사: 근거 없는 오개념은 버리고 길이를 자른다. 결과는 합치기(B) 전까지 초안으로만
  const ref2pid = new Map(q.map((r, i) => [r, L[i].pid]));
  const draft = { ch: ch.key, title: ch.title, kcs: [], miscs: [] };
  for (const k of Array.isArray(out.kcs) ? out.kcs.slice(0, 6) : []) {
    if (!k || !k.ref || !kcs.includes(String(k.ref))) continue;            // 목록에 없는 개념 ref는 버린다
    draft.kcs.push({ ref: String(k.ref), name: cut(k.name || C.topics[k.ref] || k.ref, 20), definition: cut(k.definition, 200), boundary: cut(k.boundary, 160),
      support: (k.support || []).map(r => ref2pid.get(r)).filter(Boolean),
      facets: (Array.isArray(k.facets) ? k.facets : []).slice(0, 5).map((f, i) => ({ ref: String(f.ref || "f" + (i + 1)), name: cut(f.name, 20), statement: cut(f.statement, 90),
        kind: FACET_KINDS.includes(f.kind) ? f.kind : "property", support: (f.support || []).map(r => ref2pid.get(r)).filter(Boolean) })) });
  }
  for (const m of Array.isArray(out.miscs) ? out.miscs.slice(0, 12) : []) {
    const ev = (m.evidence || []).map(r => ref2pid.get(r)).filter(Boolean); if (!ev.length || !m.belief) continue;
    draft.miscs.push({ evidence: ev, kc: String(m.kc || ""), facet: String(m.facet || ""), cw: m.confused_with && m.confused_with !== "none" ? String(m.confused_with) : null,
      belief: cut(m.belief, 70), truth: cut(m.truth, 90), contrast: cut(m.contrast, 200), cue: cut(m.cue, 50) });
  }
  draft.miscs = dedupe(draft.miscs, x => x.belief);
  meta(`vocab_draft:${C.cid}:${ch.key}`, JSON.stringify(draft));
  return { done: true };
}
// 같은 뜻의 믿음 합치기: 정규화한 글의 3글자 조각 Jaccard ≥ 0.6
const tri = s => { const t = String(s).normalize("NFKC").replace(/\s+/g, ""), o = new Set(); for (let i = 0; i < t.length - 2; i++) o.add(t.slice(i, i + 3)); return o; };
const jac = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.max(1, a.size + b.size - n); };
function dedupe(L, key) { const out = []; for (const x of L) { const t = tri(key(x)); if (!out.some(y => jac(t, tri(key(y))) >= 0.6)) out.push(x); } return out; }

// ───────── B. 과목 합치기: 개념 15–40개 + 세부 포인트, 코드를 매기고 표에 초안으로 ─────────
async function runMerge(C, job) {
  const drafts = C.chapters.map(c => meta(`vocab_draft:${C.cid}:${c.key}`)).filter(Boolean).map(s => J(s, null)).filter(Boolean);
  const pend = st("pendV", "SELECT COUNT(*) n FROM tag_job WHERE course_id = ? AND stage = 'vocab' AND state IN ('queued','running')").get(C.cid).n;
  if (pend) return { retry: true };                                        // 단원 어휘가 다 끝난 뒤에
  if (!drafts.length) return { done: true };
  const P = promptOf("merge"); if (!P) throw fail("프롬프트 파일 merge가 없어요");
  const refs = [], fRefs = [];
  for (const d of drafts) for (const k of d.kcs) { refs.push(`${d.ch}:${k.ref}`); for (const f of k.facets) fRefs.push(`${d.ch}:${k.ref}.${f.ref}`); }
  const prompt = drafts.map(d => [`[단원 ${d.ch}] ${d.title}`, ...d.kcs.map(k => `${d.ch}:${k.ref} | ${k.name} | ${k.definition} | 근거 ${k.support.length}문항\n` +
    k.facets.map(f => `   ${d.ch}:${k.ref}.${f.ref} | ${f.name} | ${f.statement} | 근거 ${f.support.length}문항`).join("\n"))].join("\n")).join("\n\n");
  const out = await call("merge", P, { course: C.name, lang_note: langNote(C) }, prompt, { k: refs, f: fRefs });
  const groups = Array.isArray(out.groups) ? out.groups : [];
  const sup = new Map(), fsup = new Map(), fInfo = new Map();
  for (const d of drafts) for (const k of d.kcs) { sup.set(`${d.ch}:${k.ref}`, k.support); for (const f of k.facets) { fsup.set(`${d.ch}:${k.ref}.${f.ref}`, f.support); fInfo.set(`${d.ch}:${k.ref}.${f.ref}`, f); } }
  const v = vocabVer(C.cid) + 1, t = now();
  const oldK = st("oldK", "SELECT code, name, chapter_keys, status, source FROM kc WHERE course_id = ?").all(C.cid);
  const oldSup = new Map(oldK.filter(k => k.status !== "retired").map(k => [k.code, new Set(J(meta(`kc_support:${C.cid}:${k.code}`), []))]));
  let kn = oldK.filter(k => /^c\d+$/.test(k.code)).reduce((m, k) => Math.max(m, +k.code.slice(1)), 0);
  const mapK = new Map(), mapF = new Map();
  tx(() => {
    for (const g of groups) {
      const from = (g.from || []).filter(r => sup.has(r)); if (!from.length) continue;
      const pids = new Set(from.flatMap(r => sup.get(r)));
      // 코드: 주제 모드면 topic 코드 그대로, 아니면 예전 개념과 근거가 50% 이상 겹칠 때 그 코드를 다시 쓴다 (판이 바뀌어도 id는 그대로)
      let code = C.topicMode ? from[0].split(":")[1] : null;
      if (!code) for (const [c, S] of oldSup) { let n = 0; for (const p of pids) if (S.has(p)) n++; if (S.size && n / Math.min(S.size, pids.size) >= 0.5) { code = c; break; } }
      code ||= "c" + String(++kn).padStart(2, "0");
      for (const r of from) mapK.set(r, code);
      const chs = [...new Set(from.map(r => r.split(":")[0]))];
      st("kcUp", `INSERT INTO kc(course_id, code, chapter_keys, name, definition, boundary, confusable, source, status, vocab_ver, updated_at) VALUES (?,?,?,?,?,?,?,?, 'draft', ?, ?)
          ON CONFLICT(course_id, code) DO UPDATE SET chapter_keys = excluded.chapter_keys, name = CASE WHEN kc.source = 'admin' THEN kc.name ELSE excluded.name END,
          definition = excluded.definition, boundary = excluded.boundary, vocab_ver = excluded.vocab_ver, updated_at = excluded.updated_at
          WHERE kc.source NOT IN ('author', 'admin') AND kc.status != 'retired'`)
        .run(C.cid, code, JSON.stringify(chs), cut(g.name || (C.topics[code] || code), 20), cut(g.definition, 200), cut(g.boundary, 160), "[]", C.topicMode ? "topic" : "llm", v, t);
      meta(`kc_support:${C.cid}:${code}`, JSON.stringify([...pids]));
      // 세부 포인트: 합치기 결과의 facets가 있으면 그대로, 없으면 단원 초안의 것을 모은다. 근거가 2문항 미만이면 가장 가까운 것에 합친다 (여기서는 같은 개념의 첫 것)
      const fs = Array.isArray(g.facets) && g.facets.length ? g.facets.map(f => ({ from: (f.from || []).filter(r => fInfo.has(r)), name: f.name, statement: f.statement, kind: f.kind }))
        : from.flatMap(r => [...fInfo.keys()].filter(x => x.startsWith(r + ".")).map(x => ({ from: [x], ...fInfo.get(x) })));
      const fall = st("fexist", "SELECT code, status FROM facet WHERE course_id = ? AND kc = ?").all(C.cid, code), exist = fall.filter(r => r.status !== "retired").map(r => r.code);
      let fn = maxNum(fall, /\.f(\d+)$/), firstF = null;
      for (const f of fs) {
        const fp = new Set(f.from.flatMap(r => fsup.get(r) || []));
        if (fp.size < 2 && firstF) { for (const r of f.from) mapF.set(r, firstF); continue; }
        let fcode = null;
        for (const c of exist) { const S = new Set(J(meta(`facet_support:${C.cid}:${c}`), [])); let n = 0; for (const p of fp) if (S.has(p)) n++; if (S.size && fp.size && n / Math.min(S.size, fp.size) >= 0.5) { fcode = c; break; } }
        fcode ||= `${code}.f${++fn}`; firstF ||= fcode;
        for (const r of f.from) mapF.set(r, fcode);
        st("fUp", `INSERT INTO facet(course_id, code, kc, name, statement, kind, confusable, sort, source, status, vocab_ver, updated_at) VALUES (?,?,?,?,?,?,'[]',?, 'llm', 'draft', ?, ?)
            ON CONFLICT(course_id, code) DO UPDATE SET name = CASE WHEN facet.source = 'admin' THEN facet.name ELSE excluded.name END,
            statement = CASE WHEN facet.source = 'admin' THEN facet.statement ELSE excluded.statement END, vocab_ver = excluded.vocab_ver, updated_at = excluded.updated_at
            WHERE facet.source NOT IN ('author', 'admin') AND facet.status != 'retired'`)
          .run(C.cid, fcode, code, cut(f.name, 20), cut(f.statement, 90), FACET_KINDS.includes(f.kind) ? f.kind : "property", fn, v, t);
        meta(`facet_support:${C.cid}:${fcode}`, JSON.stringify([...fp]));
      }
    }
    // 헷갈리는 개념 쌍: 합치기 결과 confusable
    for (const g of groups) {
      const a = mapK.get((g.from || [])[0]); if (!a) continue;
      const cw = [...new Set((g.confusable || []).map(r => mapK.get(r)).filter(x => x && x !== a))].slice(0, 3);
      st("kcCw", "UPDATE kc SET confusable = ? WHERE course_id = ? AND code = ? AND source NOT IN ('author', 'admin')").run(JSON.stringify(cw), C.cid, a);
    }
    // 오개념: 단원 초안의 kc·facet 참조를 합친 코드로, 같은 뜻은 하나로
    const have = miscOf(C.cid, null, { all: true }).filter(x => x.status !== "rejected");
    let mn = maxNum(miscOf(C.cid, null, { all: true }), /^m(\d+)$/);
    for (const d of drafts) for (const m of d.miscs) {
      const k = mapK.get(`${d.ch}:${m.kc}`) || (C.topicMode ? m.kc : null);
      const fref = m.facet ? `${d.ch}:${m.kc}.${m.facet}` : null, f = (fref && mapF.get(fref)) || null; if (!k) continue;
      const dup = have.find(x => jac(tri(x.belief), tri(m.belief)) >= 0.6); if (dup) continue;
      const code = "m" + String(++mn).padStart(3, "0");
      st("mIns", `INSERT OR IGNORE INTO misc(course_id, code, chapter_key, kc, cw, belief, truth, contrast, cue, src, status, vocab_ver, updated_at, facet) VALUES (?,?,?,?,?,?,?,?,?, 'llm', 'auto', ?, ?, ?)`)
        .run(C.cid, code, d.ch, k, m.cw ? mapK.get(`${d.ch}:${m.cw}`) || null : null, m.belief, m.truth, m.contrast, m.cue, v, t, f);
      have.push({ code, belief: m.belief });
    }
    meta("vocab_pending:" + C.cid, String(v));                       // 관리자가 "확인"을 누르면 vocab_ver가 이 판이 된다
  });
  return { done: true };
}

/** 관리자 "확인": 초안을 활성으로 바꾸고 어휘 판을 올린다 → 다음 plan()부터 문제 태깅 */
export function confirmVocab(cid) {
  const v = Math.max(vocabVer(cid), +(meta("vocab_pending:" + cid) || 0), 1);
  tx(() => {
    st("kcAct", "UPDATE kc SET status = 'active', vocab_ver = ?, updated_at = ? WHERE course_id = ? AND status = 'draft'").run(v, now(), cid);
    st("fAct", "UPDATE facet SET status = 'active', vocab_ver = ?, updated_at = ? WHERE course_id = ? AND status = 'draft'").run(v, now(), cid);
    st("mAct", "UPDATE misc SET status = 'ok' WHERE course_id = ? AND status = 'auto'").run(cid);
    meta("vocab_ver:" + cid, String(v)); meta("vocab_ok:" + cid, String(v)); meta("vocab_pending:" + cid, null);
  });
  return { ver: v, approved: true };
}

// ───────── C. 문제 태깅: 세부 포인트 + 깊이 + 보기마다 오개념 ─────────
function facetRefs(cid, ch) {
  // 이 단원의 세부 포인트 + 그 개념의 헷갈리는 개념에 딸린 세부 포인트 (≤ 20, 지역 ref f1…)
  const all = facetsOfCourse(cid), kcs = st("kcs", "SELECT code, chapter_keys, confusable FROM kc WHERE course_id = ? AND status != 'retired'").all(cid);
  const here = new Set(kcs.filter(k => J(k.chapter_keys, []).includes(ch)).map(k => k.code));
  for (const k of kcs) if (here.has(k.code)) for (const c of J(k.confusable, [])) here.add(c);
  let L = all.filter(f => here.has(f.kc)); if (!L.length) L = all;
  L = L.slice(0, 20);
  return { list: L, ref: new Map(L.map((f, i) => ["f" + (i + 1), f.code])), back: new Map(L.map((f, i) => [f.code, "f" + (i + 1)])) };
}
async function runTag(C, job) {
  const pairs = job.ref.split(",").map(x => x.split(":").map(Number));
  const L = pairs.map(([pid, v]) => C.items.find(i => i.pid === pid && i.v === v)).filter(Boolean);
  if (!L.length) return { done: true };                                   // 내용이 바뀌었으면 다음 plan()이 새로 넣는다
  const kind = L[0].kind, P = promptOf(tagStage(kind)); if (!P) throw fail(`프롬프트 파일 ${tagStage(kind)}이 없어요`);
  const ch = L[0].ch, F = facetRefs(C.cid, ch), M = miscOfCourse(C.cid).filter(m => !m.facet || F.back.has(m.facet)).slice(0, 40);
  const q = L.map((_, i) => "q" + (i + 1));
  const chap = C.chapters.find(c => c.key === ch) || { title: ch };
  const taught = [F.list.map(f => `- ${f.statement}`).join("\n"), C.conc(ch)].filter(Boolean).join("\n").slice(0, 1500);
  const facetsTxt = F.list.map((f, i) => `f${i + 1} | ${f.name} | ${f.statement}`).join("\n");
  const miscTxt = M.map(m => `${m.code} | ${m.facet ? F.back.get(m.facet) || "-" : "-"} | ${m.belief} | ${m.truth}`).join("\n");
  const prompt = [`[단원] ${chap.title}`, `[배운 내용]\n${taught}`, `[세부 포인트]\n${facetsTxt}`, `[오개념]\n${miscTxt || "(아직 없음)"}`, "[문항]", ...L.map((it, i) => itemText(q[i], it))].join("\n\n");
  const out = await call(tagStage(kind), P, { course: C.name, lang_note: langNote(C), facets: facetsTxt, miscs: miscTxt, taught }, prompt,
    { q, f: [...F.ref.keys()], m: ["none", "new", ...M.map(m => m.code)] });
  const got = new Map((Array.isArray(out.items) ? out.items : []).filter(x => x && q.includes(x.ref)).map(x => [x.ref, x]));
  const missing = [];
  const v = vocabVer(C.cid), t = now();
  tx(() => L.forEach((it, i) => {
    const x = got.get(q[i]); if (!x) { missing.push(it); return; }
    const r = checkTag(C, it, x, F, M);
    if (!r) { missing.push(it); return; }
    const old = st("tagRow", "SELECT version, vocab_ver, prompt_ver, review, src FROM item_tag WHERE problem_id = ? AND version = ?").get(it.pid, it.v);
    if (old && (old.review === "accepted" || old.review === "edited" || old.src === "admin" || old.src === "author")) return;
    st("tagPut", `INSERT INTO item_tag(problem_id, version, body_hash, vocab_ver, prompt_ver, model, kcs, diag, qa, review, updated_at, facet, depth, src, conf)
        VALUES (?,?,?,?,?,?,?,?, '{}', 'auto', ?, ?, ?, 'llm', 1)
        ON CONFLICT(problem_id, version) DO UPDATE SET body_hash = excluded.body_hash, vocab_ver = excluded.vocab_ver, prompt_ver = excluded.prompt_ver, model = excluded.model,
          kcs = excluded.kcs, diag = excluded.diag, updated_at = excluded.updated_at, facet = excluded.facet, depth = excluded.depth, src = 'llm', conf = 1, review = 'auto'`)
      .run(it.pid, it.v, bodyHash(it.kind, it.body), v, P.ver, call.last || "", JSON.stringify(r.kcs), JSON.stringify(r.diag), t, r.facet, r.depth);
  }));
  if (L.length - missing.length > 0) bumpMeta("tag_rev:" + C.cid);
  if (missing.length && missing.length < L.length) { addJob(C.cid, "tag", missing.map(it => it.pid + ":" + it.v).join(",")); return { done: true }; }
  if (missing.length) throw fail("답에 빠진 문항이 있거나 검사를 통과하지 못했어요");
  return { done: true };
}
/** SPEC §8.2.4 + DATA §8.2·§8.4 검사 → { facet, depth, kcs, diag } 또는 null (다시) */
function checkTag(C, it, x, F, M) {
  const facet = F.ref.get(x.facet); if (!facet) return null;
  const facets2 = (x.facets2 || []).map(r => F.ref.get(r)).filter(f => f && f !== facet).slice(0, 2);
  let depth = +x.depth; if (!(depth >= 1 && depth <= 4)) return null;
  const why = DEPTH_WHY.includes(x.depth_why) ? x.depth_why : null;
  let cf = { facet: 2, depth: 2, mis: 2 };
  if (why && +why[1] !== depth) { depth = Math.min(depth, +why[1]); cf.depth = 1; }   // 깊이와 규칙 id가 어긋나면 낮은 쪽, 신뢰 1
  const b = it.body, codes = new Set(M.map(m => m.code)), diag = { facets2, depth_why: why, cf };
  const newMisc = (x.new_misc || [])[0];
  const mOf = m => (m === "new" ? (newMisc ? addMisc(C, facet, newMisc) : null) : m && m !== "none" && codes.has(m) ? m : null);
  if (it.kind === "mc") {
    const n = Array.isArray(b.opts) ? b.opts.length : 0, ans = new Set(Array.isArray(b.ans) ? b.ans : [b.ans]), opt = {};
    const trapTxt = T(b.s);
    for (const o of x.options || []) {
      const i = +o.idx; if (!(i >= 0 && i < n) || ans.has(i)) continue;
      const m = mOf(o.misc), d = m ? +o.d || 0 : Math.min(1, +o.d || 0);
      const named = new RegExp(`(^|[^A-Za-z])${LET[i]}([^A-Za-z]|$)|${["①", "②", "③", "④", "⑤"][i] || "@@"}`).test(trapTxt) || (T(b.opts[i]).length >= 8 && trapTxt.includes(T(b.opts[i]).slice(0, 8)));
      opt[i] = { m, d, src: named ? "explanation" : o.src === "explanation" ? "explanation" : "inferred", err: o.err || null, why: cut(o.belief_if_chosen, 80) };
    }
    diag.opt = opt;
  } else if (it.kind === "ox") {
    const o = x.ox || {}; if (typeof o.statement_true === "boolean" && o.statement_true !== !!b.ox) return null;
    diag.ox = b.ox ? { m: null, mr: mOf(o.reverse_misc), d: +o.d || 0, src: "inferred", err: o.err || null }
      : { m: mOf(o.misc), mr: null, d: +o.d || 0, src: b.fix ? "fix" : "inferred", err: o.err || null, planted: cut(o.planted_error, 80) };
  } else if (it.kind === "short") {
    diag.short = (x.short_errors || []).slice(0, 4).map(e => ({ m: mOf(e.misc), d: +e.d || 0, ex: (e.examples || []).slice(0, 4).map(String), num: b.num != null, err: e.err || null })).filter(e => e.ex.length);
  } else if (it.kind === "essay") {
    diag.pts = (x.points || []).map(p => ({ i: +p.i, facet: F.ref.get(p.facet) || facet, m: mOf(p.misc) })).filter(p => p.i >= 0);
  }
  const kc = k => (facetsOfCourse(C.cid).find(f => f.code === k) || {}).kc;
  const k1 = kc(facet), k2 = [...new Set(facets2.map(kc).filter(k => k && k !== k1))];
  const kcs = k1 ? (k2.length ? [[k1, 0.7], ...k2.map(k => [k, 0.3 / k2.length])] : [[k1, 1]]) : [];
  return { facet, depth, kcs, diag };
}
function addMisc(C, facet, nm) {
  if (!nm || !nm.belief) return null;
  const have = miscOfCourse(C.cid), dup = have.find(x => jac(tri(x.belief), tri(nm.belief)) >= 0.6); if (dup) return dup.code;
  const code = nextMisc(C.cid);
  const kc = (facetsOfCourse(C.cid).find(f => f.code === facet) || {}).kc || "";
  st("mNew", `INSERT OR IGNORE INTO misc(course_id, code, chapter_key, kc, cw, belief, truth, contrast, cue, src, status, vocab_ver, updated_at, facet) VALUES (?,?, '', ?, NULL, ?, ?, '', '', 'llm', 'auto', ?, ?, ?)`)
    .run(C.cid, code, kc, cut(nm.belief, 70), cut(nm.truth, 90), vocabVer(C.cid), now(), facet);
  return code;
}

// ───────── D. 두 번째 의견: 세부 포인트·깊이만 다시 → conf ─────────
async function runSecond(C, job) {
  const pend = st("pendT", "SELECT COUNT(*) n FROM tag_job WHERE course_id = ? AND stage = 'tag' AND state IN ('queued','running')").get(C.cid).n;
  if (pend) return { retry: true };
  const P = promptOf("second"); if (!P) throw fail("프롬프트 파일 second가 없어요");
  // conf가 아직 1이고 두 번째 의견이 없는 llm 태그, 단원별 12개씩 한 번에 한 묶음
  const rows = st("needD", `SELECT t.problem_id pid, t.version v, t.facet, t.depth, t.diag FROM item_tag t JOIN problem p ON p.id = t.problem_id
      WHERE p.course_id = ? AND t.src = 'llm' AND t.review = 'auto' AND json_extract(t.qa, '$.second') IS NULL ORDER BY t.problem_id LIMIT 200`).all(C.cid);
  if (!rows.length) return { done: true };
  const it0 = C.items.find(i => i.pid === rows[0].pid); if (!it0) { markQa(rows[0].pid, rows[0].v, { second: "skip" }); return { retry: true }; }
  const L = rows.filter(r => { const it = C.items.find(i => i.pid === r.pid); return it && it.ch === it0.ch && it.v === r.v; }).slice(0, BATCH.second);
  const F = facetRefs(C.cid, it0.ch), q = L.map((_, i) => "q" + (i + 1));
  const prompt = [`[세부 포인트]\n${F.list.map((f, i) => `f${i + 1} | ${f.name} | ${f.statement}`).join("\n")}`, "[문항]",
    ...[...L].reverse().map((r, j) => itemText(q[L.length - 1 - j], C.items.find(i => i.pid === r.pid)))].join("\n\n");   // 순서를 뒤집어 같은 답을 베끼지 않게
  const out = await call("second", P, { course: C.name, lang_note: langNote(C) }, prompt, { q, f: [...F.ref.keys()] });
  const got = new Map((out.items || []).filter(x => x && q.includes(x.ref)).map(x => [x.ref, x]));
  tx(() => L.forEach((r, i) => {
    const x = got.get(q[i]); if (!x) return;
    const f2 = F.ref.get(x.facet), d2 = +x.depth, dg = J(r.diag);
    const grounded = Object.values(dg.opt || {}).some(o => o && o.src === "explanation") || (dg.ox && dg.ox.src === "fix") || (dg.ox && dg.ox.src === "explanation");
    let conf, depth = r.depth, review = "auto";
    if (f2 === r.facet && d2 === r.depth) conf = grounded ? 3 : 2;
    else if (f2 === r.facet && Math.abs(d2 - r.depth) === 1) { conf = 1; depth = Math.min(d2, r.depth); }
    else conf = 1;
    st("confPut", "UPDATE item_tag SET conf = ?, depth = ?, review = ?, qa = json_set(qa, '$.second', json(?)) WHERE problem_id = ? AND version = ?")
      .run(conf, depth, review, JSON.stringify({ facet: f2 || null, depth: d2 || null }), r.pid, r.v);
  }));
  bumpMeta("tag_rev:" + C.cid);
  return { retry: true };                                                   // 남은 것이 없을 때까지 같은 일감을 다시
}
const markQa = (pid, v, o) => st("qa", "UPDATE item_tag SET qa = json_patch(qa, ?) WHERE problem_id = ? AND version = ?").run(JSON.stringify(o), pid, v);

// ───────── E. 변형 묶음 (세부 포인트마다, 한 번에 4개) ─────────
async function runFamily(C, job) {
  const pend = st("pendD", "SELECT COUNT(*) n FROM tag_job WHERE course_id = ? AND stage IN ('tag','second') AND state IN ('queued','running')").get(C.cid).n;
  if (pend) return { retry: true };
  const P = promptOf("family"); if (!P) throw fail("프롬프트 파일 family가 없어요");
  const done = new Set(J(meta("family_done:" + C.cid), []));
  const byF = new Map();
  for (const r of st("tagsF", `SELECT t.problem_id pid, t.version v, t.facet, t.depth FROM item_tag t JOIN problem p ON p.id = t.problem_id AND p.current_version = t.version
      WHERE p.course_id = ? AND t.facet IS NOT NULL AND t.review NOT IN ('rejected','stale') AND p.status = 'published'`).all(C.cid))
    if (!st("inFam", "SELECT 1 FROM family_member WHERE problem_id = ? AND source IN ('author','admin')").get(r.pid)) (byF.get(r.facet) || byF.set(r.facet, []).get(r.facet)).push(r);
  const todo = [...byF].filter(([f, L]) => L.length >= 2 && !done.has(f)).slice(0, BATCH.family);
  if (!todo.length) return { done: true };
  const facets = new Map(facetsOfCourse(C.cid).map(f => [f.code, f]));
  const qmap = new Map(), fmap = new Map(); let qi = 0;
  const parts = todo.map(([f, L], j) => { const fr = "f" + (j + 1); fmap.set(fr, f);
    return [`[${fr}] ${(facets.get(f) || {}).statement || f}`, ...L.slice(0, 15).map(r => { const ref = "q" + ++qi; qmap.set(ref, r); return itemText(ref, C.items.find(i => i.pid === r.pid)) + `\n깊이: ${r.depth}`; })].join("\n"); });
  const out = await call("family", P, { course: C.name, lang_note: langNote(C) }, parts.join("\n\n"), { q: [...qmap.keys()], f: [...fmap.keys()] });
  const t = now();
  tx(() => {
    let n = maxNum(st("famN", "SELECT code FROM family WHERE course_id = ?").all(C.cid), /^F(\d+)$/);
    for (const g of Array.isArray(out.families) ? out.families : []) {
      const base = qmap.get(g.base); if (!base) continue;
      const f = fmap.get(g.facet) || base.facet, used = new Set([g.base]), mem = [];
      for (const m of g.members || []) {
        const r = qmap.get(m.ref); if (!r || used.has(m.ref) || r.facet !== base.facet) continue; used.add(m.ref);
        let role = m.role === "iso" ? "iso" : "near", dt = DELTA.includes(m.delta_type) ? m.delta_type : null; if (!dt) continue;
        if (role === "iso" && (!["surface", "repr"].includes(dt) || r.depth !== base.depth)) { if (dt === "surface") continue; role = "near"; }   // DATA §8.3
        if (role === "near" && dt === "surface") continue;
        mem.push({ r, role, dt, delta: cut(m.delta, 40) });
      }
      if (!mem.length) continue;                                            // 혼자 남은 묶음은 버린다
      const code = "F" + String(++n).padStart(3, "0");
      st("famIns", "INSERT INTO family(course_id, code, facet, base_problem_id, principle, source, status, updated_at) VALUES (?,?,?,?,?, 'llm', 'auto', ?)")
        .run(C.cid, code, f, base.pid, cut(g.principle, 90), t);
      const put = (r, role, dt, delta) => { const it = C.items.find(i => i.pid === r.pid);
        st("fmIns", `INSERT INTO family_member(problem_id, course_id, family, role, delta_type, delta, body_hash, source, conf, updated_at) VALUES (?,?,?,?,?,?,?, 'llm', 2, ?)
            ON CONFLICT(problem_id) DO UPDATE SET family = excluded.family, role = excluded.role, delta_type = excluded.delta_type, delta = excluded.delta, body_hash = excluded.body_hash, conf = 2, updated_at = excluded.updated_at
            WHERE family_member.source = 'llm'`).run(r.pid, C.cid, code, role, dt, delta, bodyHash(it.kind, it.body), t); };
      put(base, "base", null, "");
      for (const m of mem) put(m.r, m.role, m.dt, m.delta);
    }
    for (const [f] of todo) done.add(f);
    meta("family_done:" + C.cid, JSON.stringify([...done]));
  });
  bumpMeta("tag_rev:" + C.cid);
  return { retry: true };
}

// ───────── F. 검증: 추론한 오개념(d ≥ 2)을 블라인드로 고르게 + 주 세부 포인트가 맞는지 ─────────
async function runVerify(C, job) {
  const pend = st("pendE", "SELECT COUNT(*) n FROM tag_job WHERE course_id = ? AND stage IN ('tag','second') AND state IN ('queued','running')").get(C.cid).n;
  if (pend) return { retry: true };
  const P = promptOf("verify"); if (!P) throw fail("프롬프트 파일 verify가 없어요");
  const misc = new Map(miscOfCourse(C.cid).map(m => [m.code, m])), facets = new Map(facetsOfCourse(C.cid).map(f => [f.code, f]));
  const checks = [];
  for (const r of st("needF", `SELECT t.problem_id pid, t.version v, t.facet, t.diag FROM item_tag t JOIN problem p ON p.id = t.problem_id
      WHERE p.course_id = ? AND t.src = 'llm' AND t.review = 'auto' AND json_extract(t.qa, '$.verified') IS NULL ORDER BY t.problem_id LIMIT 40`).all(C.cid)) {
    const it = C.items.find(i => i.pid === r.pid && i.v === r.v); if (!it) { markQa(r.pid, r.v, { verified: "skip" }); continue; }
    const dg = J(r.diag), opts = Object.entries(dg.opt || {}).filter(([, o]) => o && o.m && o.src === "inferred" && o.d >= 2);
    for (const [i, o] of opts) checks.push({ r, it, i: +i, m: o.m });
    if (dg.ox && dg.ox.m && dg.ox.src === "inferred" && dg.ox.d >= 2) checks.push({ r, it, i: "ox", m: dg.ox.m });
    if (!opts.length && !(dg.ox && dg.ox.m)) checks.push({ r, it, i: null, m: null });          // 세부 포인트만 확인
    if (checks.length >= BATCH.verify) break;
  }
  if (!checks.length) return { done: true };
  const L = checks.slice(0, BATCH.verify), vref = L.map((_, i) => "v" + (i + 1));
  const body = L.map((c, i) => [itemText(vref[i], c.it).replace(/\n정답:[^\n]*/g, "").replace(/\n함정 문장:[^\n]*/g, "").replace(/\n {2}보기 [A-H] 설명:[^\n]*/g, ""),
    c.m ? `학생 설명: ${(misc.get(c.m) || {}).belief || ""}` : "", `세부 포인트: ${(facets.get(c.r.facet) || {}).statement || c.r.facet}`].filter(Boolean).join("\n")).join("\n\n");
  const out = await call("verify", P, { course: C.name, lang_note: langNote(C) }, body, { v: vref, q: vref });
  const pick = new Map((out.checks || []).map(x => [x.ref, x])), fit = new Map((out.fit || []).map(x => [x.ref, x]));
  tx(() => L.forEach((c, i) => {
    const x = pick.get(vref[i]), y = fit.get(vref[i]), dg = J(st("diagOf", "SELECT diag FROM item_tag WHERE problem_id = ? AND version = ?").get(c.r.pid, c.r.v)?.diag);
    if (c.m && x) {
      const want = c.i === "ox" ? "O" : LET[c.i];
      if (x.picked !== want) { if (c.i === "ox") dg.ox.d = Math.min(dg.ox.d, 1); else if (dg.opt && dg.opt[c.i]) dg.opt[c.i].d = Math.min(dg.opt[c.i].d, 1); }   // 블라인드로 못 고르면 개념 증거로만
    }
    st("diagPut", "UPDATE item_tag SET diag = ?, qa = json_set(qa, '$.verified', 1) WHERE problem_id = ? AND version = ?").run(JSON.stringify(dg), c.r.pid, c.r.v);
    if (y && y.fit === "no") st("fitNo", "UPDATE item_tag SET conf = 1, qa = json_set(qa, '$.fit', 'no') WHERE problem_id = ? AND version = ?").run(c.r.pid, c.r.v);
  }));
  bumpMeta("tag_rev:" + C.cid);
  return { retry: true };
}

// ───────── 골드 시험 (DATA §8.7): 과목마다 12문제, 사람 쪽 라벨과 C 단계 태그 비교 ─────────
/** gold/<과목 id · short · code>.json = [{ext_id, facet | null, facet_hint?, depth, depth_why?}] → { n, facet_agree, depth_kappa, pass } (파일이 없으면 null) */
export function goldOf(cid) {
  const c = st("cs", "SELECT id, short, code FROM course WHERE id = ?").get(cid); if (!c) return null;
  const file = [String(c.id), c.short, c.code].filter(Boolean).map(n => join(GOLD, n + ".json")).find(existsSync); if (!file) return null;
  let L; try { L = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  const pairs = [];
  for (const g of Array.isArray(L) ? L : []) {
    const p = st("byExt", "SELECT id, current_version v FROM problem WHERE course_id = ? AND ext_id = ?").get(cid, g.ext_id); if (!p) continue;
    const t = st("tagOf", "SELECT facet, depth, src FROM item_tag WHERE problem_id = ? AND version = ?").get(p.id, p.v);
    if (t && t.src === "llm") pairs.push([g, t]);
  }
  if (!pairs.length) {
    // 태그가 모두 저자·관리자 것(사람이 붙임)이면 비교할 llm 태그가 없다 → 골드 단계는 통과로 본다
    const r = st("authAll", `SELECT COUNT(*) n, SUM(t.src IN ('author','admin')) a FROM problem p LEFT JOIN item_tag t ON t.problem_id = p.id AND t.version = p.current_version
        WHERE p.course_id = ? AND p.status = 'published'`).get(cid);
    const out = r.n && r.a === r.n ? { n: 0, facet_agree: null, depth_kappa: null, pass: true, author: true } : { n: 0, facet_agree: null, depth_kappa: null, pass: false };
    meta("gold:" + cid, JSON.stringify(out)); return out;
  }
  // 세부 포인트 일치는 골드에 facet이 적힌 것만 센다 (어휘가 생기기 전 과목은 facet null + facet_hint)
  const fp = pairs.filter(([g]) => g.facet), agree = fp.length ? fp.filter(([g, t]) => g.facet === t.facet).length / fp.length : null;
  // 가중 κ (이차 가중, 깊이 1–4)
  const k = 4, O = Array.from({ length: k }, () => Array(k).fill(0)), a = Array(k).fill(0), b = Array(k).fill(0);
  for (const [g, t] of pairs) { const i = (+g.depth || 1) - 1, j = (+t.depth || 1) - 1; O[i][j]++; a[i]++; b[j]++; }
  const n = pairs.length; let po = 0, pe = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) { const w = 1 - ((i - j) / (k - 1)) ** 2; po += w * O[i][j] / n; pe += w * a[i] * b[j] / (n * n); }
  const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
  const r = { n, facet_n: fp.length, facet_agree: agree == null ? null : Math.round(agree * 100) / 100, depth_kappa: Math.round(kappa * 100) / 100,
    pass: n >= 10 && kappa >= 0.6 && (agree == null || agree >= 0.85), ...(agree == null ? { facet_unscored: true } : {}) };   // facet을 아직 못 매긴 과목은 깊이 κ로만 (관리자 화면에 표시)
  meta("gold:" + cid, JSON.stringify(r));
  return r;
}

// ───────── 실행 ─────────
const fail = message => Object.assign(new Error(message), { code: "bad" });
async function call(stage, P, vars, prompt, enums) {
  const r = await ai.generate({ purpose: PURPOSE[stage.startsWith("tag_") ? "tag" : stage], system: fillText(P.system, vars), prompt, schema: fillSchema(P.schema, enums), deadline: 120000, perTry: 60000 });
  call.last = r.model; return r.out;
}
const RUN = { vocab: runVocab, merge: runMerge, tag: runTag, second: runSecond, family: runFamily, verify: runVerify };
const ORDER = `CASE stage WHEN 'vocab' THEN 0 WHEN 'merge' THEN 1 WHEN 'tag' THEN 2 WHEN 'second' THEN 3 WHEN 'family' THEN 4 ELSE 5 END`;

/** 일감 하나: 빌려서(lease) 돌리고 결과를 적는다. → { ran: id | null, state, error? } */
export async function tick(cid = null, { stage = null } = {}) {
  const pause = meta("tag_pause_until"); if (pause && Date.parse(pause) > Date.now()) return { ran: null, state: "paused", until: pause };
  if (!ai.enabled()) return { ran: null, state: "off" };
  if (!ai.aiLane.idle()) return { ran: null, state: "busy" };                 // 채점이 먼저
  st("expire", "UPDATE tag_job SET state = 'queued', lease_until = NULL WHERE state = 'running' AND lease_until < ?").run(now());
  const job = st("pick", `SELECT * FROM tag_job WHERE state = 'queued' AND (? IS NULL OR course_id = ?) AND (? IS NULL OR stage = ?) ORDER BY course_id, ${ORDER}, id LIMIT 1`).get(cid, cid, stage, stage);
  if (!job) return { ran: null, state: "idle" };
  const lease = new Date(Date.now() + 3 * 6e4).toISOString();
  if (!st("lease", "UPDATE tag_job SET state = 'running', lease_until = ?, updated_at = ? WHERE id = ? AND state = 'queued'").run(lease, now(), job.id).changes) return { ran: null, state: "raced" };
  const C = courseOf(job.course_id);
  try {
    const r = C ? await RUN[job.stage](C, job) : { done: true };
    st("jobDone", "UPDATE tag_job SET state = ?, lease_until = NULL, model = ?, updated_at = ? WHERE id = ?").run(r.retry ? "queued" : "done", call.last || job.model, now(), job.id);
    if (!r.retry && C) gateCheck(job.course_id);
    return { ran: job.id, state: r.retry ? "again" : "done" };
  } catch (e) {
    const code = e && e.code;
    if (code === "lane") { st("back", "UPDATE tag_job SET state = 'queued', lease_until = NULL WHERE id = ?").run(job.id); return { ran: null, state: "busy" }; }
    if (code === "cap" || code === "quota") {
      // 하루 내내 쉬는 것은 쓸 모델이 정말 하나도 없을 때만 (모두 하루 한도 429로 막혔거나 오늘 몫 60%를 다 씀).
      // 몇 모델이 잠깐 붐빈(503·시간 초과) 사이에 한 모델이 429를 받은 경우는 10분만 쉰다
      const pool = [...new Set([...ai.INSIGHT_MODELS, ...ai.VERIFY_MODELS])];
      const usable = pool.filter(m => !blocked(m) && budgetToday(m).calls < 0.6 * ai.RPD);
      const until = new Date(usable.length ? Date.now() + 10 * 6e4 : ai.nextMidnightPT()).toISOString();
      meta("tag_pause_until", until); st("back", "UPDATE tag_job SET state = 'queued', lease_until = NULL WHERE id = ?").run(job.id);
      return { ran: null, state: "paused", until };
    }
    if (code === "off" || code === "key") { st("back", "UPDATE tag_job SET state = 'queued', lease_until = NULL WHERE id = ?").run(job.id); return { ran: null, state: "off" }; }
    const tries = job.tries + 1, msg = String((e && e.message) || e).slice(0, 300);
    // 두 번 실패한 문제 묶음은 반으로 나눈다. 한 문제짜리가 세 번 실패하면 failed
    if (job.stage === "tag" && tries >= 2 && job.ref.includes(",")) {
      const p = job.ref.split(","), h = Math.ceil(p.length / 2);
      tx(() => { st("jobFail", "UPDATE tag_job SET state = 'done', tries = ?, last_error = ?, updated_at = ? WHERE id = ?").run(tries, "나눔: " + msg, now(), job.id); addJob(job.course_id, "tag", p.slice(0, h).join(",")); addJob(job.course_id, "tag", p.slice(h).join(",")); });
      return { ran: job.id, state: "split", error: msg };
    }
    st("jobErr", "UPDATE tag_job SET state = ?, tries = ?, last_error = ?, lease_until = NULL, updated_at = ? WHERE id = ?").run(tries >= 3 ? "failed" : "queued", tries, msg, now(), job.id);
    return { ran: job.id, state: tries >= 3 ? "failed" : "error", error: msg };
  }
}

// 서버 안에서 15초마다 하나 (관리자 "작업 시작" 또는 INSIGHT_TAGGER=1). 과목마다 켜고 끈다: meta tag_run:<cid> = 1
let timer = null;
const running = () => st("runs", "SELECT key FROM insight_meta WHERE key LIKE 'tag_run:%' AND value = '1'").all().map(r => +r.key.split(":")[1]);
export function startLoop() {
  if (timer) return;
  timer = setInterval(async () => {
    if (tick.busy) return; tick.busy = true;
    try { const cids = process.env.INSIGHT_TAGGER === "1" ? [null] : running(); for (const c of cids) { const r = await tick(c); if (r.ran) break; } }
    catch (e) { console.error("[tagger]", e && e.message); }
    finally { tick.busy = false; }
  }, 15000);
  timer.unref();
}
export const setRun = (cid, on) => meta("tag_run:" + cid, on ? "1" : null);
export const isRunning = cid => meta("tag_run:" + cid) === "1";

/** 작업 현황 (관리자) */
export function jobsOf(cid) {
  const stages = STAGES.map(s => ({ stage: s, ...Object.fromEntries(["queued", "running", "done", "failed"].map(k => [k, 0])) }));
  for (const r of st("jobCnt", "SELECT stage, state, COUNT(*) n FROM tag_job WHERE course_id = ? GROUP BY stage, state").all(cid)) { const x = stages.find(s => s.stage === r.stage); if (x && r.state in x) x[r.state] = r.n; }
  const recent_errors = st("jobErrs", "SELECT id, stage, ref, last_error error, updated_at at FROM tag_job WHERE course_id = ? AND last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 10").all(cid);
  return { stages, recent_errors, running: isRunning(cid), paused_until: meta("tag_pause_until"), ai: ai.enabled() };
}

// ───────── v2 켜기 문턱 (DATA §8.6) ─────────
/** 어휘 확인 + 골드 통과 + 게시 문제의 90% 이상이 conf ≥ 2 또는 검토됨 → v2_ready:<cid> = 1 (관리자가 끈 과목 v2_hold는 그대로) */
export function gateCheck(cid) {
  const T = tagSummary(cid), g = goldOf(cid) || J(meta("gold:" + cid), null);
  const vocab = vocabApproved(cid), gold = !!(g && g.pass), share90 = T.share >= 0.9;
  const ok = vocab && gold && share90, hold = meta("v2_hold:" + cid) === "1";
  if (hold && v2Ready(cid)) v2Ready(cid, false);                       // 관리자가 멈춘 과목은 끈다. 켜는 것은 관리자 "켜기"(enableV2)로만 (사용자 결정 2026-10-26)
  const ready = v2Ready(cid);
  return { vocab, gold, gold_detail: g || null, items: T.items, tagged: T.tagged, share: Math.round(T.share * 1000) / 1000, share90, ok, hold, ready, can_enable: ok && !hold && !ready };
}
/** 관리자 "켜기": 문턱을 넘었고 멈춤이 아닐 때만 v2_ready:<cid> = 1. 켜진 뒤에는 비율이 잠깐 내려가도 끄지 않는다 (멈춤으로만) */
export function enableV2(cid) {
  const g = gateCheck(cid);
  if (g.ready) return { ...g, changed: false };
  if (!g.ok) return { ...g, changed: false, error: "아직 켤 수 없어요 (어휘 · 골드 · 태그 90%)" };
  if (g.hold) return { ...g, changed: false, error: "멈춤 상태예요. 멈춤을 먼저 풀어 주세요" };
  v2Ready(cid, true);
  return { ...gateCheck(cid), changed: true };
}
/** 관리자: 과목의 v2를 멈추거나(hold) 다시 문턱 검사로 */
export function setHold(cid, on) { meta("v2_hold:" + cid, on ? "1" : null); return gateCheck(cid); }

// ───────── CLI ─────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), arg = k => { const i = a.indexOf("--" + k); return i >= 0 ? a[i + 1] : null; };
  const cid = +arg("course"); if (!cid) { console.log("사용법: node server/insight/tagger.js --course <id> [--stage vocab|merge|tag|second|family|verify] [--limit 40] [--dry]"); process.exit(0); }
  db.exec("PRAGMA busy_timeout = 3000");
  if (a.includes("--dry")) { console.log(JSON.stringify(plan(cid), null, 2)); process.exit(0); }
  plan(cid);
  const limit = +arg("limit") || 40, stage = arg("stage");
  for (let i = 0; i < limit; i++) { const r = await tick(cid, { stage }); console.log(JSON.stringify(r)); if (!r.ran && r.state !== "busy") break; }
}
