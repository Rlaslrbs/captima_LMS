// MySQL을 node:sqlite(DatabaseSync)와 같은 모양으로 쓰게 하는 연결: db.prepare(sql).get/all/run, db.exec(sql).
// 실제 접속은 작업 스레드(worker.js)가 하고, 여기서는 대답이 올 때까지 기다린다 (SQLite도 한 번에 한 쿼리씩 기다렸다).
// 그래서 서버 코드의 흐름(동기 호출)은 그대로 두고 SQL만 MySQL 문법으로 바꾸면 된다.
import { Worker, MessageChannel, receiveMessageOnPort } from "node:worker_threads";

const WAIT_MS = 30_000;

// 서버는 시각을 ISO 글자("…T12:23:09.052Z")로 쓴다. MySQL DATETIME은 비교할 때는 이 모양을 읽지만 넣을 때는 끝의 Z를 거절한다 → "+00:00"으로 바꿔 보낸다.
// (글자 칸에 시각을 넣으면 "+00:00"으로 저장된다: Date.parse는 같은 시각으로 읽는다)
const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/;
// NaN · Infinity는 SQLite처럼 NULL로 (mysql2는 그대로 글자로 넣어 SQL 오류가 난다)
const toMy = v => v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null
  : typeof v === "string" && ISO_Z.test(v) ? v.slice(0, -1) + "+00:00" : v;

/** SQLite식 번호 자리표시(?1 ?2 …)를 MySQL의 ?로 바꾸고, 값을 그 순서대로 늘어놓는 함수를 만든다 */
function numbered(sql) {
  if (!/\?\d/.test(sql)) return { sql, order: null };
  const order = [];
  return { sql: sql.replace(/\?(\d+)/g, (_, n) => { order.push(+n - 1); return "?"; }), order };
}

export function openMySQL(cfg) {
  const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL("./worker.js", import.meta.url), { workerData: { port: port2, sab, cfg }, transferList: [port2] });
  worker.unref(); port1.unref();

  function call(sql, params = []) {
    Atomics.store(flag, 0, 0);
    port1.postMessage({ sql, params });
    if (Atomics.wait(flag, 0, 0, WAIT_MS) === "timed-out") throw new Error("MySQL 응답이 없어요 (" + WAIT_MS / 1000 + "초)");
    const { message } = receiveMessageOnPort(port1);
    if (message.error) throw Object.assign(new Error(message.error.message), { code: message.error.code, errno: message.error.errno, sql });
    return message;
  }

  const db = {
    exec(sql) { call(sql); },
    prepare(text) {
      const { sql, order } = numbered(text);
      const args = a => (order ? order.map(i => a[i]) : a).map(toMy);
      const upsert = /ON DUPLICATE KEY UPDATE/i.test(sql);
      return {
        all: (...a) => call(sql, args(a)).rows,
        get: (...a) => call(sql, args(a)).rows[0],
        run: (...a) => {
          const { affectedRows, insertId } = call(sql, args(a)).info;
          // INSERT … ON DUPLICATE KEY UPDATE는 고친 줄을 2로 센다 → SQLite처럼 1
          return { changes: upsert ? Math.min(affectedRows, 1) : affectedRows, lastInsertRowid: insertId };
        },
      };
    },
  };
  return db;
}
