// 잘려 저장된 오개념 문장(misc.belief · truth)을 다시 쓴 완전한 문장으로 바꾼다 (data/export/course<id>/misc_rewrite.json과 짝).
//   node server/insight/misc-rewrite.js --course 4 [--dry] [--export <묶음 폴더>] <다시 쓴 답 파일>
//   답: { items: [{ code, facet?, belief(≤ 70자), truth(≤ 90자), note }] } — 코드 울타리(```)나 앞말이 있어도 첫 JSON 객체만 읽는다
// - misc_rewrite.json의 코드가 모두 있어야 하고, 그 밖의 코드는 받지 않는다. facet은 그대로(바꾸면 실패), 끝이 잘린 표시(… ...)·빈 문장은 실패
// - 바꾸는 것: 그 코드들의 misc.belief · misc.truth · updated_at 만. 코드·facet·status('auto' 그대로, 관리자 검토는 나중)·태그는 건드리지 않는다
// - 실제로 쓰기 전에 data/backups/ 에 VACUUM INTO 백업을 만든다. --dry는 아무것도 쓰지 않는다
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, ROOT, now, tx, BACKUP_DIR } from "../db.js";
import { firstJson } from "./manual-import.js";

const MAX = { belief: 70, truth: 90 };
const cutMark = s => /(…|\.\.\.)\s*$/.test(s);

/** 다시 쓴 답을 검사하고 (dry가 아니면) 쓴다 → 요약 */
export function rewriteMisc(cid, file, { dry = true, exportDir = join(ROOT, "data/export/course" + cid) } = {}) {
  const src = join(exportDir, "misc_rewrite.json");
  if (!existsSync(src)) throw new Error(`${src} 이 없어요`);
  const want = JSON.parse(readFileSync(src, "utf8")).items.filter(x => !x.error), wmap = new Map(want.map(x => [x.code, x]));
  const ans = firstJson(readFileSync(file, "utf8"));
  const report = { ok: [], failed: [], missing: [], extra: [] }, writes = [];
  if (!ans || !Array.isArray(ans.items)) { report.error = "답에서 {items:[…]} JSON을 찾지 못함"; report.missing = [...wmap.keys()]; return report; }
  const row = db.prepare("SELECT code, facet, belief, truth, status FROM misc WHERE course_id = ? AND code = ?"), seen = new Set();
  for (const x of ans.items) {
    const code = x && x.code, w = wmap.get(code), fail = why => report.failed.push({ code: code ?? "-", why });
    if (!w) { report.extra.push(code ?? "-"); continue; }
    if (seen.has(code)) { fail("같은 코드가 두 번"); continue; } seen.add(code);
    const m = row.get(cid, code);
    if (!m) { fail("DB에 없음"); continue; }
    if (m.facet !== w.facet) { fail(`내보낸 뒤 facet이 바뀜 (${w.facet} → ${m.facet})`); continue; }
    if (m.belief !== w.stored.belief || m.truth !== w.stored.truth) { fail("내보낸 뒤 문장이 이미 바뀜"); continue; }
    if (x.facet != null && x.facet !== m.facet) { fail(`facet을 바꿀 수 없음 (${m.facet} → ${x.facet})`); continue; }
    const b = String(x.belief ?? "").trim(), t = String(x.truth ?? "").trim(), note = String(x.note ?? "").trim();
    const bad = [["belief", b], ["truth", t]].map(([k, s]) => !s ? `${k} 없음` : s.length > MAX[k] ? `${k} ${s.length}자 (≤ ${MAX[k]})` : cutMark(s) ? `${k} 끝이 잘린 표시` : null).filter(Boolean);
    if (!note) bad.push("note 없음");
    if (bad.length) { fail(bad.join(", ")); continue; }
    report.ok.push({ code, belief: b, truth: t, note }); writes.push({ code, b, t });
  }
  report.missing = [...wmap.keys()].filter(c => !seen.has(c));
  // 16개가 모두 통과해야 쓴다 (일부만 바뀌면 검토가 헷갈림)
  const complete = !report.failed.length && !report.missing.length && !report.extra.length;
  if (!dry && complete) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const bk = join(BACKUP_DIR, `app-before-misc-rewrite-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}.db`);
    db.exec(`VACUUM INTO '${bk.replace(/'/g, "''")}'`); report.backup = bk;
    const put = db.prepare("UPDATE misc SET belief = ?, truth = ?, updated_at = ? WHERE course_id = ? AND code = ?"), at = now();
    let n = 0; tx(() => { for (const w of writes) n += Number(put.run(w.b, w.t, at, cid, w.code).changes); });
    report.written = n;
  } else if (!dry) report.error = "모든 코드가 통과해야 써요 (아무것도 쓰지 않음)";
  return report;
}

// ───────── CLI ─────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf("--" + k); return i >= 0 ? a.splice(i, 2)[1] : null; };
  const cid = +opt("course"), exp = opt("export"), dry = a.includes("--dry"), file = a.filter(x => x !== "--dry")[0];
  if (!cid || !file) { console.log("사용법: node server/insight/misc-rewrite.js --course 4 [--dry] [--export data/export/course4] <다시 쓴 답 파일>"); process.exit(0); }
  const R = rewriteMisc(cid, file, { dry, ...(exp ? { exportDir: exp } : {}) });
  console.log(dry ? "[미리보기: 쓰지 않음]" : R.written != null ? `[썼음: ${R.written}행 · 백업 ${R.backup}]` : "[쓰지 않음]");
  if (R.error) console.log(R.error);
  console.log(`통과 ${R.ok.length} · 실패 ${R.failed.length} · 빠짐 ${R.missing.length} · 목록 밖 ${R.extra.length}`);
  for (const x of R.ok) console.log(`  ${x.code} | ${x.belief} | ${x.truth}  (${x.note})`);
  for (const f of R.failed) console.log(`  실패 ${f.code}: ${f.why}`);
  if (R.missing.length) console.log(`  빠진 코드: ${R.missing.join(", ")}`);
  if (R.extra.length) console.log(`  목록 밖 코드(무시): ${R.extra.join(", ")}`);
}
