// DB 백업 (Windows·맥 공통). 사용법: node deploy/windows/backup.mjs
// - data/app.db 를 data/backups/nightly/ 에 날짜별로 저장한다 (VACUUM INTO: 서버가 켜 있어도 안전).
// - 최근 30개만 남기고 오래된 것은 지운다.
// - 환경 변수 BACKUP_DEST 를 주면 그 폴더(예: 외장하드, 다른 드라이브)에도 한 부 더 복사한다.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, unlinkSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "data", "app.db");
const DIR = join(ROOT, "data", "backups", "nightly");
const KEEP = 30;

if (!existsSync(SRC)) {
  console.error(`DB 파일이 없어요: ${SRC}`);
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-11-12T03-00-00
const out = join(DIR, `app-${stamp}.db`);

const db = new DatabaseSync(SRC);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`백업 완료: ${out}`);

const files = readdirSync(DIR).filter(f => /^app-.*\.db$/.test(f)).sort();
for (const old of files.slice(0, Math.max(0, files.length - KEEP))) unlinkSync(join(DIR, old));

if (process.env.BACKUP_DEST) {
  const dest = process.env.BACKUP_DEST;
  mkdirSync(dest, { recursive: true });
  const copy = join(dest, `app-${stamp}.db`);
  copyFileSync(out, copy);
  console.log(`복사 완료: ${copy}`);
}
