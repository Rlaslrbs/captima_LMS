# 학습 리포트 v2: report UX (concept-depth diagnosis)

Status: **design, following the user's decisions in `DECISIONS.md` (2026-10-26).** Owner: 프론트엔드. Building is approved separately.

Thresholds: the looser rules in ALGORITHM §5 (state + `tier` firm/hedged). The fields are those in ALGORITHM §8.

This doc is aligned with:
- **`ALGORITHM.md`** (서버): §5 decision rules, §6 probes, §7 examples, §8 output contract.
- **`DATA.md`** (DB): depth 1–4, facets, variant families and `delta` (learner-readable, ≤40자), `kc.definition`, `facet.statement`, and misc belief/truth/cue.
- **`DECISIONS.md`** (user): the wording, the level names, no confidence tap, no learner feedback button, per-course rollout and looser judgment.

The UI only shows what those rules can back up. Where this doc and `ALGORITHM.md` §8 disagree, **§8 wins**.

---

## 0. What the learner should get from one look

The user's request comes down to three questions. The report answers them for each **세부 포인트** (facet):

1. **얼마나 깊이 아나?** Does the learner only recognise the definition (정의), apply it (적용), tell it apart from a neighbour (구별), or know where it stops being true (조건)?
2. **알고 있다고 착각하나?** Are they right on the familiar form but wrong once it is changed slightly, or making the same wrong move again?
3. **그래서 뭘 하면 되나?** One concrete next step at exactly that level. Often this is the **확인 문제** that settles the diagnosis.

Design rules:
- **Apple style:** one column, a large headline, white cards on `--paper`, and a single blue primary action (`.btn.pri` = `--action`). Colours come from tokens only, in light and dark.
- **Uncluttered:** at most **3 cards** under "짚어 볼 것                                                         ← max 3 cards
 ┌ 확인해 볼 부분 ─ 공학수학 › 일차결합 › span과 원점 ──────────────────┐
 │ 'span도 원점을 지나지 않는다'고 보고 있을 수 있어요.                  │
 │ ox-3 맞힘 → ox-1 틀림 → 답을 본 다음 날 ox-1 또 틀림                 │
 │ [착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]                       │
 └──────────────────────────────────────────────────────────────────┘
 ┌ 확인해 볼 부분 ─ 진화와 인간 본성 › 이타성 ──────────────────────────┐
 └──────────────────────────────────────────────────────────────────┘
 ┌ 더 다져 볼 부분 ─ 공학수학 › 내적 › 등호·극값 조건 ────────────────────┐
 └──────────────────────────────────────────────────────────────────┘

개념별 깊이                                                         ← §2, collapsed list
 일차결합 › span과 원점         ●○○○  —            확인해 볼 부분
 내적 › 등호·극값 조건          ○○◌●  —            덜 다져진 것 같아요
 행렬식 › 블록 행렬식           ○○○●  —            덜 다져진 것 같아요
 선형변환 › …                  ●●●○  구별까지      확실히 알고 있어요
 …  모든 포인트 보기 ▾

고친 문제 확인    하루 뒤 다시 맞힌 것 12 / 30          [오늘 확인할 4문제 ›]
판단 보류 ▾        4개 포인트 · "아직 1문제만 풀었어요"
▸ 이 리포트는 이렇게 만들었어요
```

Order of importance:
1. headline
2. one action
3. up to 3 cards
4. depth list
5. housekeeping rows

The primary button follows `plan.today`. 확인 문제 come first in the plan, because one probe answer moves a diagnosis the most (ALGORITHM §6, case B).

---

## 2. Per-point depth ladder

### 2.1 Levels (generic, every course; the user's order and names)

| lv | UI name | the item asks the learner to… | real example (depth per DATA) |
|---|---|---|---|
| L1 | **정의** | recognise or recall a taught statement, including a taught statement flipped | ox-54 "두 행을 바꾸면 부호가 바뀐다"; ox-59 "치환행렬 det = 1" and ox-52 "det(A+B)=det A+det B" (both taught outright, so depth 1) |
| L2 | **적용** | use it in a typical case or calculation | row operations in a det MC item |
| L3 | **구별** | tell it apart from a confusable neighbour | span vs affine combination |
| L4 | **조건** | spot where it stops being true: a condition changed, or carried to a new object | ox-60 "블록 행렬에 2×2 공식 그대로" (near/condition) |

- The UI shows exactly this order and these names (DECISIONS 4).
- `lv` = DATA `depth` 1–4 directly (DATA/ALGORITHM order). Only level 4's label is 조건 instead of 경계.
- The ladder is **not** a curriculum order. The UI never infers a lower level from a higher one, and shows only what was asked.

### 2.2 Visual

Four small segments, read left to right, appear in both the list row and the card. Tapping a segment shows its item chips (`ladder[].items`).

| `ladder[].st` | look | text on tap |
|---|---|---|
| `ok` | filled `--ok` | "정의 · 2문제 모두 맞힘" |
| `miss` | filled `--red` | "조건 · 1문제 틀림" |
| `mixed` | half-filled `--hl` | "적용 · 3문제 중 1문제 틀림" |
| `none` | hollow ring `--muted` | "구별 · 아직 이 수준 문제를 안 풀어 봤어요" |

The ladder has `role="img"` and an `aria-label` that reads all four segments. Shape (filled, half or ring) carries the meaning as well as colour.

### 2.3 The verdict next to the ladder

The UI maps `state` + `tier` (+ `kind` / `sub`) to a heading and a badge. The sentence itself is `text.diag` (ALGORITHM §8 templates). The rules live in ALGORITHM §5.

| state | tier | card heading / list label | badge | body (from `text.diag`) |
|---|---|---|---|---|
| `illusion` · misc | firm | **알고 있다고 착각하고 있어요** | 착각, filled red | "'{belief}'와 섞고 있어요 — …" |
| `illusion` · familiar | firm | **알고 있다고 착각하고 있어요** | 착각, filled red | "익숙한 형태({base})는 맞히는데, {change} 바뀐 {variant}에서 틀려요." |
| `illusion` · misc | hedged | **확인해 볼 부분** | outline red | "'{belief}'로 보고 있을 수 있어요 — …" + 확인 문제 |
| `solid` | firm | **확실히 알고 있어요** | filled ok | "확실히 알고 있어요 — {hard item}까지 맞혔어요." |
| `solid` | hedged | **잘 아는 것 같아요** | outline ok | "한 문제만 더 확인해 볼까요?" + 확인 문제 |
| `weak` · shallow | hedged | **더 다져 볼 부분** | outline hl | "{depth명}까지는 맞히는데 {miss lv명}에서 막히는 것 같아요." + 확인 문제 |
| `weak` · gap | hedged | **더 다져 볼 부분** | outline fill | "아직 잡히지 않은 것 같아요." + [먼저 읽기] + 확인 문제 |
| `weak` · null | hedged | **더 다져 볼 부분** | outline hl | "아직 덜 다져진 것 같아요." + 확인 문제 |
| `pending` | null | **판단 보류** | mute | the §5.3 reason + 확인 문제 if any |

Rules:
- **"알고 있다고 착각하고 있어요" is only for firm 착각.** A hedged 착각 never uses that heading or the filled red badge.
- **Firm vs hedged is shown by the badge style** (filled vs outline) and by the wording, never by colour alone.
- **Every hedged card carries its 확인 문제 row** (`probes`). If `need_variant` is true, it shows "확인할 문제를 준비하고 있어요".
- **Every non-pending card shows its evidence:** the ladder, plus the chain for illusion, or the ladder chips for solid and weak.
- **A factual line backs up the soft sub-label.** S and N are hard to tell apart (≈65–78%), so the weak card always adds one line from the ladder, e.g. "정의 문제 2개 맞힘 · 조건 문제 2개 틀림".
- `depth` appears as a level name ("구별까지"), or "—" when it is `null`.

---

## 3. 착각 card with the evidence chain

This answers the user's "살짝만 바꿔낸 문제를 또 틀리네? → 착각". Every claim shows its chain, firm or hedged (DECISIONS 3).

### 3.1 Layout (`kind: misc`, firm; case B after its probe is answered with m)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 알고 있다고 착각하고 있어요                                 근거 3문제 │  ← title (red badge)
│ 공학수학 › 일차결합 › span과 원점                                      │
│                                                                      │
│ 평행하지 않은 두 벡터의 span을 c+d=1인 affine 결합과 섞고 있어요.        │  ← body "~와 섞고 있어요"
│ ●○●○  정의 맞힘 · 적용 아직 · 구별 틀림 · 조건 아직                     │  ← ladder
│                                                                      │
│  span (원점 지남)              ⇄          affine 결합 (원점 안 지남)     │  ← contrast
│                                                                      │
│  ① 맞힘   ox-3   "c+d=1이면 원점을 지나지 않는 직선"         O ✓       │  ← base
│      ↓ 바뀐 점: affine 결합 → 모든 선형결합                             │  ← chain[].change = delta
│  ② 틀림   ox-1   "…선형결합 전체 = 원점을 지나는 평면"        X라고 답함 ✕ │  ← variant (10-19)
│      ↓ 같은 생각으로 또 · 다음 날                                       │
│  ③ 틀림   ox-1   같은 문제, 답을 본 뒤에도                    X라고 답함 ✕ │  ← repeat (10-20)
│  ④ 틀림   (확인 문제) span vs affine 구별                     ⓑ 고름 ✕   │  ← repeat (probe)
│                                                                      │
│ 풀 때: 계수에 제한(c+d=1)이 있는지부터 보기                             │  ← mis.cue (optional)
│ [바르게 보면 ▾]                                                       │  ← locked while hidden_truth
│                                                                      │
│ [섞어서 풀기 · 4 ›]                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

**Hedged version** (ALGORITHM §7 B today, rule 4):
- the heading is **"확인해 볼 부분"**, with an outline badge;
- the body is "'span도 원점을 지나지 않는다'고 보고 있을 수 있어요 — ox-1에서 이렇게 골랐어요. 아래 문제로 확인해 보세요.";
- the chain shows rows ①–③;
- the button is "[착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]";
- "바르게 보면" stays locked.

### 3.2 Rules

- **Chain order.** The chain runs `base` (right) → `variant` (wrong) → `repeat` (wrong), with a thin `--line` connector, in 2–4 rows.
- **Step label between rows:**
  - "바뀐 점: {change}": `change` is `family_member.delta` verbatim and is never generated at render time.
  - "같은 생각으로 또" (`misc`) or "같은 형태로 또" (`familiar`) for a repeat.
- **Each wrong `misc` row shows why it counts:** the chosen label and option text, then one muted line with `why` (= misc.belief).
- **No truth leak:**
  - `mis.truth` stays locked while `hidden_truth` is true, with the label "다시 풀어 맞히면 열려요".
  - Chips never show the correct option.
  - A still-wrong chip opens `Q:<pid>` with the answer hidden.
- **Rapid and burst attempts are never drawn.** If `excluded.rapid` or `excluded.burst` is above 0, one footer line names the counts: "너무 빠른 답 n번 · 연달아 누른 답 n번은 빼고 판단했어요".
- **One misconception per card.** A second one in the same 개념 becomes a row inside the first card ("같은 개념에서 하나 더").
- **Wording by tier:** firm → "…고 있어요" under "알고 있다고 착각하고 있어요". hedged → "…일 수 있어요" under "확인해 볼 부분", plus the 확인 문제.

### 3.3 Two-concept confusion

When the misconception mixes up two neighbouring concepts (`delta_type: neighbour`, or a misc whose cw is a neighbour), the chain gets a contrast header:

```
 span (원점 지남)            ⇄            affine 결합 c+d=1 (원점 안 지남)
```

The action becomes "섞어서 풀기 · n", which interleaves the two concepts using the v1 `X:a~b` scope.

---

## 4. What to study next

### 4.1 The plan

The primary button runs `plan.today`. It shows the count, the minutes, and a sub-line of steps, e.g. "확인 문제 4 · 넓히기 2 · 고친 문제 2".

### 4.2 Per-card action

| card | action | opens |
|---|---|---|
| 착각 firm | **같은 함정, 다른 문제 · n** | unseen items with the same m or from the same family, answer hidden |
| 착각 firm (two concepts) | **섞어서 풀기 · n** | the two concepts interleaved |
| any hedged card | **{probe reason} · n** | `point.probes` as `Q:…` (up to 3) |
| 더 다져 볼 부분 · shallow | + **{miss lv명} 문제로 넓히기 · n** (a text-style second action) | unseen items at the first `miss`/`none` level above `depth` |
| 더 다져 볼 부분 · gap | + **먼저 읽기** (a text link) | `kc.definition` + `facet.statement` |
| 판단 보류 | **확인 문제 · n**, if probes exist | same as above |
| `need_variant` | no button; a muted line "확인할 문제를 준비하고 있어요" (new items stay hidden until admin approval) | — |
| 확실히 알고 있어요 (firm) | none; row only | — |

Each card has only one filled button: the probe on hedged cards, and the practice set on firm 착각.

The probe reason texts come from ALGORITHM §6:
- `illusion_or_slip`: "착각인지 한 번의 실수인지 가려 줄 문제"
- `depth_unknown`: "적용·구별 수준을 확인할 문제"
- `confirm_solid`: "확실히 아는지 확인할 문제"

After the learner returns from an action, the card shows "새 기록 n개 · 새로 뽑기". Reports are still made only when the learner taps.

### 4.3 Not in the learner UI (DECISIONS 2 and 6)

- No confidence tap (확신 · 반반 · 찍음). The diagnosis works from answers, time and repeats only.
- No tier-2 "왜 그렇게 답했나요?" for now.
- No learner-facing "이 진단이 맞나요?". An admin-only view can come later.

---

## 5. Showing uncertainty

Open learner model research found that learners judge their own knowledge better when the system's uncertainty is visible. Learners also preferred simple overview cues to numbers (Al-Shanfari, Demmans Epp, Bull).

### 5.1 Three cues, nothing more

1. **`tier`**: firm → plain wording with a filled badge; hedged → "…일 수 있어요 / …것 같아요" with an outline badge and a 확인 문제.
2. **Hollow segments** for levels that were never asked.
3. **"근거 n문제"**, which counts distinct items (`n_items`), not attempts.

### 5.2 Never shown (ALGORITHM §5 "Never claimed")

- probabilities, θ, or a mastery percentage;
- any state from fewer than 2 distinct items, except hedged 착각 (rule 4), which always carries a 확인 문제;
- 착각 based on legacy rows;
- a firm verdict for a hedged claim.

### 5.3 판단 보류, with its reason

| why | text |
|---|---|
| `few_items` | "아직 {n}문제만 풀었어요" |
| `one_format` | "O/X로만 풀어 봤어요. 다른 형식도 풀어 보면 정확해져요" |
| `no_variant` | "같은 모양 문제만 풀었어요. 바꿔 낸 문제를 풀면 깊이를 알 수 있어요" |
| `untagged` | "이 포인트는 아직 문제 분류 중이에요" |
| `rapid_only` | "빠르게 넘긴 답이 많아 판단을 미뤘어요" |

---

## 6. Empty and partial states

| state | what the learner sees |
|---|---|
| no consent | the v1 copy + [기록 저장 켜기 ›] |
| locked (course gate) | the v1 copy + a progress bar + "[지금 풀면 좋은 문제 · 5 ›]" |
| course not tagged | the v1 report unchanged, plus one line at the top: "세부 포인트별 진단은 이 과목 문제 분류가 끝나면 열려요." No empty ladder. v2 opens **per course** as soon as that course is tagged (DECISIONS 5). The switch is the `insight_meta` flag `v2_ready:<cid>`: when it is set, the course shows v2; otherwise it shows v1 with the notice. The UI never decides this from the data itself. |
| partly tagged | ladders for tagged points only; one row "분류 중인 단원 n개"; v1 cards still shown |
| many hedged claims | hedged cards with chains + 확인 문제; the plan puts the probes first |
| `need_variant` | "확인할 문제를 준비하고 있어요". New items are written and checked offline and stay hidden until admin approval (DECISIONS 1). |
| nothing to flag | "아직 착각이나 약한 포인트는 보이지 않아요." + up to 2 확실히 앎 lines + the pending row |
| stale | as in v1: "새 기록 n개 · 새로 뽑기"; text from the answer side stays hidden |

---

## 7. What the learner can do from each element

| element | tap result |
|---|---|
| a chain chip for a right item | opens the chapter at that item |
| a chain chip for a wrong item | opens `Q:<pid>` with the answer hidden |
| a ladder segment | popover with the items, their results and "이 수준 문제 풀기 ›" |
| "바르게 보면 ▾" | shows `mis.truth`, only once unlocked |
| the card action | see §4.2 |
| a depth-list row | expands in place into a mini card (ladder + action) |

Touch targets are at least 44 px on phones, with the same hit-area expansion as the live app.

---

## 8. Mock text from the heavy device (ALGORITHM §7, looser rules)

The device is `DEVICE_ID_EXAMPLE`. The facet and misc names are proposals that have not been reviewed yet.

**A. 공학수학 › 내적 › 등호·극값 조건 → `weak` · hedged · sub null**
> **더 다져 볼 부분** · 공학수학 › 내적 › 등호·극값 조건
> 아직 덜 다져진 것 같아요.
> ○○◌● 조건 문제 1개 틀림(ox-6) · 적용 문제 1개 '모르겠어요'(1.2-29)
> [착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]

**B. 공학수학 › 일차결합 › span과 원점 → `illusion` · hedged · misc (rule 4)**
> **확인해 볼 부분** · 공학수학 › 일차결합 › span과 원점
> 'span도 원점을 지나지 않는다'고 보고 있을 수 있어요 — ox-1에서 이렇게 골랐어요. 아래 문제로 확인해 보세요.
> ① ox-3 맞힘 → ② ox-1 X라고 답함 ✕ → 답을 본 다음 날 ③ ox-1 또 X ✕
> [착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]

If the probe is answered with m, the claim becomes **firm**, as in §3.1:
> **알고 있다고 착각하고 있어요** · 평행하지 않은 두 벡터의 선형결합이 원점을 지나는 평면이라는 걸, c + d = 1인 affine 결합(원점을 안 지나는 직선)과 섞고 있어요. [섞어서 풀기 · 4 ›]

If it is answered correctly, it stays hedged.

**C. 공학수학 › 행렬식 (ox-59 is depth 1 per DATA)**

`det.swap` (ox-54 ✓, ox-59 "치환행렬 det = 1" answered O ✕):
- **With a misc tag** on ox-59's O, it is `illusion` · hedged:
  > **확인해 볼 부분** · '치환행렬의 행렬식은 항상 1'로 보고 있을 수 있어요 — ox-59에서 이렇게 골랐어요. 아래 문제로 확인해 보세요.
  > ① ox-54 맞힘 → ② ox-59 O라고 답함 ✕ · 너무 빠른 답 8번은 빼고 판단했어요.
  > [착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]
- **Without one**, it is `pending · few_items`:
  > 두 행 교환과 부호 ●○○○ — 판단 보류 · 아직 문제가 적어요 · [확인 문제 · 1 ›]

`det.block` (ox-60 near/condition ✕; base x21-t11 not tried) is `weak` · hedged:
> **더 다져 볼 부분** · 공학수학 › 행렬식 › 블록 행렬식
> 아직 덜 다져진 것 같아요.
> ○○○● 조건 문제 1개 틀림(ox-60) · 기본형은 아직 안 풀었어요
> [기본형 확인 문제 · 1 ›] (x21-t11)

**D. 진화와 인간 본성 › 이타성 → `illusion` · hedged · misc**
> **확인해 볼 부분** · 진화와 인간 본성 › 이타성
> '이타적(−/+) 행동을 행위자에게 이로운 행동'으로 보고 있을 수 있어요 — X-13에서 ⓐ "상리적인 행동과 이타적인 행동"을 골랐어요. 아래 문제로 확인해 보세요.
> 연달아 누른 답(X-22)은 한 번으로 셌어요.
> [착각인지 한 번의 실수인지 가려 줄 문제 · 1 ›]

**Headline for this device**
> 기본 규칙은 대부분 맞히지만, 헷갈리는 듯한 곳이 두 군데 보여요. 확인 문제 몇 개로 가려 볼게요.

About a third of the touched facets stay 판단 보류. Most of the rest are hedged. A firm claim appears once a facet has 2 hits, or 3 problems including a hard one.

---

## 9. Contract

The UI reads **`ALGORITHM.md` §8** as it is: `points[]`, illusion `findings[].chain[]`, `probes[]` and `excluded{rapid, burst}`.

Fields the UI switches on:
- `state`: solid | illusion | weak | pending
- `tier`: firm | hedged | null
- `sub`: shallow | gap | null (weak only)
- `kind`: misc | familiar (illusion only)
- `why`: few_items | one_format | no_variant | untagged | rapid_only

`findings.type` (illusion | weak | solid) carries the same tier, sub and kind.

Gone from the old contract: `conf` (sure/likely), `why: suspect`, and shallow/gap as separate states.

- `insight.js` keeps "unknown type → mute badge", so v1 and v2 documents can coexist.
- The UI never writes its own sentences. It uses only `text.diag/truth/cue` and the §2.3 / §5.3 mappings.
- `chain[].change` and `mis.cue` are optional. A missing one hides its line.
- No answer-time fields are added (no `conf`, no `t2`).
- Text sources: `chain[].change` = `family_member.delta` (≤40자, learner-readable); 먼저 읽기 = `kc.definition`; facet line = `facet.statement`; body = `misc.belief` / `contrast`.

---

## 10. Components and tokens (no new colours)

- `.ins-lad`: 4 segments of 14×6 px, gap 3, radius 3. They use `--ok`, `--red` and `--hl`. `none` is drawn as `box-shadow: inset 0 0 0 1.5px var(--muted)`.
- `.ins-chain`: a 2 px left connector in `--line`. It reuses `.ins-chip`. Wrong rows use `--red-weak`.
- `.ins-step`: 12.5 px in `--muted`, with an `aria-hidden` "↓".
- Badges reuse `.ins-b`:
  - 착각 = red; 확실히 = ok; 더 다져 볼 = hl (gap: fill); 판단 보류 = mute
  - firm = filled; hedged = the same colour as a 1.5 px outline, with the text in that colour
- Motion: fade-in only, and none under reduced motion.
- At 375 px, the chain and the contrast header stack, and the ladder and verdict wrap under the point name.

---

## 11. Decisions applied (DECISIONS.md, 2026-10-26)

1. Wording: the title is "알고 있다고 착각하고 있어요" and the body is "~와 섞고 있어요". Weaker claims use "~일 수 있어요" + a 확인 문제.
2. Levels: 1 정의 · 2 적용 · 3 구별 · 4 조건 (confirmed 2026-10-26).
3. No confidence tap and no tier-2 for now.
4. No learner-facing "이 진단이 맞나요?".
5. Rollout per course in this order: 생경론 → 공학수학 → 경정시 → 진인본 → 응용통계. Untagged courses keep v1 with a one-line notice.
6. Looser judgment with the chain always shown. The final numbers come from 서버.

No open questions for the user right now.

---

## 12. Sources

- Webb's Depth of Knowledge: [Central Rivers AEA](https://mainstaging.centralriversaea.org/wp-content/uploads/2023/06/B_webbs_alignment_info_dok-Revised-5.25.17.pdf), [LAUSD DOK 101](https://www.lausd.org/cms/lib/CA01000043/Centricity/Domain/593/DOK%20101.pdf)
- Uncertainty in open learner models:
  - [Al-Shanfari et al., AIED 2017](https://research.birmingham.ac.uk/en/publications/evaluating-the-effect-of-uncertainty-visualisation-in-open-learne)
  - [Demmans Epp & Bull](https://research.birmingham.ac.uk/en/publications/uncertainty-representation-in-visualizations-of-learning-analytic/)
  - [Visualising alignment for confidence judgement](https://research.birmingham.ac.uk/en/publications/visualising-alignment-to-support-students-judgment-of-confidence-/)
- Hypercorrection, which is why a fixed problem is re-checked a day later:
  - [Butler, Fazio & Marsh 2011](https://pubmed.ncbi.nlm.nih.gov/21989771/)
  - [classroom replication 2018](https://pubmed.ncbi.nlm.nih.gov/29781391/)
- Misconception false alarms and two-tier/four-tier tests: see the `ALGORITHM.md` Sources and `docs/insight/research/misconceptions.md`.
