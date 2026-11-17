// 캡티마로고 기능의 글자 장면 본체. 탐조등 화면(logo-scene.js)과 첫 소개 화면(onboarding-showcase.js)이 mountScene()으로 붙여 쓴다
// 로고·탐조등·계절 연출을 모두 촘촘한 글자만으로 그린다 (바탕 칸 없이). 글자는 과목의 개념 태그 이름을 이어 쓴 것이다.
// 손가락·마우스로 만질 수 있다: 휙 휘저으면 그 바람에 잎이 날아가고 로고 글자가 흩어졌다 돌아오며, 탐조등이 손을 따라온다.
// 계절·날씨·행사(크리스마스 등)는 SCENES에 장면을 하나씩 더하고 pick()에서 고른다. 지금은 가을: 단풍잎이 흩날린다.
const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LOGO_Y = .56, LOGO_SRC = "/img/captima-bg.webp";   // glass.css body::after와 같게
const C = 6, FONT = "600 6px Pretendard,system-ui,sans-serif";   // 한글이 정사각형이라 칸도 정사각형
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const rgb = (c, m) => `rgb(${Math.min(255, c[0] * m) | 0},${Math.min(255, c[1] * m) | 0},${Math.min(255, c[2] * m) | 0})`;
const hash = n => { const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return s - Math.floor(s); };

// 글자로 쓸 개념 태그 이름들 (서버가 못 주면 로고 이름으로)
let WORDS = ["CAPTIMA"], asked = false;
function loadWords() {
  if (asked) return;
  asked = true;
  fetch("/api/concept-words").then(r => r.ok ? r.json() : null).then(d => { if (d && d.words && d.words.length) WORDS = d.words; }).catch(() => {});
}
// 낱말을 섞어 한 줄로 이은 글 (띄어쓰기 대신 가운뎃점)
function stream(n) {
  const w = WORDS.slice().sort(() => Math.random() - .5);
  let s = "";
  for (let i = 0; s.length < n; i++) s += w[i % w.length].replace(/\s+/g, "") + "·";
  return s;
}

// 로고: 어두운 금 → 빛 받은 금
const GOLD = [[92, 58, 18], [142, 92, 26], [196, 134, 38], [236, 176, 60], [255, 212, 104], [255, 240, 178]];
// 탐조등: 아래 여섯 군데에서 올라와 서로 다른 박자로 흔들린다 (x 위치, 두 끝 각도, 한 번 흔들리는 시간, 켜지는 순서)
const RAYS = [[.08, -30, 2, 7, 0], [.24, 20, -14, 5.4, 2], [.4, -12, 18, 8.2, 4], [.6, 14, -18, 6.6, 5], [.76, -18, 20, 5, 3], [.92, 30, -4, 7.6, 1]];
const RAY_FG = ["", "rgba(255,236,206,.2)", "rgba(255,240,214,.4)", "rgba(255,246,228,.72)"];
const STAR = ".·,:+*";

// 단풍잎 본 (# 잎, + 잎맥). 이 본을 잎 크기만큼 늘려 그 안을 글자로 채운다
const MAPLE = [".....#.....", ".....#.....", "..#.#+#.#..", "..##+++##..", "#.###+###.#", "####+++####", ".####+####.", "..###+###..", ".###.+.###.", ".....+.....", ".....+....."];
// 단풍 색: 주황 · 호박색 · 노랑 · 갈색 (빨강은 쓰지 않는다)
const FALL = [[238, 124, 30], [246, 162, 40], [250, 198, 62], [188, 96, 34]];

const autumn = {
  make(W, H) {
    const n = clamp(Math.round(W * H / 42000), 12, 36), out = [];
    for (let i = 0; i < n; i++) out.push(this.leaf(W, H, true));
    return out.sort((a, b) => a.d - b.d);   // 작은(먼) 잎부터 그려 큰 잎이 앞에 온다
  },
  leaf(W, H, anywhere, old) {
    const l = old || { d: Math.random() ** 1.5, px: 0, py: 0 };   // d: 0 멀다 … 1 가깝다
    const d = l.d, c = FALL[Math.random() * FALL.length | 0];
    l.word = stream(40);                          // 잎마다 개념 이름 몇 개를 싣고 다닌다
    l.s = 3 + d * 5.5;                            // 본의 한 점이 화면에서 차지하는 크기(px)
    l.fall = 24 + d * 44; l.drift = .55 + d * .6;
    l.rot = Math.random() * 6.28; l.spin = (Math.random() - .5) * 1.8;
    l.flip = Math.random() * 6.28; l.flipV = 1.2 + Math.random() * 2.2;
    l.sway = Math.random() * 6.28; l.swayV = .8 + Math.random() * 1.2;
    // 색: [뒷면, 앞면] × [어둡게, 보통, 밝게] + 잎맥
    l.cols = [.42, .56, .7, .72, .9, 1.12].map(m => rgb(c, m * (.62 + d * .38))); l.vein = rgb(c, .4 * (.62 + d * .38));
    if (anywhere) { l.x = Math.random() * W; l.y = Math.random() * H; }
    else if (Math.random() < .6) { l.x = Math.random() * W * 1.1 - W * .1; l.y = -70; }   // 위에서
    else { l.x = -70; l.y = Math.random() * H * .8; }                                      // 바람 불어오는 왼쪽에서
    return l;
  },
  step(L, dt, t, W, H) {
    const gust = 34 + 26 * Math.sin(t * .31) + 18 * Math.sin(t * .83 + 1.7);   // 바람이 세졌다 약해졌다
    const cx = W / 2, cy = H * LOGO_Y, R = Math.min(W, H) * .34;
    for (const l of L) {
      l.sway += l.swayV * dt; l.rot += l.spin * dt; l.flip += l.flipV * dt;
      const damp = 1 - Math.min(1, dt * 1.3); l.px *= damp; l.py *= damp;   // 손바람은 천천히 잦아든다
      l.spin = clamp(l.spin, -9, 9) * (1 - dt * .3);
      // 로고 가까이에서는 바람이 로고를 감아 돈다 (소용돌이)
      const dx = l.x - cx, dy = l.y - cy, k = Math.exp(-(dx * dx + dy * dy) / (R * R)) * 58 / R;
      l.x += (gust * l.drift + Math.sin(l.sway) * 22 - dy * k + l.px) * dt;
      l.y += (l.fall + Math.cos(l.sway * 1.3) * 12 + dx * k + l.py) * dt;
      if (l.y > H + 70 || l.x > W + 70 || l.x < -160 || l.y < -160) { l.px = l.py = 0; this.leaf(W, H, false, l); }
    }
  },
  // 손이 (vx, vy) 빠르기로 (x, y)를 지나갔다: 가까운 잎이 그 바람을 타고 날아간다
  swipe(L, x, y, vx, vy) {
    for (const l of L) {
      const e = Math.hypot(l.x - x, l.y - y);
      if (e > 190) continue;
      const k = (1 - e / 190) * (1.15 - l.d * .45);   // 작은 잎이 더 가볍다
      l.px = clamp(l.px + vx * k * .6, -1700, 1700); l.py = clamp(l.py + vy * k * .6, -1700, 1700);
      l.spin += (Math.random() - .5) * 8 * k; l.flipV = 3 + Math.random() * 4;
    }
  },
  // 누른 자리에서 바람이 터져 잎이 사방으로 날린다
  burst(L, x, y) {
    for (const l of L) {
      const ex = l.x - x, ey = l.y - y, e = Math.hypot(ex, ey) || 1;
      if (e < 320) { const k = (1 - e / 320) * 620; l.px += ex / e * k; l.py += ey / e * k; l.spin += (Math.random() - .5) * 10; }
    }
  },
  // 잎 본을 돌리고 뒤집어 화면 글자 줄에 맞춰 찍는다. 뒤집힐 때 폭이 좁아지고 어두워진다
  draw(g, L) {
    for (const l of L) {
      const ca = Math.cos(l.rot), sa = Math.sin(l.rot), f = Math.cos(l.flip), w = Math.max(.16, Math.abs(f)), face = f < 0 ? 0 : 3;
      const ext = 5.5 * l.s * 1.42, c0 = Math.floor((l.x - ext) / C), c1 = Math.ceil((l.x + ext) / C), r0 = Math.floor((l.y - ext) / C), r1 = Math.ceil((l.y + ext) / C);
      let n = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const qx = c * C + C / 2 - l.x, qy = r * C + C / 2 - l.y;
        const u = Math.floor((qx * ca + qy * sa) / (l.s * w) + 5.5), v = Math.floor((qy * ca - qx * sa) / l.s + 5.5);
        if (u < 0 || v < 0 || u > 10 || v > 10) continue;
        const p = MAPLE[v][u];
        if (p === ".") continue;
        g.fillStyle = p === "+" ? l.vein : l.cols[face + (hash(u * 7 + v * 13) * 3 | 0)];
        g.fillText(l.word[n++ % l.word.length], c * C + C / 2, r * C + C / 2);   // 줄을 따라 낱말이 이어진다
      }
    }
  }
};

const SCENES = { autumn };
// 오늘에 맞는 장면. 겨울·봄·여름과 행사는 장면을 만들면 여기에 조건을 더한다
function pick() { const m = new Date().getMonth() + 1; return m >= 9 && m <= 11 ? SCENES.autumn : null; }

/** host 안에 글자 장면 캔버스를 붙이고 { start, stop, destroy }를 돌려준다.
 *  opts: before(이 요소 앞에 붙인다), burst(누르면 바람), dim(로고 밝기 0~1), ready(로고 그림을 읽었을 때 부른다), auto(읽자마자 시작) */
export function mountScene(host, opts = {}) {
  loadWords();
  const cv = document.createElement("canvas");
  cv.className = "spot-scene";
  opts.before ? opts.before.before(cv) : host.append(cv);
  const g = cv.getContext("2d");
  const img = new Image();
  let ready = false;
  // 로고 그림을 읽을 수 있을 때만 쓴다 (못 읽으면 부른 쪽이 원래 모습 그대로 둔다)
  img.onload = () => { ready = true; if (opts.ready) opts.ready(); if (opts.auto) start(); };
  img.src = LOGO_SRC;

  let W = 0, H = 0, cols = 0, rows = 0, dust = "", lit = null, parts = [], stars = [];
  let scene = null, items = [], raf = 0, last = 0, acc = 0, t = 0, on = false;
  const ptr = { x: 0, y: 0, at: 0, aim: 0 };

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; cols = Math.ceil(W / C); rows = Math.ceil(H / C);
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = FONT; g.textAlign = "center"; g.textBaseline = "middle";
    lit = new Uint8Array(cols * rows);
    // 빛이 닿아야 보이는 먼지 글자: 개념 이름이 줄줄이 적혀 있고, 군데군데 비어 있다
    const text = stream(cols * rows);
    let d = "";
    for (let j = 0; j < cols * rows; j++) d += hash(j * 1.37) < .42 ? text[j] : " ";
    dust = d;
    // 빛이 없어도 늘 보이는 먼 점들 (밤하늘)
    stars = [];
    for (let n = Math.round(cols * rows / 90); n--;) stars.push({ x: (Math.random() * cols | 0) * C + C / 2, y: (Math.random() * rows | 0) * C + C / 2, ch: STAR[Math.random() * STAR.length | 0], a: .12 + Math.random() ** 3 * .5, v: .4 + Math.random() * 1.6, p: Math.random() * 6.28 });
    // 로고 그림을 글자 줄 수만큼 줄여 읽어, 밝은 자리마다 글자를 하나씩 이어 적는다
    const o = document.createElement("canvas"); o.width = cols; o.height = rows;
    const og = o.getContext("2d", { willReadFrequently: true });
    const lw = Math.min(W * .8, 780) * 1.12, lh = lw * img.naturalHeight / img.naturalWidth;
    og.drawImage(img, (W / 2 - lw / 2) / C, (H * LOGO_Y - lh / 2) / C, lw / C, lh / C);
    const px = og.getImageData(0, 0, cols, rows).data;
    const val = i => Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) * px[i * 4 + 3] / 255;
    let top = 1;
    for (let i = 0; i < cols * rows; i++) top = Math.max(top, val(i));
    parts = [];
    for (let i = 0; i < cols * rows; i++) {
      const k = val(i) / top;
      if (k < .1) continue;
      parts.push({ j: i, hx: i % cols * C + C / 2, hy: (i / cols | 0) * C + C / 2, ox: 0, oy: 0, vx: 0, vy: 0,
        lv: k > .75 ? 3 : k > .5 ? 2 : k > .28 ? 1 : 0, ch: text[parts.length], tone: Math.random() * 3 | 0, ord: Math.random() });
    }
  }

  // 글자 자리마다 탐조등 빛의 세기(0~3). 손이 있으면 빛기둥이 손 쪽을 향한다
  function light() {
    lit.fill(0);
    const hw = clamp(W * .055, 40, 80), far = H * 1.5, oy = H * 1.04;
    for (const [bx, a1, a2, d, i] of RAYS) {
      const born = .7 + i * .14;
      if (t < born) continue;
      const ox = bx * W;
      let a = lerp(a1, a2, .5 - .5 * Math.cos(Math.PI * (t - .7) / d)) * Math.PI / 180;
      if (ptr.aim > .01) a = lerp(a, clamp(Math.atan2(ptr.x - ox, oy - ptr.y), -1.15, 1.15), ptr.aim * .9);
      const dx = Math.sin(a), dy = -Math.cos(a), gain = Math.min(1, (t - born) / .4);
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

  // 로고 글자: 밀려났다가 제자리로 튕겨 돌아온다
  function logoStep(dt) {
    const damp = 1 - Math.min(1, dt * 4.2);
    for (const p of parts) {
      if (!p.ox && !p.oy && !p.vx && !p.vy) continue;
      p.vx = (p.vx - p.ox * 34 * dt) * damp; p.vy = (p.vy - p.oy * 34 * dt) * damp;
      p.ox += p.vx * dt; p.oy += p.vy * dt;
      if (Math.abs(p.ox) + Math.abs(p.oy) + Math.abs(p.vx) + Math.abs(p.vy) < .05) p.ox = p.oy = p.vx = p.vy = 0;
    }
    for (let n = Math.min(20, parts.length); n--;) parts[Math.random() * parts.length | 0].tone = Math.random() * 3 | 0;   // 반짝임
  }
  // 손이 지나간 바람: 잎은 멀리 날아가고, 로고 글자는 조금 흩어진다
  function swipe(x, y, vx, vy) {
    for (const p of parts) {
      const ex = p.hx + p.ox - x, ey = p.hy + p.oy - y, e2 = ex * ex + ey * ey;
      if (e2 < 10000) { const k = (1 - Math.sqrt(e2) / 100) * .32; p.vx += vx * k + ex * k * 3; p.vy += vy * k + ey * k * 3; }
    }
    if (scene && scene.swipe) scene.swipe(items, x, y, vx, vy);
  }
  function burst(x, y) {
    for (const p of parts) {
      const ex = p.hx - x, ey = p.hy - y, e = Math.hypot(ex, ey) || 1;
      if (e < 260) { const k = (1 - e / 260) * 520; p.vx += ex / e * k; p.vy += ey / e * k; }
    }
    if (scene && scene.burst) scene.burst(items, x, y);
  }

  const GOLD_FG = GOLD.map(c => [.78, 1, 1.22].map(m => rgb(c, m)));
  function paint() {
    g.clearRect(0, 0, W, H);
    light();
    // 먼 점들: 저마다 다른 박자로 깜빡인다
    for (const s of stars) { g.fillStyle = `rgba(255,238,214,${(s.a * (.65 + .35 * Math.sin(t * s.v + s.p))).toFixed(2)})`; g.fillText(s.ch, s.x, s.y); }
    // 빛기둥: 빛이 닿은 먼지 글자만 보인다
    for (let n = 1; n <= 3; n++) {
      g.fillStyle = RAY_FG[n];
      for (let j = 0; j < lit.length; j++) if (lit[j] === n && dust[j] !== " ") g.fillText(dust[j], j % cols * C + C / 2, (j / cols | 0) * C + C / 2);
    }
    // 로고: 글자가 하나씩 켜지며 나타나고, 빛이 지나가는 글자는 더 밝다
    const shown = clamp((t - .45) / 1.3, 0, 1);
    g.globalAlpha = opts.dim == null ? 1 : opts.dim;
    for (const p of parts) {
      if (p.ord > shown) continue;
      g.fillStyle = GOLD_FG[Math.min(5, p.lv + Math.min(2, lit[p.j]) + (p.lv ? 1 : 0))][p.tone];
      g.fillText(p.ch, p.hx + p.ox, p.hy + p.oy);
    }
    g.globalAlpha = 1;
    if (scene) scene.draw(g, items);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
    if (acc < 1 / 30 || document.hidden) return;
    t += acc;
    ptr.aim += ((performance.now() - ptr.at < 2500 ? 1 : 0) - ptr.aim) * Math.min(1, acc * 3);   // 손을 떼고 조금 지나면 탐조등이 원래대로
    logoStep(acc);
    if (scene) scene.step(items, acc, t, W, H);
    acc = 0;
    paint();
  }
  function start() {
    on = true;
    if (raf || !ready) return;
    scene = pick(); size(); items = scene ? scene.make(W, H) : [];
    ptr.at = 0; ptr.aim = 0;
    if (still.matches) { t = 9; paint(); return; }   // 움직임 줄이기: 다 켜진 한 장만
    t = 0; acc = 0; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() {
    on = false;
    setTimeout(() => { if (!on) { cancelAnimationFrame(raf); raf = 0; items = []; parts = []; g.clearRect(0, 0, W, H); } }, 700);   // 판이 사라진 뒤에 멈추고 지운다
  }
  const onResize = () => { if (on && raf) { size(); items = scene ? scene.make(W, H) : []; } };
  addEventListener("resize", onResize);

  // 만지기: 누르지 않아도, 휙 휘저으면 그 빠르기만큼 바람이 인다. 위에 다른 화면이 있어도 끊기지 않게 창 전체에서 듣는다
  const onMove = e => {
    if (!raf) return;
    const now = performance.now(), dt = (now - ptr.at) / 1000;
    if (dt > 0 && dt < .12) {
      const vx = clamp((e.clientX - ptr.x) / dt, -2600, 2600), vy = clamp((e.clientY - ptr.y) / dt, -2600, 2600);
      if (vx * vx + vy * vy > 150 * 150) swipe(e.clientX, e.clientY, vx, vy);
    }
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.at = now;
  };
  addEventListener("pointermove", onMove, { passive: true });
  if (opts.burst) host.addEventListener("pointerdown", e => { if (raf) burst(e.clientX, e.clientY); });

  return {
    start, stop,
    destroy() { on = false; cancelAnimationFrame(raf); raf = 0; removeEventListener("resize", onResize); removeEventListener("pointermove", onMove); cv.remove(); }
  };
}
