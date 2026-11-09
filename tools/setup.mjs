// 처음 한 번: node tools/setup.mjs (또는 npm run setup)
// Node 버전 확인, mysql2 설치, .env 만들기, 커밋 검사(git hook) 켜기, MySQL 연결 확인
import { existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...o });
const ok = m => console.log("✓ " + m), warn = m => console.log("! " + m);

const major = +process.versions.node.split(".")[0];
if (major < 22) { console.log(`Node ${process.versions.node}는 너무 낮아요. Node 24 이상을 설치해 주세요.`); process.exit(1); }
major < 24 ? warn(`Node ${process.versions.node} (24 이상을 권해요)`) : ok(`Node ${process.versions.node}`);

if (!existsSync(join(root, "node_modules", "mysql2"))) {
  console.log("mysql2(MySQL 접속 패키지, 이 프로젝트의 유일한 외부 패키지)를 설치해요…");
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-fund", "--no-audit"], { shell: process.platform === "win32" });
}
ok("mysql2 설치됨");

if (!existsSync(join(root, ".env"))) { copyFileSync(join(root, ".env.example"), join(root, ".env")); ok(".env를 만들었어요. GEMINI_API_KEY와 MYSQL_… 접속 정보를 채워 주세요."); }
else ok(".env가 이미 있어요");

try { run("git", ["config", "core.hooksPath", ".githooks"]); ok("커밋 검사를 켰어요 (키·DB·.env 차단)"); }
catch { warn("git 저장소가 아니라서 커밋 검사는 건너뛰었어요"); }

let connected = false;
try { run(process.execPath, ["--env-file=.env", "tools/mysql-setup.mjs", "check"]); connected = true; }
catch { warn("MySQL에 아직 연결되지 않아요. .env의 MYSQL_HOST · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE를 확인해 주세요"); }

console.log(`
다음:
  1. MySQL 준비 (처음 한 번)
     - 문제만 넣기:            node --env-file=.env tools/mysql-setup.mjs schema  →  npm run import
     - SQLite(data/app.db)에서: node --env-file=.env tools/mysql-setup.mjs all --content-only   (학습자 기록까지: --with-learners)
     - 서버 담당의 운영 전환:  docs/db/MySQL_서버연결_프롬프트.md
  2. npm run dev  →  http://127.0.0.1:4000  (관리자 주소는 터미널에 나와요)` + (connected ? "" : "\n  (MySQL 연결이 먼저예요)"));
