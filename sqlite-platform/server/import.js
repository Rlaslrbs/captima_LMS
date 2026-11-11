// 문제 세트 JSON을 DB에 넣는다.  사용: node server/import.js [--dry] [--hidden] [--note "바꾼 이유"] [파일 ...]   (파일을 안 주면 data/import/*.json 전부)
// --hidden: 새 문제를 숨김으로 넣는다 (관리자가 승인하면 공개). 팩에 "publish": false가 있어도 같다.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { importPack, DATA } from "./db.js";

const argv = process.argv.slice(2);
const ni = argv.indexOf("--note"); const note = ni >= 0 ? argv[ni + 1] : "가져오기";
const args = argv.filter((a, i) => !a.startsWith("--") && !(ni >= 0 && i === ni + 1));
const files = args.length ? args
  : readdirSync(join(DATA, "import")).filter(f => f.endsWith(".json")).sort().map(f => join(DATA, "import", f));
const dry = argv.includes("--dry"), hidden = argv.includes("--hidden");
const n3 = (o, a, b, c) => [o[a] && `+${o[a]}`, o[b] && `~${o[b]}`, o[c] && `은퇴 ${o[c]}`].filter(Boolean).join(" ") || "그대로";
for (const f of files) {
  let pack;
  try { pack = JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { console.log(`✗ ${f}\n  JSON 형식 오류: ${e.message}\n  (수식의 역슬래시는 JSON 안에서 두 번: "\\\\(x\\\\)", "\\\\;")`); continue; }
  const r = importPack(pack, { dry, note, hidden });
  const warn = (r.warnings || []).map(w => `  ⚠ ${w}`);
  if (!r.ok) { console.log(`✗ ${f}\n  ` + r.errors.slice(0, 10).join("\n  ") + (warn.length ? "\n" + warn.slice(0, 10).join("\n") : "")); continue; }
  const p = r.plan.problems, x = r.plan.dx;
  console.log(`${dry ? "(미리보기) " : ""}✓ ${f.split("/").pop()}  문제 ${r.count} · 새로 ${p.add}${p.hidden ? ` (숨김 ${p.hidden})` : ""} · 바뀜 ${p.changed} · 그대로 ${p.same}`);
  if (x) console.log(`  진단: 개념 ${n3(x.kc, "add", "update", "retire")} · 세부 포인트 ${n3(x.facet, "add", "update", "retire")}${x.facet.draft ? ` (초안 ${x.facet.draft})` : ""}`
    + ` · 오개념 ${n3(x.misc, "add", "update", "retire")} · 태그 ${x.tags.set} 새로/${x.tags.same} 그대로${x.tags.admin ? `/관리자 것 유지 ${x.tags.admin}` : ""}`
    + ` · 변형 묶음 ${x.families}(${x.members}문제) · vocab_ver ${x.vocab_ver}`);
  if (warn.length) console.log(warn.slice(0, 20).join("\n") + (warn.length > 20 ? `\n  … 주의 ${warn.length - 20}개 더` : ""));
}
