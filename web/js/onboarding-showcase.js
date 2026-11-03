/**
 * 문제노트 - 처음 오는 사람을 위한 소개 화면 (스크롤)
 * 과목 소개(실제 문제 예시) → 복습 → 학습 리포트 → 기기 이어 풀기 → 시작(동의)
 * 뒤 배경의 글자 격자는 마우스를 누른 채 움직일 때만 물방울처럼 번진다.
 */

import { S, api, createDevice, adoptDevice, hasDevice } from "./store.js";
import { toast, LS, esc } from "./util.js";   // LS는 util.js에 있다 (store.js는 내보내지 않음)

// ─────────────────────────────────────────────────────────────
// 1. 배경 글자 격자 + 물방울 (Canvas 2D)
// ─────────────────────────────────────────────────────────────
const BG = "#000";
const BASE_TEXT = "rgba(150, 150, 160, 0.17)";
const DROP_TONES = ["255, 255, 255", "41, 151, 255"];   // 물방울 색: 흰색 · 파랑
const SCRAMBLE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+-=[]{}|;:,.<>?/~`λπ∑∫√∞≠≤≥";
const TOKENS = [
  "det A", "rank", "H0", "p-value", "t(n-1)", "SWOT", "MIS", "TPS", "EOQ", "SS", "σ²", "μ", "n-1",
  "정의", "적용", "구별", "조건", "오답", "별표", "해결", "D-day", "개념", "단원", "기출", "해설",
  "선형독립", "신뢰구간", "핵심 역량", "정보시스템", "자연선택", "재고", "가설검정"
];

class DropGridEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.still = matchMedia("(prefers-reduced-motion: reduce)").matches;   // 움직임 줄이기: 정지된 배경만

    this.fontSize = 10;
    this.cellW = 8.5;
    this.cellH = 15;
    this.cols = 0;
    this.rows = 0;
    this.cells = [];

    // 평소 글자는 한 번만 그려 두고 복사해서 쓴다 (60fps 유지)
    this.bgCanvas = document.createElement("canvas");
    this.bgCtx = this.bgCanvas.getContext("2d", { alpha: false });

    this.activeCellIndices = new Set();   // 물방울이 지나가는 셀만 다시 그린다
    this.ripples = [];
    this.lastPointer = { x: -9999, y: -9999, time: 0 };
    this.isRunning = false;

    this.onResize = this.onResize.bind(this);
    this.loop = this.loop.bind(this);
    this.onResize();
    window.addEventListener("resize", this.onResize);
    this.start();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.bgCanvas.width = this.canvas.width;
    this.bgCanvas.height = this.canvas.height;

    this.cols = Math.ceil(w / this.cellW) + 2;
    this.rows = Math.ceil(h / this.cellH) + 2;
    this.buildGrid();
  }

  buildGrid() {
    this.cells = [];
    this.activeCellIndices.clear();

    let tokenIdx = 0;
    let currToken = TOKENS[0];
    let tokenCharIdx = 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let ch = " ";
        if (Math.random() < 0.65) {
          if (tokenCharIdx < currToken.length) {
            ch = currToken[tokenCharIdx++];
          } else {
            tokenCharIdx = 0;
            tokenIdx = (tokenIdx + 1) % TOKENS.length;
            currToken = TOKENS[tokenIdx];
            ch = " ";
          }
        } else {
          ch = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }

        this.cells.push({
          x: c * this.cellW,
          y: r * this.cellH + this.fontSize,
          origChar: ch,
          displayChar: ch,
          dispX: 0,
          dispY: 0,
          scrambleTicks: 0,
          glow: 0,
          tone: 0
        });
      }
    }
    this.renderStaticBackground();
  }

  renderStaticBackground() {
    const ctx = this.bgCtx;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.font = `${this.fontSize}px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = BASE_TEXT;
    for (const cell of this.cells) {
      if (cell.origChar !== " ") ctx.fillText(cell.origChar, cell.x, cell.y);
    }
    ctx.restore();
  }

  addRipple(x, y, amplitude = 0.5, maxRadius = 280, waveWidth = 38) {
    if (this.still) return;
    if (this.ripples.length > 12) this.ripples.shift();
    this.ripples.push({
      x,
      y,
      radius: 2,
      maxRadius,
      waveWidth,
      speed: 4.0 + Math.random() * 0.6,
      amplitude,
      decay: 0.988,
      tone: Math.floor(Math.random() * DROP_TONES.length)
    });
  }

  // 마우스를 누른 채 움직일 때만 불린다 (누르지 않고 움직이면 아무 일도 없다)
  handleDrag(x, y) {
    const now = performance.now();
    const dist = Math.hypot(x - this.lastPointer.x, y - this.lastPointer.y);
    if (dist > 15 || (dist > 4 && now - this.lastPointer.time > 60)) {
      this.lastPointer = { x, y, time: now };
      this.addRipple(x, y, 0.5 + Math.min(0.4, dist * 0.008));
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    requestAnimationFrame(this.loop);
  }

  destroy() {
    this.isRunning = false;
    window.removeEventListener("resize", this.onResize);
  }

  loop() {
    if (!this.isRunning) return;

    const ctx = this.ctx;
    ctx.drawImage(this.bgCanvas, 0, 0);
    if (!this.ripples.length && !this.activeCellIndices.size) { requestAnimationFrame(this.loop); return; }

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 물방울 퍼짐: 파문 앞면이 지나가는 셀을 밀어내고 글자를 섞는다
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rip = this.ripples[i];
      rip.radius += rip.speed;
      rip.amplitude *= rip.decay;

      if (rip.radius > rip.maxRadius || rip.amplitude < 0.02) {
        this.ripples.splice(i, 1);
        continue;
      }

      const minCol = Math.max(0, Math.floor((rip.x - rip.radius - rip.waveWidth) / this.cellW));
      const maxCol = Math.min(this.cols - 1, Math.ceil((rip.x + rip.radius + rip.waveWidth) / this.cellW));
      const minRow = Math.max(0, Math.floor((rip.y - rip.radius - rip.waveWidth) / this.cellH));
      const maxRow = Math.min(this.rows - 1, Math.ceil((rip.y + rip.radius + rip.waveWidth) / this.cellH));

      for (let r = minRow; r <= maxRow; r++) {
        const rowOffset = r * this.cols;
        for (let c = minCol; c <= maxCol; c++) {
          const idx = rowOffset + c;
          const cell = this.cells[idx];
          if (!cell) continue;

          const dx = cell.x - rip.x;
          const dy = cell.y - rip.y;
          const dist = Math.hypot(dx, dy);
          const diff = dist - rip.radius;

          if (Math.abs(diff) < rip.waveWidth) {
            const phase = (diff / rip.waveWidth) * Math.PI;
            const wave = Math.cos(phase) * rip.amplitude;

            const push = Math.sin(phase) * rip.amplitude * 7;
            const invDist = dist > 0 ? 1 / dist : 0;
            cell.dispX += dx * invDist * push * 0.35;
            cell.dispY += dy * invDist * push * 0.35;

            if (wave > 0.1) {
              cell.scrambleTicks = Math.max(cell.scrambleTicks, Math.floor(wave * 12 + Math.random() * 5));
              cell.glow = Math.max(cell.glow, wave);
              cell.tone = rip.tone;
              this.activeCellIndices.add(idx);
            }
          }
        }
      }
    }

    // 움직이는 셀만 선별해서 그린다
    if (this.activeCellIndices.size > 0) {
      ctx.font = `${this.fontSize}px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`;
      ctx.textBaseline = "alphabetic";

      for (const idx of this.activeCellIndices) {
        const cell = this.cells[idx];
        if (!cell) {
          this.activeCellIndices.delete(idx);
          continue;
        }

        cell.dispX *= 0.86;
        cell.dispY *= 0.86;
        cell.glow *= 0.92;

        if (cell.scrambleTicks > 0) {
          cell.displayChar = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          cell.scrambleTicks--;
        } else {
          cell.displayChar = cell.origChar;
        }

        if (cell.glow < 0.03 && Math.abs(cell.dispX) < 0.2 && Math.abs(cell.dispY) < 0.2 && cell.scrambleTicks === 0) {
          cell.dispX = 0;
          cell.dispY = 0;
          cell.glow = 0;
          cell.displayChar = cell.origChar;
          this.activeCellIndices.delete(idx);
          continue;
        }

        if (cell.displayChar === " ") continue;

        // 제자리의 평소 글자를 지우고, 밀려난 자리에 다시 그린다
        ctx.fillStyle = BG;
        ctx.fillRect(cell.x - 1, cell.y - this.fontSize + 1, this.cellW + 2, this.cellH);

        const alpha = Math.min(0.9, 0.2 + cell.glow * 0.7);
        ctx.fillStyle = `rgba(${DROP_TONES[cell.tone]}, ${alpha})`;
        ctx.fillText(cell.displayChar, cell.x + cell.dispX, cell.y + cell.dispY);
      }
    }

    // 물방울이 떨어진 자리에서 퍼지는 동심원
    for (const rip of this.ripples) {
      if (rip.amplitude > 0.04 && rip.radius > 4) {
        const col = DROP_TONES[rip.tone];

        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${col}, ${Math.min(0.32, rip.amplitude * 0.3)})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        if (rip.radius > 28) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.radius - 18, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${col}, ${rip.amplitude * 0.12})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
    requestAnimationFrame(this.loop);
  }
}

// ─────────────────────────────────────────────────────────────
// 2. 과목 소개: 과목마다 실제 문제 하나 (data/import의 문제 그대로)
// ─────────────────────────────────────────────────────────────
const SAMPLES = [
  { short: "응용통계", name: "응용통계학", kind: "ox", ans: false,
    q: "If we construct 100 intervals, exactly 95 of them will contain μ.",
    why: "\"약\" 95개예요. 몇 개가 포함될지도 확률적으로 변해요." },
  { short: "생경론", name: "생산경영론", kind: "mc", ans: 2,
    q: "다음 중 핵심 역량(core competency)을 설명한 것은?",
    opts: ["조직 외부의 사건과 추세를 감시해 위협과 기회를 찾는 활동", "강점·약점·기회·위협을 내부와 외부로 나누어 정리하는 분석", "조직에 경쟁 우위를 주는 특별한 속성이나 능력", "조직이 이르려는 구체적인 성과 수준"],
    why: "핵심 역량 = 조직에 경쟁 우위를 주는 특별한 속성이나 능력(조직 내부의 것). 환경 탐색은 외부의 사건·추세를 감시하는 활동이고, SWOT 분석이 그 일반적인 방법이에요." },
  { short: "진인본", name: "진화와 인간 본성", kind: "ox", ans: false,
    q: "애벌레가 나비로 변태하는 것은 생물학적 진화의 한 예이다.",
    why: "진화 = 세대를 거쳐 생물 개체군 내의 형질(유전자 빈도)이 변하는 것. 변태는 한 개체 안의 변화이므로 진화가 아니에요. 판별 기준: ① 세대를 거쳤나 ② 개체군의 변화인가." },
  { short: "공학수학", name: "공학수학2 · 선형대수", kind: "ox", ans: false,
    q: "inconsistent한 시스템은 해가 두 개 이상이다.",
    why: "inconsistent = 해가 없음. 해가 하나 이상이면 consistent예요." },
  { short: "경정시", name: "경영정보시스템", kind: "ox", ans: false,
    q: "경영과학(OR)은 정보시스템에 대한 '행위적 접근'에 해당하는 학문 분야이다.",
    why: "경영과학·OR(의사결정 모형, 최적화 기법)과 컴퓨터과학은 기술적 접근이에요. 행위적 접근의 학문은 사회학, 심리학, 경제학이에요." }
];

// 서버 과목 목록(S.catalog)이 있으면 그걸 기준으로, 없으면(처음 접속 · 오프라인) 예시 과목만
function subjectList() {
  const courses = (S.catalog?.semesters || []).flatMap(s => s.courses);
  if (!courses.length) return SAMPLES.map(x => ({ short: x.short, name: x.name, problems: 0, color: null, sample: x }));
  return courses.map(c => ({ short: c.short, name: c.name, problems: c.problems, color: c.color, sample: SAMPLES.find(x => x.short === c.short) || null }));
}

// ─────────────────────────────────────────────────────────────
// 3. 소개 화면
// ─────────────────────────────────────────────────────────────

export function showOnboardingShowcase() {
  return new Promise((resolve) => {
    // 이미 쓰고 있는 사람이 다시 볼 때: 기기를 새로 만들면 기록이 끊기므로 시작 단계 대신 '돌아가기'만 둔다
    const replay = hasDevice();

    const wrap = document.createElement("div");
    wrap.className = "onb-showcase";
    wrap.id = "onbShowcase";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "문제노트 소개");

    wrap.innerHTML = `
      <canvas class="onb-scramble-canvas" id="onbCanvas" aria-hidden="true"></canvas>

      <header class="onb-header">
        <span class="onb-logo-text">문제노트</span>
        <div class="onb-header-actions">
          <button type="button" class="onb-skip-btn" id="onbSkipBtn">${replay ? "닫기" : "건너뛰기"}</button>
          ${replay ? "" : `<button type="button" class="onb-direct-start-btn" id="onbHeaderStartBtn">바로 시작하기</button>`}
        </div>
      </header>

      <nav class="onb-scroll-nav" aria-label="목차">
        <button class="onb-nav-dot is-active" data-target="hero" data-label="처음" aria-label="처음"></button>
        <button class="onb-nav-dot" data-target="feature-subjects" data-label="과목" aria-label="과목"></button>
        <button class="onb-nav-dot" data-target="feature-essay" data-label="서술형 채점" aria-label="서술형 채점"></button>
        <button class="onb-nav-dot" data-target="feature-review" data-label="복습" aria-label="복습"></button>
        <button class="onb-nav-dot" data-target="feature-report" data-label="학습 리포트" aria-label="학습 리포트"></button>
        <button class="onb-nav-dot" data-target="feature-sync" data-label="이어 풀기" aria-label="이어 풀기"></button>
        <button class="onb-nav-dot" data-target="feature-start" data-label="시작" aria-label="시작"></button>
      </nav>

      <main class="onb-content">
        <section class="onb-section onb-hero" id="hero">
          <p class="onb-eyebrow">문제노트</p>
          <h1 class="onb-hero-title">풀수록 내 약점이<br>보이는 문제 풀이</h1>
          <p class="onb-hero-sub">로그인 없이 바로 풀어요. 틀린 문제는 모아서 다시 풀고,<br>어느 개념에서 막혔는지도 알려 줘요.</p>
          <div class="onb-hero-ctas">
            <button type="button" class="onb-btn-primary" id="onbExploreBtn">과목 둘러보기</button>
            ${replay ? "" : `<button type="button" class="onb-btn-secondary" id="onbHeroStartBtn">바로 시작하기</button>`}
          </div>
          <p class="onb-scroll-hint">아래로 스크롤해 보세요<span class="onb-drag-hint"> · 마우스를 누른 채 움직이면 배경에 물방울이 번져요</span></p>
        </section>

        <section class="onb-section" id="feature-subjects">
          <div class="onb-feature-grid">
            <div class="onb-feature-info onb-rv">
              <p class="onb-eyebrow">과목</p>
              <h2 class="onb-feature-title" id="onbSubjTitle">과목별로 문제를 풀어 볼 수 있어요</h2>
              <p class="onb-feature-desc">과목을 눌러 문제를 하나씩 풀어 보세요. 실제로 올라와 있는 문제예요.</p>
              <div class="onb-subjects" id="onbSubjects" role="tablist" aria-label="과목"></div>
            </div>
            <div class="onb-tile onb-rv" id="onbSample" style="--d:120ms"></div>
          </div>
        </section>


        <section class="onb-section" id="feature-essay">
          <div class="onb-feature-grid reverse">
            <div class="onb-tile onb-rv" id="onbEssay">
              <p class="onb-tile-cap">화면 예시 · 생산경영론 서술형</p>
              <p class="onb-q">Distinguish order qualifiers from order winners. Can the same attribute be both?</p>
              <p class="onb-ess-lab">내 답안</p>
              <p class="onb-ess-ans">Order qualifier는 구매 후보가 되기 위한 최소 기준이고, order winner는 경쟁사보다 낫다고 느끼게 하는 특성이에요. 가격이나 품질은 상황에 따라 둘 다 될 수 있어요.</p>
              <button type="button" class="onb-ess-btn" id="onbEssBtn">AI 채점 도우미로 확인하기</button>
              <ul class="onb-ess-pts" id="onbEssPts">
                <li data-v="covered"><span class="onb-ess-mark">✓</span><span>Qualifier = minimum standard</span><em>들어감</em></li>
                <li data-v="covered"><span class="onb-ess-mark">✓</span><span>Winner = better than competition</span><em>들어감</em></li>
                <li data-v="missing"><span class="onb-ess-mark">✕</span><span>Qualify first, then win</span><em>빠짐</em></li>
                <li data-v="partial"><span class="onb-ess-mark">△</span><span>price/delivery/quality는 둘 다 가능</span><em>애매함</em></li>
              </ul>
              <div class="onb-ess-res" id="onbEssRes" hidden>
                <b>일부 부족</b><small>참고용 · 최종 판정은 직접 해 주세요</small>
                <p>먼저 자격을 갖춰야 주문을 따낼 수 있다는 순서가 빠졌어요. 가격 외에 납기도 함께 적어 보세요.</p>
              </div>
            </div>
            <div class="onb-feature-info onb-rv" style="--d:120ms">
              <p class="onb-eyebrow">서술형 채점</p>
              <h2 class="onb-feature-title">서술형 답안도<br>포인트별로 확인해요</h2>
              <p class="onb-feature-desc">답안을 쓰고 AI 채점 도우미를 누르면, 모범 답안과 채점 포인트에 견줘 들어간 것과 빠진 것을 짚어 줘요. 점수가 아니라 참고용이고, 맞았는지는 내가 직접 정해요.</p>
              <ul class="onb-feature-bullets">
                <li>쓴 답안은 저장되지 않고, 오답일 때만 오답노트에 남아요</li>
                <li>처음 쓸 때 동의를 받아요. 답안이 Google Gemini로 보내지니 이름 같은 개인 정보는 쓰지 마세요</li>
                <li>남용을 막으려고 시간당 사용 횟수에 한도가 있어요</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="onb-section" id="feature-review">
          <div class="onb-feature-grid flip">
            <div class="onb-tile onb-rv">
              <p class="onb-tile-cap">화면 예시</p>
              <div class="onb-rv-row"><span class="onb-pill onb-pill-w">오답</span><span>100개 구간 중 정확히 95개가 μ를 포함한다</span></div>
              <div class="onb-rv-row"><span class="onb-pill onb-pill-s">별표</span><span>inconsistent한 시스템은 해가 두 개 이상이다</span></div>
              <div class="onb-rv-row"><span class="onb-pill onb-pill-ok">해결</span><span>애벌레의 변태는 진화의 한 예이다</span></div>
              <div class="onb-rv-foot"><span>다시 풀어 해결</span><b>1 / 3</b></div>
              <div class="onb-track"><i style="--w:33%"></i></div>
            </div>
            <div class="onb-feature-info onb-rv" style="--d:120ms">
              <p class="onb-eyebrow">복습</p>
              <h2 class="onb-feature-title">틀린 문제는 모아서<br>다시 풀어요</h2>
              <p class="onb-feature-desc">오답과 별표를 친 문제만 따로 모여요. 다시 풀어서 맞히면 해결로 바뀌어요.</p>
              <ul class="onb-feature-bullets">
                <li>풀이 기록은 과목마다 따로 쌓여요</li>
                <li>별표를 쳐 둔 문제만 골라 다시 풀 수 있어요</li>
                <li>시험일을 정해 두면 남은 날이 D-day로 보여요</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="onb-section" id="feature-report">
          <div class="onb-feature-grid reverse flip">
            <div class="onb-feature-info onb-rv">
              <p class="onb-eyebrow">학습 리포트</p>
              <h2 class="onb-feature-title">어디서 막혔는지<br>알려 줘요</h2>
              <p class="onb-feature-desc">풀이 기록으로 개념마다 어느 깊이에서 막혔는지 보여 줘요. 깊이는 정의 · 적용 · 구별 · 조건, 네 단계예요.</p>
              <ul class="onb-feature-bullets">
                <li>같은 착각이 서로 다른 문제 2개 이상에서 나올 때만 알려 줘요</li>
                <li>근거가 모자라면 판단을 미루고 확인 문제를 권해요</li>
                <li>개념 정리가 끝난 과목부터 차례로 열려요</li>
              </ul>
            </div>
            <div class="onb-tile onb-rv" style="--d:120ms">
              <p class="onb-tile-cap">화면 예시 · 공학수학</p>
              <p class="onb-tile-h">역행렬과 가역성</p>
              ${[["1 정의", "확실히", 100], ["2 적용", "확실히", 88], ["3 구별", "얕게", 46], ["4 조건", "모름", 12]].map(([d, s, w]) =>
                `<div class="onb-lv"><span>${d}</span><div class="onb-track"><i style="--w:${w}%"></i></div><em>${s}</em></div>`).join("")}
              <div class="onb-note">
                <small>이렇게 헷갈리고 있을 수 있어요</small>
                <b>가역이면 항상 대각화할 수 있다고 생각하고 있어요</b>
              </div>
            </div>
          </div>
        </section>

        <section class="onb-section" id="feature-sync">
          <div class="onb-feature-grid flip">
            <div class="onb-tile onb-rv">
              <p class="onb-tile-cap">예시</p>
              <div class="onb-sync-visual">
                <div class="onb-device"><b>노트북</b><small>풀던 기록</small></div>
                <div class="onb-sync-line" aria-hidden="true"></div>
                <div class="onb-device"><b>폰</b><small>이어서 풀기</small></div>
              </div>
              <div class="onb-code" aria-label="6자리 코드 예시">
                ${[4, 8, 2, 9, 1, 7].map(n => `<span>${n}</span>`).join("")}
              </div>
            </div>
            <div class="onb-feature-info onb-rv" style="--d:120ms">
              <p class="onb-eyebrow">이어 풀기</p>
              <h2 class="onb-feature-title">다른 기기에서도<br>이어서 풀어요</h2>
              <p class="onb-feature-desc">회원가입이 없어서 이름도 이메일도 받지 않아요. 기록 모으기에 동의하면 6자리 코드로 폰과 노트북을 이어 쓸 수 있어요.</p>
              <ul class="onb-feature-bullets">
                <li>인터넷이 끊겨도 기록은 이 기기에 먼저 저장돼요</li>
                <li>코드는 마이페이지에서 만들어요</li>
                <li>브라우저를 지워도 기록 열쇠가 있으면 되살릴 수 있어요</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="onb-section onb-final-section" id="feature-start">
          <h2 class="onb-hero-title onb-final-title onb-rv">${replay ? "소개는 여기까지예요" : "이제 풀어 볼까요?"}</h2>
          <p class="onb-hero-sub onb-rv" style="--d:80ms">${replay ? "원래 화면으로 돌아가요." : "학년과 닉네임은 안 골라도 돼요."}</p>

          <div class="onb-tile onb-card-final onb-rv" style="--d:160ms">
            ${replay ? `<button type="button" class="onb-submit-btn" id="onbCloseBtn">돌아가기</button>` : `
            <form id="onbFinalForm">
              <div class="onb-form-group">
                <label class="onb-form-label">
                  <span>몇 학년이에요?</span>
                  <small>(선택, 둘러보기가 그 학년부터 열려요)</small>
                </label>
                <div class="onb-grade-seg" role="radiogroup" aria-label="학년">
                  <label><input type="radio" name="onbYear" value="1"><span>1학년</span></label>
                  <label><input type="radio" name="onbYear" value="2"><span>2학년</span></label>
                  <label><input type="radio" name="onbYear" value="3"><span>3학년</span></label>
                  <label><input type="radio" name="onbYear" value="4"><span>4학년</span></label>
                  <label><input type="radio" name="onbYear" value="ge"><span>교양만</span></label>
                </div>
              </div>

              <div class="onb-form-group">
                <label class="onb-form-label" for="onbNickInput">
                  <span>닉네임</span>
                  <small>(선택, 제보할 때 표시)</small>
                </label>
                <input type="text" id="onbNickInput" class="onb-input-text" maxlength="20" placeholder="예: 경영 22" autocomplete="off">
              </div>

              <div class="onb-form-group">
                <details class="onb-privacy-box">
                  <summary>모으는 것과 모으지 않는 것</summary>
                  <p><b>모으는 것</b> 문제별 정답 여부 · 고른 답이나 쓴 답 · 풀이 시간 · 화면 크기와 기기 종류(폰/PC) · 오류 제보 내용</p>
                  <p><b>모으지 않는 것</b> 이름 · 이메일 · 학번 · 위치 · 연락처. 동의는 마이페이지에서 언제든 끌 수 있어요.</p>
                </details>
              </div>

              <div class="onb-action-stack">
                <button type="submit" class="onb-submit-btn">동의하고 시작하기</button>
                <button type="button" class="onb-local-btn" id="onbLocalBtn">동의하지 않고 시작 <small>기록은 이 브라우저에만 저장돼요</small></button>
              </div>

              <div class="onb-restore-link">
                <button type="button" class="onb-restore-toggle" id="onbRestoreToggle">이미 쓰던 기록이 있나요? 코드나 기록 열쇠로 가져오기</button>
                <div class="onb-restore-form" id="onbRestoreForm" hidden>
                  <input type="text" id="onbRestoreCode" class="onb-input-text" placeholder="6자리 코드 또는 기록 열쇠" autocomplete="off" autocapitalize="off" spellcheck="false">
                  <button type="button" class="onb-restore-btn" id="onbRestoreBtn">가져오기</button>
                </div>
              </div>
            </form>`}
          </div>
        </section>
      </main>
    `;

    document.body.appendChild(wrap);
    document.documentElement.classList.add("onb-lock");

    const $ = s => wrap.querySelector(s);
    const goTo = id => $("#" + id)?.scrollIntoView({ behavior: "smooth" });

    // ───────── 배경 격자: 마우스를 누른 채 움직일 때만 물방울 ─────────
    const engine = new DropGridEngine($("#onbCanvas"));
    let pressed = false;
    const onPointerDown = e => {
      // 단추 · 입력칸 위에서 누른 것은 물방울로 치지 않는다. 손가락은 스크롤에 써야 하니 마우스만.
      pressed = e.pointerType === "mouse" && e.button === 0 && !e.target.closest("input, textarea, button, summary, label, a, select");
    };
    const onPointerUp = () => { pressed = false; };
    const onPointerMove = e => { if (pressed) engine.handleDrag(e.clientX, e.clientY); };
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    window.addEventListener("blur", onPointerUp);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    // ───────── 스크롤: 목차 점 + 떠오르며 나타나기 ─────────
    const sections = wrap.querySelectorAll(".onb-section");
    const navDots = wrap.querySelectorAll(".onb-nav-dot");
    const onScroll = () => {
      const scrollY = wrap.scrollTop;
      const h = window.innerHeight;
      sections.forEach((sec, idx) => {
        const top = sec.offsetTop;
        if (scrollY >= top - h * 0.45 && scrollY < top + sec.offsetHeight - h * 0.45) {
          navDots.forEach(d => d.classList.remove("is-active"));
          navDots[idx]?.classList.add("is-active");
        }
      });
    };
    wrap.addEventListener("scroll", onScroll, { passive: true });
    navDots.forEach(dot => dot.addEventListener("click", () => goTo(dot.dataset.target)));

    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { root: wrap, threshold: 0.18 });
    wrap.querySelectorAll(".onb-rv").forEach(el => io.observe(el));

    // ───────── 과목 소개: 과목 목록 + 문제 하나 풀어 보기 ─────────
    const list = subjectList();
    const total = list.reduce((n, c) => n + c.problems, 0);
    if (total) $("#onbSubjTitle").innerHTML = `지금 ${list.length}과목,<br>${total.toLocaleString("ko-KR")}문제가 있어요`;
    let cur = 0;

    function renderSubjects() {
      $("#onbSubjects").innerHTML = list.map((c, i) => `
        <button type="button" role="tab" class="onb-subj" data-i="${i}" aria-selected="${i === cur}">
          <i class="onb-subj-dot" style="background:${esc(c.color?.dark || "#2997ff")}"></i>
          <span class="onb-subj-name">${esc(c.name)}</span>
          <span class="onb-subj-n">${c.problems ? c.problems.toLocaleString("ko-KR") + "문제" : ""}</span>
        </button>`).join("");
    }

    function renderSample() {
      const c = list[cur], x = c.sample;
      const box = $("#onbSample");
      if (!x) {
        box.innerHTML = `<p class="onb-tile-cap">${esc(c.name)}</p><p class="onb-q">시작한 뒤 둘러보기에서 이 과목을 열어 보세요.</p>`;
        return;
      }
      const choices = x.kind === "ox" ? ["O", "X"] : x.opts;
      const right = x.kind === "ox" ? (x.ans ? 0 : 1) : x.ans;
      box.innerHTML = `
        <p class="onb-tile-cap">${esc(c.name)} · ${x.kind === "ox" ? "O/X" : "객관식"}</p>
        <p class="onb-q">${esc(x.q)}</p>
        <div class="onb-opts ${x.kind}">${choices.map((t, i) => `<button type="button" class="onb-opt" data-i="${i}">${esc(t)}</button>`).join("")}</div>
        <div class="onb-why" hidden><b></b><p>${esc(x.why)}</p></div>`;
      box.dataset.right = right;
      box.dataset.label = x.kind === "ox" ? choices[right] : String(right + 1) + "번";
    }

    function answer(btn) {
      const box = $("#onbSample");
      if (box.dataset.done) return;
      box.dataset.done = "1";
      const pick = +btn.dataset.i, right = +box.dataset.right;
      box.querySelectorAll(".onb-opt").forEach(b => {
        b.disabled = true;
        if (+b.dataset.i === right) b.classList.add("good");
      });
      if (pick !== right) btn.classList.add("bad");
      const why = box.querySelector(".onb-why");
      why.querySelector("b").textContent = pick === right ? "맞아요" : `정답은 ${box.dataset.label}예요`;
      why.hidden = false;
      if (pick === right) {
        const flash = document.createElement("div");
        flash.className = "onb-flash";
        flash.addEventListener("animationend", () => flash.remove());
        wrap.append(flash);
      }
    }

    $("#onbSubjects").addEventListener("click", e => {
      const b = e.target.closest(".onb-subj"); if (!b) return;
      cur = +b.dataset.i;
      delete $("#onbSample").dataset.done;
      renderSubjects(); renderSample();
    });
    $("#onbSample").addEventListener("click", e => {
      const b = e.target.closest(".onb-opt"); if (b) answer(b);
    });
    renderSubjects(); renderSample();

    // ───────── 서술형 채점 예시: 누르면 포인트가 하나씩 채점돼 나온다 (화면 예시라 서버를 부르지 않는다) ─────────
    const essBtn = $("#onbEssBtn");
    essBtn.addEventListener("click", () => {
      essBtn.disabled = true;
      essBtn.textContent = "채점 중…";
      const pts = [...wrap.querySelectorAll("#onbEssPts li")];
      pts.forEach((li, i) => setTimeout(() => li.classList.add("on"), 500 + i * 450));
      setTimeout(() => {
        $("#onbEssRes").hidden = false;
        essBtn.textContent = "다시 보기";
        essBtn.disabled = false;
        essBtn.onclick = () => {
          pts.forEach(li => li.classList.remove("on"));
          $("#onbEssRes").hidden = true;
          essBtn.textContent = "AI 채점 도우미로 확인하기";
          essBtn.onclick = null;
        };
      }, 500 + pts.length * 450 + 200);
    }, { once: true });

    // ───────── 버튼 ─────────
    $("#onbExploreBtn")?.addEventListener("click", () => goTo("feature-subjects"));
    $("#onbHeroStartBtn")?.addEventListener("click", () => goTo("feature-start"));
    $("#onbHeaderStartBtn")?.addEventListener("click", () => goTo("feature-start"));

    const finish = () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      io.disconnect();
      wrap.classList.remove("is-active");
      setTimeout(() => {
        engine.destroy();
        wrap.remove();
        document.documentElement.classList.remove("onb-lock");
        resolve();
      }, 500);
    };
    // 처음 오는 사람은 동의를 거쳐야 하므로 건너뛰기 · Esc는 동의 단계로만 보낸다. 다시 보는 사람은 그냥 닫는다.
    const skip = () => (replay ? finish() : goTo("feature-start"));
    const onKeyDown = e => { if (e.key === "Escape") skip(); };
    window.addEventListener("keydown", onKeyDown);
    $("#onbSkipBtn").addEventListener("click", skip);
    $("#onbCloseBtn")?.addEventListener("click", finish);

    // ───────── 시작 (처음 오는 사람만) ─────────
    const pickYear = () => {
      const yr = wrap.querySelector('input[name="onbYear"]:checked');
      if (yr) LS.set("browseYear", yr.value);
    };
    const nick = () => ($("#onbNickInput")?.value || "").trim();

    const form = $("#onbFinalForm");
    if (form) {
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const btn = wrap.querySelector(".onb-submit-btn");
        btn.disabled = true;
        pickYear();
        await createDevice({ consent: true, nickname: nick() });
        finish();
        toast("고마워요! 이제 과목을 담아 볼까요?", "ok");
      });

      $("#onbLocalBtn").addEventListener("click", async e => {
        e.currentTarget.disabled = true;
        pickYear();
        await createDevice({ consent: false, nickname: nick() });
        finish();
        toast("시작해요! 과목을 담아 볼까요?", "ok");
      });

      const restoreForm = $("#onbRestoreForm"), restoreInput = $("#onbRestoreCode");
      $("#onbRestoreToggle").addEventListener("click", () => {
        restoreForm.hidden = !restoreForm.hidden;
        if (!restoreForm.hidden) restoreInput.focus();
      });
      $("#onbRestoreBtn").addEventListener("click", async () => {
        const v = restoreInput.value.trim();
        const isKey = /^[A-Za-z0-9_-]{16,64}$/.test(v);
        if (!/^\d{6}$/.test(v) && !isKey) { toast("6자리 코드나 기록 열쇠를 입력해 주세요", "bad"); return; }
        try {
          const r = await api("POST", "/api/transfer/claim", isKey ? { key: v } : { code: v });
          await adoptDevice(r.device_id);
          finish();
          toast("기록을 가져왔어요. 이제 두 기기에서 같은 기록을 써요.", "ok");
        } catch (err) { toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
      });
    }

    requestAnimationFrame(() => wrap.classList.add("is-active"));
  });
}
