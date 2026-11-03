// MySQL 접속을 맡는 작업 스레드. 서버(sync.js)가 보낸 SQL을 하나씩 실행하고 결과를 돌려준다.
// 서버 쪽은 결과가 올 때까지 기다리므로 node:sqlite처럼 "바로 대답 받기"로 쓸 수 있다.
import { workerData } from "node:worker_threads";
import mysql from "mysql2";

const { port, sab, cfg } = workerData;
const flag = new Int32Array(sab);

// DATETIME(3) → "2026-11-01T11:40:00.123Z" (SQLite 때처럼 ISO 글자). JSON 칸 → 빈칸 없는 JSON 글자 (JSON.stringify와 같은 모양)
const typeCast = (field, next) => {
  if (field.type === "DATETIME" || field.type === "TIMESTAMP") { const s = field.string(); return s == null ? null : s.replace(" ", "T") + "Z"; }
  if (field.type === "DATE") return field.string();
  if (field.type === "JSON") { const s = field.string("utf8"); return s == null ? null : JSON.stringify(JSON.parse(s)); }
  return next();
};

// 연결이 끊기면(MySQL 기본 8시간 무사용, 네트워크, MySQL 재시작) 다음 쿼리 때 새로 맺는다. 예전에는 끊기는 순간 서버 전체가 꺼졌다
let conn = null, ready, inTx = false, lost = false;
function drop(c) { if (conn === c) { conn = null; if (inTx) lost = true; } }
function open() {
  const c = conn = mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    charset: "utf8mb4_0900_ai_ci", timezone: "Z", typeCast, multipleStatements: true,
    supportBigNumbers: true, decimalNumbers: true, enableKeepAlive: true,
    flags: ["+FOUND_ROWS"],          // UPDATE가 "바뀐 줄"이 아니라 "조건에 맞은 줄" 수를 돌려준다 (SQLite changes와 같게)
  });
  c.on("error", () => drop(c));
  ready = new Promise((ok, bad) => c.connect(e => e ? bad(e) : c.query("SET time_zone = '+00:00', information_schema_stats_expiry = 0", e2 => e2 ? bad(e2) : ok())));
  ready.catch(() => drop(c));
}

const reply = msg => { port.postMessage(msg); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
port.on("message", async ({ id, sql, params }) => {
  const fail = e => reply({ id, error: { message: e.message, code: e.code, errno: e.errno } });
  const verb = sql.trimStart().slice(0, 17).toUpperCase();
  // 트랜잭션 도중 끊겼으면 앞쪽 쓰기는 MySQL이 이미 되돌렸다. 뒤쪽만 따로 저장되지 않게 ROLLBACK이 올 때까지 거절한다
  if (lost) {
    if (verb.startsWith("ROLLBACK")) { lost = inTx = false; return reply({ id, info: { affectedRows: 0, insertId: 0 } }); }
    return fail(new Error("트랜잭션 도중 MySQL 연결이 끊겼어요"));
  }
  try {
    if (!conn) open();
    const c = conn;
    await ready;
    c.query({ sql, values: params }, (e, rows) => {
      if (e) { if (e.fatal) drop(c); return fail(e); }
      if (verb === "START TRANSACTION") inTx = true;
      else if (verb.startsWith("COMMIT") || verb.startsWith("ROLLBACK")) inTx = false;
      if (Array.isArray(rows)) reply({ id, rows: rows.map(r => Array.isArray(r) ? r : { ...r }) });
      else reply({ id, info: { affectedRows: rows.affectedRows, insertId: rows.insertId } });
    });
  } catch (e) { fail(e); }
});
