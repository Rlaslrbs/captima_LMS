# 학습 리포트 v2 — 연관 개념 진단 (RELATED.md, 학습 리포트 엔진 담당, 2026-11-17)

Status: **design only.** The user asked for this on 2026-11-17 and approved writing the design first (DECISIONS §11). Building waits for a separate approval. No code, DB or test changes were made for this document.

Companion files:
- `ALGORITHM.md` §8 gets the `det.related[]` field, §11 gets the decision row and §12 points here.
- `REPORT_UX.md` §4.4 shows how the line looks; §9 lists the field.
- `DATA.md`: no new table. §2 below says which existing columns are read.

---

## 0. Summary

1. The report already says **which facet is weak** (ALGORITHM §5). This adds one hedged line under a weak card: **which other concept is probably weak too**, even if the learner has not been asked about it yet.
   > 치환 행렬이 아직 덜 다져진 것 같아요. → **단위 행렬도 헷갈리고 있을 수 있어요.** (같은 문제에 자주 함께 나와요) · 확인 문제 1
2. Method: **personalized PageRank** (random walk with restart) on a per-course **concept graph**.
   - Nodes are 개념 (`kc`). Edges come from tags (concepts tagged on the same problem, confusable pairs) and from aggregate co-errors (learners who miss A also miss B).
   - The walk restarts at the learner's weak concepts. Its stationary vector is the principal **eigenvector (eigenvalue 1)** of the Google matrix, found by power iteration.
3. It is never a verdict. It is always hedged wording + a 확인 문제 + the reason the two concepts are linked. Direct evidence always wins: a concept the learner has shown as 확실히 앎 is never named.
4. Deterministic and small: a pure function in `insight-related.js`, < 1 ms per report. No LLM. The graph holds only aggregate counts.
5. Off by default per course. The admin turns it on after the back-test in §8 passes.

---

## 1. What the user asked, turned into decisions

> "구글이 개발한 페이지 연관성 알고리즘처럼 … 진단에서 잘 모르는 개념과, 그와 연관된 개념까지 알려줄 수 있어? 예를 들어 치환 행렬이 아직 부족해요, 아마 단위 행렬 개념도 헷갈리고 있을 거예요 이런 식으로."

| User's words | Model output | Evidence it needs |
|---|---|---|
| 잘 모르는 개념 | the seed: kcs with a weak or illusion point (ALGORITHM §5) | the existing facet judgement, unchanged |
| 연관된 개념 | top kcs by personalized PageRank relative to global PageRank (§3.3) | a graph edge path from a seed (§2) |
| "아마 … 헷갈리고 있을 거예요" | `related[]` entry, always `tier: "hedged"` | + a 확인 문제 that tests it directly (§4.3) |

The user wrote "isogonal vector, value". PageRank uses the **eigenvector and eigenvalue** (고유벡터 · 고윳값) of the link matrix, so that is what this design uses.

**Why a graph and not the facet model.** The facet model (ALGORITHM §3) judges only what the learner answered. Most kcs have 0–3 answered problems (ALGORITHM §1 principle 1), so the report is silent on most of the course. The graph spreads evidence from what was answered to what was not, the same way Knowledge Space Theory's surmise relation does (ALGORITHM §3.2), but with weights learned from tags and from other learners.

---

## 2. The concept graph (per course)

Nodes: every kc of the course with `status != 'retired'` (merged kcs follow `merged_into`).

Edges come from three sources. All weights are ≥ 0 and directed (a → b means "weak a suggests weak b").

### 2.1 E1 · co-tag (always available)

- From `item_tag.kcs` (`[["c07",0.7],["c03",0.3]]`, Σ = 1), only rows with `review` in (auto, accepted, edited) and `conf ≥ 2`.
- For each problem version with ≥ 2 kcs: `E1[a][b] += w_a · w_b` for a ≠ b (symmetric).
- Facet-level tags lift to their kc (`facet.kc`).
- Reason shown to the learner: `co_tag` with `n` = the number of problems that carry both.

### 2.2 E2 · co-error (aggregate of all learners)

- From the first `answer_submit` / `idk` event per device and problem (`event`), joined to the item's kcs. `item_first` is not used: nothing writes it yet (checked 2026-11-17).
- Cleaning, close to ALGORITHM §2.3: answers faster than 1.5 s (`time.rapid.lo`), essays, and first events with `attempt > 1` (records reset in the old app) are dropped. 모르겠어요 counts as a miss.
- Per device and kc: `miss(d, a)` = the device missed ≥ 1 first attempt on kc a.
- `lift(a→b) = P(miss b | miss a) / P(miss b)`, over devices that attempted both a and b. Shrunk toward 1 with a Beta prior worth 10 devices.
- **Minimum support:** ≥ 20 devices attempted both, and ≥ 5 devices missed both. Below that the edge does not exist. This also keeps any single learner from being identifiable.
- `E2[a][b] = max(0, lift − 1)`. Directed: lift is conditional, so a → b and b → a can differ.
- **Leave-one-out:** for the learner whose report is being made, the counts are computed without that learner (subtract their own row). Otherwise their own misses would make the edge that then "predicts" those misses.
- Reason shown: `co_error`, with no numbers (ALGORITHM §1 principle 5: no false precision).

### 2.3 E3 · explicit links from the tags

| source | edge | reason |
|---|---|---|
| `kc.confusable[]` | a ↔ b, weight 1 | `confusable` |
| `misc.cw` (misc on kc a, confused with kc b) | a ↔ b, weight 1 | `confusable` |
| `facet.confusable[]` lifted to kc | a ↔ b, weight .5 | `confusable` |

- Measured 2026-11-17 on a `VACUUM INTO` copy: the work files in `data/export/course1–5` have empty `confusable` lists, but the DB itself has confusable links in 17 of 19 tagged courses (2–62 directed edges each). So E3 is the main source today, then E1. See §8.1.
- Prerequisites (`facet.pre` in ALGORITHM §2.1) do not exist as a column. A prerequisite edge (`prereq`, stronger in the direction advanced → prerequisite) needs a DATA change and a tagging pass. That is **not** in this design's scope; §9 lists it as a later step.

### 2.4 Combining

```
W = .35 · E1/max(E1) + .45 · E2/max(E2) + .20 · E3
```
- If a course has no E2 edge yet (too few learners), its weight moves to E1 (`.80 · E1 + .20 · E3`).
- No self-loops. `P` = W column-normalized (each column sums to 1). A kc with no out-edge is dangling: its column is the restart vector.
- Built on the server per course (`ctx.js`), cached in memory and keyed by `tag_rev:<cid>` + the day. So it is rebuilt at most once a day, or when tags change. No new table.

---

## 3. The walk

### 3.1 Seeds

The restart vector `s` comes from the learner's own judgement (ALGORITHM §5), lifted to kcs:

| point state | weight |
|---|---|
| illusion, firm | 1.0 |
| illusion, hedged · weak (gap or shallow) | 0.6 |
| pending, solid, no evidence | 0 |

- A kc's seed weight is the max over its facets. `s` is normalized to Σ = 1.
- No seed → no `related[]` (the field is empty, nothing is shown).

### 3.2 Personalized PageRank

```
r = (1 − d) · s + d · P · r          d = .6, power iteration until ‖Δr‖₁ < 1e-6 (≤ 50 rounds)
```
- `r` is the principal eigenvector (eigenvalue 1) of the Google matrix `G = d·P + (1 − d)·s·1ᵀ`.
- **Why d = .6 and not the web's .85.** A step costs belief. With .6, about 60% of the mass sits within one step of a seed and 85% within two. That keeps the claims about near neighbours, which is what can be explained in one sentence. Tuned in §8.

### 3.3 Score: lift over popularity

- Hub concepts (e.g. "행렬") are near everything and would always come first.
- So the score is `rel(b) = r_b / π_b`, where `π` is the same walk with a uniform restart (global PageRank of the course).
- `rel(b) > 1` means: closer to *this learner's* weak spots than to the course in general.

---

## 4. Which concepts are named

### 4.1 Candidates

A kc b is a candidate when all hold:
1. b is not a seed.
2. No facet of b is `solid` (either tier). **Direct evidence wins.**
3. b has no `illusion` or `weak` point of its own (those already have a card).
4. `rel(b) ≥ 2.0` and `r_b ≥ .02`.
5. b has ≥ 1 published, unseen problem that can serve as its probe (§4.3). Without one there is nothing to check, so b is not named.

So the line is mostly about kcs the learner has **not** been asked about yet (pending, `few_items`, or no evidence). That is where it adds something.

### 4.2 How many, and under which card

- Each candidate is attached to the seed that explains it best: `via = argmax_a s_a · P[b][a]` (the one-step contribution). Its reason types are the edge sources from that seed (§2), strongest first, at most 2.
- At most **2 per seed card** and **3 per report**, by `rel` descending.
- If b's best path from every seed is longer than 2 steps (one-step contribution < 20% of `r_b`), b is dropped: the reason could not be said honestly in one line.

### 4.3 Probe

- Reuse ALGORITHM §6 with a new reason `related_check`: one unseen problem of kc b, depth 1–2 first (정의 · 적용). A miss there is the cleanest "also weak" signal; a correct answer at depth 1–2 removes b next time (rule 4.1.2 after its facet turns solid).
- The answer is hidden as in every probe.

### 4.4 Never claimed

- Never firm wording, never the 착각 title, never a percentage, never "다른 학습자 n명".
- Never a kc the learner has shown solid; never a retired kc.
- Never sent to Gemini. The `aidiag.js` payload is unchanged.

---

## 5. Output: `det.related[]`

```js
related: [{
  kc, name,                      // kc code and kc.name
  from: "c07",                   // the seed kc that explains it (§4.2)
  from_point: "c07.f2",          // the seed card it is shown under (its weakest facet)
  via: ["co_tag", "co_error"],   // reason types, strongest first, ≤ 2: co_tag | co_error | confusable
  n_co: 4,                       // co_tag only: problems carrying both (else null)
  rel: 3.4,                      // §3.3, for sorting and the admin view only (not shown to learners)
  tier: "hedged",
  probes: [{ pid, ext, lv, role: "related_check" }],   // ≤ 1
  text: { diag, why } }]
```

Text is deterministic (the v1 §5.7 rule). Templates:

| field | template |
|---|---|
| `text.diag` | "'{name}'도 헷갈리고 있을 수 있어요." |
| `text.why` · co_tag | "'{from_name}'와 같은 문제에 자주 함께 나와요 ({n_co}문제)." |
| `text.why` · co_error | "'{from_name}'를 틀린 학습자들이 '{name}'도 자주 틀렸어요." |
| `text.why` · confusable | "'{from_name}'와 헷갈리기 쉬운 개념이에요." |

With two reasons, `why` joins the first two with " 그리고 ".

---

## 6. Where it runs

- **Server (`server/insight/graph.js`):** builds the per-course base graph (E1, E3 and the E2 counts) once a day or when the content key changes, cached in memory. For each report it removes the learner's own rows from E2 and returns `graph: { kcs, names, out: [[b, w, w1, w2, w3, n_co]…] per node }`.
- **Engine (`web/js/insight-related.js`, pure):** `related(points, graph, V, Z)` → `det.related[]`, and `pagerank(graph, s, d)`. `buildReport` calls it when `raw.graph` is set.
- **Report (`report.js`):** `buildDoc` attaches `raw.graph` only when the per-course switch (`insight_meta related:<cid>`, default off) is on. Off → no `related` field at all.
- The switch is part of `ctxKey`, so turning it on or off changes the report fingerprint; the learner's next 리포트 뽑기 makes a new one (nothing is auto-made). `ENGINE_VER` stays 2: with the switch off the output is unchanged.
- **Cost:** ≤ 150 kcs and ≤ 150² edges; 50 rounds of a sparse product < 1 ms. Building E2 is one pass over the course's answer events, once a day.

---

## 7. Privacy

- The graph holds only kc codes and aggregate weights. No device id, nickname or time.
- An E2 edge exists only with ≥ 20 devices on both kcs and ≥ 5 missing both (§2.2), and the learner's own rows are removed for their own report.
- The learner sees "다른 학습자들이 … 자주 틀렸어요" without numbers.
- Learner tables (`event`, `progress`) are **read only**. Nothing is written to them.

---

## 8. Validation (acceptance gates for the build; nothing runs until the user asks)

Run on a **copy** of the live DB (`VACUUM INTO`), never the live file: `node tools/related-backtest.mjs <copy>`. The tool refuses `data/app.db` and prints per-course totals only.

1. **Back-test (time split).**
   - For each device with ≥ 30 first attempts: cut its history at the median day. Build the graph and seeds from data before the cut only (other learners' data also cut at that day).
   - Among the kcs named in `related[]` that the device then attempted after the cut: share missed on the first attempt.
   - Compare against two baselines on the same device's unseen kcs: (a) random unseen kc, (b) the globally hardest unseen kc.
   - **Gates:** precision ≥ 65% (the same bar as every hedged claim, ALGORITHM §10.2), and ≥ 1.3× baseline (b).
2. **Ablation:** E1 only · E1+E2 · E1+E2+E3, and d ∈ {.5, .6, .7, .85}. The defaults in §2.4 and §3.2 are replaced by the best passing setting; the numbers go back into this file.
3. **Admin review:** the admin-only preview lists each report's `related[]` with `rel` and the edge path; the admin marks 맞아요 / 아니에요. Target ≥ 80% agreement, as ALGORITHM §10.3.
4. **Switch on:** per course, by the admin's button (`related:<cid>`), only after 1–3 pass for that course. Courses with too few learners for E2 can still pass on E1; the back-test decides.

---

### 8.1 First run (2026-11-17, copy of the live DB)

- The back-test tool runs end to end, but **no course has enough learners to judge**: at most 3 devices answered in any course (생산경영론 1, 공학수학2 1, 경영정보시스템 3, the rest 0). So E2 has no edge anywhere, and the gate (≥ 20 checked predictions) is "표본 부족" for every course.
- Graph shape per course: 8–57 kcs. E1 exists only where items carry ≥ 2 kcs (공학수학2 119 of 431 items, 경영정보시스템 13 of 203, a few elsewhere); most courses tag one kc per item, so E1 is empty there. E3 links exist in 17 of 19 courses.
- Spot checks of the walk look sensible, e.g. 중심극한정리 → 정규확률변수의 선형결합 · 표본평균의 분포; 1계 선형 ODE → 변수분리형 ODE · Bernoulli 식; 이항 모형 옵션 평가 → 이항 격자.
- **Granularity.** kcs are coarse in some courses (공학수학2 has 11, e.g. "가역행렬과 역행렬 성질"). The user's example (치환 행렬 → 단위 행렬) is at facet level. A facet-level graph is a possible later step; kc level stays for now because facets have too few items each for E1/E2.
- **Decision for now:** the switch stays off in every course. Re-run `tools/related-backtest.mjs` when a course has ≥ 30 learners with ≥ 30 answers each.

## 9. Later (not in this design)

- **Prerequisite edges** (`prereq`): a `facet.pre` or `kc.pre` column (DATA change, `IF NOT EXISTS` / add only) and a tagging pass. Reason text would be "'{from_name}'를 이해하려면 먼저 알아야 하는 개념이에요."
- **v1 (untagged) courses:** the same walk could seed from v1 chapter labels on `item_tag.kcs`. Not now: v1 has no facet judgement to seed from honestly.
- **Persona (PERSONA_HARNESS.md):** `related[]` is deterministic and could join `profile` later as "watch" kcs.

---

## Sources

- Page, Brin, Motwani & Winograd (1999). The PageRank Citation Ranking. http://ilpubs.stanford.edu:8090/422/
- Haveliwala (2002). Topic-sensitive PageRank (personalized restart vector). https://dl.acm.org/doi/10.1145/511446.511513
- Langville & Meyer (2006). *Google's PageRank and Beyond* — the Google matrix, its eigenvector for eigenvalue 1, and power iteration.
- Knowledge Space Theory, surmise relations (Doignon & Falmagne). https://arxiv.org/pdf/1511.06757
- Piech et al. (2015), Deep Knowledge Tracing — concept influence learned from co-occurring errors. https://arxiv.org/abs/1506.05908
- Association-rule lift (Brin, Motwani, Ullman & Tsur 1997). https://dl.acm.org/doi/10.1145/253260.253325
