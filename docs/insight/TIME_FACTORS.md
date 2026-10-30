# 학습 리포트: time and behaviour factors (spec for `web/js/insight-engine.js`)

Answers BUILD_P0_P1 decision 6. It extends SPEC §3–§5 and replaces only §3.3 options 2–3 (rapid threshold). All tunables go in `PARAMS.time` (params.js). Every number shown to the user comes from the engine, never from an LLM.

## 0. What the literature says (and the design rules it implies)

| finding | source | rule here |
|---|---|---|
| ln T = β_i − τ_j + ε, ε ~ N(0, α_i⁻²). β = item **time intensity**, τ = person **speed**. RT and accuracy are independent given (θ, τ) and linked only across persons. | [van der Linden 2006](https://ideas.repec.org/a/sae/jedbes/v31y2006i2p181-204.html), [2007](https://ris.utwente.nl/ws/files/5129699/Linden05hierarchical.pdf), [Klein Entink et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2792348) | Lognormal sub-model with shrinkage (§2). With one learner it gives **aberrance detection and a speed axis**. Extra θ precision needs ρ(θ, τ) over many people (P5). |
| SRT rule S = (2x − 1)(d − t): fast-correct scores highest, fast-wrong lowest. Math Garden runs Elo on it. Unmodelled individual speed differences bias θ. | [Klinkenberg et al. 2011](https://dare.uva.nl/id/de65bb65-d198-4dbc-ac7b-bc25ca23e627), [Maris & van der Maas 2012](https://dare.uva.nl/id/257c9569-e69c-466b-b813-c48c1e65942c), [Tijmstra & Bolsinova 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8359328/) | Quadrants are defined on **own-speed residuals** z, never on raw seconds. SRT partial credit is an off-by-default arm (§3). |
| Rapid guesses (< 10% of typical time) are non-effortful. Effort-moderated IRT treats them as missing. | [Wise & Kong 2005; Wise & DeMars 2006](https://commons.lib.jmu.edu/gradpsych/15), [NT10](https://search.r-project.org/CRAN/refmans/aberrance/html/detect_rg.html) | Kept, but the threshold now comes from the model's predicted median. |
| Beyond very fast answers, next-answer curves are flat. Slow-correct is **not** weaker evidence for selected response. Slow-wrong is slightly better than fast-wrong. Wrong answers say more than times. | [Pelánek 2018](https://www.fi.muni.cz/~xpelanek/publications/las18-observational-data.pdf), [Pelánek & Effenberger 2020](https://www.fi.muni.cz/~xpelanek/publications/answer-classification.pdf), [Pelánek 2024 review](https://link.springer.com/article/10.1007/s11257-023-09386-7) | Slowness never lowers mastery. Speed is a **separate axis** (`unit.speed`, the `fluency` finding). |
| First-response-time bins (per item 5/50/95%) gave next-correct .38 / .71 / .64 / .54. KT RMSE went .4251 → .4213. | [Wang & Heffernan 2012](https://educationaldatamining.org/EDM2012/uploads/procs/Short_Papers/edm2012_short_13.pdf) | Only the extremes carry information. The expected gain is about 1%, so ship only if eval.js shows it. |
| On EdNet, AUC .7816 (SAINT) → +elapsed .7858 → +lag .7898 → both .7914. Elapsed time capped at 300 s; lag time binned in minutes. | [SAINT+ (Shin et al. 2020), Table 4](https://ar5iv.labs.arxiv.org/html/2010.12042) | Lag beats elapsed time. Lag is already in the model (recency, retry/spaced, relearning). Elapsed time is capped. |
| Time-on-task effect is positive for problem solving, negative for routine items. | [Goldhammer et al. 2014](https://www.pedocs.de/volltexte/2019/17967/pdf/Goldhammer_etal_2014_time_on_task_effect_in_reading_and_problem_solving_A.pdf) | Never penalise thinking time on calc/essay items. |
| Fluency (correct *and* fast) is its own learning target; Elo variants use RT as mastery evidence. | [Řihák 2015](https://ics.muni.cz/en/research/publications/1316790) | `fluency` finding plus a timed practice step. |
| Accuracy declines through a practice session and recovers after breaks (break = ≥ 5 min without answers; 2.8 M attempts). | [Hodas et al. 2018](https://arxiv.org/abs/1809.02647) | `fatigue` finding, built on reconstructed study blocks. |
| Hint abuse occurs on 36% of actions, and correct-after-hint is weaker evidence (C−). Partial credit for help predicts better than binary scoring. | [Aleven et al. 2006](https://learnlab.org/research/wiki/index.php/Help_abuse), [Pelánek & Effenberger 2020](https://www.fi.muni.cz/~xpelanek/publications/answer-classification.pdf), [Ostrow et al. 2015](https://www.educationaldatamining.org/EDM2015/proceedings/short404-407.pdf) | `ai_copy` before answering makes that answer *assisted* (w × 0.3). |
| Attention to feedback is higher after wrong answers and falls as a test gets longer. Feedback works only if it is elaborated and read. | [Timmers & Veldkamp 2011](https://research.utwente.nl/en/publications/effects-of-feedback-in-a-computer-based-assessment-for-learning/), [Shute 2008](https://myweb.fsu.edu/vshute/pdf/shute%202008_b.pdf) | `fb_skip` finding from `sol_dwell`. |
| Low-confidence correct answers indicate partial knowledge or lucky guesses. High-confidence errors are corrected most readily after feedback (hypercorrection). | [Gardner-Medwin CBM](https://www.ucl.ac.uk/lapt/REAP_CBM.htm), [Hasan 1999](https://iopscience.iop.org/article/10.1088/0031-9120/34/5/304), [hypercorrection (secondary)](https://en.wikipedia.org/wiki/Hypercorrection_(psychology)) | A ☆ on a correct answer = *unsure*: it lowers confidence in `solid` and sends the item to relearning. |

## 1. Data audit (VACUUM INTO copy, 2026-10-25, read-only)

Only the heavy device has enough data: 358 answer/idk events. The other three devices have 3–4 events each, so no population exists yet. None of the Contract 5 fields exist in the data yet: `seen` 0, `vis` 0, and no `ai_copy` or `sol_dwell` events.

| quantity | value |
|---|---|
| answer events | 195 first attempts (attempt 1, non-seen), 71 seen (median 0.4 s after the previous wrong answer, accuracy .37), 24 later non-seen (lag median 16 h; 7 cross a KST day), 19 idk |
| mode | focus 308 / list 50 events |
| first attempts, s (p10 / median / p90, accuracy) | OX focus n = 121: 2.3 / 5.8 / 18.7, .83 · MC focus n = 19: 6 / 32 / 472 · MC list n = 26 (진인본 G23): 8 / 13 / 25 · short focus n = 10: 6.7 / 13 / 273 · essay n = 1 |
| speed by correctness after the seen filter | OX correct 5.7 s vs wrong 7.9 s. (codebase_map's "4.8 vs 1.9 s" came from post-feedback bursts.) On true statements, a wrong "X" takes 12.6 s vs 5.3 s for a correct answer: doubt, not haste. |
| timed first attempts (gates in §2.1) | 147. Overlap removed 3 focus + 1 list. Cells with n ≥ 8: 공학수학 OX 61 (σ̂ .69, ≈ 5.9 s), 경정시 OX 42 (σ̂ .73, 6.6 s), 생경론 OX 15 (σ̂ .99, 14.9 s). **Every MC and short cell has n < 8.** |
| time-intensity fit, LOO RMSE of ln t | OX .822 (no length term) → .808 (b_len .25–.5) → .856 (b_len 1); adding `q_sub` length does not help. `calc` items: MC 24 → 114 s, short 14 → 164 s; OX no effect. With the model, \|z\| > 1.645 for **9%** of answers (nominal 10%), so σ is calibrated. |
| speed vs accuracy (model z, expected accuracy from LOO chapter rate) | fast (z ≤ −1): n 15, accuracy .87 vs expected .81, so no haste. Slow (z ≥ 1.28): n 17, accuracy .65 vs expected .82 (η̂ −0.56). Slow means unsure on OX, consistent with Goldhammer's routine-task result. |
| rapid | 4 of 147, all at the 1.5 s floor. The 3 rapid OX answers were all **correct**, so do not raise the OX floor. |
| sessions | A `session_id` is not a study session: one browser session spans 70 h and 121 answers. Blocks rebuilt with a 10–15 min gap: 19 blocks, ≤ 90 min each. Fatigue: answers ≥ 30 min into a block, n 40, accuracy .85 vs expected .79. P(γ < −.3) = .04, so no signal. |
| hour (KST) | 204 of 358 answers at 0–2 h and 108 at 15–19 h. Accuracy by bucket .81 / .78 / .82, confounded with course. **Not used.** |
| idk | 5 quick (< 10 s, mostly essays), 7 after ≥ 30 s of focus, 5 in list mode stuck at the 30-min cap (untimed). |
| bookmarks | 38 ☆-on events, about 5 s after answering: 21 on wrong items, **7 on correct**, 3 on resolved, 7 on unanswered. None of the 7 correct-☆ items has been re-answered. |
| feedback dwell proxy | After a wrong first attempt, a median 8.3 s until the next card (5 of 33 under 5 s; 19 of 33 contain re-clicks). After a correct one, 1.5 s. |
| interruptions | Tab hidden during the attempt in 3 of 177 cases. |

**Usable now:** model-based rapid threshold, τ/σ on three OX cells, z per answer, unit speed (computed for 8 chapters, none flagged), idk timing, unsure ☆, blocks.
**Computed but silent until data grows:** fluency (needs ≥ 4 correct timed items per unit plus ≥ 8 in other units), hasty (≥ 8 fast answers), fatigue (≥ 15 late answers in ≥ 3 blocks), MC/short speed (cells ≥ 8).
**Only after the new instrumentation accumulates:** `fb_skip` (`sol_dwell`), assisted answers (`ai_copy`), list-mode timing (`vis`), the interruption gate (`away`). On today's data the model raises **no** time finding, which is the intended conservative behaviour.

## 2. Lognormal RT sub-model

### 2.1 Timed answers
An observation o is **timed** when all of the following hold:
1. `src = first`, it is not idk, kind ∈ {ox, mc, short};
2. `t` = `mode === "focus" ? ms : p.vis`, and t is present and > 0 (list mode without `vis` is untimed);
3. `!(p.away > 0)`;
4. no other answer event in this course's raw (another pid) has ts in (ts_o − t, ts_o). This catches back-navigation and two visible list cards;
5. o is not rapid (§2.4).

Retry and spaced times restart at the previous grade, so they are not modelled. Essays are never timed. `rd` and `hr` are recorded but unused in P1. `rd` is an eval arm: a cleaner thinking time for short answers, without typing. `len` is used only by essay_skip, where `len < 30` on an essay answer counts as skip-like.

### 2.2 Item time intensity (log seconds)
```
β_i = b0[k] + b_len·ln(max(20, len_i)/medLen[k]) + b_calc[k]·calc_i  (+ P5: population offset)
calc_i = kind ∈ {mc, short} && (body.num != null || #/\d+(\.\d+)?/ in strip(q) ≥ 3 || /\\\(|\\\[/.test(q))
```
- `len_i` and `medLen` come from ctx (Contract 2). `calc` is computed in the engine from `ctx.items[pid].body`, so there is no contract change.
- **P5:** when ≥ 5 other devices have timed first attempts on item i, set `β_i ← (n·β̂_i⁻ᵈᵉᵛ + 5·β_i)/(n + 5)` with `β̂_i⁻ᵈᵉᵛ = mean(ln t + τ̂_dev)` over the other devices (leave-one-out, as for difficulty).

### 2.3 Learner speed τ and noise σ per (course, kind)
Residual `r_o = β_i − ln t_o`, so `r_o` estimates τ (positive = faster). Prior `τ_ck ~ N(0, s_τ²)`, with `σ_k` known for each step:
```
r̃_o  = clip(r_o, −c·σ, +c·σ)                       (c = 2.5; Huber-style; idle tabs cannot drag τ)
τ̂_ck = (Σ r̃_o / σ²) / (1/s_τ² + n/σ²)              v_τ = 1/(1/s_τ² + n/σ²)
σ̂²_k = (ν0·σ0[k]² + Σ min(e_o², (cσ)²)) / (ν0 + n),  e_o = ln t_o − (β_i − τ̂_ck)
```
- Run two alternations (τ, then σ, then τ). σ is pooled per kind over the course, because one report covers one course.
- A cell is **active** when n ≥ `nMin` (8). Inactive cells still use τ̂ for the rapid threshold and the plan minutes, but never for z-based findings.
- **Expected median for this learner:** `m̂_i = exp(β_i − τ̂_ck)` s.

### 2.4 Rapid threshold (replaces SPEC §3.3 options 2–3)
- `T_i = clamp(0.10·m̂_i, 1.5 s, 10 s)`, computed in two passes:
  1. pass 1 with τ = 0 (defaults);
  2. fit τ and σ on the non-rapid answers;
  3. pass 2 recomputes T_i and the rapid flags.

  Stop after pass 2.
- SPEC option 1 (population median, P5) still takes precedence. List mode without `vis` is flagged with raw ms; that is a lower bound, as SPEC C12 says.

### 2.5 Residual and speed class
- `z_o = (ln t_o − ln m̂_i)/σ̂_k` for timed o in an active cell. The bias from including o in τ̂ is O(1/n) and is ignored.
- Classes: **fast** z ≤ −1.0 · **slow** z ≥ +1.28 · **idle** z > 3 (untimed after the fact, never evidence) · else normal.
- Quadrants: FC / FW / SC / SW.
- Evidence `fast` (Contract 4) = rapid ∨ z ≤ −1.

**Complexity:** O(n_obs) per pass plus the overlap check, which is O(n log n) on sorted ts. Well under 1 ms for 700 observations.

## 3. How speed enters mastery (conservative)
1. **Rapid** observations are excluded (unchanged), with the better threshold.
2. **Assisted:** an answer on pid within 30 min after an `ai_copy` with `st ∈ {new, wrong}` gets `w × wAssist` (0.3). It never counts toward `solid`, the `fixed` mark, relearning confirmation, or the fluency and hasty statistics. An `ai_copy` with `st ∈ {correct, resolved}` marks that item *unsure*.
3. **Unsure correct:** a ☆-on event ≤ 10 min after a correct non-seen answer, or `ai_copy` after a correct answer. The likelihood is unchanged. `solid` additionally requires `#unsure distinct correct items < ⅓·#distinct correct` in the unit, otherwise the label is `ok`.
4. **Quick idk on an essay** (t < 10 s, focus mode or `vis`): `w × 0.5`. Avoiding the effort of writing is weaker "doesn't know" evidence.
5. **SRT arm, off by default** (`srt = 0`): `y′ = (1 − λ)·y + λ·ys`, with ys = FW 0, SW .1, SC .9, FC 1, and normal answers keeping y. Current mode only. Guard: if a unit is `weak` only with λ > 0, use the λ = 0 label. Turn it on only after it passes eval.js (§7).
6. The initial-mode likelihood and the misconception layer never see time. Slow times never imply a misconception (SPEC §3.3).

## 4. Unit speed (`units[].speed`)
- For unit u with kind k in course c, use the **correct** timed answers in u against a leave-unit-out reference `τ̂_ck⁻ᵘ`. That keeps a dominant chapter from defining "normal" (공학수학 ox holds 51 of 61 OX).
- The reference needs ≥ `nMin` timed answers outside u; otherwise `speed: null`.
```
d_o = ln t_o − (β_i − τ̂⁻ᵘ_ck)        δ_u ~ N(0, 0.4²)
v = 1/(1/0.4² + n/σ̂²),  m = v·Σ d_o/σ̂²
speed = "slow" if P(δ_u > ln 1.5) ≥ .8;  "fast" if P(δ_u < −ln 1.5) ≥ .8;  "normal" otherwise;  null if n < 4 distinct items
```
- The ratio shown to the user is `exp(m)` with one decimal: "평소의 1.8배".

## 5. Behaviour findings

### 5.1 Selection
- All behaviour types (the SPEC §5.4 habits plus the types below) share the **single habit slot**, at most one per report. Each has a fixed `prio`, and it takes the 3rd finding only if it beats the remaining candidates (SPEC §5.6).
- Order and prio: qualifier .60 > ox_bias .55 = **hasty .55** > **fb_skip .50** = rapid_wrong .50 > **fluency** .45·(1 + .5·exam_share) > **fatigue .40** > essay_skip .35.
- A unit-bound behaviour finding (fluency) must not share a unit with another finding, and it is suppressed when the unit is `weak` or `pending` (accuracy comes first).
- Expected accuracy for the grid tests below: `p̂_o = P_o(E[θ_u])` from the mastery posterior of o's chapter, computed without time.
- Effect grid: `η ∈ [−4, 4]`, step .2, `logit P = logit p̂_o + η·[flag]`, prior N(0, s²), with posterior probabilities summed on the grid (as in SPEC §4.2).

### 5.2 `fluency` (맞히지만 오래 걸림, 시간 재고 풀기)
- **Gate:** unit label ∈ {ok, solid}; `speed = "slow"` (§4); ≥ 4 distinct correct timed items spread over ≥ 2 blocks; no assisted or unsure items among them.
- **Evidence chips:** the 3 slowest correct items, `role: "slow"`, with `sec` and `rel`.
- **Text example:** diag "'행렬식 성질'은 맞히고 있지만 비슷한 길이의 문제보다 1.8배 오래 걸려요 (맞힌 5문제, 내 예상 12초 → 실제 22초)." cue "시험에서는 시간이 점수예요. 목표 시간 안에 답을 정하고, 넘으면 표시하고 넘어가기."
- **Plan step:** `type: "timed"`, title "시간 재고 풀기 · 5문제 · 문제당 약 12초". Items: unit items correct ≥ 1 day ago plus unattempted ones, 4–6 in all. `target_s = clamp(round(exp(β_i − τ̂⁻ᵘ_ck)), 5, 180)`, the learner's own pace on comparable items elsewhere.

### 5.3 `hasty` (서두르다 틀림)
- **Gate:**
  - ≥ 8 fast (z ≤ −1) timed answers, with P(η < −.5) ≥ .9 under prior s = .7;
  - ≥ 3 fast-wrong items that the learner demonstrably knows, on ≥ 2 KST days. "Knows" means a later non-seen correct answer on the item ≥ 1 KST day later, **or** p̂_o ≥ .75 in a non-weak unit.
- **Text example:** diag "평소보다 빨리 답한 문제에서 틀려요: 빠른 답 9개 중 4개 오답 (같은 난이도라면 1.6개 예상). 그중 3문제는 다음 날 다시 맞혔어요." Chip example: [2.3-7 · O라고 답함 · 2.1초], `role: "fast"`. cue "답하기 전에 '항상·모든·만' 같은 조건어를 한 번 더 읽기."
- **Plan step:** "천천히 다시 풀기 · n문제" (the fast-wrong items still wrong, plus unattempted items from the same units).
- `rapid_wrong` (SPEC) stays, but it is dropped when `hasty` fires.

### 5.4 `fatigue` (오래 풀면 정확도 저하)
- **Blocks:** maximal runs of the device's answer events with gaps ≤ `blockGap` (10 min). Block start = ts of the first answer − its ms. When `pos`/`sess` are present, they only mark that other-course answers happened in between (Contract 1 is per course).
- **Flag:** `late = (ts − start) ≥ lateMin` (35 min). Prior s = .5.
- **Gate:** P(γ < −.3) ≥ .9, late n ≥ 15 answers in ≥ 3 blocks, early n ≥ 30.
- **Text example:** "35분 넘게 이어서 풀면 정확도가 떨어져요: 처음 35분 82% → 그 뒤 61% (같은 난이도 기준, 4번 중 3번의 학습에서)." cue "30분쯤 풀면 5분 쉬고 이어 풀기."
- **Plan:** no step. `plan.today.minutes` is capped at `min(15, lateMin)`.

### 5.5 `fb_skip` (해설을 읽고 넘어가기); needs `sol_dwell`
- **Skip:** a `sol_dwell` with `ok = false` after a non-seen wrong answer, with `ms < max(3 s, 0.3·R_i)`. `R_i = strip(body.s).length / 15` s, i.e. reading at about 15 characters per second.
- **Gate:** n ≥ 8 dwells, k ≥ 4 skips, and Beta(1 + k, 1 + n − k) gives P(rate > .4) ≥ .8.
- **Text example:** "틀린 뒤 해설을 3초 안에 넘긴 문제가 8개 중 6개예요. 그중 다시 푼 4문제는 2개만 맞혔어요." cue "틀리면 해설에서 함정 문장 하나를 찾아 읽고 넘어가기."
- **Plan step:** "해설 읽고 다시 풀기 · n문제" (skipped items, due after 1 day, opened with the answer hidden if still wrong).
- The old-data proxy (next card's shown time minus this grading) is used only by eval.js.

### 5.6 Help and uncertainty: no card of their own
- **Unsure and assisted items** go into `relearn.due` once ≥ 1 KST day has passed since that answer, and stay there until a later-day non-seen correct answer. Text: "자신 없다고 표시한 문제 3개, 오늘 다시 확인".
- **Chips** get the label suffixes "· ☆ 자신 없음" and "· AI 도움".
- **idk timing** enriches the gap card signals: "'모르겠어요' 3번 (그중 2번은 1분 넘게 고민한 뒤)". The essay_skip habit counts only quick idks.

## 6. det additions (Contract 4, all additive)
```js
time: { speed: null /* P5: vs population τ; null until ≥5 other devices timed in the course */,
        n_timed, ref: { ox: 6.1, mc: null, short: null } /* exp(b0+τ̂) s at medLen, active cells only */,
        counts: { rapid, fast_wrong, slow_correct, assisted, unsure, fb_skip: [k, n] | null },
        notes: ["집중 모드에서 잰 첫 풀이 147개로 내 풀이 속도를 계산했어요."] },
units[].speed: "fast"|"normal"|"slow"|null,
findings[].type += "fluency"|"hasty"|"fatigue"|"fb_skip";  evidence[].role += "slow"|"fast";  evidence[] += { sec, rel },
plan.steps[].type += "timed";  plan.steps[] += { target_s },
caveats += "few_timed" /* n_timed < 20: "풀이 시간을 잰 기록이 아직 적어(집중 모드 n개) 시간 분석은 뺐어요." */,
           "list_time" /* > 50% list answers without vis: "목록 모드로 푼 문제는 시간을 정확히 잴 수 없어 시간 분석에서 뺐어요." */
```
**Update order inside `buildReport`:**
1. `normalize` (seen, legacy, src)
2. join `raw.aux`
3. timed gates
4. β
5. rapid pass 1 → τ, σ → rapid pass 2 → τ, σ
6. z, quadrants, assisted and unsure flags
7. `scoreConcepts`
8. unit speed
9. habits plus §5 findings
10. `selectFindings` → `buildPlan`, with item minutes = `min(180 s, m̂_i)`
11. `composeText`

**Contract 1 extension (server owner, optional):** `raw.aux = [{rid, pid, v, type: "ai_copy"|"sol_dwell"|"bookmark", ts, p}]`, from the same SQL with those types. When it is missing, §3.2–3.3, §5.5 and the unsure part of §5.6 are skipped silently.

## 7. Validation plan (`eval.js`, run later)
**Prequential evaluation:** predict every event-level first attempt from earlier data only.
- Metrics: log-loss, Brier and AUC per course; bootstrap the CI by device.
- Arms, each building on the previous one:

| arm | contents |
|---|---|
| A0 | SPEC as written |
| A1 | model-based T_i |
| A2 | + assisted / unsure weights |
| A3 | + SRT, λ ∈ {.25, .5} |
| A4 | + d0 += κ·(β_i − b0[k]), κ ∈ {.2, .4}; labour-intensity ≈ difficulty (Pelánek: r ≈ .7 in math) |
| A5 | spaced threshold of 6 h / 12 h instead of a KST day; lag (SAINT+) |

- **RT sub-model checks:** RMSE of ln t against the kind-median baseline; coverage of \|z\| > 1.645 should stay at 8–12%.
- **Findings check:** next non-seen accuracy should be
  - higher on hasty-flagged fast-wrong items than on other wrongs;
  - lower in fluency-slow units (the Wang & Heffernan long bin);
  - lower on skipped-feedback items.
- **Ship rule:** an arm ships only with Δlog-loss ≤ −0.005 per answer, its 90% CI excluding 0, on ≥ 2,000 timed first attempts from ≥ 5 devices.
- **Tune:** b_len, b_calc, σ0, s_τ, nMin, the z cutoffs, blockGap, lateMin, the skip ratio, wAssist, λ, κ.

**Simulation** (sim.test.js, added): lognormal times with τ ~ N(0, .4²), β = prior + N(0, .5²), σ .8. Plant a fluency deficit δ = .7 in one unit for 30% of learners, plus hasty learners.
- fluency and hasty precision ≥ .8;
- false-flag rate < 5% when nothing is planted;
- `weak` labels identical with and without time (time never creates `weak`);
- \|z\| > 1.645 share in [.08, .12].

## 8. What NOT to do
- Never label a unit weak, nor infer a misconception, from slowness. Never lower mastery for long thinking on calc or essay items.
- Never compute τ or z from list-mode raw ms, interrupted attempts (`away`), overlapping windows, retries, or idle answers (z > 3).
- Never compare a learner's speed with other people before P5. Never show other learners' times.
- **No hour-of-day profiling:** `hr` is unused in P1, absent from det and admin preview, and never sent to Gemini (SPEC §12). The evidence is only correlational ([e.g.](https://ar5iv.labs.arxiv.org/html/1906.09864)).
- No running clock in normal practice, because showing that time is measured changes behaviour (Pelánek 2018). A countdown appears only inside a chosen "시간 재고 풀기" set (a later web task).
- ☆ and AI copy are never "cheating" or penalties. They only lower confidence in `solid` and schedule rechecks.

## 9. Parameters (`PARAMS.time`)
| key | default | source |
|---|---|---|
| b0 (s) | ox 6, mc 20, short 15 (log scale) | SPEC §3.3 defaults |
| b_len | 0.5 | audit LOO optimum .25–.5; SPEC √ scaling |
| b_calc | ox 0, mc 1.2, short 1.5 | audit medians ×4.8 / ×11, halved toward 0 |
| s_τ | 0.6 | heuristic; tune |
| σ0, ν0 | ox .8, mc 1.0, short 1.1; ν0 10 | audit σ̂ .69–.99, LOO RMSE .81 |
| clip c | 2.5 | robust (Huber) |
| nMin | 8 | SPEC §3.3 n ≥ 8 |
| rapid | 0.10·m̂, [1.5 s, 10 s] | NT10, Wise & Ma; cap per NWEA |
| fast / slow / idle z | −1.0 / +1.28 / +3 | Wang & Heffernan extreme bins; Pelánek 5–20% |
| unit speed | prior .4; ratio 1.5; P .8; n ≥ 4 | heuristic, conservative |
| wAssist / quick-idk essay | 0.3 / 0.5 | Ostrow 2015 hint partial credit; effort moderation |
| unsure share for solid | < ⅓ | CBM "C = 1" ≈ P < .67 |
| hasty | n ≥ 8, P(η < −.5) ≥ .9, s .7, ≥ 3 known items, ≥ 2 days | heuristic; sim-tuned |
| fatigue | blockGap 10 min, lateMin 35, P(γ < −.3) ≥ .9, s .5, late ≥ 15 in ≥ 3 blocks | Hodas 2018 (break ≥ 5 min); audit blocks ≤ 90 min |
| fb_skip | max(3 s, .3·R), 15 chars/s, n ≥ 8, k ≥ 4, P(rate > .4) ≥ .8 | Timmers & Veldkamp 2011; heuristic |
| SRT λ | 0 (arms .25 / .5) | Maris & van der Maas 2012; Tijmstra & Bolsinova 2021 |
| prio | hasty .55, fb_skip .50, fluency .45, fatigue .40 | SPEC §5.6 habit .5 scale |
