// 학습 리포트 조절값 (SPEC §17 + TIME_FACTORS §9). 엔진(web/js/insight-engine.js)은 이 객체를 인자로만 받는다.
// data/insight_params.json이 있으면 같은 키를 덮어쓴다 (일부만 적어도 된다). 그 파일에 "ver"가 있으면 PARAM_VER가 된다
// → 리포트 캐시 키(ctx.key)가 바뀌어 모든 리포트를 다시 만든다.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "insight_params.json");

export const DEFAULTS = Object.freeze({
  grid: { lo: -4, step: 0.2, n: 41 },
  // 추측으로 맞힐 바닥 (lit.)
  guess: { ox: 0.5, short_num: 0.02, short_text: 0.05, essay: 0 },
  // 증거 무게
  w: { first: 1, retry: 0.5, spaced: 0.7, spaced_ox: 0.3, legacy: 0.6, legacy_fix: 0.3, idk: 1, idk_again: 0.5, self: 0.5,
    essay_pt: 1.5, disagree: 0.5, regrade: 0.5 },
  seenMin: 30,                       // 같은 세션, 이 분 안에 오답 뒤 다시 고르면 해설을 본 뒤로 본다 (옛 기록)
  recency: { half: 21, floor: 0.3 },
  hier: { tau: 0.7, prior_sd: 1 },
  diff: { ox: -0.3, mc: 0, short: 0.5, essay: 0.5, star: 0.5, exam: 0.2 },
  label: { minI: 0.5, minItems: 3, pendN: 8, delta: -0.3, weakP: 0.8, weakM: 0.5, solidM: 0.75, solidP: 0.8, unsureShare: 1 / 3,
    watchN: 8, watchP: 0.5, fixShare: 0.4 },     // watch: 약함 아래 "상대적으로 낮음" · fixShare: 고쳐짐 = 처음 틀린 문제의 40% 이상 다시 맞힘
  // 결정 8: 예전 기록이 많은 과목도 열리게 — n_eff와 '3문제 이상 푼 단원 3곳'만 본다 (예전 기록 포함).
  //   고른 답 기록(choice)은 고른 답으로만 만드는 진단(O/X 치우침·한정어·오개념·흩어진 보기)에만 문턱으로 쓴다
  gate: { n_eff: 30, chapters: 3, chItems: 3, choice: 15 },
  misc: { prior: { K: 0.45, U: 0.40, M: 0.15 }, ed: { 3: 1, 2: 0.85 }, q: { reviewed: 1, pass: 0.8, unverified: 0.7 },
    w: { first: 1, retry: 0.5, spaced: 0.5, legacy: 0.6, idk: 1 }, again: 0.5,
    flag: { sure: 0.85, likely: 0.70, hyp: 0.50, recovered: 0.30 } },
  habit: { rapid_n: 8, rapid_gap: 0.15, rapid_p: 0.9, ox_n: 12, ox_c: 0.35, ox_p: 0.9, ox_head: 0.95, qual_n: 2, essay_n: 3, essay_share: 0.5, essay_p: 0.8,
    prio: { qualifier: 0.60, ox_bias: 0.55, hasty: 0.55, fb_skip: 0.50, rapid_wrong: 0.50, fluency: 0.45, fatigue: 0.40, essay_skip: 0.35 } },
  find: { max: 3, conf: { sure: 1.2, likely: 1.0, hyp: 0.6 }, type: { misc: 1.3, confusion: 1.3, gap: 1.0, unclear: 0.8 },
    relearn: 0.4, relearn_due: 3, overlap: 0.5, kcItems: 3,
    format: 0.9, fmt: { n: 8, d: 0.15, p: 0.9 },                    // 유형별 첫 풀이: 추측 바닥을 뺀 정답률 차가 .15 넘을 확률 ≥ .9 (유형마다 8문제 이상)
    relative: 0.6, rel: { n: 6, eta: -0.5, s: 1, p: 0.9, max: 2 } }, // 약함이 없을 때: 내 평균보다 첫 풀이가 낮은 단원 (logit 효과 η < −.5일 확률 ≥ .9)
  plan: { items: 12, minutes: 15, band: [0.55, 0.8], cap_s: 180, gap_n: 3, diag_n: 2, relearn_n: 3, timed: [4, 6] },
  time: {
    b0: { ox: 6, mc: 20, short: 15 },           // 초 (로그로 쓴다)
    b_len: 0.5, b_calc: { ox: 0, mc: 1.2, short: 1.5 },
    s_tau: 0.6, sigma0: { ox: 0.8, mc: 1.0, short: 1.1 }, nu0: 10, clip: 2.5, nMin: 8,
    rapid: { frac: 0.10, lo: 1500, hi: 10000, oxFrac: 0.25, oxLo: 800 }, cap: 30 * 60e3,   // O/X 바닥 = 예측 중앙값의 ¼ (0.8–1.5초)
    z: { fast: -1.0, slow: 1.28, idle: 2.5 }, idleCap: { ox: 120e3, mc: 900e3, short: 900e3 },   // z > 2.5 또는 이보다 길면 자리를 비운 것으로 (계산 문제의 긴 풀이는 남긴다)
    nLen: 30, bSd: 0.4, listGap: 5,             // 길이 기울기: 30개 이상일 때 N(b_len, .4²)로 줄여 추정 · 목록 모드: 앞 답과 5분 안이면 간격으로 잰다
    unit: { prior: 0.4, ratio: 1.5, p: 0.8, n: 4 },
    wAssist: 0.3, assistMin: 30, quickIdk: 10000, quickIdkW: 0.5, starMin: 10,
    hasty: { n: 8, eta: -0.5, p: 0.9, s: 0.7, known: 3, days: 2, pKnown: 0.75 },
    fatigue: { gap: 10, late: 35, gamma: -0.3, p: 0.9, s: 0.5, nLate: 15, blocks: 3, nEarly: 30 },
    fb: { min: 3000, frac: 0.3, cps: 15, n: 8, k: 4, rate: 0.4, p: 0.8 },
    fluency: { items: 4, blocks: 2 },
    srt: 0, few: 20, listShare: 0.5, note: { n: 8, p: 0.9, gap: 0.1 },   // 속도–정확도 메모: 빠른 답·오래 푼 답 각 8개 이상, P(차 > .1) ≥ .9
  },
  caveat: { legacyShare: 0.4, tagShare: 0.5 },
});

const isObj = x => x && typeof x === "object" && !Array.isArray(x);
/** 기본값 위에 덮어쓰기 (객체는 깊이 합치고, 배열·값은 바꾼다) */
export function merge(a, b) {
  if (!isObj(b)) return a;
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return o;
}

function load() {
  if (!existsSync(FILE)) return { P: DEFAULTS, ver: 1 };
  try {
    const o = JSON.parse(readFileSync(FILE, "utf8"));
    const { ver, ...rest } = isObj(o) ? o : {};
    return { P: merge(DEFAULTS, rest), ver: Number.isInteger(ver) && ver > 0 ? ver : 1 };
  } catch (e) { console.error("[insight] data/insight_params.json을 읽지 못해 기본값을 써요:", e.message); return { P: DEFAULTS, ver: 1 }; }
}
const L = load();
export const PARAMS = L.P;
export const PARAM_VER = L.ver;
