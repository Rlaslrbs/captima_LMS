// MySQL 연결부 시험 (읽기 쿼리만, 표를 바꾸지 않음). 실행: npm run test:mysql  (.env의 MySQL 접속 정보 필요)
import { test } from "node:test";
import assert from "node:assert/strict";
import { openMySQL } from "./sync.js";

const env = (a, b, d) => process.env[a] || process.env[b] || d;
const cfg = { host: env("MYSQL_HOST", "DB_HOST", "127.0.0.1"), port: +env("MYSQL_PORT", "DB_PORT", 3306), user: env("MYSQL_USER", "DB_USER"),
  password: env("MYSQL_PASSWORD", "DB_PASSWORD", ""), database: env("MYSQL_DATABASE", "DB_NAME", "problem_solving_site"), waitMs: 2000 };
const skip = !cfg.user && "MySQL 접속 정보가 없어요 (.env)";
const pause = ms => new Promise(r => setTimeout(r, ms));
const connId = db => db.prepare("SELECT CONNECTION_ID() id").get().id;

test("연결이 끊겨도 서버가 꺼지지 않고 다음 쿼리 때 다시 붙는다", { skip }, async () => {
  const db = openMySQL(cfg), other = openMySQL(cfg);
  const before = connId(db);
  other.exec(`KILL ${before}`);
  await pause(500);
  assert.deepEqual(db.prepare("SELECT 1 x").get(), { x: 1 });
  assert.notEqual(connId(db), before);
});

test("시간이 지난 쿼리의 늦은 답을 다음 쿼리가 받지 않는다", { skip }, async () => {
  const db = openMySQL(cfg);
  assert.throws(() => db.prepare("SELECT SLEEP(3) s").get(), /응답이 없어요/);
  await pause(1500);
  assert.deepEqual(db.prepare("SELECT 'A' x").get(), { x: "A" });
  assert.deepEqual(db.prepare("SELECT 'B' x").get(), { x: "B" });
});

test("트랜잭션 도중 끊기면 ROLLBACK 전까지 쿼리를 거절한다", { skip }, async () => {
  const db = openMySQL(cfg), other = openMySQL(cfg);
  db.exec("START TRANSACTION");
  other.exec(`KILL ${connId(db)}`);
  await pause(500);
  assert.throws(() => db.prepare("SELECT 1 x").get(), /트랜잭션 도중/);
  assert.throws(() => db.exec("COMMIT"), /트랜잭션 도중/);
  db.exec("ROLLBACK");
  assert.deepEqual(db.prepare("SELECT 1 x").get(), { x: 1 });
});
