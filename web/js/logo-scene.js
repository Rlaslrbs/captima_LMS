// 캡티마로고 기능의 화면 (탐조등 버튼을 눌러 로고로 들어갔을 때만, spotlight.js·glass.css와 함께)
// 로고·탐조등·계절 연출을 모두 네모 칸에 글자로 찍는다. 사실적인 그림이 아니라 블록 게임처럼 칸이 보이는 픽셀 느낌.
// 계절·날씨·행사(크리스마스 등)는 SCENES에 장면을 하나씩 더하고 pick()에서 고른다. 지금은 가을: 단풍잎이 흩날린다.
const root = document.documentElement;
const fx = document.querySelector(".spot-fx");   // spotlight.js가 만든 판 (로고가 없는 테마에서는 없다)
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LOGO_Y = .56, LOGO_SRC = "/img/captima-bg.webp";   // glass.css body::after와 같게
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const rgb = (c, m) => `rgb(${c[0] * m | 0},${c[1] * m | 0},${c[2] * m | 0})`;

// 로고: 어두운 금 → 빛 받은 금 (칸 바탕은 조금 어둡게, 글자는 밝게)
const GOLD = [[70, 44, 14], [120, 78, 22], [176, 118, 32], [226, 164, 52], [252, 204, 96], [255, 236, 170]];
const GOLD_CH = ":+x#%@";
// 탐조등: 아래 여섯 군데에서 올라와 서로 다른 박자로 흔들린다 (x 위치, 두 끝 각도, 한 번 흔들리는 시간, 켜지는 순서)
const RAYS = [[.08, -30, 2, 7, 0], [.24, 20, -14, 5.4, 2], [.4, -12, 18, 8.2, 4], [.6, 14, -18, 6.6, 5], [.76, -18, 20, 5, 3], [.92, 30, -4, 7.6, 1]];
const RAY_BG = ["", "rgba(255,232,196,.07)", "rgba(255,232,196,.14)", "rgba(255,236,204,.24)"];
const RAY_FG = ["", "rgba(255,238,210,.22)", "rgba(255,240,216,.36)", "rgba(255,244,224,.55)"];
const RAY_CH = " .:+";

// 단풍잎 그림 (# 잎, + 잎맥). 작은 것은 멀리 있는 잎
const MAPLE = [
  ["..#..", "#.+.#", "##+##", ".#+#.", "..+.."],
  ["...#...", ".#.+.#.", ".##+##.", "###+###", ".##+##.", "##.+.##", "...+..."],
  [".....#.....", ".....#.....", "..#.#+#.#..", "..##+++##..", "#.###+###.#", "####+++####", ".####+####.", "..###+###..", ".###.+.###.", ".....+.....", ".....+....."]
];
// 단풍 색: 주황 · 호박색 · 노랑 · 갈색 (빨강은 쓰지 않는다)
const FALL = [[238, 124, 30], [246, 162, 40], [250, 198, 62], [188, 96, 34]];

const autumn = {
  make(W, H) {
    const n = clamp(Math.round(W * H / 45000), 12, 34), out = [];
    for (let i = 0; i < n; i++) out.push(this.leaf(W, H, true));
    return out.sort((a, b) => a.d - b.d);   // 작은(먼) 잎부터 그려 큰 잎이 앞에 온다
  },
  leaf(W, H, anywhere, old) {
    const l = old || {}, c = FALL[Math.random() * FALL.length | 0];
    if (!old) l.d = Math.random() ** 1.5;         // 0 멀다 … 1 가깝다 (그리는 순서가 바뀌지 않게 한 번만 정한다)
    const d = l.d, m = .6 + d * .4;
    l.map = MAPLE[d < .4 ? 0 : d < .78 ? 1 : 2];
    l.fall = 24 + d * 44; l.drift = .55 + d * .6;
    l.rot = Math.random() * 6.28; l.spin = (Math.random() - .5) * 1.8;
    l.flip = Math.random() * 6.28; l.flipV = 1.2 + Math.random() * 2.2;
    l.sway = Math.random() * 6.28; l.swayV = .8 + Math.random() * 1.2;
    l.bg = [rgb(c, m * .34), rgb(c, m * .5)]; l.fg = [rgb(c, m * .7), rgb(c, m)]; l.vein = rgb(c, m * .46);
    if (anywhere) { l.x = Math.random() * W; l.y = Math.random() * H; }
    else if (Math.random() < .6) { l.x = Math.random() * W * 1.1 - W * .1; l.y = -80; }   // 위에서
    else { l.x = -80; l.y = Math.random() * H * .8; }                                      // 바람 불어오는 왼쪽에서
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
      if (l.y > H + 80 || l.x > W + 80) this.leaf(W, H, false, l);
    }
  },
  // 잎 그림을 칸에 맞춰 찍는다: 돌고, 팔랑이며 뒤집힐 때 폭이 좁아지고 어두워진다
  draw(g, L, C) {
    for (const l of L) {
      const n = l.map.length, h = n / 2, ca = Math.cos(l.rot), sa = Math.sin(l.rot);
      const f = Math.cos(l.flip), w = Math.max(.18, Math.abs(f)), lit = f < 0 ? 0 : 1;
      const c0 = Math.floor(l.x / C), r0 = Math.floor(l.y / C), e = Math.ceil(h * 1.42);
      for (let j = -e; j <= e; j++) for (let i = -e; i <= e; i++) {
        const u = Math.floor((i * ca + j * sa) / w + h), v = Math.floor(j * ca - i * sa + h);
        if (u < 0 || v < 0 || u >= n || v >= n) continue;
        const p = l.map[v][u];
        if (p === ".") continue;
        const x = (c0 + i) * C, y = (r0 + j) * C;
        g.fillStyle = l.bg[lit]; g.fillRect(x, y, C - 1, C - 1);
        g.fillStyle = p === "+" ? l.vein : l.fg[lit];
        g.fillText(p, x + C / 2, y + C / 2);
      }
    }
  }
};

const SCENES = { autumn };
// 오늘에 맞는 장면. 겨울·봄·여름과 행사는 장면을 만들면 여기에 조건을 더한다
function pick() { const m = new Date().getMonth() + 1; return m >= 9 && m <= 11 ? SCENES.autumn : null; }

if (fx) {
  const cv = document.createElement("canvas");
  cv.className = "spot-scene";
  fx.querySelector(".spot-hint").before(cv);
  const g = cv.getContext("2d");
  const img = new Image();
  // 로고 그림을 읽을 수 있을 때만 CSS 로고·빛기둥을 끄고 글자판으로 바꾼다 (못 읽으면 원래 모습 그대로)
  img.onload = () => root.classList.add("spot-ascii");
  img.src = LOGO_SRC;

  let W = 0, H = 0, C = 10, cols = 0, rows = 0, logo = null, order = null, lit = null;
  let scene = null, items = [], raf = 0, last = 0, acc = 0, t = 0, on = false;

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; C = W < 700 ? 8 : 10;
    cols = Math.ceil(W / C); rows = Math.ceil(H / C);
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = `bold ${C}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    lit = new Uint8Array(cols * rows);
    // 로고 그림을 칸 수만큼 줄여 읽는다 → 칸마다 밝기 단계(0~4)
    const o = document.createElement("canvas"); o.width = cols; o.height = rows;
    const og = o.getContext("2d", { willReadFrequently: true });
    const lw = Math.min(W * .8, 780) * 1.12, lh = lw * img.naturalHeight / img.naturalWidth;
    og.drawImage(img, (W / 2 - lw / 2) / C, (H * LOGO_Y - lh / 2) / C, lw / C, lh / C);
    const px = og.getImageData(0, 0, cols, rows).data;
    const val = i => Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) * px[i * 4 + 3] / 255;
    logo = new Uint8Array(cols * rows); order = new Float32Array(cols * rows);
    let top = 1;
    for (let i = 0; i < logo.length; i++) top = Math.max(top, val(i));
    for (let i = 0; i < logo.length; i++) {
      const k = val(i) / top;
      logo[i] = k > .75 ? 4 : k > .5 ? 3 : k > .28 ? 2 : k > .12 ? 1 : 0;
      order[i] = Math.random();   // 블록이 하나씩 쌓이듯 나타나는 순서
    }
  }

  // 칸마다 탐조등 빛의 세기(0~3)
  function light() {
    lit.fill(0);
    const hw = clamp(W * .055, 40, 80), far = H * 1.5, oy = H * 1.04;
    for (const [bx, a1, a2, d, i] of RAYS) {
      const born = .7 + i * .14;
      if (t < born) continue;
      const a = lerp(a1, a2, .5 - .5 * Math.cos(Math.PI * (t - .7) / d)) * Math.PI / 180;
      const dx = Math.sin(a), dy = -Math.cos(a), ox = bx * W, gain = Math.min(1, (t - born) / .4);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const vx = c * C + C / 2 - ox, vy = r * C + C / 2 - oy;
        const along = vx * dx + vy * dy;
        if (along <= 0) continue;
        const half = 3 + hw * along / far, perp = Math.abs(vx * dy - vy * dx);
        if (perp >= half) continue;
        const z = along / (H * .6), k = (z < 1 ? lerp(.5, .16, z) : Math.max(0, lerp(.16, 0, z - 1))) * (1 - perp / half) * gain;
        const n = k > .22 ? 3 : k > .1 ? 2 : k > .03 ? 1 : 0, j = r * cols + c;
        if (n) lit[j] = Math.min(3, lit[j] + n);
      }
    }
  }

  function paint() {
    g.clearRect(0, 0, W, H);
    light();
    // 빛기둥: 칸 바탕은 전부, 글자는 한 칸 걸러 (바둑판)
    for (let n = 1; n <= 3; n++) {
      g.fillStyle = RAY_BG[n];
      for (let j = 0; j < lit.length; j++) if (lit[j] === n && !logo[j]) g.fillRect(j % cols * C, (j / cols | 0) * C, C - 1, C - 1);
      g.fillStyle = RAY_FG[n];
      for (let j = 0; j < lit.length; j++) {
        const c = j % cols, r = j / cols | 0;
        if (lit[j] === n && !logo[j] && (c + r) & 1) g.fillText(RAY_CH[n], c * C + C / 2, r * C + C / 2);
      }
    }
    // 로고: 블록이 하나씩 놓이며 나타나고, 빛이 지나가는 칸은 더 밝다
    const shown = clamp((t - .45) / 1.3, 0, 1);
    for (let k = 0; k < 6; k++) {
      const bg = rgb(GOLD[k], .5), fg = rgb(GOLD[k], 1), ch = GOLD_CH[k];
      for (let j = 0; j < logo.length; j++) {
        if (!logo[j] || order[j] > shown || Math.min(5, logo[j] - 1 + Math.min(2, lit[j])) !== k) continue;
        const x = j % cols * C, y = (j / cols | 0) * C;
        g.fillStyle = bg; g.fillRect(x, y, C - 1, C - 1);
        g.fillStyle = fg; g.fillText(ch, x + C / 2, y + C / 2);
      }
    }
    if (scene) scene.draw(g, items, C);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
    if (acc < 1 / 24 || document.hidden) return;   // 블록 느낌이라 초당 24장이면 충분하다
    t += acc; if (scene) scene.step(items, acc, t, W, H); acc = 0;
    paint();
  }
  function start() {
    if (raf || !root.classList.contains("spot-ascii")) return;
    scene = pick(); size(); items = scene ? scene.make(W, H) : [];
    if (still.matches) { t = 9; paint(); return; }   // 움직임 줄이기: 다 켜진 한 장만
    t = 0; acc = 0; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() {
    setTimeout(() => { if (!on) { cancelAnimationFrame(raf); raf = 0; items = []; g.clearRect(0, 0, W, H); } }, 700);   // 판이 사라진 뒤에 멈추고 지운다
  }
  new MutationObserver(() => {
    const now = root.classList.contains("spot");
    if (now === on) return;
    on = now; on ? start() : stop();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", () => { if (on && logo) { size(); items = scene ? scene.make(W, H) : []; paint(); } });
}
