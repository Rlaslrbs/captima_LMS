// Gemini 채팅에 손으로 붙여 넣고 받은 답을 들여온다 (data/export/course<id>/ 묶음과 짝).
//   node server/insight/manual-import.js --course 4 [--stage tag|second|third|family|verify] [--dry] [--export <묶음 폴더>] <답 파일…>
//   답 파일 이름: <묶음 파일 이름>_answer.json (예: second_2.3_b01_answer.json). 코드 울타리(```)나 앞말이 있어도 첫 JSON 객체만 읽는다.
//   --stage를 빼면 묶음 파일의 stage를 따른다. 한 번에 한 단계만. 순서: tag → second → third → verify → family
// - third (세 번째 판단, 다수결): third_*_answer.json과 second2_*_answer.json을 함께 준다. 문제마다 A = 첫 태그(묶음 current), B = second2, C = third
//     1) C가 A나 B와 facet·depth 모두 같으면 그 값, conf 2 (근거가 해설·바른 진술이면 3; second와 같은 규칙)
//     2) 아니고 facet이 셋 중 둘 이상 같으면 그 facet, depth는 그 facet을 고른 판단들 중 다수 (없으면 둘이면 낮은 쪽, 셋이면 가운데), conf 1
//     3) 셋 다 facet이 다르면 첫 태그 그대로, conf 1
//     facet이 바뀌면 kcs·diag.facets2도 새 facet에 맞춘다. qa.second(없으면)·qa.third(규칙과 첫 태그)를 남긴다
// - verify2_bNN: 저장된 오개념 문장이 잘린 확인 항목(key.unreadable)은 fit만 받고 그 보기 증거를 d ≤ 1로. 같은 번호의 verify_bNN은 받지 않는다
// - tag: item_tag (src 'llm' · model 'gemini-chat(manual)' · conf 1 · review auto · qa.manual = true). 자동 태깅과 같은 줄에 선다
// - second·family·verify: tagger.js runSecond·runFamily·runVerify와 같은 규칙·같은 DB 효과 (conf · family 행 · 검증 표시)
// - 문제 글·상태·학습자 기록은 건드리지 않는다. 저자·관리자 태그(src author/admin, review accepted/edited)는 덮어쓰지 않는다
// - 실제로 쓰기 전에 data/backups/ 에 VACUUM INTO 백업을 만든다. --dry는 아무것도 쓰지 않는다
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, ROOT, J, now, tx, meta, bumpMeta, bodyHash, facetsOf, miscOf, DEPTH_WHY, DELTA_TYPES, BACKUP_DIR } from "../db.js";

const LET = "ABCDEFGH", MODEL = "gemini-chat(manual)", STAGES = ["tag", "second", "third", "family", "verify"];
const cut = (s, n) => (s = String(s ?? "").trim(), s.length > n ? s.slice(0, n - 1) + "…" : s);
const stageOf = batch => (String(batch.stage || "").startsWith("tag_") ? "tag" : batch.stage);
/** 쓰기 전 백업 (VACUUM INTO) → 파일 경로 */
function backup(stage) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const bk = join(BACKUP_DIR, `app-before-manual-${stage === "tag" ? "tags" : stage}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}.db`);
  db.exec(`VACUUM INTO '${bk.replace(/'/g, "''")}'`); return bk;
}
/** 답 파일 하나 → { B(요약 칸), batch, ans } 또는 B.error */
function load(file, exportDir, stage, report) {
  const bname = basename(file).replace(/_answer\.json$/i, ".json"), bfile = join(exportDir, bname);
  const B = { file: basename(file), batch: bname, passed: 0, failed: {}, missing: 0 };
  report.batches.push(B);
  if (!existsSync(bfile)) { B.error = `묶음 파일 ${bname} 이 없음`; return { B }; }
  const batch = JSON.parse(readFileSync(bfile, "utf8"));
  if (stageOf(batch) !== stage) { B.error = `이 묶음은 ${stageOf(batch)} 단계예요 (지금 ${stage})`; return { B }; }
  return { B, batch, ans: firstJson(readFileSync(file, "utf8")) };
}
const failer = (B, report, bname) => (ref, why) => { const k = why.split(" ")[0]; B.failed[k] = (B.failed[k] || 0) + 1; report.failed.push({ ref: ref ?? "-", batch: bname, why }); };
const newReport = () => ({ batches: [], done: [], failed: [], missing: [], notes: [] });

/** 채팅 답에서 첫 최상위 JSON 객체를 꺼낸다 (```json 울타리 · 앞말 · 뒷말 허용) */
export function firstJson(txt) {
  const s = String(txt);
  for (let i = s.indexOf("{"); i >= 0; i = s.indexOf("{", i + 1)) {
    let d = 0, q = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (q) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') q = false; continue; }
      if (c === '"') q = true; else if (c === "{") d++; else if (c === "}" && --d === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { break; } }
    }
  }
  return null;
}

/** 답 한 항목 → { row } 또는 { why } */
function check(x, it, V) {
  if (!x || typeof x !== "object") return { why: "형식 오류" };
  if (!String(x.rationale || "").trim()) return { why: "rationale 없음" };
  if (!V.facets.has(x.facet)) return { why: `facet ${x.facet ?? "-"} 이 확인된 어휘에 없음` };
  const f2 = Array.isArray(x.facets2) ? x.facets2 : [];
  const bad2 = f2.find(f => !V.facets.has(f)); if (bad2) return { why: `facets2 ${bad2} 이 확인된 어휘에 없음` };
  const depth = +x.depth; if (!(depth >= 1 && depth <= 4)) return { why: `depth ${x.depth} (1–4가 아님)` };
  if (x.conf != null && ![1, 2, 3].includes(+x.conf)) return { why: `conf ${x.conf} (1–3이 아님)` };
  const why = DEPTH_WHY.includes(x.depth_why) ? x.depth_why : null;
  let d = depth; const cf = { facet: 2, depth: 2, mis: 2 };
  if (why && +why[1] !== d) { d = Math.min(d, +why[1]); cf.depth = 1; }        // tagger와 같은 규칙: 깊이와 규칙 id가 어긋나면 낮은 쪽
  const notes = [];
  const mOf = m => { if (m == null || m === "none") return null; if (m === "new") { notes.push("new 오개념은 넣지 않음"); return null; } if (V.miscs.has(m)) return m; throw `misc ${m} 이 확인된 46개에 없음`; };
  const b = it.body, diag = { facets2: f2.filter(f => f !== x.facet).slice(0, 2), depth_why: why, cf, manual: true };
  try {
    if (it.kind === "mc") {
      const n = (b.opts || []).length, ans = new Set(Array.isArray(b.ans) ? b.ans : [b.ans]), opt = {};
      for (const o of x.options || []) {
        let i = +o.idx; if (!(i >= 0 && i < n)) { const L = LET.indexOf(String(o.idx).trim().toUpperCase()); i = L; }   // 0부터 번호 또는 글자 A–H
        if (!(i >= 0 && i < n) || ans.has(i)) continue;
        const m = mOf(o.misc); opt[i] = { m, d: m ? +o.d || 0 : Math.min(1, +o.d || 0), src: o.src === "explanation" ? "explanation" : "inferred", err: o.err || null, why: cut(o.belief_if_chosen, 80) };
      }
      diag.opt = opt;
    } else if (it.kind === "ox") {
      const o = x.ox || {};
      if (typeof o.statement_true === "boolean" && o.statement_true !== !!b.ox) return { why: "statement_true가 정답과 다름" };
      diag.ox = b.ox ? { m: null, mr: mOf(o.reverse_misc), d: +o.d || 0, src: "inferred", err: o.err || null }
        : { m: mOf(o.misc), mr: null, d: +o.d || 0, src: b.fix ? "fix" : "inferred", err: o.err || null, planted: cut(o.planted_error, 80) };
    } else if (it.kind === "short") {
      diag.short = (x.short_errors || []).slice(0, 4).map(e => ({ m: mOf(e.misc), d: +e.d || 0, ex: (e.examples || []).slice(0, 4).map(String), num: b.num != null, err: e.err || null })).filter(e => e.ex.length);
    } else if (it.kind === "essay") {
      diag.pts = (x.points || []).map(p => ({ i: +p.i, facet: V.facets.has(p.facet) ? p.facet : x.facet, m: mOf(p.misc) })).filter(p => p.i >= 0);
    }
  } catch (e) { return { why: String(e) }; }
  const k1 = V.kcOf.get(x.facet), k2 = [...new Set(diag.facets2.map(f => V.kcOf.get(f)).filter(k => k && k !== k1))];
  const kcs = k1 ? (k2.length ? [[k1, 0.7], ...k2.map(k => [k, 0.3 / k2.length])] : [[k1, 1]]) : [];
  return { row: { facet: x.facet, depth: d, kcs, diag }, notes };
}

/** 답 파일들을 검사하고 (dry가 아니면) 쓴다 → 요약. stage를 빼면 첫 묶음 파일의 단계 */
export function importAnswers(cid, files, { dry = true, exportDir = join(ROOT, "data/export/course" + cid), stage = null } = {}) {
  if (!stage) { const st = files.map(x => join(exportDir, basename(x).replace(/_answer\.json$/i, ".json"))).filter(existsSync).map(f => stageOf(JSON.parse(readFileSync(f, "utf8"))));
    stage = st.includes("third") ? "third" : st[0] || "tag"; }
  if (!STAGES.includes(stage)) throw new Error(`단계는 ${STAGES.join(" · ")} 중 하나예요`);
  const R = { tag: importTag, second: importSecond, third: importThird, family: importFamily, verify: importVerify }[stage](cid, files, { dry, exportDir });
  R.stage = stage; return R;
}

function importTag(cid, files, { dry, exportDir }) {
  const V ={ facets: new Set(facetsOf(cid).filter(f => f.status === "active").map(f => f.code)),
    miscs: new Set(miscOf(cid, null, { all: true }).filter(m => m.status === "ok").map(m => m.code)),
    kcOf: new Map(facetsOf(cid).map(f => [f.code, f.kc])) };
  const cur = db.prepare(`SELECT p.id pid, p.current_version v, p.course_id cid, pv.kind, pv.body FROM problem p JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version WHERE p.id = ?`);
  const tagRow = db.prepare("SELECT src, review FROM item_tag WHERE problem_id = ? AND version = ?");
  const report = { batches: [], done: [], failed: [], missing: [], notes: [] }, writes = [];
  for (const file of files) {
    const bname = basename(file).replace(/_answer\.json$/i, ".json"), bfile = join(exportDir, bname);
    const B = { file: basename(file), batch: bname, passed: 0, failed: {}, missing: 0 };
    report.batches.push(B);
    if (!existsSync(bfile)) { B.error = `묶음 파일 ${bname} 이 없음`; continue; }
    const batch = JSON.parse(readFileSync(bfile, "utf8"));
    if (stageOf(batch) !== "tag") { B.error = `이 묶음은 ${stageOf(batch)} 단계예요 (--stage ${stageOf(batch)})`; continue; }
    const refs = new Map(batch.items.map(i => [i.ref, i]));
    const ans = firstJson(readFileSync(file, "utf8"));
    if (!ans || !Array.isArray(ans.items)) { B.error = "답에서 {items:[…]} JSON을 찾지 못함"; for (const r of refs.keys()) report.missing.push(r); B.missing = refs.size; continue; }
    const seen = new Set();
    for (const x of ans.items) {
      const ref = x && x.ref, bi = refs.get(ref);
      const fail = why => { B.failed[why.split(" ")[0]] = (B.failed[why.split(" ")[0]] || 0) + 1; report.failed.push({ ref: ref ?? "-", batch: bname, why }); };
      if (!bi) { fail(`ref ${ref ?? "-"} 이 묶음에 없음`); continue; }
      if (seen.has(ref)) { fail("같은 ref가 두 번"); continue; } seen.add(ref);
      const it = cur.get(bi.problem_id);
      if (!it || it.cid !== cid) { fail("과목에 없는 문제"); continue; }
      if (it.v !== bi.version) { fail(`문제가 고쳐짐 (묶음 v${bi.version} → 지금 v${it.v}), 다시 내보내 주세요`); continue; }
      const old = tagRow.get(it.pid, it.v);
      if (old && (old.src === "author" || old.src === "admin" || old.review === "accepted" || old.review === "edited")) { fail("사람이 붙인 태그가 있어 건너뜀"); continue; }
      it.body = J(it.body);
      const r = check(x, it, V);
      if (r.why) { fail(r.why); continue; }
      for (const n of r.notes) report.notes.push({ ref, note: n });
      B.passed++; report.done.push(ref); writes.push({ it, ...r.row, prompt_ver: +batch.prompt_ver || 1 });
    }
    for (const r of refs.keys()) if (!seen.has(r)) { report.missing.push(r); B.missing++; }
  }
  // 실패한 ref가 나중 파일에서 통과했으면 실패·빠짐 목록에서 뺀다
  const ok = new Set(report.done); report.failed = report.failed.filter(f => !ok.has(f.ref)); report.missing = [...new Set(report.missing)].filter(r => !ok.has(r));
  if (!dry && writes.length) {
    report.backup = backup("tag");
    const vv = +(meta("vocab_ver:" + cid) || 0), t = now();
    const put = db.prepare(`INSERT INTO item_tag(problem_id, version, body_hash, vocab_ver, prompt_ver, model, kcs, diag, qa, review, updated_at, facet, depth, src, conf)
        VALUES (?,?,?,?,?,?,?,?, '{"manual":true}', 'auto', ?, ?, ?, 'llm', 1)
        ON CONFLICT(problem_id, version) DO UPDATE SET body_hash = excluded.body_hash, vocab_ver = excluded.vocab_ver, prompt_ver = excluded.prompt_ver, model = excluded.model,
          kcs = excluded.kcs, diag = excluded.diag, qa = excluded.qa, updated_at = excluded.updated_at, facet = excluded.facet, depth = excluded.depth, src = 'llm', conf = 1, review = 'auto'
        WHERE item_tag.src NOT IN ('author','admin') AND item_tag.review NOT IN ('accepted','edited')`);
    tx(() => { for (const w of writes) put.run(w.it.pid, w.it.v, bodyHash(w.it.kind, w.it.body), vv, w.prompt_ver, MODEL, JSON.stringify(w.kcs), JSON.stringify(w.diag), t, w.facet, w.depth); });
    bumpMeta("tag_rev:" + cid); report.written = writes.length;
  }
  return report;
}

// 묶음의 current[ref] = 내보낼 때의 { problem_id, version, facet, depth, conf } → 지금 태그 행이 그대로인지
const tagNow = () => db.prepare(`SELECT t.problem_id pid, t.version v, t.facet, t.depth, t.conf, t.src, t.review, t.diag, t.qa, p.course_id cid, p.current_version cv, p.status
    FROM item_tag t JOIN problem p ON p.id = t.problem_id WHERE t.problem_id = ? AND t.version = ?`);
function sameTag(t, c, cid) {
  if (!t || t.cid !== cid) return "태그가 없음";
  if (t.cv !== c.version) return `문제가 고쳐짐 (묶음 v${c.version} → 지금 v${t.cv}), 다시 내보내 주세요`;
  if (t.facet !== c.facet) return "내보낸 뒤 세부 포인트가 바뀜, 다시 내보내 주세요";        // 깊이는 second가 바꿀 수 있어 지금 값을 쓴다
  return null;
}

// ───────── D. 두 번째 의견 (tagger runSecond): 같은 facet·같은 깊이면 conf 2 (근거가 해설·바른 진술이면 3), 깊이 1 차이면 낮은 쪽·conf 1, 다르면 conf 1 ─────────
function importSecond(cid, files, { dry, exportDir }) {
  const report = newReport(), writes = [], q = tagNow(), conf = { 1: 0, 2: 0, 3: 0 }, all = new Set();
  for (const file of files) {
    const { B, batch, ans } = load(file, exportDir, "second", report); if (B.error) continue;
    const fail = failer(B, report, B.batch), F = new Set((batch.facets || []).map(f => f.code)), refs = Object.keys(batch.current || {});
    if (!ans || !Array.isArray(ans.items)) { B.error = "답에서 {items:[…]} JSON을 찾지 못함"; report.missing.push(...refs); B.missing = refs.length; continue; }
    const seen = new Set();
    for (const x of ans.items) {
      const ref = x && x.ref, c = batch.current[ref];
      if (!c) { fail(ref, `ref ${ref ?? "-"} 이 묶음에 없음`); continue; }
      if (seen.has(ref) || all.has(ref)) { fail(ref, "같은 ref가 두 번"); continue; } seen.add(ref);
      const t = q.get(c.problem_id, c.version), bad = sameTag(t, c, cid); if (bad) { fail(ref, bad); continue; }
      if (t.src !== "llm" || t.review !== "auto") { fail(ref, "사람이 확인한 태그라 건너뜀"); continue; }
      if (J(t.qa).second != null) { fail(ref, "이미 두 번째 의견이 있음"); continue; }
      if (!F.has(x.facet)) { fail(ref, `facet ${x.facet ?? "-"} 이 묶음의 세부 포인트 목록에 없음`); continue; }
      const d2 = +x.depth; if (!(d2 >= 1 && d2 <= 4)) { fail(ref, `depth ${x.depth} (1–4가 아님)`); continue; }
      const dg = J(t.diag), grounded = Object.values(dg.opt || {}).some(o => o && o.src === "explanation") || (dg.ox && (dg.ox.src === "fix" || dg.ox.src === "explanation"));
      let cf, depth = t.depth;
      if (x.facet === t.facet && d2 === t.depth) cf = grounded ? 3 : 2;
      else if (x.facet === t.facet && Math.abs(d2 - t.depth) === 1) { cf = 1; depth = Math.min(d2, t.depth); }
      else cf = 1;
      conf[cf]++; B.passed++; all.add(ref); report.done.push(ref);
      writes.push({ pid: t.pid, v: t.v, conf: cf, depth, sec: { facet: x.facet, depth: d2, manual: true } });
    }
    for (const r of refs) if (!seen.has(r)) { report.missing.push(r); B.missing++; }
  }
  report.failed = report.failed.filter(f => !all.has(f.ref)); report.missing = [...new Set(report.missing)].filter(r => !all.has(r));
  report.summary = `conf 3: ${conf[3]} · conf 2: ${conf[2]} · conf 1: ${conf[1]}`;
  if (!dry && writes.length) {
    report.backup = backup("second");
    const put = db.prepare(`UPDATE item_tag SET conf = ?, depth = ?, review = 'auto', qa = json_set(qa, '$.second', json(?))
        WHERE problem_id = ? AND version = ? AND src = 'llm' AND review = 'auto' AND json_extract(qa, '$.second') IS NULL`);
    let n = 0; tx(() => { for (const w of writes) n += Number(put.run(w.conf, w.depth, JSON.stringify(w.sec), w.pid, w.v).changes); });
    bumpMeta("tag_rev:" + cid); report.written = n;
  }
  return report;
}

// ───────── E. 변형 묶음 (tagger runFamily): 기준 1 + 바뀐 점 하나씩. 같은 세부 포인트만, iso는 surface·repr이고 깊이가 같을 때만 ─────────
function importFamily(cid, files, { dry, exportDir }) {
  const report = newReport(), q = tagNow(), used = new Set(), fams = [], doneF = new Set();
  const inFam = db.prepare("SELECT 1 FROM family_member WHERE problem_id = ?");
  let singles = 0;
  for (const file of files) {
    const { B, batch, ans } = load(file, exportDir, "family", report); if (B.error) continue;
    const fail = failer(B, report, B.batch), cur = batch.current || {}, fs = new Set((batch.groups || []).map(g => g.facet)), depthNow = new Map();
    if (!ans || !Array.isArray(ans.families)) { B.error = "답에서 {families:[…]} JSON을 찾지 못함"; B.missing = Object.keys(cur).length; continue; }
    // 들여올 수 있는 문항: 내보낼 때와 태그가 같고, 숨김·검토 거절이 아니고, 아직 어느 묶음에도 없는 것
    const ok = ref => { const c = cur[ref]; if (!c) return `ref ${ref ?? "-"} 이 묶음에 없음`;
      const t = q.get(c.problem_id, c.version), bad = sameTag(t, c, cid); if (bad) return bad;
      if (t.status !== "published" || ["rejected", "stale"].includes(t.review)) return "숨김이거나 거절된 태그";
      if (inFam.get(t.pid)) return "이미 변형 묶음에 있음";
      if (used.has(ref)) return "한 문항이 두 묶음에"; depthNow.set(ref, t.depth); return null; };
    let placed = 0;
    for (const g of ans.families) {
      const bad = ok(g && g.base); if (bad) { fail(g && g.base, "기준 " + bad); continue; }
      if (!String(g.principle || "").trim()) { fail(g.base, "principle 없음"); continue; }
      const base = cur[g.base], f = fs.has(g.facet) ? g.facet : base.facet, mine = new Set([g.base]), mem = [];
      for (const m of Array.isArray(g.members) ? g.members : []) {
        const r = cur[m && m.ref], why = mine.has(m && m.ref) ? "같은 묶음에 두 번" : ok(m && m.ref);
        if (why) { report.notes.push({ ref: m && m.ref, note: why }); continue; }
        if (r.facet !== base.facet) { report.notes.push({ ref: m.ref, note: "기준과 세부 포인트가 달라 뺌" }); continue; }
        let role = m.role === "iso" ? "iso" : "near", dt = DELTA_TYPES.includes(m.delta_type) ? m.delta_type : null;
        if (!dt) { report.notes.push({ ref: m.ref, note: `delta_type ${m.delta_type} 이 없어 뺌` }); continue; }
        if (role === "iso" && (!["surface", "repr"].includes(dt) || depthNow.get(m.ref) !== depthNow.get(g.base))) { if (dt === "surface") { report.notes.push({ ref: m.ref, note: "깊이가 달라 surface iso를 뺌" }); continue; } role = "near"; }   // DATA §8.3
        if (role === "near" && dt === "surface") { report.notes.push({ ref: m.ref, note: "near인데 surface라 뺌" }); continue; }
        mine.add(m.ref); mem.push({ ref: m.ref, role, dt, delta: cut(m.delta, 40) });
      }
      if (!mem.length) { report.notes.push({ ref: g.base, note: "혼자 남은 묶음은 버림" }); continue; }
      for (const r of mine) used.add(r);
      fams.push({ facet: f, base: g.base, principle: cut(g.principle, 90), mem, cur });
      B.passed++; placed += mine.size; report.done.push(...mine);
    }
    for (const g of batch.groups || []) doneF.add(g.facet);
    singles += Object.keys(cur).length - placed;
  }
  report.summary = `묶음 ${fams.length}개 · 묶인 문항 ${report.done.length}개 · 혼자 남은 문항 ${singles}개`;
  if (!dry && fams.length) {
    report.backup = backup("family");
    const t = now(), body = db.prepare("SELECT kind, body FROM problem_version WHERE problem_id = ? AND version = ?");
    const famIns = db.prepare("INSERT INTO family(course_id, code, facet, base_problem_id, principle, source, status, updated_at) VALUES (?,?,?,?,?, 'llm', 'auto', ?)");
    const fmIns = db.prepare(`INSERT INTO family_member(problem_id, course_id, family, role, delta_type, delta, body_hash, source, conf, updated_at) VALUES (?,?,?,?,?,?,?, 'llm', 2, ?)
        ON CONFLICT(problem_id) DO UPDATE SET family = excluded.family, role = excluded.role, delta_type = excluded.delta_type, delta = excluded.delta, body_hash = excluded.body_hash, conf = 2, updated_at = excluded.updated_at
        WHERE family_member.source = 'llm'`);
    let rows = 0;
    tx(() => {
      let n = db.prepare("SELECT code FROM family WHERE course_id = ?").all(cid).reduce((m, x) => Math.max(m, +((/^F(\d+)$/.exec(x.code) || [0, 0])[1])), 0);
      for (const F of fams) {
        const code = "F" + String(++n).padStart(3, "0"), b = F.cur[F.base];
        famIns.run(cid, code, F.facet, b.problem_id, F.principle, t);
        const put = (c, role, dt, delta) => { const p = body.get(c.problem_id, c.version); rows += Number(fmIns.run(c.problem_id, cid, code, role, dt, delta, bodyHash(p.kind, J(p.body)), t).changes); };
        put(b, "base", null, "");
        for (const m of F.mem) put(F.cur[m.ref], m.role, m.dt, m.delta);
      }
      meta("family_done:" + cid, JSON.stringify([...new Set([...J(meta("family_done:" + cid), []), ...doneF])]));
    });
    bumpMeta("tag_rev:" + cid); report.written = rows;
  }
  return report;
}

// ───────── F. 검증 (tagger runVerify): 블라인드로 고른 답이 그 보기가 아니면 오개념 증거를 d ≤ 1로, fit no면 conf 1 ─────────
function importVerify(cid, files, { dry, exportDir }) {
  const report = newReport(), writes = [], q = tagNow(), allRows = new Set();
  let lowered = 0, fitNo = 0;
  for (const file of files) {
    const { B, batch, ans } = load(file, exportDir, "verify", report); if (B.error) continue;
    // verify2_bNN이 있으면 옛 verify_bNN은 받지 않는다 (잘린 학생 설명으로 고른 답)
    if (/^verify_b\d+\.json$/.test(B.batch) && existsSync(join(exportDir, B.batch.replace("verify_", "verify2_")))) { B.error = `${B.batch.replace("verify_", "verify2_")}를 쓰세요 (답 파일 이름만 바꿔도 됨)`; continue; }
    const fail = failer(B, report, B.batch), byRow = new Map();
    for (const k of batch.key || []) (byRow.get(k.problem_id) || byRow.set(k.problem_id, []).get(k.problem_id)).push(k);
    if (!ans || (!Array.isArray(ans.checks) && !Array.isArray(ans.fit))) { B.error = "답에서 {checks:[…], fit:[…]} JSON을 찾지 못함"; for (const p of byRow.keys()) report.missing.push("p" + p); B.missing = byRow.size; continue; }
    const first = L => { const m = new Map(); for (const x of Array.isArray(L) ? L : []) if (x && x.ref && !m.has(x.ref)) m.set(x.ref, x); return m; };
    const pick = first(ans.checks), fit = first(ans.fit);
    for (const [pid, K] of byRow) {
      const ref = "p" + pid, c = batch.current[ref];
      if (allRows.has(ref)) { fail(ref, "같은 문제가 두 번"); continue; }
      const t = q.get(c.problem_id, c.version), bad = sameTag(t, c, cid); if (bad) { fail(ref, bad); continue; }
      if (t.src !== "llm" || t.review !== "auto") { fail(ref, "사람이 확인한 태그라 건너뜀"); continue; }
      const qa = J(t.qa); if (qa.verified != null) { fail(ref, "이미 검증됨"); continue; }
      if (qa.second == null) { fail(ref, "두 번째 의견을 먼저 들여와 주세요 (second)"); continue; }
      // 그 문제의 v 항목이 모두 답해져 있어야 한다 (오개념 확인은 picked, 모두 fit)
      const lack = K.filter(k => !["yes", "no"].includes(fit.get(k.ref)?.fit) || (k.misc && !/^[A-HOX]$/.test(String(pick.get(k.ref)?.picked || ""))));
      if (lack.length) { report.missing.push(ref); B.missing++; continue; }
      const dg = J(t.diag); let low = 0;
      for (const k of K) if (k.unreadable) {                                         // 저장된 오개념 문장이 잘려 블라인드 확인을 못 함 → 개념 증거로만
        const o = k.opt === "ox" ? dg.ox : dg.opt && dg.opt[k.opt];
        if (o && o.m === k.unreadable && o.d > 1) { o.d = 1; low++; report.notes.push({ ref, note: `${k.ref} 오개념 ${k.unreadable} 문장이 잘려 d ≤ 1` }); }
      }
      for (const k of K) if (k.misc) {
        const o = k.opt === "ox" ? dg.ox : dg.opt && dg.opt[k.opt];
        if (!o || o.m !== k.misc) { report.notes.push({ ref, note: `${k.ref} 보기의 오개념이 바뀌어 건너뜀` }); continue; }
        if (pick.get(k.ref).picked !== k.want && o.d > 1) { o.d = 1; low++; }        // 블라인드로 못 고르면 개념 증거로만
      }
      const no = K.some(k => fit.get(k.ref).fit === "no");
      lowered += low; fitNo += no ? 1 : 0; B.passed++; allRows.add(ref); report.done.push(ref);
      writes.push({ pid: t.pid, v: t.v, diag: dg, no });
    }
  }
  report.failed = report.failed.filter(f => !allRows.has(f.ref)); report.missing = [...new Set(report.missing)].filter(r => !allRows.has(r));
  report.summary = `검증 ${writes.length}문제 · 오개념 증거를 낮춤 ${lowered}개 · 세부 포인트가 맞지 않음(fit no → conf 1) ${fitNo}문제`;
  if (!dry && writes.length) {
    report.backup = backup("verify");
    const W = "WHERE problem_id = ? AND version = ? AND src = 'llm' AND review = 'auto' AND json_extract(qa, '$.verified') IS NULL";
    const ok = db.prepare(`UPDATE item_tag SET diag = ?, qa = json_set(qa, '$.verified', 1, '$.manual_verify', json('true')) ${W}`);
    const no = db.prepare(`UPDATE item_tag SET diag = ?, conf = 1, qa = json_set(qa, '$.verified', 1, '$.manual_verify', json('true'), '$.fit', 'no') ${W}`);
    let n = 0; tx(() => { for (const w of writes) n += Number((w.no ? no : ok).run(JSON.stringify(w.diag), w.pid, w.v).changes); });
    bumpMeta("tag_rev:" + cid); report.written = n;
  }
  return report;
}

// ───────── 세 번째 판단 (다수결): 첫 태그 A · second2 B · third C. 규칙은 맨 위 설명 ─────────
function importThird(cid, files, { dry, exportDir }) {
  const report = newReport(), writes = [], q = tagNow(), all = new Set(), rules = { "C=A": 0, "C=B": 0, facet2of3: 0, none: 0 }, confN = { 1: 0, 2: 0, 3: 0 };
  const kcOf = new Map(facetsOf(cid).map(f => [f.code, f.kc])), act = new Set(facetsOf(cid).filter(f => f.status === "active").map(f => f.code));
  // second2 답 (같이 준 파일들)
  const B2 = new Map(), thirds = [];
  for (const file of files) {
    const bname = basename(file).replace(/_answer\.json$/i, ".json"), bfile = join(exportDir, bname);
    if (!existsSync(bfile)) { report.batches.push({ file: basename(file), batch: bname, passed: 0, failed: {}, missing: 0, error: `묶음 파일 ${bname} 이 없음` }); continue; }
    const batch = JSON.parse(readFileSync(bfile, "utf8")), st = stageOf(batch);
    if (st === "second") { const a = firstJson(readFileSync(file, "utf8")); for (const x of (a && a.items) || []) if (x && x.ref && !B2.has(x.ref)) B2.set(x.ref, { facet: x.facet, depth: +x.depth }); continue; }
    if (st !== "third") { report.batches.push({ file: basename(file), batch: bname, passed: 0, failed: {}, missing: 0, error: `이 묶음은 ${st} 단계예요 (third에는 third_*와 second2_* 답만)` }); continue; }
    thirds.push(file);
  }
  for (const file of thirds) {
    const { B, batch, ans } = load(file, exportDir, "third", report); if (B.error) continue;
    const fail = failer(B, report, B.batch), F = new Set((batch.facets || []).map(f => f.code)), refs = Object.keys(batch.current || {});
    if (!ans || !Array.isArray(ans.items)) { B.error = "답에서 {items:[…]} JSON을 찾지 못함"; report.missing.push(...refs); B.missing = refs.length; continue; }
    const seen = new Set();
    for (const x of ans.items) {
      const ref = x && x.ref, c = batch.current[ref];
      if (!c) { fail(ref, `ref ${ref ?? "-"} 이 묶음에 없음`); continue; }
      if (seen.has(ref) || all.has(ref)) { fail(ref, "같은 ref가 두 번"); continue; } seen.add(ref);
      const snap = (batch.second2 || {})[ref], b = B2.get(ref) || null;
      if (!b) { fail(ref, "second2 답이 없음 (second2_*_answer.json을 같이 주세요)"); continue; }
      if (snap && (snap.facet !== b.facet || snap.depth !== b.depth)) { fail(ref, "second2 답이 내보낸 뒤 바뀜, 다시 내보내 주세요"); continue; }
      if (!act.has(b.facet) || !(b.depth >= 1 && b.depth <= 4)) { fail(ref, "second2 답이 올바르지 않음"); continue; }
      const t = q.get(c.problem_id, c.version), bad = sameTag(t, c, cid); if (bad) { fail(ref, bad); continue; }
      if (t.src !== "llm" || t.review !== "auto") { fail(ref, "사람이 확인한 태그라 건너뜀"); continue; }
      const qa = J(t.qa);
      if (qa.third != null) { fail(ref, "이미 세 번째 판단이 있음"); continue; }
      if (qa.verified != null) { fail(ref, "이미 검증됨 (third는 verify 전에)"); continue; }
      if (qa.second != null && (qa.second.facet !== b.facet || +qa.second.depth !== b.depth)) { fail(ref, "DB의 두 번째 의견이 second2 답과 다름"); continue; }
      if (!F.has(x.facet)) { fail(ref, `facet ${x.facet ?? "-"} 이 세부 포인트 목록에 없음`); continue; }
      const d3 = +x.depth; if (!(d3 >= 1 && d3 <= 4)) { fail(ref, `depth ${x.depth} (1–4가 아님)`); continue; }
      const A = { facet: c.facet, depth: c.depth }, C = { facet: x.facet, depth: d3 }, same = (u, v) => u.facet === v.facet && u.depth === v.depth;
      let win, rule;
      if (same(C, A)) { win = A; rule = "C=A"; }
      else if (same(C, B2.get(ref))) { win = b; rule = "C=B"; }
      else {
        const votes = [A, b, C], cnt = new Map(); for (const v of votes) cnt.set(v.facet, (cnt.get(v.facet) || 0) + 1);
        const fw = [...cnt].find(([, n]) => n >= 2)?.[0];
        if (!fw) { win = A; rule = "none"; }
        else { const ds = votes.filter(v => v.facet === fw).map(v => v.depth).sort((p, r) => p - r), dc = new Map(); for (const d of ds) dc.set(d, (dc.get(d) || 0) + 1);
          const dm = [...dc].find(([, n]) => n >= 2)?.[0]; win = { facet: fw, depth: dm ?? (ds.length === 3 ? ds[1] : ds[0]) }; rule = "facet2of3"; }
      }
      const dg = J(t.diag), grounded = Object.values(dg.opt || {}).some(o => o && o.src === "explanation") || (dg.ox && (dg.ox.src === "fix" || dg.ox.src === "explanation"));
      const cf = rule === "C=A" || rule === "C=B" ? (grounded ? 3 : 2) : 1;
      dg.facets2 = (dg.facets2 || []).filter(f => f !== win.facet);
      if (win.facet !== A.facet && !dg.facets2.includes(A.facet)) dg.facets2 = [A.facet, ...dg.facets2].slice(0, 2);   // 밀려난 첫 facet은 보조로
      const k1 = kcOf.get(win.facet), k2 = [...new Set(dg.facets2.map(f => kcOf.get(f)).filter(k => k && k !== k1))];
      const kcs = k1 ? (k2.length ? [[k1, 0.7], ...k2.map(k => [k, 0.3 / k2.length])] : [[k1, 1]]) : [];
      rules[rule]++; confN[cf]++; B.passed++; all.add(ref); report.done.push(ref);
      if (win.facet !== A.facet) report.notes.push({ ref, note: `facet ${A.facet} → ${win.facet}` });
      writes.push({ pid: t.pid, v: t.v, facet: win.facet, depth: win.depth, conf: cf, kcs, diag: dg,
        sec: qa.second == null ? { facet: b.facet, depth: b.depth, manual: true } : null, third: { facet: C.facet, depth: C.depth, manual: true, rule, first: A } });
    }
    for (const r of refs) if (!seen.has(r)) { report.missing.push(r); B.missing++; }
  }
  report.failed = report.failed.filter(f => !all.has(f.ref)); report.missing = [...new Set(report.missing)].filter(r => !all.has(r));
  report.summary = `C=A ${rules["C=A"]} · C=B ${rules["C=B"]} · facet 2/3 ${rules.facet2of3} · 셋 다 다름 ${rules.none} → conf 3: ${confN[3]} · conf 2: ${confN[2]} · conf 1: ${confN[1]} · facet 바뀜 ${report.notes.filter(n => n.note.startsWith("facet")).length}`;
  if (!dry && writes.length) {
    report.backup = backup("third");
    const put = db.prepare(`UPDATE item_tag SET facet = ?, depth = ?, conf = ?, kcs = ?, diag = ?,
        qa = json_set(CASE WHEN ? IS NULL THEN qa ELSE json_set(qa, '$.second', json(?)) END, '$.third', json(?)), updated_at = ?
        WHERE problem_id = ? AND version = ? AND src = 'llm' AND review = 'auto' AND json_extract(qa, '$.third') IS NULL AND json_extract(qa, '$.verified') IS NULL`);
    const t = now(); let n = 0;
    tx(() => { for (const w of writes) { const sec = w.sec ? JSON.stringify(w.sec) : null;
      n += Number(put.run(w.facet, w.depth, w.conf, JSON.stringify(w.kcs), JSON.stringify(w.diag), sec, sec, JSON.stringify(w.third), t, w.pid, w.v).changes); } });
    bumpMeta("tag_rev:" + cid); report.written = n;
  }
  return report;
}

// ───────── CLI ─────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf("--" + k); return i >= 0 ? a.splice(i, 2)[1] : null; };
  const cid = +opt("course"), exp = opt("export"), stage = opt("stage"), dry = a.includes("--dry"), files = a.filter(x => x !== "--dry");
  if (!cid || !files.length) { console.log("사용법: node server/insight/manual-import.js --course 4 [--stage tag|second|third|family|verify] [--dry] [--export data/export/course4] <…_answer.json …>"); process.exit(0); }
  const R = importAnswers(cid, files, { dry, stage, ...(exp ? { exportDir: exp } : {}) });
  console.log(`[${R.stage}] ` + (dry ? "[미리보기: 쓰지 않음]" : `[썼음: ${R.written || 0}행 · 백업 ${R.backup || "-"}]`));
  if (R.summary) console.log(R.summary);
  for (const B of R.batches) console.log(`${B.batch}: 통과 ${B.passed} · 실패 ${Object.values(B.failed).reduce((s, n) => s + n, 0)}${Object.keys(B.failed).length ? " (" + Object.entries(B.failed).map(([k, n]) => k + " " + n).join(", ") + ")" : ""} · 빠짐 ${B.missing}${B.error ? " · " + B.error : ""}`);
  console.log(`\n끝난 ref ${R.done.length}개`);
  if (R.missing.length) console.log(`답이 없는 ref ${R.missing.length}개 (다시 붙여 넣기): ${R.missing.join(", ")}`);
  if (R.failed.length) { console.log(`실패 ${R.failed.length}개:`); for (const f of R.failed) console.log(`  ${f.ref} [${f.batch}] ${f.why}`); }
  if (R.notes.length) console.log(`참고: ${R.notes.map(n => n.ref + " " + n.note).join(" · ")}`);
}
