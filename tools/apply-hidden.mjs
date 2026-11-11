// 숨김 목록 다시 적용. 사용: node tools/apply-hidden.mjs [--dry]   (npm run hide)
// - data/import/<과목코드>_hidden.txt 의 문제 번호(ext_id)를 숨김(status='hidden')으로 바꾼다.
// - 새 DB에 문제 세트를 넣은 뒤(npm run import) 운영 서버와 같은 공개 상태로 맞출 때 쓴다.
// - 파일 형식: '#'로 시작하는 줄은 설명, 나머지는 공백·줄바꿈으로 나눈 번호 (예: 1-19 1-20 2-9)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db, ROOT, tx } from "../server/db.js";

const dry = process.argv.includes("--dry");
const DIR = join(ROOT, "data", "import");
const files = readdirSync(DIR).filter(f => /^[A-Za-z0-9]+_hidden\.txt$/.test(f)).sort();
if (!files.length) { console.log("숨김 목록 파일(data/import/<과목>_hidden.txt)이 없어요."); process.exit(0); }

let total = 0;
tx(() => {
  for (const f of files) {
    const code = f.replace(/_hidden\.txt$/, "");
    const course = db.prepare("SELECT id FROM course WHERE code = ?").get(code);
    if (!course) { console.log(`- ${f}: 과목 ${code}가 DB에 없어요. 먼저 npm run import`); continue; }
    const ids = readFileSync(join(DIR, f), "utf8").split(/\r?\n/).filter(l => !l.trim().startsWith("#")).join(" ").split(/\s+/).filter(Boolean);
    const find = db.prepare("SELECT id, status FROM problem WHERE course_id = ? AND ext_id = ?");
    const hide = db.prepare("UPDATE problem SET status = 'hidden' WHERE id = ?");
    let n = 0, already = 0; const missing = [];
    for (const ext of ids) {
      const p = find.get(course.id, ext);
      if (!p) { missing.push(ext); continue; }
      if (p.status === "hidden") { already++; continue; }
      if (!dry) hide.run(p.id);
      n++;
    }
    total += n;
    console.log(`${dry ? "(미리보기) " : ""}✓ ${code}: 목록 ${ids.length} · 새로 숨김 ${n} · 이미 숨김 ${already}${missing.length ? ` · DB에 없음 ${missing.length} (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""})` : ""}`);
  }
});
console.log(`${dry ? "(미리보기) " : ""}끝: 숨김으로 바꾼 문제 ${total}개`);
