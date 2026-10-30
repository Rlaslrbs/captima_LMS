// 처음 한 번: node tools/setup.mjs (또는 npm run setup)
// Node 버전 확인, .env 만들기, 문제 세트로 DB 만들기, 커밋 검사(git hook) 켜기
import { existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
const ok = m => console.log("✓ " + m), warn = m => console.log("! " + m);

const major = +process.versions.node.split(".")[0];
if (major < 22) { console.log(`Node ${process.versions.node}는 너무 낮아요. Node 24 이상을 설치해 주세요.`); process.exit(1); }
major < 24 ? warn(`Node ${process.versions.node} (24 이상을 권해요)`) : ok(`Node ${process.versions.node}`);

if (!existsSync(join(root, ".env"))) { copyFileSync(join(root, ".env.example"), join(root, ".env")); ok(".env를 만들었어요. GEMINI_API_KEY를 채워 주세요."); }
else ok(".env가 이미 있어요");

if (!existsSync(join(root, "data", "app.db"))) { console.log("문제 세트를 DB에 넣어요…"); run(process.execPath, ["server/import.js"]); ok("data/app.db를 만들었어요 (학습자 기록 없는 빈 DB)"); }
else ok("data/app.db가 이미 있어요 (건드리지 않아요)");

try { run("git", ["config", "core.hooksPath", ".githooks"]); ok("커밋 검사를 켰어요 (키·DB·.env 차단)"); }
catch { warn("git 저장소가 아니라서 커밋 검사는 건너뛰었어요"); }

console.log("\n다음: npm run dev  →  http://127.0.0.1:4000  (관리자 주소는 터미널에 나와요)");
