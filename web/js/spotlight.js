// 로고 비추기 (다크 모드 전용, glass.css의 배경 로고가 있을 때만)
// 오른쪽 아래 버튼을 누르면 보는 사람이 가운데 CAPTIMA 로고로 빨려 들어가듯 다가가고,
// 화면의 카드·메뉴는 로고에서 바깥으로 날아가 사라진다. 남은 로고를 아래에서 올라온 탐조등들이 비춘다.
// 다시 누르거나 아무 곳이나 누르거나 Esc로 돌아온다.
const root = document.documentElement;
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const isDark = () => root.dataset.theme === "dark" || (!root.dataset.theme && darkMQ.matches);
const LOGO_Y = .56;   // glass.css body::after의 background-position 세로값과 같게

if (getComputedStyle(document.body, "::after").backgroundImage.includes("captima")) {
  const btn = document.createElement("button");
  btn.className = "spot-btn"; btn.type = "button";
  btn.setAttribute("aria-label", "CAPTIMA 로고 비추기"); btn.setAttribute("aria-pressed", "false");
  btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g transform="rotate(-35 10 13)"><rect x="4.5" y="10" width="9.5" height="6" rx="1.6"/><path d="M14 9.2 17 8v10l-3-1.2"/><path d="M19 9.5 21.5 8.5M19.3 13h2.7M19 16.5l2.5 1"/></g>
    <path d="M10 16.2V20.5M6.5 20.5h7"/></svg>`;   // 탐조등: 비스듬히 위를 향한 등 + 받침 + 빛살
  const fx = document.createElement("div");
  fx.className = "spot-fx"; fx.setAttribute("aria-hidden", "true");
  fx.innerHTML = `<i class="spot-halo"></i>${[1, 2, 3, 4, 5, 6].map(n => `<i class="spot-ray r${n}"></i>`).join("")}<p class="spot-hint">아무 곳이나 누르면 돌아가요</p>`;
  document.body.append(fx, btn);

  let on = false, busy = false, parts = [];
  const shells = () => [document.querySelector(".top"), document.getElementById("view"), ...document.querySelectorAll(".fx-bar,.fx-handle,.nudge,.toast")].filter(Boolean);

  // 화면에 보이는 덩어리들: 화면 높이의 40%보다 큰 상자는 안으로 들어가 쪼갠다 (카드 하나하나가 따로 날아가게)
  function pieces() {
    const out = [], H = innerHeight;
    const take = el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > H) return;
      if (r.height > H * .4 && el.children.length) return [...el.children].forEach(take);
      out.push({ el, r });
    };
    shells().forEach(take);
    return out;
  }
  // 로고에서 바깥으로 밀려나 화면 밖으로 날아간 마지막 모양 (카메라가 다가가면 가장자리로 흘러 나가며 커진다)
  function flung({ el, r }, base, k) {
    let ux = r.left + r.width / 2 - innerWidth / 2, uy = r.top + r.height / 2 - innerHeight * LOGO_Y;
    const d = Math.hypot(ux, uy);
    if (d < 24) { const a = k * 2.4; ux = Math.cos(a); uy = Math.sin(a); } else { ux /= d; uy /= d; }   // 한가운데 있는 것은 방향을 돌려 가며
    const L = Math.hypot(innerWidth, innerHeight) * .75;
    return { base, end: `${base} translate(${ux * L}px,${uy * L}px) scale(1.9)`, dist: d };
  }
  // 로고로 빨려 들어가는 느낌: 로고가 확 다가왔다가 조금 물러나 자리 잡는다 (끝값은 CSS html.spot의 scale(1.12)와 같게)
  const rush = () => calm.matches || document.body.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.4)", offset: .45 }, { transform: "scale(1.12)" }],
    { pseudoElement: "::after", duration: 1500, easing: "cubic-bezier(.45,0,.2,1)" });

  async function open() {
    if (on || busy || !isDark()) return;
    on = busy = true;
    btn.setAttribute("aria-pressed", "true"); btn.setAttribute("aria-label", "원래 화면으로");
    root.style.overflow = "hidden";
    parts = pieces().map((p, k) => {
      const t = getComputedStyle(p.el).transform;
      return { ...p, ...flung(p, t === "none" ? "" : t, k) };
    });
    const far = Math.max(1, ...parts.map(p => p.dist));
    parts.forEach(p => {
      // 가운데(로고 가까이)에 있는 것부터 먼저 비켜나고, 점점 빨라지며 커지고 흐려진다
      p.anim = calm.matches
        ? p.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" })
        : p.el.animate([
            { transform: p.base || "none", opacity: 1, filter: "blur(0)" },
            { transform: p.end, opacity: 0, filter: "blur(10px)" }
          ], { duration: 1000, delay: p.dist / far * 160, easing: "cubic-bezier(.55,0,.75,.1)", fill: "forwards" });
    });
    root.classList.add("spot");
    rush();
    await Promise.all(parts.map(p => p.anim.finished.catch(() => {})));
    if (!on) return;
    shells().forEach(s => { s.style.visibility = "hidden"; s.inert = true; });
    busy = false;
    btn.focus();
  }

  function close(instant) {
    if (!on) return;
    on = false; busy = false;
    btn.setAttribute("aria-pressed", "false"); btn.setAttribute("aria-label", "CAPTIMA 로고 비추기");
    root.classList.remove("spot");
    root.style.overflow = "";
    shells().forEach(s => { s.style.visibility = ""; s.inert = false; });
    const far = Math.max(1, ...parts.map(p => p.dist));
    parts.forEach(p => {
      p.anim && p.anim.cancel();
      if (instant || calm.matches || !p.el.isConnected) return;
      // 화면 밖에서 다시 날아 들어와 제자리로 (가장자리 것부터)
      p.el.animate([
        { transform: p.end, opacity: 0, filter: "blur(10px)" },
        { transform: p.base || "none", opacity: 1, filter: "blur(0)" }
      ], { duration: 760, delay: (1 - p.dist / far) * 180, easing: "cubic-bezier(.2,.9,.25,1)", fill: "backwards" });
    });
    parts = [];
  }

  btn.addEventListener("click", () => on ? close() : open());
  fx.addEventListener("click", () => close());
  addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  addEventListener("popstate", () => close(true));
  // 라이트 모드로 바뀌면 바로 원래대로
  const recheck = () => { if (!isDark()) close(true); };
  darkMQ.addEventListener("change", recheck);
  new MutationObserver(recheck).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
}
