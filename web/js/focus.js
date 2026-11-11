/* 집중 모드: 문제 목록에서 한 번에 한 문제만 크게 보여 준다. (_hub/focus.js를 옮겨 옴)
   - 아래 이동 바는 늘 보인다: 이전 · 지금 번호 · 다음. 번호를 누르면 문제 번호 줄이 펼쳐지고, 바 밖을 누르면 접힌다.
   - 채점한 문제에서는 카드의 "다음 문제" 버튼을 이동 바의 주요 버튼으로 올려 보여 준다 (엄지가 닿는 자리).
   - 이어 풀기: 범위마다 마지막으로 본 문제를 기억한다 (opts.resumeGet / resumeSet).
   - 지금 보이는 문제가 바뀌면 opts.onCurrent(카드 id)를 부른다 (풀이 시간 측정용). */
export function initFocus(main, opts) {
  const KEY = "mn:focusMode";
  let mode = "focus"; try { mode = localStorage.getItem(KEY) || "focus"; } catch { }
  let curId = null, busy = false, queued = false, open = false;
  let lastIdx = 0, lastShownId = null, lastCur = null, enterFrom = 0;
  const ac = new AbortController(), sig = { signal: ac.signal };

  const bar = document.createElement("nav"); bar.className = "fx-bar"; bar.setAttribute("aria-label", "문제 이동"); bar.hidden = true;
  document.body.append(bar);

  const list = () => Array.from(main.querySelectorAll("article.card"));
  function status(c) {
    if (c.classList.contains("st-wrong")) return "w";
    if (c.classList.contains("st-resolved")) return "r";
    if (c.classList.contains("st-correct")) return "c";
    return "";
  }
  const label = c => { const n = c.querySelector(".no"); return n ? n.textContent.trim() : ""; };
  function section(c) {
    let prev = c.previousElementSibling;
    while (prev) { if (prev.classList.contains("grp-h")) return prev.textContent.trim(); prev = prev.previousElementSibling; }
    return "";
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const saveRes = id => { if (id) opts.resumeSet(opts.scopeKey(), id); };

  main.addEventListener("click", e => {
    const c = e.target.closest && e.target.closest("article.card"); if (c) saveRes(c.id);
  }, { capture: true, ...sig });

  /* ---- 문제 번호 줄: 번호 단추로 펼치고, 바 밖을 누르면 접힌다 ---- */
  function center() { const strip = bar.querySelector(".fx-dots"), cur = strip && strip.querySelector(".cur"); if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2; }
  function setOpen(v) {
    if (open === v) return; open = v; document.documentElement.classList.toggle("fx-open", v);
    const p = bar.querySelector('[data-fx="dots"]'); if (p) p.setAttribute("aria-expanded", v);
    if (v) center();
  }
  document.addEventListener("pointerdown", e => { if (open && !bar.contains(e.target)) setOpen(false); }, sig);

  function apply() {
    busy = true;
    const cs = list();
    const on = mode === "focus" && cs.length >= 1;
    document.documentElement.classList.toggle("fx-on", on);
    const st = {}; cs.forEach(c => { st[c.id] = status(c); });
    const fa = bar.contains(document.activeElement) ? document.activeElement.getAttribute("data-fx") : null;

    if (!cs.length) {
      bar.hidden = true; setOpen(false);
      document.documentElement.classList.remove("fx-has-bar"); busy = false; return;
    }
    bar.hidden = false; document.documentElement.classList.add("fx-has-bar");
    const n = cs.length;

    if (!on) {
      cs.forEach(c => c.classList.remove("fx-hide", "fx-cur")); setOpen(false);
      bar.innerHTML = '<div class="fx-row"><span class="fx-pos">전체 ' + n + '문제 목록</span><button class="fx-mode" data-fx="mode">한 문제씩 크게 보기</button></div>';
      if (lastCur !== null) { lastCur = null; opts.onCurrent && opts.onCurrent(null); }
      refocus(fa); busy = false; return;
    }
    let i = cs.findIndex(c => c.id === curId);
    if (i < 0) {
      if (curId) i = Math.min(lastIdx, n - 1);
      else {
        i = 0; const rid = opts.resumeGet(opts.scopeKey());
        if (rid) { const q = cs.findIndex(c => c.id === rid); if (q >= 0) i = (st[cs[q].id] && q + 1 < n) ? q + 1 : q; }   // 마지막에 푼 문제면 그 다음 문제부터
      }
      curId = cs[i].id;
    }
    lastIdx = i;
    cs.forEach((c, k) => { c.classList.toggle("fx-hide", k !== i); c.classList.toggle("fx-cur", k === i); if (k !== i) c.classList.remove("fx-enter"); });
    if (cs[i].id !== lastShownId) {
      cs[i].classList.remove("fx-from-r", "fx-from-l");
      if (enterFrom) cs[i].classList.add(enterFrom > 0 ? "fx-from-r" : "fx-from-l");
      cs[i].classList.add("fx-enter");
    }
    enterFrom = 0;
    lastShownId = cs[i].id;
    if (lastCur !== cs[i].id) { lastCur = cs[i].id; opts.onCurrent && opts.onCurrent(lastCur, i); }
    const sec = section(cs[i]);
    const dots = cs.map((c, k) => {
      const s = st[c.id];
      return '<button class="fx-dot' + (k === i ? " cur" : "") + (s ? " s-" + s : "") + '" data-fx="go" data-i="' + k + '" title="' + esc(label(c)) + '" aria-label="' + (k + 1) + '번 문제' + (s === "w" ? " (오답)" : s ? " (풀이 완료)" : "") + '">' + (k + 1) + '</button>';
    }).join("");
    const nb = cs[i].querySelector("[data-next] .nl");   // 채점한 문제: 카드의 "다음 문제"(마지막이면 "끝! …")를 주요 버튼으로
    bar.innerHTML =
      '<div class="fx-dots" role="group" aria-label="문제 번호">' + dots + '</div>' +
      '<button class="fx-mode" data-fx="mode">목록으로 보기</button>' +
      '<div class="fx-row">' +
      '<button class="fx-btn" data-fx="prev"' + (i === 0 ? " disabled" : "") + ' aria-label="이전 문제">‹ 이전</button>' +
      '<button class="fx-pos" data-fx="dots" aria-expanded="' + open + '" aria-label="' + (i + 1) + '번 문제, 전체 ' + n + '문제. 문제 번호 펼치기"><span><b>' + (i + 1) + '</b> / ' + n + '</span>' + (sec ? '<span class="fx-sec">' + esc(sec) + '</span>' : "") + '</button>' +
      (nb ? '<button class="fx-btn pri" data-fx="done">' + esc(nb.textContent) + ' →</button>'
        : '<button class="fx-btn" data-fx="next"' + (i === n - 1 ? " disabled" : "") + ' aria-label="다음 문제">다음 ›</button>') +
      '</div>';
    if (open) center();
    refocus(fa); busy = false;
  }
  function refocus(fa) {   // 바 버튼을 키보드로 누른 뒤에도 포커스 유지
    if (!fa) return;
    const nb = (fa === "go" ? bar.querySelector(".fx-dot.cur") : bar.querySelector('[data-fx="' + fa + '"]:not([disabled])')) || bar.querySelector("button:not([disabled])");
    if (nb) nb.focus({ preventScroll: true });
  }
  function schedule() { if (busy || queued) return; queued = true; requestAnimationFrame(() => { queued = false; apply(); }); }
  const index = () => Math.max(0, list().findIndex(c => c.id === curId));
  function go(i) {
    let cs = list(); if (!cs.length) return;
    i = Math.max(0, Math.min(cs.length - 1, i)); const tid = cs[i].id;
    const from = index(); enterFrom = i > from ? 1 : i < from ? -1 : 0;     // 새 카드가 들어오는 방향
    opts.onLeave && opts.onLeave();   // 방금 푼 문제를 목록에서 내리게 (안 푼 문제 필터)
    cs = list(); if (!cs.length) return;
    i = cs.findIndex(c => c.id === tid);
    if (i < 0) i = Math.min(lastIdx, cs.length - 1);
    curId = cs[i].id; saveRes(curId); apply();
    const y = cs[i].getBoundingClientRect().top + pageYOffset - 180;   // 머리 줄(뒤로 · 범위 이름 · 진행 선)이 위쪽 바에 가리지 않게
    scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }
  bar.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const a = b.getAttribute("data-fx");
    if (a === "prev") go(index() - 1);
    else if (a === "next") go(index() + 1);
    else if (a === "go") go(+b.getAttribute("data-i"));
    else if (a === "dots") setOpen(!open);
    else if (a === "done") { const nb = list()[index()].querySelector("[data-next]"); if (nb) nb.click(); }   // 끝 처리(오답 다시 풀기 · 메뉴로)는 카드 버튼이 안다
    else if (a === "mode") { mode = mode === "focus" ? "list" : "focus"; try { localStorage.setItem(KEY, mode); } catch { } apply(); }
    if (e.detail !== 0 && document.activeElement && bar.contains(document.activeElement)) document.activeElement.blur();
  });
  document.addEventListener("keydown", e => {
    if (mode !== "focus" || bar.hidden) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (document.querySelector(".modal, .sheet-wrap")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); go(index() + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(index() - 1); }
  }, sig);
  /* ---- 폰: 카드를 옆으로 밀어 이전·다음 문제로 ----
     세로 스크롤은 브라우저에 맡기고(touch-action: pan-y), 가로로 민 것만 받는다.
     화면 가장자리(브라우저 뒤로 가기 몸짓), 입력칸, 옆으로 스크롤되는 표·수식에서 시작한 몸짓은 건드리지 않는다. */
  let sw = null;
  const hScroll = el => {
    for (let e = el; e && e !== main; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 2) { const ox = getComputedStyle(e).overflowX; if (ox === "auto" || ox === "scroll") return true; }
    }
    return false;
  };
  const resetCard = c => { c.classList.remove("fx-drag"); c.style.transform = ""; };
  main.addEventListener("touchstart", e => {
    sw = null;
    if (mode !== "focus" || e.touches.length !== 1) return;
    const c = e.target.closest && e.target.closest("article.card.fx-cur"); if (!c) return;
    const t = e.touches[0];
    if (t.clientX < 24 || t.clientX > innerWidth - 24) return;
    if (e.target.closest("input,textarea,select") || hScroll(e.target)) return;
    sw = { x: t.clientX, y: t.clientY, t: Date.now(), c, lock: null, dx: 0 };
  }, { passive: true, ...sig });
  main.addEventListener("touchmove", e => {
    if (!sw) return;
    const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
    if (!sw.lock) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      sw.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
      if (sw.lock === "x") sw.c.classList.add("fx-drag");
    }
    if (sw.lock !== "x") return;
    e.preventDefault();
    const i = index(), n = list().length, edge = (dx > 0 && i === 0) || (dx < 0 && i === n - 1);
    sw.dx = edge ? dx * 0.25 : dx;                                           // 처음·마지막 문제에서는 살짝만 끌려 온다
    sw.c.style.transform = `translateX(${sw.dx}px)`;
  }, { passive: false, ...sig });
  main.addEventListener("touchend", () => {
    if (!sw) return; const s = sw; sw = null;
    if (s.lock !== "x") return;
    const i = index(), n = list().length, dir = s.dx < 0 ? 1 : -1;
    const far = Math.abs(s.dx) > Math.min(110, innerWidth * 0.25), fast = Math.abs(s.dx) > 40 && Date.now() - s.t < 280;
    if (!(far || fast) || i + dir < 0 || i + dir >= n) { resetCard(s.c); return; }
    s.c.classList.remove("fx-drag"); s.c.classList.add("fx-out");
    s.c.style.transform = `translateX(${dir > 0 ? "-100vw" : "100vw"})`;
    setTimeout(() => { s.c.classList.remove("fx-out"); resetCard(s.c); go(i + dir); }, 200);
  }, sig);
  main.addEventListener("touchcancel", () => { if (sw) { resetCard(sw.c); sw = null; } }, sig);

  const mo = new MutationObserver(schedule); mo.observe(main, { childList: true, subtree: true });
  apply();

  return {
    reset() { curId = null; },                    // 다른 범위·필터를 고르면 첫 문제(또는 이어 풀 문제)부터
    isFocus: () => mode === "focus",
    next: () => go(index() + 1),                  // 카드 안 "다음 문제" 버튼·Enter 키
    destroy() {
      ac.abort(); mo.disconnect(); bar.remove();
      document.documentElement.classList.remove("fx-on", "fx-open", "fx-has-bar");
    },
  };
}
