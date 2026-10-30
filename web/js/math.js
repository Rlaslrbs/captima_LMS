// 수식(MathJax) 공용 설정 — 사용자 웹과 관리자 웹이 같은 설정, 같은 모양을 쓴다.
// 수식 과목을 새로 올려도 여기만 따르면 된다. 수식 모양을 바꿀 때도 여기만 고친다.
//
// 지키는 것
// 1. 문장 속 수식(\( … \))은 글씨와 같은 기준선에 놓는다.
//    → mjx-container를 inline 그대로 둔다. inline-block으로 바꾸면 수식이 글씨보다 떠 보인다(2026-10-19 고친 문제).
// 2. 세로로 긴 수식(행렬 등)이 윗줄과 붙지 않게 SVG에 "위쪽" 여백만 준다.
//    아래 여백을 주면 안 된다: 문장 속 SVG는 아래 여백 끝을 기준선으로 삼아 그만큼 수식이 떠 버린다(쉼표가 처져 보임).
// 3. \text{…} 안 글씨는 화면 글꼴(Pretendard)을 그대로 써서 한국어와 모양을 맞춘다.
const MJ_URL = "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js";

const CSS = `
mjx-container[jax="SVG"]:not([display="true"]){display:inline;margin:0}
mjx-container[jax="SVG"]:not([display="true"]) > svg{margin:4px 0 0}
mjx-container[jax="SVG"][display="true"]{display:block;margin:.6em 0;overflow-x:auto;overflow-y:hidden;max-width:100%}
`;
let styled = false;
function addStyle() {
  if (styled) return; styled = true;
  const st = document.createElement("style"); st.id = "mn-math"; st.textContent = CSS; document.head.appendChild(st);
}

let ready = null;
export function loadMath() {
  if (window.MathJax && window.MathJax.typesetPromise) return Promise.resolve();
  if (!ready) {
    addStyle();
    window.MathJax = {
      tex: { inlineMath: [["\\(", "\\)"]], displayMath: [["\\[", "\\]"], ["$$", "$$"]] },
      svg: { fontCache: "global", mtextInheritFont: true, merrorInheritFont: true },
      startup: { typeset: false },
    };
    ready = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = MJ_URL; s.async = true;
      s.onload = () => window.MathJax.startup.promise.then(res); s.onerror = rej; document.head.appendChild(s);
    });
  }
  return ready;
}

/** el 안의 수식을 그린다. math가 거짓이면(수식 없는 과목) 아무것도 안 한다.
    MathJax는 한 번에 하나씩 그려야 안전해서 차례로 줄 세운다 */
let chain = Promise.resolve();
export function typeset(el, math = true) {
  if (!math || !el) return Promise.resolve();
  chain = chain.then(() => loadMath()).then(() => el.isConnected && window.MathJax.typesetPromise([el])).catch(() => { });
  return chain;
}
/** el 안에서 그린 수식을 MathJax 기억에서 지운다. 화면을 다시 그리기 전에 부르지 않으면 메모리가 계속 쌓여 느려진다 */
export function clearMath(el) {
  try { if (el && window.MathJax && window.MathJax.typesetClear) window.MathJax.typesetClear([el]); } catch { }
}
