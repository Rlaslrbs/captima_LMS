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

const conn = mysql.createConnection({
  host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
  charset: "utf8mb4_0900_ai_ci", timezone: "Z", typeCast, multipleStatements: true,
  supportBigNumbers: true, decimalNumbers: true,
  flags: ["+FOUND_ROWS"],          // UPDATE가 "바뀐 줄"이 아니라 "조건에 맞은 줄" 수를 돌려준다 (SQLite changes와 같게)
});
const ready = new Promise((ok, bad) => conn.connect(e => e ? bad(e) : conn.query("SET time_zone = '+00:00', information_schema_stats_expiry = 0", e2 => e2 ? bad(e2) : ok())));

const reply = msg => { port.postMessage(msg); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); };
port.on("message", async ({ sql, params }) => {
  try {
    await ready;
    conn.query({ sql, values: params }, (e, rows) => {
      if (e) return reply({ error: { message: e.message, code: e.code, errno: e.errno } });
      if (Array.isArray(rows)) reply({ rows: rows.map(r => Array.isArray(r) ? r : { ...r }) });
      else reply({ info: { affectedRows: rows.affectedRows, insertId: rows.insertId } });
    });
  } catch (e) { reply({ error: { message: e.message, code: e.code, errno: e.errno } }); }
});
