// 작은 도우미 모음
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 브라우저 저장소 (사생활 보호 창 등에서 막혀도 앱은 돌아가게) */
export const LS = {
  get(k, d) { try { const v = localStorage.getItem("mn:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem("mn:" + k, JSON.stringify(v)); }
    catch (e) {
      if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
        try {
          // 모바일 스토리지 용량 한도 초과 시: 로그성 evq(미전송 이벤트)부터 비우고 재시도
          localStorage.removeItem("mn:evq");
          localStorage.setItem("mn:" + k, JSON.stringify(v));
        } catch { }
      }
    }
  },
  del(k) { try { localStorage.removeItem("mn:" + k); } catch { } },
};

/** 익명 ID: URL에 안전한 22글자 */
export function rid(n = 16) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const KIND = { ox: "O/X", mc: "객관식", short: "서답형", essay: "서술형" };
export const LETTERS = "ABCDEFGH";

/** 아래에서 잠깐 떠오르는 알림 */
let toastT = null;
export function toast(msg, kind = "") {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.className = "toast show " + kind;
  clearTimeout(toastT); toastT = setTimeout(() => { el.className = "toast " + kind; }, 2600);
}

/** 상대 시간: 방금 / 3분 전 / 2일 전 / 10월 3일 */
export function ago(iso) {
  if (!iso) return "";
  const t = new Date(iso), s = (Date.now() - t) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return Math.floor(s / 60) + "분 전";
  if (s < 86400) return Math.floor(s / 3600) + "시간 전";
  if (s < 86400 * 7) return Math.floor(s / 86400) + "일 전";
  return `${t.getMonth() + 1}월 ${t.getDate()}일`;
}

/** 진행 막대 (맞힘 · 해결 · 오답) */
export function barHTML(k, cls = "") {
  const pc = n => k.all ? (n / k.all * 100).toFixed(2) : 0;
  return `<span class="bar ${cls}"><span style="width:${pc(k.c)}%;background:var(--ok)"></span><span style="width:${pc(k.r)}%;background:color-mix(in srgb,var(--ok) 55%,var(--accent))"></span><span style="width:${pc(k.w)}%;background:var(--red)"></span></span>`;
}
export const pct = k => (k.done ? Math.round((k.c + k.r) / k.done * 100) : null);

/** 확인 창 (브라우저 confirm 대신, 같은 디자인으로) */
export function ask({ title, body = "", ok = "확인", cancel = "취소", danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement("div"); wrap.className = "modal";
    wrap.innerHTML = `<div class="modal-bg" data-x="0"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
      <h2 id="dlg-t">${esc(title)}</h2>${body ? `<p>${body}</p>` : ""}
      <div class="dlg-btns"><button class="btn" data-x="0">${esc(cancel)}</button><button class="btn ${danger ? "danger" : "pri"}" data-x="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    const done = v => { wrap.classList.remove("in"); setTimeout(() => wrap.remove(), 220); document.removeEventListener("keydown", key); resolve(v); };
    const key = e => { if (e.key === "Escape") done(false); };
    document.addEventListener("keydown", key);
    wrap.addEventListener("click", e => { const b = e.target.closest("[data-x]"); if (b) done(b.dataset.x === "1"); });
    wrap.querySelector('[data-x="1"]').focus();
  });
}
