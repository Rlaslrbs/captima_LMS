// 예전 "중간 문제 노트 모음"(파일로 연 허브)의 풀이 기록을 새 플랫폼으로 옮긴다.
// 사용: node tools/import_legacy.mjs <문제노트_예전기록.json> [--dry]
// - 새 기기를 하나 만들어 기록을 넣고, 1시간 동안 쓸 수 있는 기기 이동 코드를 만든다.
//   그 코드를 아무 브라우저(맥·폰)의 마이페이지 → "다른 기기 기록 가져오기"에 넣으면 그 브라우저가 이 기록을 쓴다.
// - 예전 문제 번호(id) = 새 DB의 ext_id. 공수2 객관식은 보기 순서를 섞어 옮겼으므로 보기 글자로 다시 찾는다.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const file = process.argv[2]; const dry = process.argv.includes("--dry");
if (!file) { console.error("사용: node tools/import_legacy.mjs <json> [--dry]"); process.exit(1); }
const dump = JSON.parse(readFileSync(file, "utf8"));
const db = new DatabaseSync(process.env.DB_PATH || join(ROOT, "data", "app.db"));
db.exec("PRAGMA busy_timeout = 3000");

const KEYS = { "mis-quiz:progress": "MIS", "pom-quiz:progress": "IE216", "kehn-quiz:progress": "KEHN", "ie208-quiz:progress": "IE208", "lan:progress": "LA2" };
const LETTERS = "ABCDEFGH";
const raw = JSON.parse(readFileSync(join(ROOT, "data", "raw", "la_raw.json"), "utf8"));
const laOpts = {};      // 공수2 원래 보기 순서 (o[0]이 정답)
for (const s of raw.sets || raw.PROBLEM_SETS || raw) for (const p of (s.problems || [])) if (p.mc && p.mc.o) laOpts[p.id] = p.mc.o;

const find = db.prepare(`SELECT p.id, p.current_version v, pv.kind, pv.body FROM problem p JOIN course c ON c.id = p.course_id
  JOIN semester s ON s.id = c.semester_id JOIN problem_version pv ON pv.problem_id = p.id AND pv.version = p.current_version
  WHERE s.code = '26-2' AND c.code = ? AND p.ext_id = ?`);
const courseId = code => db.prepare("SELECT c.id FROM course c JOIN semester s ON s.id = c.semester_id WHERE s.code = '26-2' AND c.code = ?").get(code).id;

const rows = [], miss = [], per = {};
for (const [key, code] of Object.entries(KEYS)) {
  const items = (dump.items || {})[key] || {};
  for (const [oldId, r] of Object.entries(items)) {
    if (!r || !["correct", "wrong", "resolved"].includes(r.status)) continue;
    const p = find.get(code, oldId);
    if (!p) { miss.push(`${code} ${oldId}`); continue; }
    const b = JSON.parse(p.body);
    let answer = "", attempts, wrong = r.wrongCount || 0;
    if (code === "LA2") {
      attempts = Array.isArray(r.attempts) ? r.attempts.length : (r.attempts || 1);
      const ch = r.status === "wrong" ? r.lastWrongChoice : 0;         // 0 = 정답
      if (ch === -1) answer = "모르겠어요";
      else if (p.kind === "ox" && Number.isInteger(ch)) answer = (ch === 0) === b.ox ? "O" : "X";
      else if (p.kind === "mc" && Number.isInteger(ch) && laOpts[oldId]) { const i = b.opts.indexOf(laOpts[oldId][ch]); if (i >= 0) answer = LETTERS[i]; }
    } else {
      attempts = r.attempts || 1;
      if (r.mine) answer = String(r.mine);
      else if (p.kind === "ox" && typeof r.lastChoice === "boolean") answer = r.lastChoice ? "O" : "X";
      else if (p.kind === "mc" && Number.isInteger(r.lastChoice)) answer = LETTERS[r.lastChoice];
    }
    rows.push({ pid: p.id, v: p.v, status: r.status, attempts, wrong, answer: answer.slice(0, 600), at: r.updatedAt || dump.exported_at, cid: code });
    per[code] = per[code] || { correct: 0, wrong: 0, resolved: 0 }; per[code][r.status]++;
  }
}
console.log("옮길 기록:", rows.length, "문제");
for (const [c, k] of Object.entries(per)) console.log(`  ${c}: 맞힘 ${k.correct} · 오답 ${k.wrong} · 해결 ${k.resolved}`);
if (miss.length) console.log("새 DB에서 못 찾은 문제:", miss.length, miss.slice(0, 20).join(", "));
if (dry || !rows.length) process.exit(0);

const dev = randomBytes(16).toString("base64url").slice(0, 22);
const t = new Date().toISOString();
let code;
db.exec("BEGIN");
try {
  db.prepare("INSERT INTO device(id, nickname, consent, created_at, last_seen) VALUES (?,?,1,?,?)").run(dev, "", t, t);
  const ins = db.prepare("INSERT INTO progress(device_id, problem_id, version, status, attempts, wrong_count, last_answer, updated_at) VALUES (?,?,?,?,?,?,?,?)");
  rows.forEach(r => ins.run(dev, r.pid, r.v, r.status, r.attempts, r.wrong, r.answer, r.at));
  const order = ["MIS", "IE216", "KEHN", "IE208", "LA2"].filter(c => per[c]);
  order.forEach((c, i) => db.prepare("INSERT INTO enrollment(device_id, course_id, sort, added_at) VALUES (?,?,?,?)").run(dev, courseId(c), i, t));
  do code = String(randomInt(0, 1e6)).padStart(6, "0"); while (db.prepare("SELECT 1 FROM transfer_code WHERE code = ?").get(code));
  db.prepare("INSERT INTO transfer_code(code, device_id, expires_at) VALUES (?,?,?)").run(code, dev, new Date(Date.now() + 36e5).toISOString());
  db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); throw e; }
console.log("\n새 기기:", dev);
console.log("기기 이동 코드:", code, "(1시간 동안 유효)");
