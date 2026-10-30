# 학습 리포트 v2 — 개념 깊이 진단 알고리즘 (ALGORITHM.md, 서버 담당, 2026-10-26)

Status: **design only.** The user's decisions of 2026-10-26 (`DECISIONS.md`) are applied: no confidence tap, a looser judgment with hedged wording, variants written by Claude sessions, the card wording is approved, and rollout is per course. Building still waits for a separate approval. No code, DB or test changes were made for this document.
The calculations quoted below were run in a scratch copy, not in the project.

Companion files, and how they are aligned (names are final in this file, §2 and §8):
- `DATA.md` (DB) supplies the inputs in §2: field names `facet`, `depth`, `mis`, `family`, `role`, `delta_type`, `delta` and `conf`.
- `REPORT_UX.md` (프론트엔드) shows only what §5 allows; det shape in §8.

---

## 0. Summary

1. The unit of diagnosis moves from 단원 to **세부 포인트 (`facet`)**: 단원 → 개념(kc) → facet. A facet is one fine conceptual detail, such as `dot.eq` "슈바르츠 등호 조건 = 평행". It is never case trivia (numbers, names, years).
2. Each facet gets two separate judgements:
   - **depth D**: 확실히 앎 K / 얕게 앎 S / 모름 N;
   - **misconception H**: holds a specific wrong idea m (착각) — yes or no.
   Keeping them apart is what lets the report say "익숙한 형태는 맞히는데 살짝 바꾸면 같은 착각으로 틀린다".
3. Evidence is graded by **depth** (1 정의 → 2 적용 → 3 구별 → 4 조건) and by **variant family** (base / iso / near). Only chosen options that map to a named misconception can support a named 착각.
4. **Two strengths of claim, looser than the first draft** (§5):
   - **Firm wording** ("~예요"):
     - 착각: the same wrong idea on **≥ 2 different problems**.
     - 확실히 앎: **≥ 3 problems**, including a correct depth 3–4 problem.
   - **Hedged wording** ("~일 수 있어요" / "~것 같아요"), always with a 확인 문제:
     - 착각: one problem's worth of the wrong idea.
     - 확실히 앎: 3 problems without a correct depth 3–4 one.
     - **덜 다져짐**, with a 얕게 앎 or 모름 sub-label: from 2 problems.
   - Everything else is **판단 보류**, with a reason and the **1–3 problems that would decide it** (확인 문제, chosen by expected information gain).
   - Every claim shows its evidence chain.
5. **It extends `insight-engine.js`.** The Rasch layer stays for course and chapter level, gate, habits, relearning and time. The facet layer is a new pure module. It switches on only where items carry v2 tags, so untagged courses keep today's report.

---

## 1. What the user asked, turned into decisions the model must make

> "이렇게 내서 이걸 틀리면 이 개념을 확실히 아는 거고, 이렇게 냈을 때 틀리면 이 정도만 알고 있는 거구나… 살짝만 바꿔 낸 문제를 또 틀리네? 알고 있다고 착각하는 거구나."

| User's words | Model output | Evidence it needs |
|---|---|---|
| 확실히 앎 | D = K, no m | correct across depths **and** variants, including depth 3–4 or a near variant |
| 이 정도까지만 앎 → 더 학습 | D = S, `depth` = the highest level that reliably holds | depth 1–2 correct; depth 3–4 or near variants wrong **without** one recurring wrong idea |
| 모름 | D = N | 모르겠어요, scattered wrong choices, chance-level accuracy |
| 착각 (`misc`): 같은 틀린 생각 | H = m | the m-tagged choice on ≥ 2 different problems |
| 착각 (`familiar`): 살짝 바꾸면 틀림 | D = S **with** base/iso right | ≥ 1 base/iso right + ≥ 2 different near members wrong, same facet |
| 어느 단원 어느 부분 | every claim carries chapter → kc → facet → problem chips with the chosen option, what it means, and what changed versus the base | tags (§2) |

**Design principles.** Each one is a rule the implementation must keep.

1. **Probe, don't over-infer.**
   - With dozens of option-level answers per course, most facets have 1–3 problems, so honest output is mostly "판단 보류".
   - The report then says *which* next problem would decide it (§6). This is item selection in cognitive-diagnosis CAT (Cheng 2009; Kaplan et al. 2015).
2. **Options carry the diagnosis.** This is the Ordered Multiple-Choice and facet tradition: each option maps to an idea (Briggs et al. 2006; Minstrell's goal and problematic facets, DIAGNOSER).
3. **A misconception is a wrong idea that recurs across problems.** Systematic errors recur; slips don't (Brown & Burton; VanLehn). Recurrence on the *same* problem is weaker: it may be memory of one's own answer.
4. **Generic.** Nothing depends on a course id, code or name.
5. **No percentage per facet.** At this data size a "73%" is false precision. The report shows a state, a confidence word, and the ladder of what was actually asked.

---

## 2. Inputs (contract with `DATA.md`)

### 2.1 Concept map, per course

```
chapter ─ kc (exists) ─ facet   code "<kc>.<f>", name, statement (goal facet, the correct view)
misc                            code, facet, belief ("~라고 생각함"), truth, cue?, cw (confusable kc, optional), status
```

Read with `db.facetsOf(cid)` and `db.miscOf(cid, facet?)`. Optional `facet.pre[]` (prerequisites) is used only as a weak prior (§3.2).

### 2.2 Item annotation, per problem version (`item_tag` + `family_member`)

| field (DATA.md name) | used for |
|---|---|
| `facet` (primary); `facets2` (≤ 2, weight 0.3) | which facet the evidence updates |
| `depth` 1–4: 1 정의 · 2 적용 · 3 구별 · 4 조건 (DATA §4.2 rubric) | the depth ladder; P(success \| S) |
| `family`, `role` (base · iso · near), `delta_type`, `delta` | the `familiar` 착각 chain, probe diversity, the "바뀐 점" text |
| `mis` (MC: array parallel to `opts`; OX: planted error / `mr`; short: patterns; essay: per point) | hit/avoid likelihood (§3.3) |
| `conf` 1–3 (tag trust), `src` (author · llm · admin) | evidence exponent (§3.4) |

UI names for the depths, confirmed by the user (DECISIONS §4): **1 정의 · 2 적용 · 3 구별 · 4 조건**. This is DATA's order with level 4 labelled 조건. det uses `lv: "L1".."L4"` for the same 1–4.

| depth (DATA) | det | UI label |
|---|---|---|
| 1 | L1 | 정의 |
| 2 | L2 | 적용 |
| 3 | L3 | 구별 |
| 4 | L4 | 조건 |


**Why this order.** It follows DATA.md's rubric, anchored on Webb's DOK and revised Bloom. Webb measures how deeply the content must be understood, not the verb (Hess Cognitive Rigor Matrix). Telling a facet from its neighbour (구별) is harder than applying it in the taught form (적용), so 구별 sits above 적용. Depth ≠ difficulty; difficulty stays the engine's Rasch b.

**Why families.** Near variants keep the governing principle and change one radical. That is exactly where shallow knowledge fails to transfer (Bassok & Holyoak 1989; Singh 2008). Family structure follows automatic-item-generation item models (Sinharay, Johnson & Williamson 2003).

### 2.3 Learner evidence and how it is cleaned

Sources are `event` (answer_submit, idk), `ai_grade` and imported `progress`, through the v1 evidence layer (SPEC §3), plus these v2 rules:

| rule | why | real case |
|---|---|---|
| **Burst collapse:** same item and same answer re-submitted within 3 s → one response; the count goes to `excluded.burst` | Re-clicks are not repeated beliefs | 진인본 X-22: "B" recorded 9 times, #1–#9, within 1.1 s |
| **Rapid answers** (v1 NT10; a sub-second re-tap is always rapid) → excluded, counted in `excluded.rapid` | Disengagement | 공학수학 ox-59: 8 of 11 "O" answers under 200 ms (프론트엔드 count) |
| First attempt: weight 1.0 | | |
| Same item, same session, after a wrong answer: MC weight 0.3 with tried options removed; OX dropped | The answer is hidden but options are being eliminated | |
| Same item on a **later KST day**: weight 0.7, `fb=true` if the answer had been seen | A spaced re-answer reflects the current belief | 공학수학 ox-1 (§7) |
| Legacy rows (no chosen option): correctness only, weight 0.6, **never** a hit | No option, so no idea can be read | 진인본 7-2 |
| Answer confidence `payload.conf` (2 확신 · 1 반반 · 0 찍음) | **Not collected** (DECISIONS §2); all thresholds in §5 are set without it | — |
| Response time: never used to infer depth or misconception | Slower wrong answers even predict slightly better later performance (Pelánek 2018) | |

---

## 3. The model, per facet

### 3.1 States

Joint state = (D, H):
- D ∈ {K, S, N};
- H ∈ {0, m₁, m₂, …}, at most one active misconception per facet, chosen from the facet's misc rows.

That gives 3 × (1 + |M_f|) states, usually 3–12. The posterior is exact, by enumeration.

**Why two axes.** A single list K/S/N/M cannot tell 얕게 앎 from 착각 on items that don't offer m: both look the same there, so M just keeps its prior share.
- In the scratch run, the one-axis model gave the shallow pattern P(S) = .54 and P(M) = .36.
- The factorised model gives P(S) = .84.

It also matches the user's description: a learner can know a facet at the definition level *and* hold one wrong idea about a detail.

### 3.2 Priors

- **D, default:** K .40 · S .35 · N .25.
- **Shifted by the v1 chapter label** (light hierarchical coupling):
  - weak → .25 / .40 / .35;
  - solid → .55 / .30 / .15.
- **H:** each m gets min(.10, .30/|M_f|); H = 0 gets the rest.
- **Prerequisite** (`facet.pre`) S or N with P ≥ .8 → halve this facet's K prior and move the mass to S. This is a weak version of Knowledge Space Theory's surmise relation (Doignon & Falmagne).

### 3.3 Likelihood of one response

Notation:
- g = guess floor (OX .5, MC 1/k, short .05, essay 0)
- k = number of options
- a = number of wrong options tagged with the m being considered

Response categories: C correct · H the m-tagged wrong choice · W another wrong choice · I 모르겠어요.

**A holder (H = m) on an item that offers m:**

| | C | H | W | I |
|---|---|---|---|---|
| MC | .12 | .75 / a | .13 / (k − 1 − a) | .03 |
| OX | .20 | .80 | — | .03 |

The C/H/W shares are scaled by 1 − P(I). If there is no other wrong option, W's share goes to H.

**Otherwise (H = 0, or the item doesn't offer m), by D:**

| D | P(I) | P(C ∣ not I), by depth 1 / 2 / 3 / 4 |
|---|---|---|
| K | .02 | 1 − slip: .92 / .90 / .85 / .85 |
| S | .10 | g + (1 − g)·q, q = .85 / .60 / .25 / .25 |
| N | .35 | g |

- Wrong answers are spread evenly over the wrong options. Only a holder prefers one.
- A near variant's own `depth` decides its column. A near item that keeps depth 2 is still scored at depth 2. The family adds the chain and the `familiar` rule (§5), not extra likelihood.
- **Feedback modifier:** if `fb` and the response repeats the m-tagged wrong choice, multiply the non-holder likelihood by 0.5.
  - A non-holder who has seen the answer rarely picks the same wrong idea again; a holder does.
  - Even confident errors are usually corrected after feedback (the hypercorrection effect, Butterfield & Metcalfe 2001). So a wrong idea that survives feedback is informative.
- **Answer confidence: not used**, because it is not collected (DECISIONS §2). The table below is kept only so the field can be switched on later without redesign (heuristic):

  | response | holder | K | S | N |
  |---|---|---|---|---|
  | `conf=2` 확신 and wrong | × 1 | × .5 | × .5 | × .3 |
  | `conf=0` 찍음 and wrong | × .4 | × 1 | × 1 | × 1 |

  - `conf=0` 찍음 and correct: weight .3.
  - This is the Certainty-of-Response / three-tier logic: confident and wrong = misconception, unsure and wrong = lack of knowledge (Hasan et al. 1999; Pesman & Eryilmaz 2010).
- **Short and essay answers:**
  - Typed text matching a `mis` pattern = H (holder .55, others .02–.04).
  - An essay rubric point tagged m with verdict missing = a weak H at exponent .5.

The depth ordering is built into the tables: K succeeds at every depth, S mostly at 1–2. This is the attribute-hierarchy idea, as a fixed-parameter DINA-style latent class model per facet.

There is **no population fitting.** That is deliberate: DINA and G-DINA need hundreds to about 1,000 respondents to estimate guess and slip (Sorrel et al. 2023).

### 3.4 Evidence exponent

log-likelihood += w · e_t · log P(response | state), where:
- w comes from §2.3;
- e_t = tag trust: `conf` 3 or `src`=author/admin → 1.0; conf 2 → .85; conf 1 → .7;
- `facets2` evidence gets × 0.3.

All numbers in §3.2–3.4 are **heuristic starting values**. The literature-backed parts are the guess floors, slip ≈ .1, and the recurrence rule. §9 says how to tune the rest.

---

## 4. Telling 착각, 실수, 찍기 and 얕게 앎 apart (scratch run)

| Evidence on one facet | Posterior | Conclusion |
|---|---|---|
| depth 1, 3, 4 correct; one m-tagged miss | K .66, m .02 | **slip**, not 착각. Slips are isolated (VanLehn). Not yet 확실히 앎 (K < .70) → 판단 보류 + `confirm_solid` probe |
| base right (doesn't offer m) + two variants answered with the m option | m .92 | **착각 (misc)** |
| depth 1, 2 right; depth 3, 4 wrong with *different* options | S .84, m ≤ .15 | **얕게 앎**, `depth` = 적용 |
| 모르겠어요 ×2 + one scattered wrong | N .94 | **모름** |
| same item, same m answer, on two KST days, after seeing the answer | m .80 | **hedged 착각** only (rule 4), plus a probe on a different item; never firm from one item |
| two OX hits on different items | m .67 | 판단 보류. OX hits are weak (U = .5); three distinct OX hits → .89 |
| only legacy wrong answers | N .67 | never 착각 (no chosen option) |

---

## 5. Decision rules (looser, two wording strengths — DECISIONS §3)

The user wants diagnoses sooner and accepts an occasional wrong call. So each facet now gets one of three kinds of output:

- **firm** (`tier: "firm"`): stated plainly.
- **hedged** (`tier: "hedged"`): "~일 수 있어요 / ~것 같아요", **always** with a 확인 문제 row (§6).
- **판단 보류.**

Every non-pending output shows its evidence chain (§8 `chain`, `ladder`). Rules are checked top to bottom; the first match wins.

| # | `state` / `tier` | rule | wording |
|---|---|---|---|
| 1 | `illusion` / firm, `kind: "misc"` | P(H = m) ≥ **.70** and m-hits on ≥ 2 distinct non-legacy items | "알고 있다고 착각하고 있어요 — '{belief}'와 섞고 있어요" |
| 2 | `illusion` / firm, `kind: "familiar"` | same facet: ≥ 1 base/iso member right **and** ≥ 2 distinct near members wrong (first attempts, non-rapid), P(S) ≥ .65, no m with P > .5 | "익숙한 형태는 맞히는데, {change} 바뀌면 틀려요" |
| 3 | `solid` / firm | P(K) ≥ .80, P(any m) < .30, ≥ **3** distinct items, ≥ 1 correct at depth 3–4 or a near member | "확실히 알고 있어요" |
| 4 | `illusion` / hedged, `kind: "misc"` | P(H = m) ≥ **.55** and ≥ 1 m-hit (one item, or the same item again after feedback) | "'{belief}'로 보고 있을 수 있어요" + 확인 문제 |
| 5 | `solid` / hedged | P(K) ≥ .70, P(any m) < .30, ≥ 3 distinct items | "잘 아는 것 같아요" + 확인 문제 |
| 6 | `weak` / hedged | P(S) + P(N) ≥ .70, ≥ 2 distinct items | "아직 덜 다져진 것 같아요" + 확인 문제 |
| 6a | ↳ `sub: "shallow"` | also P(S) ≥ .65, ≥ 1 correct at depth 1–2 **and** ≥ 1 miss at depth 3–4 | "{depth명}까지는 맞히는데 {miss lv명}에서 막히는 것 같아요" |
| 6b | ↳ `sub: "gap"` | also P(N) ≥ .70 | "아직 잡히지 않은 것 같아요" |
| 7 | `pending` | anything else | "판단 보류" + why + 확인 문제 |

**Why 얕게 앎 and 모름 are only sub-labels.**
- The simulation tells "덜 다져짐" (S or N, or holding an m) from "확실히 앎" reliably, at ≈ 90% precision.
- It separates S from N much less well: ≈ 65–70% for 얕게 앎 and ≈ 73–78% for 모름.
- So the firm claim is the parent ("덜 다져짐"). The sub-label always uses hedged wording, plus the factual ladder ("정의 문제 2개 맞힘, 조건 문제 2개 틀림").
- When the sub-label is wrong, the advice is the same either way ("더 학습"), so the error is mild.

`pending` always carries `why`:
- `few_items`: < 2 distinct items, or posteriors short of every rule above;
- `one_format`: all items are OX, or all MC;
- `no_variant`: no near member was answered;
- `untagged`: < 60% of the facet's answered items are tagged;
- `rapid_only`: > 50% of the facet's attempts were excluded as rapid.

The old `why: "suspect"` is gone: that case is now rule 4 (hedged 착각 + 확인 문제).

**Depth and ladder.**
- For each depth, report `st`: ok · miss · mixed · none (no items at that depth), plus the item chips.
- `depth` = the highest level with P(C | level) ≥ .7 under the posterior, **at least one observed correct answer at that level, and ≥ 2 distinct correct items at or below it.**
- It is never claimed for a level that was not asked.
- The ladder is not a curriculum order. The UI never infers "적용이니까 정의도 안다"; the model's prior ordering affects only the posterior.

**Simulation (scratch run, final rule set).**
- Truth was generated with deliberately different tables from the model's (K slip .2, holder hit .6 MC / .7 OX, S success .8/.5/.2/.2 by depth).
- 3,000 learners per cell × 3 OX shares (0, .5, 1), pooled. Truth: 40% K, 36% S, 24% N; 30% hold m.
- Depths are drawn at random per item, and item 1 never offers m.
- FA = false calls among learners for whom the claim is untrue.

| items per facet | 판단 보류 (strict draft → now) | 착각 firm: prec · FA | 착각 hedged: prec · FA | 확실히 앎 firm: prec · FA | 잘 아는 것 같아요: prec · FA | 덜 다져짐: prec · FA |
|---|---|---|---|---|---|---|
| 2 | ≈ 92% → **50%** | — (needs 2 hits on items that offer m) | 72% · 4.2% | — | — | 89% · 15% |
| 3 | 76–84% → **30%** | 86% · 2.3% | 75% · 1.9% | 84% · 1.1% | 69% · 3.8% | 90% · 14% |
| 4 | 52–73% → **24%** | 91% · 2.0% | 69% · 2.0% | 85% · 1.6% | 71% · 3.0% | 90% · 15% |
| 6 | 35–53% → **19%** | 95% · 1.5% | 77% · 0.8% | 88% · 1.9% | 78% · 1.6% | 91% · 14% |

How to read it:
- **Firm claims stay trustworthy:** 착각 86–95% and 확실히 앎 84–88% precision, both with FA ≤ 2.3%. Of the firm 착각 errors, most are learners who are only S or N, not tidy-K learners.
- **Hedged claims are wrong about 1 time in 4.** That is what the user accepted. The wording says "~일 수 있어요", and the 확인 문제 settles it: one probe answered with m takes the worked case B from .80 to .98, and answered correctly to .63 (§6).
- **덜 다져짐's FA of ≈ 15%** means 15% of truly solid learners also see "아직 덜 다져진 것 같아요" for that facet, usually after one slip. It is a hedged nudge to review, with a 확인 문제. This is the price of fewer 판단 보류.
- **Versus the strict draft:** the solid rule went from 4 items to 3. At 3 items the strict draft could never say 확실히 앎; firm precision is still 84%. The 착각 bar went from .75 to .70, which raised FA by only ≈ 0.4 pt.
- **Not simulated yet:** the `familiar` kind. It needs the real family structure (build round).
- **The numbers are only as good as the tags.** A wrong `mis` tag makes a false 착각, which is why rule 1 requires tag `conf` ≥ 2.

**Never claimed:**
- any state from < 2 distinct items, except hedged 착각 (rule 4), which always carries a 확인 문제;
- 착각 from legacy rows;
- a mastery percentage;
- firm `illusion (misc)` from tags with `conf` 1. Those can reach only rule 4.

**Coverage this needs**, sent to DB for DATA.md §7: per facet, ≥ 4 items in total (was ≥ 5):
- 1–2 at depth 1–2;
- ≥ 1–2 near members at depth 3–4 with different delta_types;
- ≥ 3 items offering the leading misc, so that a 확인 문제 is still unseen after a hit;
- ×1.5 for ★/exam facets.

---

## 6. Probes (확인 문제): the next problem that decides it

For every facet with a **hedged** output (rules 4–6) or `pending`. Hedged wording is never shown without this row (DECISIONS §3); firm `solid` gets none.

1. Candidates are unattempted, published items with this `facet`. Items with it in `facets2` count at 0.3.
2. For each candidate, compute EIG = H(post) − Σ_r P(r) · H(post | r), over r ∈ {C, H_m…, W, I}. Shannon-entropy selection performs on par with PWKL and MPWKL on short tests (Kaplan et al. 2015).
3. Pick ≤ 3 greedily. Prefer a different family member (a near member if only base/iso was seen), and items that offer the leading m.
4. `reason`:
   - `illusion_or_slip`: "착각인지 한 번의 실수인지 가려 줄 문제"
   - `depth_unknown`: "적용·구별 수준을 확인할 문제"
   - `confirm_solid`: "확실히 아는지 확인할 문제"
5. If there is no candidate, set `need_variant` (facet, wanted depth/delta_type, leading m) for DATA.md §9's generation queue. The UI says "확인할 문제가 아직 없어요".

**Effect, case B (§7):** one probe answered with m takes P(m) from .80 to .98 on 2 distinct items → firm 착각. Answered correctly, it goes to .63 → stays hedged ("~로 보고 있을 수 있어요").

When `need_variant` is set, the variant is written by a **Claude authoring session**, checked by a blind Sonnet solver, and imported hidden; an admin publishes it (DECISIONS §1). Gemini does not write variants. The engine only ever proposes published items.

---

## 7. Worked examples (real heavy device, 21:52 copy of the live DB)

These show what the engine will say **once items are tagged**. Facet and misc names are proposals, not reviewed.

**A. 공학수학 · 내적 · `dot.eq` "슈바르츠 등호·극값 조건 = 평행 (|cosθ| = 1)"**
- ox-6 (depth 4, false statement "등호는 수직일 때"). Answered **O** on 10-19, 9.4 s, first attempt. The twist is m = "등호를 수직(cos θ = 0)일 때로 앎".
- 1.2-29 (depth 3; smallest and largest of ‖v−w‖ and v·w): 모르겠어요 (legacy, weight 0.6).
- Posterior: K .10 · S .37 · N .54, P(m) .31.
- Output: P(S) + P(N) = .91 from 2 items → **덜 다져짐 (hedged)**: "아직 덜 다져진 것 같아요". No sub-label, since neither S ≥ .65 nor N ≥ .70.
- 확인 문제: the equality case with a different surface, offering m (`illusion_or_slip`). If none exists → `need_variant`.

**B. 공학수학 · 일차결합 · `lincomb.span` "평행하지 않은 두 벡터의 span = 원점을 지나는 평면"**
- ox-1 (depth 1, true statement): **X** at 10-19 18:53 KST, then O on retry. At 10-20 01:17 KST (the next KST day), after having seen the answer, **X again** (15.8 s).
- Related: ox-3 (affine c + d = 1, not through origin) correct; 1.1-16 (affine line) 모르겠어요.
- Proposed m = "span도 원점을 지나지 않는다고 봄 (affine 결합과 섞음)", cw = affine combination.
- Posterior: P(m) .80 from a single item → **착각, hedged** (rule 4): "'span도 원점을 지나지 않는다'고 보고 있을 수 있어요" + 확인 문제.
- Probe: a depth-3 구별 item, span vs affine.
  - answered with m → .98 on 2 distinct items → **firm 착각 (misc)**;
  - answered correctly → .63 → stays hedged.
- Card text, when confirmed: "평행하지 않은 두 벡터의 선형결합이 원점을 지나는 평면이라는 걸, c + d = 1인 affine 결합(원점을 안 지나는 직선)과 섞고 있어요."

**C. 공학수학 · 행렬식** (DB's examples, corrected by DB on 10-26)
- `det.swap` "두 행을 바꾸면 부호가 바뀐다":
  - ox-54 (base, depth 1) correct.
  - ox-59 "치환행렬의 det는 항상 1" answered O. It is **depth 1 (D1b, a taught statement flipped)**, not near / depth 4: LA2 3.1-2's summary states "det P = ±1" outright. Only the first non-rapid answer counts; the 8 sub-200 ms taps are excluded.
  - Posterior, if ox-59's planted error is tagged with a det.swap misc ("치환행렬 det를 항상 1로 봄"): K .44 · S .34 · N .21, P(m) .57 → **착각, hedged** (rule 4) + a 확인 문제 offering the same m. If it carries no mis tag → **pending (`few_items`)**.
  - Lesson (DB's point): mis-tagging a flipped taught statement as a depth-4 near member is exactly what would turn this into a false `familiar` 착각. So ox-59 goes into the tagging gold set, and the tagging pass sees each chapter's taught statements.
- `det.lin`: ox-64 right, ox-52 "det(A+B) = det A + det B" answered O. Also D1b, so it has the same shape as `det.swap`.
- `det.block` (블록 상삼각 det = det A · det D) is the better 착각 candidate:
  - ox-60 (near, condition, depth 4) answered O ✗ with m_det_2x2; x24-9 (depth 4, combine) 모르겠어요; the base x21-t11 (depth 1) was never tried.
  - Posterior: K .04 · S .28 · N .68, P(m) .30 → **덜 다져짐, hedged** (N just under .70, so no sub-label) + 확인 문제 **x21-t11**.
    - x21-t11 right → S .61 → still 덜 다져짐;
    - x21-t11 wrong → N .91 → 덜 다져짐 / 모름.
  - Also emit `need_variant(det.block, depth 4, object, m_det_2x2)`. A second m-offering item is what could make it a firm 착각.

**D. 진인본 · G23 · X-22 and X-13**
- X-22: "B" recorded 9 times in 1.1 s. After burst collapse it is **one** wrong response. Without §2.3 this alone would have produced a 9-hit 착각.
- X-13: answered A (상리 + 이타) twice, at 13 s and 110 s, on the same item, same day. Legacy 7-2 has no option.
- Posterior: first answer weight 1, the same-day retry weight .3 → P(m) .64 → **착각, hedged** (rule 4): "이타적(−/+)을 행위자에게 이로운 행동으로 보고 있을 수 있어요" + a 확인 문제 on another 이타/상리 item. Without the retry it would be .52 → pending.

**What this means for the heavy device today:** after tagging, roughly a third of the touched facets will still be 판단 보류. Most of the rest will be hedged ("~일 수 있어요" + 확인 문제). Firm 착각 and firm 확실히 앎 appear wherever a facet has 2 hits or 3 problems with a hard one. Every claim shows the problems it rests on.

---

## 8. Output: det.v = 2 additions

Aligned to REPORT_UX.md §9, including its extra asks. Everything in v1 stays; `units[]` remains for untagged parts.

```js
points: [{
  code, path: [chapter_title, kc_name, facet_name], statement,
  state: "solid" | "illusion" | "weak" | "pending",
  tier: "firm" | "hedged" | null,                   // firm: solid / illusion only; weak is always hedged; null for pending
  sub: "shallow" | "gap" | null,                    // weak only (얕게 앎 / 모름), always hedged wording
  kind: "misc" | "familiar" | null,                 // illusion only
  why: "few_items" | "one_format" | "no_variant" | "untagged" | "rapid_only" | null,   // pending only
  depth: "L1" | "L2" | "L3" | "L4" | null,          // = DATA depth 1–4; UI labels L1 정의 · L2 적용 · L3 구별 · L4 조건
  ladder: [{ lv, st: "ok" | "miss" | "mixed" | "none", items: ["E3", "E7"] }],
  mis: { code, belief, truth, cue } | null,         // cue optional
  hidden_truth: bool,                               // v1 rule: hide truth while every hit item is still wrong
  n_items,
  probes: [{ pid, ext, lv, role, reason }],         // ≤ 3
  need_variant: bool }],
findings: [ …v1…, {
  type: "illusion" | "weak" | "solid", tier, sub, kind, point: code,
  chain: [ { role: "base" | "variant" | "repeat", e: "E1", ext, lv, chosen, ok, text, why /* misc.belief */, change /* family_member.delta */ } ],
  text: { diag, truth, cue }, plan } ],
probes: [{ point, reason, pids: [...], scope: "Q:…" }],
excluded: { rapid: n, burst: n }
```

- `chain[].change` comes only from the DATA tag (`delta`). It is never LLM text at render time.
- `text` is still deterministic (v1 §5.7). The card title for 착각 is "알고 있다고 착각하고 있어요" (DECISIONS §4). The templates are:

| case | firm | hedged (always + 확인 문제) |
|---|---|---|
| misc | "'{belief}'와 섞고 있어요 — {base}는 맞혔지만 {variant}에서 같은 생각으로 골랐어요." | "'{belief}'로 보고 있을 수 있어요 — {variant}에서 이렇게 골랐어요. 아래 문제로 확인해 보세요." |
| familiar | "익숙한 형태({base})는 맞히는데, {change} 바뀐 {variant}에서 틀려요." | — |
| solid | "확실히 알고 있어요 — {hard item}까지 맞혔어요." | "잘 아는 것 같아요. 한 문제만 더 확인해 볼까요?" |
| weak / shallow | — | "{depth명}까지는 맞히는데 {miss lv명}에서 막히는 것 같아요." |
| weak / gap | — | "아직 잡히지 않은 것 같아요." |
| weak | — | "아직 덜 다져진 것 같아요." |

  The hedged 착각 card does not use the 착각 title; it uses a softer heading such as "확인해 볼 부분". The frontend picks the exact heading.
- An optional Gemini narrative (P4) may paraphrase, but only from these fields, under v1's id-validation rule.

---

## 9. How it fits `insight-engine.js`: extend, not replace

- New pure module **`web/js/insight-depth.js`**: no DOM, no node:*; shared by browser and server like the engine.
  - Exports: `facetModel(obs, tags, P)` → posterior; `label(post, ev, fam, P)`; `probes(post, cands, P)`.
- `buildReport` calls it when `ctx` has v2 tags.
  - Tagged facets become `points[]` and point findings.
  - Untagged items keep feeding the v1 chapter/topic `units[]`.
  - **Rollout is per course** (DECISIONS §5): v2 switches on for a course as soon as its tags are imported. Untagged courses keep the v1 report unchanged.
  - Inside a tagged course, a chapter with ≥ 60% of its answered items tagged shows its facets. The v1 chapter label stays as a summary line and as the D prior (§3.2).
- v1 SPEC §5.1 (K/U/M) is **subsumed**: U splits into S and N, and it runs per facet with depths. §5.2 confusion pairs become `mis` with `cw`. §5.3 gap/unclear become `gap`/`pending`. Habits (§5.4), relearning (§5.5) and time stay.
- **Server side:**
  - `ctx.js` loads `facetsOf`, `familiesOf`, misc and tags; `tag_rev`/`vocab_ver` go into `ctx.key`.
  - `evidence.js` adds burst collapse, `fb` and `payload.conf`.
  - `ENGINE_VER` → 2, so snapshots go stale and are remade on the next 리포트 뽑기.
- **Cost:**
  - Per course: ≤ 100 facets × ≤ 10 items × ≤ 12 states ≈ 12k likelihood terms.
  - EIG: ≤ 20 candidates × ≤ 5 responses ≈ 100k operations.
  - Total < 5 ms per 리포트 뽑기 (v1 target < 20 ms). det grows by about 5–15 KB.
- **No Gemini calls at report time.** Tagging is offline (DATA.md §8).

---

## 10. Validation plan (acceptance gates for the build; nothing runs until the user asks)

1. **Worked checks.** The §4 rows reproduce within ±0.01 with the final parameters.
2. **Simulation.**
   - Synthetic learners use each course's real tag structure (depth / family / mis counts per facet), with perturbed truth tables.
   - Gates:
     - firm 착각 (both kinds): FA < 3%, precision ≥ 85%;
     - firm 확실히 앎: FA < 3%, precision ≥ 80%;
     - every hedged claim: precision ≥ 65%;
     - posterior calibration ±0.1 per decile.
   - After 2 probes: recall up, false alarm still < 3%.
   - Tune §3 by held-out log-loss once ≥ 2,000 option-level first attempts exist.
3. **Real-data review.**
   - The heavy device's facet claims are shown in the **admin-only** preview and marked 맞아요 / 아니에요. There is no learner-facing button (DECISIONS §6).
   - Target: ≥ 80% agreement before the learner screen ships.
4. **Tag quality.** Wrong `mis` tags make false 착각; Q-matrix misspecification degrades CDMs. Hence the `conf` ≥ 2 rule for `illusion (misc)`.

---

## 11. Decisions applied (DECISIONS.md, 2026-10-26) and what is still open

| # | user decision | where it lands here |
|---|---|---|
| 1 | Variants are written by Claude authoring sessions, checked by a blind Sonnet solver, imported hidden, then published by admin | §6 `need_variant` → DATA §9 queue; the engine proposes only published items |
| 2 | No confidence tap | §2.3, §3.3; the thresholds in §5 assume none |
| 3 | Looser judgment, hedged wording + 확인 문제, evidence chain always shown | §5 rules 1–7 and the simulation table; §6; §8 `tier` |
| 4 | Card wording OK; depth labels 1 정의 · 2 적용 · 3 구별 · 4 조건 (DATA's order) | §8 templates; §2.2 label table |
| 5 | Rollout per course, as soon as the course is tagged | §9 |
| 6 | No learner-facing "이 진단이 맞나요?" | §10 uses an admin-only review instead |

Rollout order (DATA §8.6, per-course gate `insight_meta v2_ready:<cid>`): 생경론 → 공학수학 → 경정시 → 진인본 → 응용통계.

Nothing is open on the algorithm side. Building waits for the user's separate approval.

---

## Sources

- Briggs, Alonzo, Schwab & Wilson (2006). Diagnostic Assessment with Ordered Multiple-Choice Items. *Educational Assessment* 11(1). https://experts.colorado.edu/display/pubid_97217 · think-aloud follow-up: https://www.leibniz-ipn.de/en/research/publications/die-kognitive-validitat-von-ordered-multiple-choice-aufgaben-zur-erfassung-des-verstandnisses-von-materie
- Minstrell, facets and DIAGNOSER. https://nap.nationalacademies.org/read/6296/chapter/231.html · https://stemteachingtools.org/assets/landscapes/STEM-Teaching-Tool-37-Beyond-Misconceptions.pdf
- Pesman & Eryilmaz (2010), three-tier test. https://avesis.metu.edu.tr/yayin/9f2a134c-4ca8-4222-9562-3b9e8427a923/development-of-a-three-tier-test-to-assess-misconceptions-about-simple-electric-circuits
- Hasan, Bagayoko & Kelley (1999), Certainty of Response Index. https://iopscience.iop.org/article/10.1088/0031-9120/34/5/304 · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5490181/
- Butterfield & Metcalfe (2001), the hypercorrection effect. https://en.wikipedia.org/wiki/Hypercorrection_(psychology) · https://pmc.ncbi.nlm.nih.gov/articles/PMC3604148
- Koriat & Bjork (2005), illusions of competence. https://gwern.net/doc/psychology/spaced-repetition/2005-koriat.pdf
- Repair theory; bugs vs slips (Brown & Burton; VanLehn). https://www.lri.fr/~mbl/Stanford/CS477/papers/RepairTheory-SeelyBrown.pdf · https://instructionaldesign.org/?p=195
- Bassok & Holyoak (1989). https://reasoninglab.psych.ucla.edu/wp-content/uploads/sites/273/2021/04/Bassok_Holyoak1.1989.pdf · Singh, misconceptions blocking transfer: https://arxiv.org/pdf/1602.07686
- Sinharay, Johnson & Williamson (2003), item families. https://ideas.repec.org/a/sae/jedbes/v28y2003i4p295-313.html · https://www.ets.org/research/policy_research_reports/publications/report/2003/hsgg.html
- Cheng (2009), PWKL (doi 10.1007/s11336-009-9123-2); Kaplan, de la Torre & Barrada (2015). https://personal.unizar.es/barrada/papers/15_APM_Kaplan.pdf · https://pmc.ncbi.nlm.nih.gov/articles/PMC9073635
- Sorrel et al. (2023), CDMs with small samples. https://repositorio.comillas.edu/jspui/bitstream/11531/82824/1/202398125540499_2023%20-%20Psych%20-%20Sorrel%20et%20al.pdf · Q-matrix misspecification: https://arxiv.org/pdf/2105.09495v3
- Knowledge Space Theory. https://arxiv.org/pdf/1511.06757 · https://www.mheducation.com/content/dam/mhe/research/prek-12/essa-tier-4/aleks-practical-perspective-knowledge-space-theory.pdf
- Webb's DOK vs revised Bloom; Hess matrix. https://dam.assets.ohio.gov/image/upload/sboe.ohio.gov/Educator-Evaluations/QualityAssessments/DOK-Compared-to-Blooms-Taxonomy.pdf · https://www.scusd.edu/sites/main/files/file-attachments/hess_cognitive_rigor_matrix.pdf
- Pelánek (2018), wrong answers vs response times. v1 learner-model sources are in `../research/learner_model.md`.
