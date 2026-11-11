// 관리자 웹 공용: 서버 요청, 숫자 표시, 문제 미리보기, 수식
import { esc } from "/js/util.js";
export { esc, toast, ask, ago } from "/js/util.js";

// 비밀 주소(/admin-xxxx) 아래에서만 돈다
export const BASE = "/" + location.pathname.split("/")[1];
export async function api(method, path, body) {
  const res = await fetch(BASE + "/api" + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch { }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `요청 실패 (${res.status})`), { status: res.status, data });
  return data;
}

export const KIND = { ox: "O/X", mc: "객관식", short: "서답형", essay: "서술형" };
export const LETTERS = "ABCDEFGH";
export const pct = x => (x === null || x === undefined ? "–" : Math.round(x * 100) + "%");
export function sec(ms) {
  if (ms === null || ms === undefined) return "–";
  const s = ms / 1000;
  if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + "초";
  return Math.floor(s / 60) + "분 " + Math.round(s % 60) + "초";
}
export const n = x => (x ?? 0).toLocaleString("ko-KR");
export const strip = s => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/** 정답률 칸: 기준 이하이고 시도가 충분하면 빨강 */
export const LOW = 0.5, MIN_N = 3;
export function accCell(acc, attempts) {
  if (acc === null || acc === undefined) return `<span class="muted">–</span>`;
  const bad = acc < LOW && attempts >= MIN_N;
  return `<span class="accb ${bad ? "bad" : ""}"><i><s style="width:${Math.round(acc * 100)}%"></s></i><span class="${bad ? "bad" : ""}">${pct(acc)}</span></span>`;
}

const fmt = s => (s && !/<(p|ol|ul|table|div|br|section)\b/i.test(s) ? String(s).replace(/\n/g, "<br>") : s || "");
/** 사용자 화면과 비슷한 문제 미리보기 (정답 표시 포함) */
export function previewHTML({ kind, star, body: b, files = {}, label = "" }) {
  let mid = "";
  if (kind === "ox") mid = `<div class="ans"><b>정답 ${b.ox ? "O" : "X"}</b>${b.fix ? ` — ${b.fix}` : ""}</div>`;
  else if (kind === "mc") {
    mid = (b.stem ? `<div class="stem">${fmt(b.stem)}</div>` : "") + `<div class="opts">${(b.opts || []).map((o, i) =>
      `<div class="o ${i === b.ans ? "right" : ""}"><b>${LETTERS[i]}</b><span>${fmt(o)}${b.opts_sub && b.opts_sub[i] ? `<small>${fmt(b.opts_sub[i])}</small>` : ""}</span></div>`).join("")}</div>`
      + (b.a ? `<div class="ans"><b>풀이 결과</b> ${fmt(b.a)}</div>` : "");
  } else if (kind === "short") {
    mid = `<div class="ans"><b>정답</b> ${fmt(b.a)}${b.accept && b.accept.length ? `<br><small class="muted">허용 답: ${esc(b.accept.join(", "))}</small>` : ""}${b.num !== undefined ? `<br><small class="muted">숫자 채점: ${esc(b.num)} ± ${esc(b.tol ?? 0.01)}</small>` : ""}</div>`;
  } else {
    mid = `<div class="ans"><b>모범 답안</b><br>${fmt(b.a)}</div>` + (b.pts && b.pts.length ? `<b>채점 포인트</b><ul>${b.pts.map(x => `<li>${x}</li>`).join("")}</ul>` : "");
  }
  const src = b.src && b.src.length ? `<div class="src">출처 · ${b.src.map(s => esc((files[s[0]] || s[0]) + (s[1] ? " · " + s[1] : ""))).join(" / ")}</div>` : "";
  return `<div class="pv"><div class="meta">${label}<span class="tag">${KIND[kind] || kind}</span>${star ? '<span class="tag hl">★ 중요</span>' : ""}${b.no ? `<span>${esc(b.no)}</span>` : ""}</div>
    <div class="qq">${fmt(b.q)}${b.q_sub ? `<span class="sub">${fmt(b.q_sub)}</span>` : ""}</div>${mid}
    ${b.s ? `<div class="sol">${b.s}</div>` : ""}${src}</div>`;
}

// 수식: 사용자 웹과 같은 설정·모양 (web/js/math.js)
export { typeset } from "/js/math.js";

/** 같은 화면 안의 작은 상태(정렬·필터)를 기억 */
export const mem = {
  get(k, d) { try { const v = sessionStorage.getItem("mna:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem("mna:" + k, JSON.stringify(v)); } catch { } },
};
