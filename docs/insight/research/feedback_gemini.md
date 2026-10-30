# Diagnostic learning report for 문제노트: design rules and Gemini usage plan

## PART A — What makes a diagnostic report useful, and not a filled template

### A1. Principles from the research, each turned into a design rule

1. **Every report answers three questions** (Hattie & Timperley 2007, pp. 86–90): where am I going (feed up), how am I going (feed back), where to next (feed forward). The authors say feed forward "can have some of the most powerful impacts on learning." So the report ends in actions, not a diagnosis.
   - Feedback works at four levels: task, process, self-regulation and self. Feedback aimed at the self ("you're great") is the least effective. Process and self-regulation feedback are strongest.
   - Rule: each weakness card carries three things. (a) The task-level fact: "3-12: you chose ② '…'". (b) A process cue: "in this type, first check whether the condition is A or B". (c) A self-check cue: "when an OX statement contains '항상/모든', stop and look for a counter-condition". No praise of the person.
   - Source: https://www.uky.edu/~gmswan3/575/Hattie_Timperly_2007.pdf , https://doi.org/10.3102/003465430298487
2. **Separate a knowledge gap from a misconception.** Hattie & Timperley: task feedback "is more powerful when it is about faulty interpretations, not lack of information. If students lack necessary knowledge, further instruction is more powerful than feedback."
   - Rule: classify each weak concept as one of:
     - **개념 공백 (gap):** "모르겠어요" (idk), scattered errors, slow answers. Remedy: re-read the concept summary (instruction) first.
     - **오개념 (misconception):** the same distractor or misconception picked again on ≥2 different problems. Remedy: a contrast explanation plus a contrasting problem set.
     - **혼동쌍 (confusion pair):** errors swap concept A with sibling concept B.
     - **실수/추측 (slip/guess):** a fast wrong answer on a concept that is otherwise mastered.
   - The remedies differ by category. This is what keeps the report from reading as one template.
3. **Shute 2008's guidelines** (Tables 2 and 3), verified in the full text: https://myweb.fsu.edu/vshute/pdf/shute%202008_b.pdf
   - Do: focus on the task, not the learner. Give elaborated what/how/why. Present it "in manageable units". Be specific. Keep it "as simple as possible but no simpler". Reduce uncertainty between performance and goal. Give feedback only after the learner has attempted the problem.
   - Avoid: normative comparisons, overall grades (grades plus comments produced no gains in Wiliam's summary), and praise.
   - Shute also says to **"minimize use of extensive error analyses and diagnosis."** Error analyses are "rarely complete and not always accurate."
   - Rules that follow:
     - At most 2–3 diagnoses per course.
     - Each one is worded as a hypothesis with its evidence.
     - No total score.
     - No percentile or "others got X%".
   - Table 5 adds adaptation by level. For low mastery: directive, corrective, scaffolded feedback (show the explanation `s` or the concept summary). For high mastery: facilitative feedback ("retry these 2; hint: …").
4. **Learning-analytics dashboard pitfalls** (Jivet et al. 2017/2018):
   - Awareness alone is not enough.
   - Social comparison is the most common reference frame, and it suits performance-oriented learners more than mastery-oriented ones.
   - Dashboards rarely support goal setting.
   - Rules: self-referenced frames only (you vs. your earlier self; you vs. the course or chapter goal). Every insight is attached to a one-tap action.
   - Sources: https://www.slideshare.net/slideshow/awareness-is-not-enough-pitfalls-of-learning-analytics-dashboards-in-the-educational-practice/80007584 , https://doi.org/10.1145/3170358.3170421 . OnTask's critique of earlier student-facing reports as "too generic": https://publications.ascilite.org/index.php/APUB/article/view/1913
5. **Remediation that works** (Dunlosky et al. 2013: practice testing and distributed practice are the only "high utility" techniques; interleaving is "moderate"): https://www.sciencedaily.com/releases/2013/01/130110111734.htm
   - **Successive relearning:** retrieve until correct, then relearn in later spaced sessions. https://www.unh.edu/teaching-learning-resource-hub/sites/default/files/media/2023-06/itow-successive-relearning-dunlosky-greve-badali-wissman-rawson.pdf
     - Rule: "resolved" becomes "확인됨" (confirmed) only after a correct answer on a later day.
   - **Interleaving and contrasting cases for confusable categories.** Case comparison beats single-case study (Alfieri, Nokes-Malach & Schunn 2013, 57 experiments): https://www.lrdc.pitt.edu/Schunn/papers/ContrastingCasesMeta-AlfieriEtAl2013.pdf . Interleaving helps discrimination, but effects depend on design and on how similar the categories are: https://www.frontiersin.org/articles/10.3389/fpsyg.2019.02296/full
     - Rule: for a confusion pair, build a mixed set of A and B problems plus a two-line contrast ("A는 …, B는 …").
   - **Hypercorrection:** errors made with high confidence are corrected more readily after feedback. https://en.wikipedia.org/wiki/Hypercorrection_(psychology)
   - **Rapid guessing:** answers faster than an item can be read signal low effort, not knowledge (Wise & Kong 2005). https://rdrr.io/cran/aberrance/man/detect_rg.html
     - Rule: a fast wrong answer is ambiguous (a confident misconception or a guess). Disambiguate with consistency. If the same misconception appears again, treat it as a misconception. If not, treat it as a slip.
6. **How products do it:**
   - **Eedi:** each MC distractor is mapped to one specific misconception, so the chosen wrong option is the diagnosis. https://eedi.com/blog/from-wrong-answers-to-real-insights-how-we-used-a-kaggle-challenge-to-map-student-misconceptions
   - **ALEKS:** reports mastered / not mastered / "ready to learn" (the outer fringe, whose prerequisites are known). https://en.wikipedia.org/wiki/Knowledge_space
     - Rule: the next-step plan prefers weak concepts whose prerequisite chapters are solid.
   - **Khan Academy:** categorical levels (Familiar, Proficient, Mastered). Mastered requires success on a later mixed unit test or course challenge. https://support.khanacademy.org/hc/en-us/articles/115002552631
     - Rule: use categories, not decimals.
   - **Duolingo half-life regression:** recall decays with time since practice. https://preview.aclanthology.org/fix_video/P16-1174.pdf
     - Rule: evidence decays with recency.
   - **Riiid/Santa:** weakness by part plus a recommended curriculum, built on large-data knowledge tracing (EdNet). https://arxiv.org/pdf/2010.12042 . Their score gains are company claims only.

### A2. Report anatomy (per course; Korean UI, uncluttered)

1. **한 줄 요약** (feed up/back, self-referenced). Example: "선형변환·역행렬 장은 안정적, 행렬식 성질에서 같은 착각이 반복됨." No total score.
2. **핵심 약점 2–3장 카드.** Each card has:
   - A type badge: 개념 공백, 오개념, 혼동, or 실수.
   - A diagnosis sentence that names the concept and the specific wrong belief. Example: "행 교환이 det 부호를 바꾼다는 점을 '스칼라배'와 섞고 있어요."
   - **Evidence chips:** problem ext_id, the option chosen and its misconception tag, and optionally the date and time taken. Tap a chip to open the problem.
   - A confidence label from the server: 확실 / 가능성 높음 / 가설, plus "근거 n문제".
   - A process cue and a self-check cue (one line each).
3. **헷갈리는 짝** (only when detected): a two-line contrast plus a "대조 세트 풀기" button.
4. **다음 할 일** (feed forward): at most 3 ordered steps, each linked to real problem IDs from the bank.
   - (a) Gap: open the concept summary (공학수학 `course.info.concepts`), then 3 retrieval problems.
   - (b) Confusion: an interleaved A/B set of 4–6 problems.
   - (c) Spacing: "N일 뒤 다시" queue of resolved problems.
   - Answers stay hidden until the learner attempts them (consistent with the platform rule and with Shute).
5. **잘 되고 있는 것:** one line, task-level ("이 장은 다시 풀어도 맞힘"), never person praise.
6. **아직 판단 보류:** concepts with too little evidence. Optionally an admin-only flag: "이 개념은 문제 수가 적어 진단 불가 → 문제 보강". This supports the user's plan for more 생경론 problems.

### A3. Scoring engine (deterministic, on the server, before any LLM call)

- **BKT-lite per concept** (Corbett & Anderson 1995: prior, learn, guess, slip). Guess depends on problem kind, which builds in "per-problem weighting":
  - OX: g = 0.5
  - MC: g = 1/len(opts)
  - short: g ≈ 0.05
  - essay: use the `ai_grade` point verdicts (covered = 1, partial = 0.5, missing = 0) over self-grading
  - slip ≈ 0.1
  - Update: P(L|correct) = P(L)(1−s) / [P(L)(1−s) + (1−P(L))g]. An OX correct is therefore weak evidence and a short-answer correct is strong. https://arxiv.org/pdf/1803.05926
- **Observation weight** = recency decay (half-life about 14 days) × first-attempt bonus × exam relevance (`exams` tag or `star`) × source factor.
  - Imported progress rows with no events count at about 0.5 weight with an unknown date.
  - An idk event is strong "not known" evidence and typed as a gap.
- **Uncertainty:** keep a Beta posterior or a Wilson lower bound internally and map it to the three labels. Never show raw percentages from small n (pitfall: https://evanmiller.org/how-not-to-sort-by-average-rating.html ).
  - In pyBKT simulations, mastery-estimate accuracy keeps improving up to about 15 responses per skill and then levels off: https://arxiv.org/pdf/2105.00385
  - Showing uncertainty in open learner models is recommended (Demmans Epp & Bull 2015): https://research.birmingham.ac.uk/en/publications/uncertainty-representation-in-visualizations-of-learning-analytic/
- **Gates:**
  - The report unlocks for a course at about 30 answered items, ≥15 of them with event-level first attempts, across ≥3 chapters.
  - A concept claim needs ≥3 weighted observations, or ≥2 consistent picks of the same misconception.
  - Below that, the concept goes to "판단 보류".
- **Population item statistics:** use per-problem p-value and distractor shares only when ≥20 other devices have answered.
  - Option-level IRT (nominal response model) needs hundreds of respondents, so it is not feasible here. Use descriptive stats only: https://pmc.ncbi.nlm.nih.gov/articles/PMC7151189
  - Until then, rely on the authored explanation text (`s`, the "함정:" lines) and LLM option tags.
- **Confusion pairs:** count (A, B) when the chosen MC distractor or the false OX statement is tagged as belonging to sibling concept B.

### A4. Per-course notes

- **공학수학:** already has topic, tags and concept summaries. Reuse them as the taxonomy instead of generating one. The 319 MC items get distractor tags that separate procedural slips (sign errors, misapplied row operations) from conceptual errors.
- **응용통계:** English stems. Confusion pairs are likely (SD vs SE, Type I vs Type II). Write feedback in Korean that quotes the English term.
- **진인본:** weight `exams`-tagged items higher. Show "기출 관련" on the evidence chip.
- **생경론:** only 69 problems and no MC. Diagnosis relies on OX traps and essay missing points, so expect many "판단 보류" items.
- **경정시:** 99 short and 31 essay items. Map `ai_grade` "missing" points to concepts.

## PART B — Gemini API practicalities (checked October 2026)

### B1. Platform facts that affect the code

- **Model lineup:**
  - Stable Flash models are now gemini-3.8-flash and gemini-3.6-flash. Flash-Lite: 3.5 and 3.1.
  - On 2026-09-18, gemini-2.5-flash and 2.5-flash-lite became limited to users who have used them recently. They are "not deprecated" and are served "until further notice".
  - On 2026-10-08, gemini-3.5-flash was deprecated and is now routed to 3.6-flash.
  - The changelog says `gemini-flash-latest` pointed to 3.5 Flash as of 2026-05-19. No later change is documented. The 503s seen locally may be capacity issues behind the alias.
  - **Recommendation:** pin explicit model IDs, putting gemini-2.5-flash first (it works for this project), then gemini-3.6-flash, then gemini-3.5-flash-lite. Drop the aliases for this feature.
  - Firebase docs say 2.5 models shut down on the Agent Platform (Vertex) on 2026-10-20. That is a different API, but it signals that 2.5 will eventually be retired, so the code must work for each model family.
  - Sources: https://ai.google.dev/gemini-api/docs/changelog , https://ai.google.dev/gemini-api/docs/models , https://firebase.google.com/docs/ai-logic/thinking?api=dev
- **Sampling:** temperature, top_p and top_k were deprecated on 2026-07-21. 3.6 Flash and later ignore them, and "future model generations" will return an error. Prefilled model turns now return 400.
  - Send `temperature: 0` only to 2.5 models. For 3.x, put determinism rules in `systemInstruction`.
  - https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6 , https://ai.google.dev/gemini-api/docs/latest-model
- **Thinking:**
  - 2.5 Flash: `thinkingConfig.thinkingBudget` from 0 to 24,576. 0 disables thinking. The default is dynamic, up to 8,192.
    - `server/ai.js` sets no thinkingConfig today, which likely explains the 6–13 s essay grading.
  - 3.x: thinking cannot be disabled. Use `thinkingLevel`. 3.6 Flash accepts medium/high (default medium), while 3.5 Flash-Lite defaults to minimal. Firebase's general docs list minimal/low/medium/high for 3.x; 3.7 and 3.8 Flash reject minimal.
  - Sending thinkingLevel to a pre-3 model, or both fields at once to a 3.x model, returns an error. Build generationConfig per family.
  - Thinking tokens are billed as output.
  - Some forum reports say budget 0 was not always honored on 2.5 previews, so check `usageMetadata.thoughtsTokenCount`.
  - https://discuss.ai.google.dev/t/how-to-disable-thinking-using-gemini-2-5-flash-thinkingbudget-0-not-working/80149
- **Structured output:** current generateContent docs show `responseJsonSchema` (JSON Schema subset). In REST that is `generationConfig.responseFormat.text.schema`. The existing `responseSchema` still works, so there is no need to migrate.
  - Supported: enum, minItems and maxItems (enforced), anyOf, $ref.
  - minLength, maxLength and uniqueItems are silently ignored, so enforce them on the server.
  - Large enums, large maxItems and many optional properties can cause 400 "too many states". Put enums on concept IDs per course (≤60 values), never on all 1,198 problem IDs.
  - https://ai.google.dev/gemini-api/docs/generate-content/structured-output , https://ai.google.dev/gemini-api/docs/structured-output
- **Long context:** put the query or evidence last, and pass only the tokens the model needs. https://ai.google.dev/gemini-api/docs/long-context
- **Token accounting:** `usageMetadata` has promptTokenCount, cachedContentTokenCount, thoughtsTokenCount, candidatesTokenCount and totalTokenCount. Log these per call (never the key). https://ai.google.dev/api/generate-content

### B2. Limits, price, caching, batch

- **Rate limits:** Google no longer publishes a per-model free-tier table. Limits are per project, not per key, and RPD resets at midnight Pacific. https://ai.google.dev/gemini-api/docs/rate-limits
  - The last official figures found (cited in search results) for 2.5 Flash free tier: 10 RPM, 250K TPM, 250 RPD.
  - Forum 429 bodies show 20 RPD on some projects: https://discuss.ai.google.dev/t/429-errors-despite-waiting-after-retrydelay/96899
  - Third-party guides disagree on 3.x Flash (about 20 to about 1,500 RPD, unverified): https://www.memetik.ai/guides/gemini-api-free-tier-limits , https://klymentiev.com/blog/gemini-api-free-tier
  - **Design for a worst case of 20 RPD per model.** Read the real limits in AI Studio.
- **Pricing per 1M tokens, paid** (all of these are free of charge on the free tier):

  | Model | Input | Output | Notes |
  |---|---|---|---|
  | 2.5 Flash | $0.30 | $2.50 | Batch $0.15 / $1.25 |
  | 2.5 Flash-Lite | $0.10 | $0.40 | |
  | 3.6 and 3.8 Flash | $0.75 (→ $1.50 on 2027-01-01) | $3.75 (→ $7.50) | |
  | 3.5 Flash-Lite | $0.30 | $2.50 | |

  https://ai.google.dev/gemini-api/docs/pricing
- **Batch API:** 50% off, about 24 h turnaround. The pricing page lists it as **"Not available" on the free tier**, so it is not an option now. https://ai.google.dev/gemini-api/docs/batch-api
- **Caching:**
  - Implicit caching is automatic on 2.5 and newer. The minimum prefix is 2,048 tokens on 2.5 Flash and 4,096 on 3.6/3.8 Flash.
  - Put static content first (system instruction, schema, course taxonomy) and the learner's evidence last.
  - On the free tier, caching saves no money, only some latency.
  - Explicit caching (storage per hour, minimum sizes) is not worth it for a prefix of about 3K tokens used a few times a day.
  - **The real cache is the app's own:** store each report keyed by `hash(evidence JSON + prompt version)` and serve it with no call when the hash is unchanged.
  - https://ai.google.dev/gemini-api/docs/caching
- **Errors:** retry 429 and 503 with exponential backoff and jitter: https://ai.google.dev/gemini-api/docs/troubleshooting
  - The current code cools down only on 5xx. Add 429 handling: if the quotaId contains "PerDay", mark that model exhausted until midnight Pacific (retryDelay is misleading for daily quotas). For per-minute quotas, back off and retry.

### B3. Call plan with estimates

Measured from the DB (read-only): 1,198 published problems and about 552K characters after stripping HTML (average 461; 공학수学 averages 672 because of LaTeX). That is roughly 200–250K tokens for the whole bank (estimate, about 25% Hangul).

1. **Taxonomy, once per course** (4 calls; 공학수학 reuses its tags). Input: chapter titles, concept summaries and a sample of stems, about 10–20K tokens in and about 3K out. Output: 20–60 concept IDs with Korean names, one-line definitions and candidate confusion pairs. The admin reviews it. LLM concept tagging tends to over-generate (569 vs 101 in Wang/Koedinger), so a human check is needed: https://arxiv.org/abs/2502.18632v1
2. **Item tagging, once, and again only when a problem_version changes** (content hash). About 15 problems per call gives about 80 calls.
   - Each call: static prefix of about 3K tokens plus about 3–4K of problems in, about 2.7K out.
   - Output per problem: 1–3 concept IDs (enum), the misconception each MC option implies (Eedi-style, ≤60 characters), the trap type of a false OX statement, and the concept a wrong answer is confused with.
   - Total about 520K input and 220K output tokens, plus thinking if a budget of about 1,024 is used.
   - Cost: $0 on the free tier; about $0.90 on paid 2.5 Flash.
   - Throughput: one day at 250 RPD, about 4 days at 20 RPD.
   - Run it as a resumable background job paced at ≤6 RPM, writing a new `problem_tag` table (problem_id, version, tags JSON, model, prompt_ver).
3. **Confusion-pair contrast texts, shared by all learners.** About 10 pairs per call gives about 15 calls in total. These are cached globally and reused in every report.
4. **Per-learner report narrative:**
   - 0 calls when the evidence hash is unchanged.
   - Otherwise 1 call: about 2.5K static plus 2–4K evidence in (≤12 concept rows, ≤20 evidence items with stems cut to 120 characters, ≤6 pairs, ≤15 candidate plan IDs), about 1–1.5K out.
   - thinkingBudget 0–512, roughly 3–6 s (to be measured).
   - Regenerate only after ≥10 new events in that course or ≥3 days, at most once per course per device per day.
   - About 20 learners × 2–3 courses × 2 per week ≈ 15 calls per day. Queue them under a global token bucket. When quota runs out, serve the **deterministic report** (all evidence and plan steps are computed on the server) with a "AI 설명은 잠시 뒤" note.

### B4. Hallucination control

LLM feedback faithfulness is a real problem: one study found over 23% hallucinated content (https://educationaldatamining.org/EDM2024/proceedings/2024.EDM-short-papers.49/index.html ). In a 252-learner trial, learners with low prior knowledge were worse at spotting erroneous feedback (https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.doctoral-consortium-papers.254/index.html ). The controls:

1. The server computes every statistic and choice. The LLM only selects, orders and words them, from evidence JSON with short IDs (E1…E20, C-ids).
2. The schema uses enums for evidence and concept IDs. Each diagnosis must cite ≥2 evidence IDs, or it is downgraded to "가설".
3. **No digits in narrative fields.** The UI renders numbers from the database next to the text. Strip or reject any text containing digits.
4. Server validation: drop unknown IDs, check that each cited evidence item supports the stated concept and misconception tag, and retry once with the error appended, then fall back to the deterministic report.
5. Temperature 0 (2.5 only) plus system rules: "근거 JSON 밖의 사실 금지", no peer comparison, no praise.
6. Store model, prompt version and verdicts so the admin can audit reports. Add a "이 진단이 맞나요? 예/아니오" button that writes an event, the same way `user_verdict` works for AI grading.

### B5. Privacy

Gemini API terms for unpaid services say Google uses inputs and outputs to "improve, and develop" its products, that "human reviewers may read" them, and: "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Users must be 18 or older, and serving users in the EEA, UK or Switzerland requires paid services. https://ai.google.dev/gemini-api/terms

- Send no device IDs, names or timestamps finer than a day. Send only problem content, the options chosen, and aggregates.
- Update the consent text: "AI 분석을 위해 풀이 기록 일부(익명)가 Google Gemini로 전송될 수 있음", with an opt-out that falls back to the deterministic report.
- Problem text derived from lecture slides is also sent. Note this, or move to a paid project where data is not used for training.