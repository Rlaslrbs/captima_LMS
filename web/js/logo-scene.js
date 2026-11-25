// 캡티마로고 기능: 탐조등 버튼을 눌러 로고로 들어갔을 때 글자 장면을 켠다 (spotlight.js·glass.css와 함께)
// 장면 본체는 logo-scene-core.js
import { mountScene } from "./logo-scene-core.js";

const root = document.documentElement;
const fx = document.querySelector(".spot-fx");   // spotlight.js가 만든 판 (로고가 없는 테마에서는 없다)

if (fx) {
  const hint = fx.querySelector(".spot-hint");
  // 로고 그림을 읽으면 CSS 로고·빛기둥을 끄고 글자판으로 바꾼다 (못 읽으면 원래 모습 그대로)
  const scene = mountScene(fx, {
    before: hint, burst: true,
    ready() { root.classList.add("spot-ascii"); hint.textContent = "마우스나 손가락으로 휘저어 보세요 · 버튼을 다시 누르면 돌아가요"; }
  });
  let on = false;
  new MutationObserver(() => {
    const now = root.classList.contains("spot");
    if (now === on) return;
    on = now; on ? scene.start() : scene.stop();
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
}
