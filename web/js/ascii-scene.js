// 뒷배경 ASCII 장면: 글자 격자를 화면 가득 깔고, 그 격자 위에 입체 개구리와 나비를 그린다.
// 칸마다 광선을 쏴서(타원체·날개 평면과 만나는 점) 빛·색을 구하고, 밝기에 맞는 글자를 색칠해 찍는다.
// 캔버스 두 장: bg(글자 바탕, 크기·테마가 바뀔 때만 다시 그림) + fg(동물, 1초에 30번).
const CW = 4, CH = 7;                                  // 글자 한 칸 크기(px). 작을수록 빼곡하다
const FONT = "bold 7px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const RAMP = ":;~=+*xoa#%@";                           // 옅은 것 → 진한 것 (동물 몸)
const BGCH = ".,:;'`-~+=*/\\|<>^x#%&$@?!()[]";
const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

const mk = cls => { const c = document.createElement("canvas"); c.className = "ascii-cv " + cls; c.setAttribute("aria-hidden", "true"); document.body.append(c); return c; };
const bg = mk("ascii-bg"), fg = mk("ascii-fg");
const bx = bg.getContext("2d"), fx = fg.getContext("2d");
let W = 0, H = 0, dark = false, paper = "", ink = "", small = false;

// ───────── 바탕 ─────────
const hex = h => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
function theme() {
  const cs = getComputedStyle(root), p = cs.getPropertyValue("--paper").trim() || "#f5f5f7", i = cs.getPropertyValue("--ink").trim() || "#1d1d1f";
  if (p === paper && i === ink) return false;
  paper = p; ink = i; const [r, g, b] = hex(p); dark = r * .3 + g * .59 + b * .11 < 100; return true;
}
function drawBg() {
  bx.clearRect(0, 0, W, H); bx.fillStyle = ink;
  let s = 20260116; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;   // 씨앗 고정: 크기를 바꿔도 무늬가 그대로
  for (let y = 0; y < H; y += CH) for (let x = 0; x < W; x += CW) {
    bx.globalAlpha = .25 + .75 * rnd(); bx.fillText(BGCH[rnd() * BGCH.length | 0], x, y);
  }
  bx.globalAlpha = 1;
}
function resize() {
  const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; small = W < 560;
  for (const [c, x] of [[bg, bx], [fg, fx]]) { c.width = W * d; c.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); x.font = FONT; x.textBaseline = "top"; }
  theme(); drawBg();
}

// ───────── 수학 ─────────
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mm = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o; };
const tr = (M, x, y, z) => [M[0] * x + M[3] * y + M[6] * z, M[1] * x + M[4] * y + M[7] * z, M[2] * x + M[5] * y + M[8] * z];   // 카메라 → 몸 좌표 (Mᵀ·v)
const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const l3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const LIGHT = (() => { const v = [-.45, .8, .55], n = Math.hypot(...v); return v.map(c => c / n); })();   // 왼쪽 위 앞에서 오는 빛 (카메라 기준)
const CAM = .38;                                       // 살짝 위에서 내려다본다

// 한 칸 찍기: 칸을 바탕색으로 덮고(뒤 글자를 가림) 색 글자를 올린다
function put(x, y, r, g, b) {
  const k = clamp(r * .3 + g * .59 + b * .11, 0, 1);
  const ch = RAMP[Math.round((dark ? .15 + .85 * k : 1 - .8 * k) * (RAMP.length - 1))];
  const m = dark ? 255 : 215;                          // 밝은 바탕에서는 조금 눌러야 또렷하다
  fx.fillStyle = paper; fx.fillRect(x, y, CW, CH);
  fx.fillStyle = `rgb(${clamp(r, 0, 1) * m | 0},${clamp(g, 0, 1) * m | 0},${clamp(b, 0, 1) * m | 0})`; fx.fillText(ch, x, y);
}
// 몸 하나 그리기: 화면의 (cx,cy)에, 1단위 = S px, 방향 M. hit(o,d,L,Hv)가 [r,g,b]나 null을 돌려준다
function render(cx, cy, S, M, ex, ey, hit) {
  const d = [-M[6], -M[7], -M[8]], L = tr(M, ...LIGHT);
  const hv = [L[0] - d[0], L[1] - d[1], L[2] - d[2]], hn = Math.hypot(...hv), Hv = hv.map(c => c / hn);
  const x0 = Math.max(0, Math.floor((cx - ex * S) / CW)), x1 = Math.min(Math.ceil(W / CW), Math.ceil((cx + ex * S) / CW));
  const y0 = Math.max(0, Math.floor((cy - ey * S) / CH)), y1 = Math.min(Math.ceil(H / CH), Math.ceil((cy + ey * S) / CH));
  for (let iy = y0; iy < y1; iy++) for (let ix = x0; ix < x1; ix++) {
    const c = hit(tr(M, (ix * CW + CW / 2 - cx) / S, -(iy * CH + CH / 2 - cy) / S, 10), d, L, Hv);
    if (c) put(ix * CW, iy * CH, c[0], c[1], c[2]);
  }
}
// 광선과 타원체: 만나는 거리 t (없으면 -1). 법선은 N에 담는다
const N = [0, 0, 0], P = [0, 0, 0];
function ell(o, d, q) {
  const ox = (o[0] - q[0]) / q[3], oy = (o[1] - q[1]) / q[4], oz = (o[2] - q[2]) / q[5], dx = d[0] / q[3], dy = d[1] / q[4], dz = d[2] / q[5];
  const a = dx * dx + dy * dy + dz * dz, b = ox * dx + oy * dy + oz * dz, di = b * b - a * (ox * ox + oy * oy + oz * oz - 1);
  return di < 0 ? -1 : (-b - Math.sqrt(di)) / a;
}
function nrm(o, d, q, t) {
  for (let i = 0; i < 3; i++) { P[i] = o[i] + d[i] * t; N[i] = (P[i] - q[i]) / (q[3 + i] * q[3 + i]); }
  const n = Math.hypot(N[0], N[1], N[2]); N[0] /= n; N[1] /= n; N[2] /= n;
}

// ───────── 개구리 ─────────
// 몸 좌표: x 오른쪽, y 위, z 앞. 타원체 여러 개(몸통·머리·눈)와 공을 이어 만든 다리.
const frog = { x: 0, dir: 1, yaw: 1.1, st: "idle", t: 0, wait: 1.5, x0: 0, x1: 0, blink: 3, life: 0 };
const HOP = .62;                                       // 공중에 떠 있는 시간(초)
function frogStep(dt, S) {
  const f = frog; f.t += dt; f.life += dt; f.blink -= dt; if (f.blink < -.14) f.blink = 2.5 + Math.random() * 4;
  f.yaw += (f.dir * 1.1 - f.yaw) * Math.min(1, dt * 7);                  // 가는 쪽으로 몸을 돌린다
  if (f.st === "idle" && f.t > f.wait) {
    const far = S * (1.7 + Math.random() * 1.1) * f.dir;
    if (f.x + far < S * 1.6 || f.x + far > W - S * 1.6) { f.dir = -f.dir; f.t = 0; f.wait = .7 + Math.random(); }   // 벽 앞이면 돌아서고 잠깐 쉰다
    else { f.st = "crouch"; f.t = 0; f.x0 = f.x; f.x1 = f.x + far; }
  } else if (f.st === "crouch" && f.t > .2) { f.st = "air"; f.t = 0; }
  else if (f.st === "air") { f.x = lerp(f.x0, f.x1, Math.min(1, f.t / HOP)); if (f.t > HOP) { f.st = "land"; f.t = 0; } }
  else if (f.st === "land" && f.t > .26) { f.st = "idle"; f.t = 0; f.wait = 1.2 + Math.random() * 3; }
}
function frogDraw(S) {
  const f = frog, u = f.st === "air" ? f.t / HOP : 0;
  // 자세 값: e 뒷다리 뻗음, a 앞다리 뻗음, up 높이, sq 눌림, pitch 고개 듦
  let e = 0, a = 0, up = 0, sq = 0, pitch = .26;
  if (f.st === "crouch") { sq = sm(f.t / .2) * .16; pitch = .26 + .1 * sm(f.t / .2); }
  else if (f.st === "air") { e = sm(u / .18) * (1 - sm((u - .55) / .4)); a = sm(u / .3) * (1 - sm((u - .7) / .3)) ; up = 4 * 1.05 * u * (1 - u); pitch = .1 + .5 * Math.cos(Math.PI * u); sq = -.1 * e; }
  else if (f.st === "land") { const k = 1 - sm(f.t / .26); sq = .2 * k; pitch = lerp(.26, -.3, k); }
  const br = 1 + .025 * Math.sin(f.life * 2.6), th = 1 + .16 * Math.max(0, Math.sin(f.life * 7));   // 숨, 목 울림
  const by = -sq * .35, hy = 1 - sq, pr = [];
  pr.push([0, by, 0, .5 * br, .4 * hy * br, .72, 0], [0, by - .07, -.42, .46, .33 * hy, .42, 0],        // 몸통, 엉덩이
    [0, by + .17, .6, .44, .29 * hy, .4, 0], [0, by - .05, .62, .3 * th, .2 * th, .28, 3]);              // 머리, 목(연한 색)
  for (const s of [-1, 1]) {
    pr.push([s * .27, by + .4, .7, .155, .155, .155, f.blink < 0 ? 0 : 1, s * .55, .25, .8]);              // 눈 (마지막 셋: 눈동자 방향)
    const hip = [s * .36, by - .12, -.5];
    const K = l3([s * .74, -.04, .02], [s * .46, -.12, -1], e), A = l3([s * .6, -.36, -.55], [s * .36, -.2, -1.6], e), T = l3([s * .74, -.42, -.02], [s * .3, -.26, -2.05], e);
    seg(pr, hip, K, .2, .15, 4, 0); seg(pr, K, A, .14, .09, 4, 0); seg(pr, A, T, .08, .055, 4, 2);       // 허벅지, 정강이, 발
    const sh = [s * .36, by - .1, .4], El = l3([s * .52, -.26, .5], [s * .42, -.18, .8], a), Ha = l3([s * .44, -.43, .72], [s * .36, -.3, 1.12], a);
    seg(pr, sh, El, .12, .09, 3, 0); seg(pr, El, Ha, .085, .06, 3, 2);                                    // 앞다리
  }
  const M = mm(rotX(CAM), mm(rotY(f.yaw), rotX(-pitch)));
  render(f.x, H - 14 - S * .78 - up * S, S, M, e > .05 ? 2.5 : 1.5, 1.3, (o, d, L, Hv) => {
    let bt = 1e9, bq = null;
    for (const q of pr) { const t = ell(o, d, q); if (t > 0 && t < bt) { bt = t; bq = q; } }
    if (!bq) return null;
    nrm(o, d, bq, bt);
    const lam = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]), sh = .26 + .74 * lam;
    let sp = Math.pow(Math.max(0, N[0] * Hv[0] + N[1] * Hv[1] + N[2] * Hv[2]), 28) * .55;                // 젖은 피부의 반짝임
    let r = .34, g = .68, b = .18, m = bq[6];
    if (m === 1) { const dn = N[0] * bq[7] + N[1] * bq[8] + N[2] * bq[9]; if (dn > .87) { r = g = b = .03; sp *= 2; } else if (dn > .58) { r = .98; g = .76; b = .12; } else m = 0; }
    if (m === 2) { r = .5; g = .78; b = .3; }
    if (m === 3) { r = .93; g = .9; b = .62; }
    if (m === 0) {
      if (Math.sin(P[0] * 11 + 1.3) * Math.sin(P[2] * 9) * Math.sin(P[1] * 8 + P[2] * 3) > .28) { r *= .55; g *= .6; b *= .5; }   // 등 무늬
      const k = sm((-N[1] - .15) / .5); r = lerp(r, .93, k); g = lerp(g, .9, k); b = lerp(b, .62, k);     // 배는 연하게
    }
    return [r * sh + sp, g * sh + sp, b * sh + sp];
  });
}
function seg(pr, a, b, r1, r2, n, mat) { for (let i = 0; i <= n; i++) { const t = i / n, r = lerp(r1, r2, t); pr.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), r, r, r, mat]); } }

// ───────── 나비 ─────────
// 몸은 z축을 따라 누운 타원체. 날개는 몸 축을 경첩으로 접히는 평면이고, 그 평면 위 좌표 (a 바깥쪽, b 앞쪽)로 모양·무늬를 정한다.
const PAL = [                                           // 안쪽 색, 바깥쪽 색
  [[1, .74, .16], [.96, .4, .04]],                      // 주황 (제왕나비)
  [[.4, .8, 1], [.1, .28, .95]],                        // 파랑 (모르포)
];
const flies = [0, 1].map(i => ({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, next: 0, ph: i * 2, yaw: 0, roll: 0, glide: 0, pal: PAL[i] }));
function flyStep(b, dt) {
  b.next -= dt;
  if (b.next < 0) { b.next = 1.6 + Math.random() * 3; b.tx = W * (.08 + .84 * Math.random()); b.ty = H * (.1 + .7 * Math.random()); if (Math.random() < .3) b.glide = .5; }
  const ax = (b.tx - b.x) * .9 - b.vx * 1.3 + (Math.random() - .5) * 420, ay = (b.ty - b.y) * .9 - b.vy * 1.3 + (Math.random() - .5) * 420;   // 목표로 끌리되 팔랑팔랑 흔들린다
  b.vx += ax * dt; b.vy += ay * dt;
  const sp = Math.hypot(b.vx, b.vy), mx = small ? 90 : 130; if (sp > mx) { b.vx *= mx / sp; b.vy *= mx / sp; }
  b.x += b.vx * dt; b.y += b.vy * dt;
  b.glide -= dt;
  const w = b.glide > 0 ? 3 : 30;                        // 활공할 때는 날개를 거의 멈춘다
  b.ph += dt * w * (1 + .35 * Math.cos(b.ph));           // 내려칠 때가 더 빠르다
  let dy = Math.atan2(b.vx, b.vy) - b.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));       // 가는 쪽으로 천천히 머리를 돌린다
  const turn = clamp(dy * 3, -3.2, 3.2); b.yaw += turn * dt; b.roll += (clamp(turn * .16, -.45, .45) - b.roll) * Math.min(1, dt * 5);   // 돌 때는 몸이 기운다
}
function wingCol(a, b, pal) {                            // 날개 평면 좌표 → 색. 날개 밖이면 null
  if (a < .03) return null;
  const c = .94, s = .34, fa = (a - .6) * c + (b - .24) * s, fb = -(a - .6) * s + (b - .24) * c;         // 앞날개는 살짝 위로 틀어져 있다
  const e1 = (fa / .64) ** 2 + (fb / .36) ** 2, e2 = ((a - .44) / .47) ** 2 + ((b + .34) / .37) ** 2, f = Math.min(e1, e2);
  if (f > 1) return null;
  if (f > .7) return (Math.floor(a * 10) + Math.floor(b * 10)) % 3 === 0 && f < .93 ? [1, 1, 1] : [.05, .04, .04];   // 검은 테두리에 흰 점
  if (Math.abs(Math.sin(Math.atan2(b + .05, a) * 7)) < .13 && f > .12) return [.07, .05, .04];             // 날개맥
  return l3(pal[0], pal[1], f / .7);
}
function flyDraw(b, S) {
  const phi = .42 + .85 * Math.sin(b.ph), c = Math.cos(phi), s = Math.sin(phi);                          // 날개 각도: 아래 -25° ~ 위 +73°
  const M = mm(rotZ(b.yaw), mm(rotX(1.02), rotZ(b.roll)));   // 위에서 비스듬히 내려다본다 (날개 무늬가 보이게)
  const body = [0, 0, 0, .075, .075, .42, 0], head = [0, .01, .44, .09, .09, .09, 0];
  const bob = -Math.sin(b.ph - .7) * S * .07;            // 날개를 내려칠 때 몸이 들린다
  render(b.x, b.y + bob, S, M, 1.4, 1.4, (o, d, L, Hv) => {
    let bt = 1e9, col = null;
    for (const q of [body, head]) { const t = ell(o, d, q); if (t > 0 && t < bt) { bt = t; nrm(o, d, q, t); const sh = .3 + .7 * Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]); col = [.16 * sh, .12 * sh, .1 * sh]; } }
    for (const sd of [-1, 1]) {                          // 왼쪽·오른쪽 날개
      const ux = sd * c, uy = s, nx = -sd * s, ny = c, den = d[0] * nx + d[1] * ny;
      if (Math.abs(den) < 1e-4) continue;
      const t = -(o[0] * nx + o[1] * ny) / den; if (t <= 0 || t >= bt) continue;
      const w = wingCol((o[0] + d[0] * t) * ux + (o[1] + d[1] * t) * uy, o[2] + d[2] * t, b.pal); if (!w) continue;
      const lam = Math.abs(nx * L[0] + ny * L[1]), sh = .42 + .58 * lam, sp = Math.pow(Math.abs(nx * Hv[0] + ny * Hv[1]), 18) * .35;   // 비늘 가루의 은은한 윤
      bt = t; col = [w[0] * sh + sp, w[1] * sh + sp, w[2] * sh + sp];
    }
    return col;
  });
}

// ───────── 돌리기 ─────────
function place() { frog.x = W * (.2 + .6 * Math.random()); for (const b of flies) { b.x = b.tx = W * Math.random(); b.y = b.ty = H * (.2 + .5 * Math.random()); } }
let last = 0, acc = 0, tick = 0;
function frame(now) {
  if (!fg.offsetWidth || document.hidden) { last = 0; return setTimeout(() => requestAnimationFrame(frame), 500); }   // 문제 푸는 화면·숨은 탭에서는 쉰다
  const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; acc += dt;
  if (acc >= 1 / 30 || !dt) {
    if (++tick % 30 === 0 && theme()) drawBg();          // 1초에 한 번 테마가 바뀌었는지 본다
    const S = small ? 66 : 116, n = small ? 1 : 2;
    frogStep(acc, S); for (let i = 0; i < n; i++) flyStep(flies[i], acc);
    fx.clearRect(0, 0, W, H); frogDraw(S); for (let i = 0; i < n; i++) flyDraw(flies[i], S * .72);
    acc = 0;
  }
  if (!still) requestAnimationFrame(frame);              // 동작 줄이기를 켠 기기는 한 장만 그리고 멈춘다
}
resize(); place();
addEventListener("resize", () => { resize(); frog.x = clamp(frog.x, 80, W - 80); });
requestAnimationFrame(frame);
