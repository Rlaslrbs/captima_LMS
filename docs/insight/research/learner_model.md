# Per-concept mastery and misconception diagnosis for 문제노트: research recommendation

## 0. Bottom line

1. **Use a hierarchical Bayesian 1PL with a fixed guessing floor as the core learner model.** Each concept's skill is shrunk toward the learner's own course-level ability. Compute the posterior exactly on a 41-point grid. This is Rasch/Elo with guessing plus partial pooling, and it gives credible intervals, which Elo cannot.
   - At this data scale, logistic/IRT-family models match or beat BKT and deep KT.
   - Gervet et al. found logistic regression wins below about 1M interactions. We have about 10³–10⁴.
2. **Fix item difficulty from priors at first; switch to population calibration later.** Priors come from kind and star (collateral information, Mislevy 1988). Per-item population calibration only starts once other learners exist.
   - When calibrating, never let a learner's own answers set the difficulty of items used to judge that same learner (leave-one-learner-out).
   - With one heavy user, item difficulty and his skill cannot be separated. His weak concepts would otherwise disappear into "hard items".
3. **"Weight per problem" is not a hand-tuned score.** It is the product of:
   - an evidence-quality weight (first attempt, retry, imported, self-graded, rapid guess);
   - the item's Fisher information under its guessing floor. At θ ≈ d, one short answer ≈ 1.7 four-option MC ≈ 3 OX items.
4. **Diagnose "you confuse A with B" from the options chosen, not from correctness.** Gemini maps each MC distractor and each OX statement's twist to a per-chapter misconception catalog. This is done offline, once per item version, and cached. A fixed-parameter 3-state classifier (Knows / Doesn't know / Holds misconception m) then weighs the chosen options, with "모르겠어요" (idk) clicks used as a confidence signal.
5. **Gemini writes only the narrative.** It works from a computed evidence JSON. Every claim must cite problem ids, and the server drops claims whose ids are not in the evidence. This keeps the analysis real rather than template-filled, and keeps it auditable.

## 1. Literature comparison

| Method | Accuracy evidence | Data needs / cold start | Verdict here |
|---|---|---|---|
| BKT | Lags logistic and deep models on 9 datasets. Previously reported BKT AUC 0.62 vs Best-LR 0.83 on algebra05 (Gervet 2020). Extended BKT can match DKT (Khajah 2016). | Per-skill parameters fitted from a population. About 250 students × 6 problems to infer guess/slip (Slater & Baker, via course notes). Identifiability and degenerate-parameter problems. Bounds: guess < 0.3, slip < 0.1 (Corbett & Anderson). | Do not fit it. Borrow the item-specific guess/slip idea (KT-IDEM). |
| PFA | More accurate than KT, with more plausible parameters (Gong, Beck & Heffernan 2011). Best-LR = PFA with log(1+count) features + IRT ability/difficulty. | Per-KC γ/ρ need population fitting. No item difficulty unless added. | Later, as a validation baseline. |
| Elo (+guess, +concept hierarchy, PFAE) | Geography data: Elo AUC 0.743, full Bayesian 0.741, hierarchical concept model 0.751 (Pelánek et al. 2017). Elo ≈ JMLE (r = 0.97). | Item difficulty needs about 100 learners. Learner skill is reasonable after about 10 answers once items are calibrated. U(n) = 1/(1+0.05n). Shifted logistic for k options. | Use for online item calibration once the population grows. For learners it gives point estimates with no CI. |
| IRT 1PL/2PL/3PL | Hierarchical Bayesian IRT matched or beat DKT on all datasets (Wilson 2016). | Rasch: 30 respondents per item for ±1 logit, 100 for ±0.5 (95% CI; Linacre). 2PL/3PL need far more, and the guessing parameter c is notoriously hard to estimate. | **Core:** 1PL with c fixed at 1/k by format, Bayesian priors. |
| CDM (DINA/G-DINA) | Needs a Q-matrix. MMLE-EM struggles at small N (Sorrel 2023). Complex CDMs need larger N (simulations use N = 200–5000). | Population-fitted slip/guess per item. With one concept per item, it reduces to a per-concept latent class. | No as a fitted model. The misconception classifier in 2.5 is a fixed-parameter latent class model in this spirit. |
| HLR (Duolingo) | Trained on 12.9M instances. MAE −45% vs Leitner, but AUC only 0.538 (Leitner 0.542). | Huge data. | Use only a fixed recency decay. Forgetting matters less for understanding than for fluency or memory (Pelánek 2017, hypothesis 2). |
| DKT/SAKT | Best-LR dominates below about 1M interactions. SAKT trailed DKT on every dataset (Gervet). | Large data. Not interpretable. | No. |
| Beta-binomial shrinkage | Exact CI. Classic empirical Bayes. | Ignores item difficulty and guessing. | Use for display and sanity checks only. |

Two other findings shape the design:

- **Response time:**
  - **Very fast answers (5th–10th percentile) mark guessing.** Otherwise the response-time curves are nearly flat (Pelánek & Effenberger 2020).
  - **Slower wrong answers predict slightly *better* future performance.** That contradicts the intuition that a slow wrong answer means a misconception.
  - **Wrong answers carry more information than response times** (Pelánek, L@S 2018).
  - **Data choice beats model choice.** Choosing input data and thresholds matters more than the choice of learner model (Pelánek & Řihák).
- **Retries:** In ASSISTments, partial credit with small per-attempt penalties (about 0.1) predicted the next problem better than first-attempt-only binary scoring (Ostrow et al. 2015). Later attempts carry information, but they must be discounted.

## 2. Recommended pipeline

### 2.1 Evidence layer: from events to observations

Build the `obs` table from `answer_submit`, `idk`, `ai_grade` and imported `progress` rows. Each row has: item, list of KCs with weights `kw` (summing to 1), outcome y ∈ [0, 1], guess floor g, weight w, flags, chosen option and timestamp.

**Guess floor g:**
- OX = 0.5.
- MC = 1/k.
- short numeric = 0.02; short text = 0.05.
- essay = 0.
- idk = 0, with y = 0. An idk is clean "not known" evidence, because no guess is possible.

**Retry on the same item.** The answer stays hidden, so options get eliminated:
- MC: g = 1/(k − eliminated).
- OX after a wrong answer: g = 1. The retry is forced and carries no information, so drop it.
- Weight retries by W_RETRY = 0.5. This is a heuristic for local dependence and item memory; tune it later.

**Rapid guess.** Flag when t < T_i = min(10 s, max(1.5 s, 0.10·τ_i)). This is NT10 (Wise & Ma) with the 10-second cap described by NWEA.
- τ_i is the median non-rapid time on that item across learners when there are at least 20 such times.
- Otherwise τ_i is the learner's own per-kind median, scaled by item text length relative to the kind's median length.
- Only flag when `mode = focus`. List-mode times are unreliable.
- Treatment follows effort-moderated IRT: exclude rapid answers (correct or wrong) from the likelihood, and report them as a disengagement rate. Prefer liberal thresholds (Rios 2022).
- Never use slow times to infer misconceptions.

**Essays:**
- y = (covered + 0.5·partial) / points.
- AI-graded: w = 1.0, × 0.5 if `user_verdict` disagrees.
- Self-graded: w = 0.5, because self-assessment is inflated.
- Missing points become concept-level evidence for 2.5.

**Imported rows** (no events):
- One first-attempt observation: y = (status == correct && wrong_count == 0), with w = 0.7.
- For `resolved`, add one later-correct retry observation.
- For a still-wrong row, `last_answer` gives the chosen distractor.

### 2.2 Item layer

- **Prior:** d_i ~ N(d₀, 1²), where d₀ = β_kind + β_star·star.
  - Start with β = 0 and β_star = +0.7. These are heuristic starting values.
  - Refit these roughly 5 global parameters by pooled MAP over all data, the heavy user included. That is safe: there are hundreds of observations per parameter, and he cannot cause per-item confounding through them.
- **Per-item update:** use first attempts of *other* learners only. Compute MAP with abilities fixed, using 3 Newton steps. It stays close to d₀ until about 30 other learners have answered the item.
- **Chapter difficulty offsets** δ_ch: only once at least 5–10 other learners have answered in that chapter. Until then, the report must say weaknesses are "relative to your own average, assuming chapters equally hard".

### 2.3 Learner layer: exact grid posterior

Model: P_i(θ) = g + (1 − g)·σ(θ − d_i), on the grid θ_j ∈ {−4, −3.8, …, 4}.

1. For each concept c, accumulate the log-likelihood:
   LL_c[j] += w · w_time · kw · [y·ln P + (1 − y)·ln(1 − P)]
2. Two estimates per concept:
   - **Initial:** first attempts only, no decay. This is the misconception-era diagnosis.
   - **Current:** all non-dropped observations, with w_time = max(0.3, 2^(−Δdays/30)).
3. Course level: LL_course = Σ_c LL_c. This is exact because the kw weights sum to 1 per observation. Use prior N(0, 1).
4. Leave-concept-out course mean μ₋c = posterior mean of (LL_course − LL_c). This is free.
5. Concept posterior: prior N(μ₋c, τ²) with τ = 0.7.
   - This is hierarchical shrinkage: a concept with few answers falls back to the learner's own level.
   - The τ value is a heuristic, consistent with the 0.6 cross-subset skill correlation Pelánek reports. Tune it by grid search on held-out log-loss.

Outputs per concept:
- posterior mean and SD of θ_c;
- 80% interval;
- Δ_c = θ_c − μ₋c;
- p_mastery = P(σ(θ_c − d̄_c) ≥ 0.8);
- raw and guess-corrected accuracy, for transparency.

Course 4: use `topic` and `tags` as the KCs, with kw = 1/|tags|. Courses 1, 2, 3 and 5: chapter-level KCs now, plus 1–3 Gemini-generated tags per item drawn from a per-chapter vocabulary. LLM-generated KCs reach a fit comparable to human KCs (KCGen-KT). Keep tags only if they improve held-out prediction over chapter-only.

### 2.4 "Enough evidence" rules and labels

Information: I_c = Σ w·kw·(1 − g)²σ²(1 − σ)² / (P(1 − P)), evaluated at θ̂. At θ = d this is 0.25 per short answer, 0.15 per MC4 item and 0.083 per OX item.

| Label | Condition |
|---|---|
| `insufficient` | I_c < 0.5, or fewer than 3 distinct non-rapid items. Roughly 2 short / 4 MC / 6 OX first attempts at minimum. |
| `weak` | P(Δ_c < −0.3) ≥ 0.8 |
| `strong` | P(Δ_c > +0.3) ≥ 0.8 |
| `average` | Otherwise |
| `fixed` | Initial = weak, current is not weak, **and** at least 2 later correct first attempts on *different* items. A same-item correct may be memory of the answer. |

- **Course gate:** show a course report only with at least 30 informative observations. Otherwise show "데이터 모으는 중 (n/30)".
- **Priority ranking:** (0.8 − E[mastery]) × (number of unsolved items in the concept, plus a past-exam tag bonus).

### 2.5 Confusion / misconception layer

**Offline (Gemini, cached per problem version).** Inputs: the chapter's concept summaries and every item's explanation `s` (which already names traps, e.g. "함정").

1. Build a per-chapter catalog of 5–15 misconceptions or confusable pairs, each with {id, kc_a, kc_b, label}.
2. Map each MC distractor, each OX twist and each essay point to a catalog id, or to "none", with a confidence.

Mapping onto a fixed catalog keeps ids consistent across items, which is what makes aggregation possible. The Eedi/Kaggle winners used retrieve-then-rerank onto a catalog. Eedi notes that generic LLMs struggle out of the box, and that unseen misconceptions are hard. So:
- drop tags with confidence below 0.6;
- give the developer accept/reject in the admin UI.

**Online classifier per misconception m** (fixed parameters, no population needed):
- Priors: K 0.45, U 0.40, M 0.15.
- Likelihoods for a non-idk answer on an item with k options, a of which are tagged m:
  - K: correct 0.9; each wrong option 0.1/(k − 1).
  - U: every option 1/k.
  - M: a tagged option 0.8/a; correct 0.1; each other wrong option 0.1/(k − 1 − a). If there are no other wrong options, that mass goes to the tagged option.
- OX: K 0.9/0.1; U 0.5/0.5; M picks the twist with 0.85.
- idk: K 0.02, U 0.25, M 0.02. This applies the Certainty of Response Index logic (Hasan 1999): a confident wrong answer suggests a misconception, while unsure means lack of knowledge.
- Retries: renormalise over the remaining options and raise the likelihood to the power 0.5.

**Flagging:**
- **Confusion:** P(M) ≥ 0.7 **and** hits on at least 2 distinct items.
  - Worked examples: two MC4 hits → P(M) = 0.79 (flagged). One hit + one correct → 0.24. Two OX wrongs → 0.51; four OX wrongs → 0.75. So OX correctly needs more evidence.
- **Single-item hits:** shown only as a "hint" inside an already-weak concept.
- **Fixed:** P(M) recomputed on answers after the last hit falls below 0.3.

### 2.6 Gemini's two jobs

1. **Offline tagging** (2.5 and the KC tags).
   - Send 10–20 items per request to respect free-tier quotas.
   - Use responseSchema, temperature 0, and gemini-2.5-flash first, since gemini-flash-latest often returns 503.
2. **Per-course narrative**, one call per course.
   - Input: the evidence JSON — concept table, flagged confusions with item ids, chosen options, distractor labels, explanation excerpts, essay missing points, idk and rapid rates, uncertainty labels.
   - Schema: {summary, weaknesses:[{kc, diagnosis, evidence_ids, why_from_choices, action, next_items}], confusions:[…], caveats}.
   - Validation: drop any claim with fewer than 2 evidence ids, or with any id outside the input set. All numbers are rendered by the server, never by the LLM.
   - Cache by hash of the evidence. Regenerate only after at least 10 new course answers, on user request.

### 2.7 Optimization

- **Report cost:** one indexed query `obs WHERE device_id=? AND course=?`. That is O(n_obs × 41): about 30k logistic evaluations for 700 answers, which is about 1 ms in V8.
- **Leave-concept-out:** subtract one array; no refits.
- **Item calibration:** compute lazily at report time, only for items the learner answered, using others' observations. Alternatively run an Elo pass on each submit with K = 1/(1 + 0.05·n_i).
- **Observation table:** materialise `obs` incrementally on submit. Re-derive it only when tagging changes.
- **Database tables:** `kc`, `item_kc`, `misconception`, `distractor_tag`, `report_cache`.

## 3. Pseudo-code (plain JS, no libraries)

```js
const G=[...Array(41)].map((_,j)=>-4+0.2*j), sig=x=>1/(1+Math.exp(-x));
const TAU=0.7, H=30*864e5, MINW=0.3;
function gFloor(o){ if(o.idk) return 0;
  if(o.kind==='ox') return o.elim>0?1:0.5;
  if(o.kind==='mc') return 1/Math.max(1,o.k-o.elim);
  return o.kind==='short'?(o.numeric?0.02:0.05):0; }
function accumulate(obs,dOf,now,mode){ const LL=new Map(), INFO=new Map(), ITEMS=new Map();
  for(const o of obs){ const g=gFloor(o); if(o.rapid||g>=1) continue;
    if(mode==='initial'&&!o.first) continue;
    const w=o.w*(mode==='current'?Math.max(MINW,2**(-(now-o.ts)/H)):1), d=dOf(o.item);
    for(const {id,kw} of o.kcs){ const a=LL.get(id)??LL.set(id,new Float64Array(41)).get(id);
      for(let j=0;j<41;j++){ const p=g+(1-g)*sig(G[j]-d);
        a[j]+=w*kw*(o.y*Math.log(p)+(1-o.y)*Math.log(1-p)); }
      (ITEMS.get(id)??ITEMS.set(id,new Set()).get(id)).add(o.item); } }
  return {LL,ITEMS}; }
function post(ll,mu,tau){ const lp=G.map((t,j)=>(ll?ll[j]:0)-(t-mu)**2/(2*tau*tau));
  const m=Math.max(...lp), p=lp.map(x=>Math.exp(x-m)), Z=p.reduce((a,b)=>a+b);
  const q=p.map(x=>x/Z), mean=q.reduce((s,x,j)=>s+x*G[j],0);
  return {q,mean,sd:Math.sqrt(q.reduce((s,x,j)=>s+x*(G[j]-mean)**2,0))}; }
const probBelow=(P,t)=>P.q.reduce((s,x,j)=>s+(G[j]<t?x:0),0);
function concepts(LL,ITEMS,infoOf){ const course=new Float64Array(41);
  for(const a of LL.values()) a.forEach((v,j)=>course[j]+=v);
  return [...LL].map(([id,a])=>{ const loo=course.map((v,j)=>v-a[j]);
    const mu=post(loo,0,1).mean, P=post(a,mu,TAU), I=infoOf(id,P.mean);
    const label=(I<0.5||ITEMS.get(id).size<3)?'insufficient'
      :probBelow(P,mu-0.3)>=0.8?'weak':(1-probBelow(P,mu+0.3))>=0.8?'strong':'average';
    return {id,mu,mean:P.mean,sd:P.sd,label}; }); }
// misconception m: states K,U,M
function misconception(resps){ let lK=Math.log(.45),lU=Math.log(.40),lM=Math.log(.15); const hit=new Set();
  for(const r of resps){ if(r.rapid) continue; const e=r.retry?0.5:1; let K,U,M;
    if(r.idk){K=.02;U=.25;M=.02;}
    else{ const k=r.k-r.elim, a=r.taggedRemaining, rest=k-1-a;
      if(r.correct){K=.9;U=1/k;M=.1;}
      else if(r.choiceTagged){K=.1/(k-1);U=1/k;M=(rest>0?.8:.9)/a;hit.add(r.item);}
      else{K=.1/(k-1);U=1/k;M=.1/Math.max(1,rest);} }
    lK+=e*Math.log(K); lU+=e*Math.log(U); lM+=e*Math.log(M); }
  const mx=Math.max(lK,lU,lM), z=Math.exp(lK-mx)+Math.exp(lU-mx)+Math.exp(lM-mx);
  const pM=Math.exp(lM-mx)/z; return {pM,flag:pM>=0.7&&hit.size>=2}; }
```

## 4. Caveats and things not to do

- **Calibration.** Do not calibrate per-item difficulty from the heavy user and then judge him with it. Until about 5–10 other learners per chapter exist, label results "relative to your own average".
- **The heavy user's own history.**
  - Most of his history is imported, with no options or times, so misconception evidence is thin until new events accumulate.
  - The report should say so, not hide it.
- **Heuristic defaults.** These are my own reasoned defaults, not literature values: W_RETRY 0.5, w_import 0.7, τ 0.7, H 30 d, the misconception priors and 0.8/0.85 likelihoods, the star offset, and the label thresholds.
  - Once there are at least 2,000 event-level first attempts, tune them by grid search on held-out next-first-attempt log-loss/RMSE (Pelánek's practice).
  - Literature-backed values: guess = 1/k; slip ≈ 0.1; U(n) = 1/(1 + 0.05n); NT10 with 10 s cap; 5–10th-percentile rapid cutoff.
- **Do not copy fitted parameters from other domains**, such as PFAE γ = 2.23, δ = −0.89 from geography.
- **Never let Gemini produce scores or labels.** Only tag offline, with review, and narrate from evidence.

## Sources

- [Pelánek 2016, Elo in adaptive educational systems](https://www.fi.muni.cz/~xpelanek/publications/CAE-elo.pdf)
- [Pelánek et al. 2017, Elo-based learner modeling for facts](https://www.fi.muni.cz/~xpelanek/publications/umuai-adaptive-practice.pdf)
- [Pelánek 2017, overview of learner modeling](https://www.fi.muni.cz/~xpelanek/publications/umuai-overview.pdf)
- [Pelánek & Effenberger 2020, answer classification](https://www.fi.muni.cz/~xpelanek/publications/answer-classification.pdf)
- [Pelánek 2018, response times vs wrong answers](https://muni.cz/en/research/publications/1448716)
- [Pelánek & Řihák, mastery criteria](https://www.fi.muni.cz/~xpelanek/publications/nrhm-mastery.pdf)
- [Gervet et al. 2020, JEDM](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/451)
- [Khajah et al. 2016, How deep is knowledge tracing?](https://arxiv.org/abs/1604.02416)
- [Wilson et al. 2016, Bayesian IRT vs neural networks](https://arxiv.org/abs/1604.02336)
- [BKT bounds and Slater & Baker sample sizes (course notes, secondary source)](https://yilinl.quarto.pub/bayesian-knowledge-tracing)
- [KT-IDEM, Pardos & Heffernan](https://web.cs.wpi.edu/~nth/pubs_and_grants/papers/2011/UMAP/Pardos%20Introducing%20Item%20Difficulty.pdf)
- [Gong, Beck & Heffernan 2011](https://journals.sagepub.com/doi/10.3233/JAI-2011-016)
- [Settles & Meeder 2016, HLR](https://aclanthology.org/P16-1174.pdf)
- [Rios 2022, rapid guessing and EM-IRT](https://pmc.ncbi.nlm.nih.gov/articles/PMC8725050)
- [NWEA on rapid guessing: 10% rule with 10 s cap (from search snippet; page returned 404 on fetch)](https://nwea.org/blog/?p=8558)
- [aberrance R package, NT method](https://search.r-project.org/CRAN/refmans/aberrance/html/detect_rg.html)
- [Ostrow et al. 2015, partial credit](https://www.educationaldatamining.org/EDM2015/proceedings/short404-407.pdf)
- [Linacre, Rasch sample size and calibration stability](https://www.rasch.org/rmt/rmt74m.htm)
- [Mislevy 1988, auxiliary item information](https://www.ets.org/research/policy_research_reports/publications/report/1987/ihoh.html)
- [Sorrel et al. 2023, CDMs with small samples](https://www.mdpi.com/2624-8611/5/2/23)
- [Frontiers 2020, DCM sample size](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.621251/pdf)
- [Eedi misconception competition](https://www.eedi.com/news/from-wrong-answers-to-real-insights-how-we-used-a-kaggle-challenge-to-map-student-misconceptions)
- [KCGen-KT, LLM-generated KCs](https://arxiv.org/html/2502.18632v3)
- [LLM-assisted Q-matrix discovery (2026, known from search summary only)](https://aclanthology.org/2026.aimecon-wip.29.pdf)
- [Hasan et al. 1999, Certainty of Response Index](https://iopscience.iop.org/article/10.1088/0031-9120/34/5/304)
- [Robinson, empirical Bayes estimation](https://www.r-bloggers.com/2015/09/understanding-empirical-bayes-estimation-using-baseball-statistics/)