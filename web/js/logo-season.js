// 캡티마로고 기능의 계절 연출 (탐조등 버튼을 눌러 로고로 들어갔을 때만, spotlight.js·glass.css와 함께)
// 계절·날씨·행사(크리스마스 등)를 ASCII 글자로 로고 둘레에 그린다. 장면은 SCENES에 하나씩 더하고 pick()에서 고른다.
// 지금은 가을: 빨강·주황 낙엽이 바람에 흩날리며 로고 둘레를 감아 돈다.
const root = document.documentElement;
const fx = document.querySelector(".spot-fx");   // spotlight.js가 만든 판 (로고가 없는 테마에서는 없다)
const still = matchMedia("(prefers-reduced-motion: reduce)");
const CW = 7, CH = 12, FONT = "bold 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const LOGO_Y = .56;   // spotlight.js와 같게
const RAMP = ".:;~+*x%#@";
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// 가을 낙엽 색: 진한 빨강 → 주홍 → 주황 → 호박색
const FALL = [[176, 34, 24], [214, 58, 28], [236, 104, 26], [244, 150, 36]];

const autumn = {
  make(W, H) {
    const n = clamp(Math.round(W * H / 26000), 18, 54), out = [];
    for (let i = 0; i < n; i++) out.push(this.leaf(W, H, true));
    return out.sort((a, b) => a.len - b.len);   // 작은(먼) 잎부터 그려 큰 잎이 앞에 온다
  },
  leaf(W, H, anywhere, old) {
    const d = Math.random() ** 1.6, c = FALL[Math.random() * FALL.length | 0], l = old || {};
    l.len = 7 + d * 24;                           // 잎 반길이(px). 클수록 가깝다
    l.fall = 26 + d * 46; l.drift = .55 + d * .6;
    l.rot = Math.random() * 6.28; l.spin = (Math.random() - .5) * 2.4;
    l.flip = Math.random() * 6.28; l.flipV = 1.4 + Math.random() * 2.6;
    l.sway = Math.random() * 6.28; l.swayV = .8 + Math.random() * 1.2;
    l.cols = [0, 1, 2, 3, 4, 5].map(k => { const m = (.34 + k * .13) * (.6 + d * .4); return `rgb(${c[0] * m | 0},${c[1] * m | 0},${c[2] * m | 0})`; });
    if (anywhere) { l.x = Math.random() * W; l.y = Math.random() * H; }
    else if (Math.random() < .6) { l.x = Math.random() * W * 1.1 - W * .1; l.y = -l.len - 10; }   // 위에서
    else { l.x = -l.len - 10; l.y = Math.random() * H * .8; }                                      // 바람 불어오는 왼쪽에서
    return l;
  },
  step(L, dt, t, W, H) {
    const gust = 34 + 26 * Math.sin(t * .31) + 18 * Math.sin(t * .83 + 1.7);   // 바람이 세졌다 약해졌다
    const cx = W / 2, cy = H * LOGO_Y, R = Math.min(W, H) * .34;
    for (const l of L) {
      l.sway += l.swayV * dt; l.rot += l.spin * dt; l.flip += l.flipV * dt;
      // 로고 가까이에서는 바람이 로고를 감아 돈다 (소용돌이)
      const dx = l.x - cx, dy = l.y - cy, k = Math.exp(-(dx * dx + dy * dy) / (R * R)) * 58 / R;
      l.x += (gust * l.drift + Math.sin(l.sway) * 22 - dy * k) * dt;
      l.y += (l.fall + Math.cos(l.sway * 1.3) * 12 + dx * k) * dt;
      if (l.y > H + l.len + 12 || l.x > W + l.len + 12) this.leaf(W, H, false, l);
    }
  },
  // 잎 하나를 글자 격자에 찍는다: 양끝이 뾰족한 잎 모양, 팔랑이며 뒤집힐 때 폭이 좁아지고 어두워진다
  draw(g, L) {
    for (const l of L) {
      const ca = Math.cos(l.rot), sa = Math.sin(l.rot), f = Math.cos(l.flip), w = Math.max(.14, Math.abs(f));
      const c0 = Math.floor((l.x - l.len) / CW), c1 = Math.ceil((l.x + l.len) / CW);
      const r0 = Math.floor((l.y - l.len) / CH), r1 = Math.ceil((l.y + l.len) / CH);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const px = c * CW + CW / 2 - l.x, py = r * CH + CH / 2 - l.y;
        const u = (px * ca + py * sa) / l.len, v = (py * ca - px * sa) / l.len / w;
        if (u < -1 || u > 1) continue;
        const h = .46 * (1 - u * u) ** .7 * (1 + .28 * u), e = Math.abs(v) / h;
        if (!(e < 1)) continue;
        let k = (.5 + .5 * w) * (1 - .4 * e) * (f < 0 ? .78 : 1);
        if (Math.abs(v) < .07) k *= .62;          // 잎맥
        g.fillStyle = l.cols[clamp(k * 6 | 0, 0, 5)];
        g.fillText(RAMP[clamp((k * 1.15 - e * .25) * RAMP.length | 0, 0, RAMP.length - 1)], c * CW + CW / 2, r * CH + CH / 2);
      }
    }
  }
};

const SCENES = { autumn };
// 오늘에 맞는 장면. 겨울·봄·여름과 행사는 장면을 만들면 여기에 조건을 더한다
function pick() { const m = new Date().getMonth() + 1; return m >= 9 && m <= 11 ? SCENES.autumn : null; }

if (fx) {
  const cv = document.createElement("canvas");
  cv.className = "spot-season";
  fx.querySelector(".spot-hint").before(cv);
  const g = cv.getContext("2d");
  let W = 0, H = 0, scene = null, items = [], raf = 0, last = 0, acc = 0, t = 0;

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = FONT; g.textAlign = "center"; g.textBaseline = "middle";
  }
  function paint() { g.clearRect(0, 0, W, H); scene.draw(g, items); }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
    if (acc < 1 / 30 || document.hidden) return;   // 초당 30장이면 충분하다
    t += acc; scene.step(items, acc, t, W, H); acc = 0;
    paint();
  }
  function start() {
    scene = pick();
    if (!scene || raf) return;
    size(); items = scene.make(W, H); paint();
    if (!still.matches) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() {
    cancelAnimationFrame(raf); raf = 0; items = [];
    setTimeout(() => { if (!raf) g.clearRect(0, 0, W, H); }, 700);   // 판이 사라진 뒤에 지운다
  }
  let on = false;
  new MutationObserver(() => {
    const now = root.classList.contains("spot");
    if (now === on) return;
    on = now; on ? start() : stop();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", () => { if (on && scene) { size(); items = scene.make(W, H); paint(); } });
}
