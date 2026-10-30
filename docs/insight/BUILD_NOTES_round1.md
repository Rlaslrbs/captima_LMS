## time owner note

I wrote one file, `TIME_FACTORS.md`, and changed no code. On today's data the model raises no time-based finding, which is the intended conservative result. The literature, the data audit and the full parameter table are in the doc.

**The model**
- **Time per item:** ln t = β_i − τ + ε.
  - β_i (how long item i should take) comes from the item's kind, its stripped text length (b_len 0.5) and a `calc` flag for MC/short items. The engine computes `calc` from `body`, so no contract change.
  - τ is the learner's speed per course × kind, shrunk toward N(0, 0.6²) and robust to outliers.
  - σ is the learner's own spread per kind. A cell is used for findings once it has at least 8 timed answers.
- **Rapid threshold:** SPEC §3.3's options 2–3 are replaced by 0.10 × the predicted median, clamped to 1.5–10 s, computed in two passes.
- **Speed classes:** each timed answer gets a residual z: fast (z ≤ −1), slow (z ≥ 1.28), or idle (z > 3, ignored).
- **What counts as timed:** first attempts in focus mode, or list mode with `vis`. Interrupted attempts (`away`) and answers whose timing window overlaps another answer are excluded.
- **Mastery stays conservative.** Slowness never lowers mastery, never makes a unit weak, and never implies a misconception. Time changes mastery in only three ways:
  - rapid answers are excluded, as before;
  - an answer given right after an "AI 질문용 복사" press is down-weighted (×0.3);
  - a ☆ on a correct answer (or AI copy after a correct answer) marks it "unsure": it blocks the 탄탄 label once a third of a unit's correct items are unsure, and sends the item back for relearning.
  - An SRT-style partial-credit scheme is specified but off by default (λ = 0), with a guard so it can never create a weak label.
- **Speed as its own axis:** `units[].speed` compares a unit with the learner's own pace in the other units of the same course.
- **New finding types:** `fluency` (correct but 1.5× slower than usual, with a timed practice set and per-item target times), `hasty`, `fatigue` and `fb_skip` (skipping the solution after a wrong answer). They share the single habit slot. Gates and Korean copy that cites concrete evidence are in the doc.
- **Validation:** later prequential ablation arms in `eval.js`, a simulation test, and a "what not to do" list. Hour-of-day is never profiled.

**Audit (heavy device on the DB copy; other devices have only 3–4 answers each)**
- 147 timed first attempts. Only three OX cells have enough data: 공학수학 61, 경정시 42 and 생경론 15. Every MC and short-answer cell has fewer than 8.
- The time model is well calibrated: 9% of answers have |z| > 1.645, against 10% expected.
- Text length helps: prediction error for OX falls from 0.822 to 0.808 with the length term.
- Slow OX answers are less accurate than expected (0.65 vs 0.82); fast answers are not (0.87 vs 0.81).
- Accuracy does not drop late in a study block, so there is no fatigue signal.
- A browser `session_id` is not a study session: one spans 70 hours. Study blocks are rebuilt from gaps between answers instead.
- 7 bookmarks were placed on correct answers.
- None of the new Contract 5 fields exist in the data yet.

**Usable now:** the model-based rapid threshold, τ/σ and z on the three OX cells, unit speed, idk timing (quick vs. after trying), unsure ☆, and block reconstruction.

**Computed but silent until more data:** fluency, hasty, fatigue, and MC/short speed.

**Only after the new instrumentation accumulates:** `fb_skip` (needs `sol_dwell`), assisted answers (`ai_copy`), list-mode timing (`vis`), and the interruption gate (`away`).

**Contract changes (all additive)**
- **Contract 1 (server owner):** an optional `raw.aux` with the `ai_copy`, `sol_dwell` and `bookmark` events for the course. The engine skips those parts if it is missing.
- **Contract 4 (det):**
  - optional `time.ref` and `time.counts`;
  - `units[].speed`;
  - evidence roles `"slow"`/`"fast"` with `sec`/`rel`;
  - plan step type `"timed"` with `target_s`;
  - caveat `"list_time"`;
  - `time.speed` stays null until other learners' data exists (P5).

**Open issues**
- The engine owner implements this spec.
- The web must render the new roles and step types generically.
- A countdown UI for the timed set is a later web task.

I started no servers or background processes. My read-only audit scripts are in `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/tf/`, `audit.mjs` through `audit4.mjs`.

Files are in /private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/docs/insight:
- TIME_FACTORS.md

## ai owner note

The ai owner's P0 work is done in the staging copy. `gradeEssay` now goes through `generate()` and returns exactly what the original did, and all 20 unit tests pass.

**Files changed** (all under `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/server/`)
- `ai.js`: `generate()`, `genCfg()`, 429/404/5xx/timeout handling, usage written to `ai_budget`, the `aiLane` semaphore, model lists from env. `gradeEssay` keeps its SYSTEM prompt, SCHEMA and result clean-up byte for byte. Its cache key now uses the model that actually answered; lookups check each grading model in order, so cache hits behave as before.
- `db.js`: added `meta`, `bumpMeta`, `budgetAdd`, `budgetToday`, `blockModel` and `blocked`. `"why"` is in BODY_KEYS, and `checkPack` gives a Korean error when an MC `why` is not a string array with the same length as `opts`. `importPack` keeps `course.topics` in `course.info` only when the pack has it, so existing courses' info is unchanged. No existing export changed name or shape.
- `schema.sql`: the SPEC §2 DDL appended exactly, including the `event_device` index.
- `insight/test/fake-gemini.mjs` and `insight/test/ai.test.mjs`: new.

**Test results**
- **Unit tests:** 20/20 pass in about 7.5 s on port 4012, against a throwaway `VACUUM INTO` copy that the test deletes afterwards. They cover:
  - grading output shape, verdict recomputation, the exact request sent, and the cache;
  - 503 moving to the next model with a 10-minute cooldown and a single log line;
  - timeout cooldown;
  - PerDay 429 writing an `ai_block` row until the next Pacific midnight, including daylight-saving dates;
  - PerMinute 429 cooling for the retryDelay;
  - 400 "thinking" retrying once bare and remembering it;
  - 404 blocking for 24 h;
  - bad JSON;
  - budget rows and daily caps;
  - the lane rules;
  - the DB helpers, `why`/`topics` validation and import;
  - grading's final messages when every model fails;
  - the key never appearing in any log, thrown error or URL.
- **Old vs new grading:** I ran the original `ai.js` and the new one side by side on the fake server: 10 env setups × 12 cases. Results and error messages are identical in every case. The requests differ only where the spec says they should: a 404 or PerDay model is not called again, and a 429 moves on to the next model.
- **Existing packs:** for all 5 packs in `data/import`, `checkPack` and dry-run import give the same results as before, with no new versions.
- **Full server on 4002:** it boots and all 11 new tables and indexes exist. `POST /api/grade` works, with a second identical answer served from the cache. In 429 PerDay mode it returns the usual limit message and blocks all 3 models until 07:00Z. One `ai_budget` row was written. Every process I started is stopped; the live server on 4000 was not touched.

**Decisions and deviations**
1. **Grading request unchanged:** grading sends `{temperature: 0}` to every model, as today. Aliases like `gemini-flash-latest` do not get `thinkingLevel: "low"` for grading; I read "grade: unchanged" as covering all model families.
2. **Usage shape:** `{ tok_in, tok_out, tok_think }`. A response that cannot be parsed still counts as one call.
3. **Error codes:** thrown errors now carry `code`: off, fail, timeout, conn, quota, key, busy, lane, parse, notFound, cap. `server.js` only reads `status` and `message`, so nothing changes there.
4. **Lane:** grading never waits. A narrative call waits up to 5 s, then fails with `lane`. Background calls (tag, verify, vocab) are refused immediately with `lane` when anything else is running, rather than queued. The tagger should treat `lane` as "try next tick" and `cap` as "paused for today".
5. **Daily caps:** the §7.2 model-level caps are enforced inside `generate()`: background calls only below 60% of `GEMINI_RPD` per model, narrative calls below 40% across all models. Grading is unlimited. The per-device narrative caps are left for the P4 caller.
6. **When every model is blocked:** no request is sent and the limit message is shown. If all the blocks are 404s, it shows the "모델을 찾지 못했어요" message instead.
7. **Extras:**
   - `meta(key, value)` also writes a value, and `null` deletes the key.
   - `db.js` also exports `dayPT`.
   - `ai.js` also exports `nextMidnightPT`, `genCfg`, `aiLane`, `MODELS`, `INSIGHT_MODELS`, `VERIFY_MODELS`, `RPD` and `text`.
   - `why` strings are included in the math check.
8. **Not done:** `insightGet`/`insightPut` are listed in SPEC §2 but not in my ownership table, so I left them for the server owner.
9. **Test key:** the tests use a random `fake-<hex>` key instead of the literal `fake`, so the leak check is meaningful.

**Open issues**
- **Test command:** `node --test server/insight/test/` fails on Node 24 with MODULE_NOT_FOUND because it won't take a directory. Use `node --test "server/insight/test/*.test.mjs"`. `fake-gemini.mjs` exits cleanly when run without `--port`, so a `*.mjs` glob is also safe.
- **No early unblock:** a 404 block lasts 24 h in the DB. There is no admin control yet; to clear one early, delete its `ai_block` row.

## web owner note

The P1 report screens are built in STAGE and all checks I could run pass. Nothing has been tried in a browser yet, and the real report API isn't in STAGE, so only the dev fixture works for now.

**Files changed** (only the ones my role owns)
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/js/insight.js` (new): the report screen. It has `mount(main, ctx)` with `update` and `destroy`, and states ready, locked, no_consent and error.
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/js/course.js`: hub card, INSIGHT branch, `Q:` scope, `seen` flag and the Contract 5 events.
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/js/me.js`: one "리포트 ›" link per course row when the overview says ready.
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/js/store.js`: only the session helpers `nextPos()` and `sessionSec()`.
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/css/app.css`: `.ins*` styles appended. Tokens only, light and dark, a 375px layout, and a reduced-motion block.
- `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/web/js/fixtures/insight-sample.json` (new, 29,624 B), built by `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/gen_fixture.mjs` from course 4 in a read-only copy of the DB.
  - `ready`: findings misc, confusion, gap, unclear, habit, relearn and fluency; 21 units; 3 caveats.
  - `hyp`: an unknown type "streak" and an unknown caveat code.
  - `thin`: no findings.
  - `locked` and `no_consent` variants.

**What works (in code; not yet seen in a browser)**
- **Ready report:**
  - headline, then a "오늘의 복습 시작 · n문제 · 약 m분" button
  - finding cards with a badge for each type; unknown types fall back to "참고"
  - evidence chips; hidden items keep their answer hidden
  - plan steps, the relearn row and the '풀이 속도' line from `det.time.notes`
  - the full concept list, then how the report was made, with caveats
- **Other states:**
  - **Locked:** shows "첫 리포트까지 N문제" and problems to solve next.
  - **No consent:** links to /me.
  - **Error:** has a retry.
- **Rendering:** a report cached in the browser is painted first. Before fetching, the page calls `flush()` and `sendEvents()`. MathJax is cleared and re-typeset around every render.
- **Hub and navigation:**
  - The hub card appears when `features().insight` is on, or with `?insightFixture=1` (`=0` turns it off).
  - The crumb reads "‹ 메뉴 · 학습 리포트".
  - The report screen skips setLast, watchCards and lazyMath, and its markup never uses `article.card`.
- **Events:**
  - `insight_open` and `insight_start` go through `track`.
  - Each answer now carries `seen`, `vis`, `away`, `pos`, `sess`, `hr`, `rd` and `len`.
  - New events `ai_copy` and `sol_dwell`; dwell time leaves out time the tab is hidden and is capped at 10 minutes.

**Test results**
- `node --check` passes on all 4 changed JS files, and the fixture parses as JSON.
- The static review found no missing styles. The only `ins-*` names without CSS are the data attributes (`ins-q`, `-from`, `-open`, `-hid`, `-retry`) and the unstyled marker class `ins-dt`. The ids `#crumb`, `#tabsNav`, `#stats`, `#toolbar` and `#insMeta` exist, as do the shared classes the screen uses.
- On a STAGE server on port 4005:
  - All 7 static files returned 200 (insight.js 18,636 B, course.js 52,831 B, me.js 13,066 B, store.js 14,100 B, app.css 51,250 B, fixture 29,624 B, util.js).
  - `/course/4/INSIGHT` returns the same SPA shell as `/` (identical md5).
- I stopped the server and nothing is left listening on 4005. I didn't touch the live site on port 4000 or the real Gemini API.

**Differences from the contract**
- Evidence chips that aren't hidden open an inline detail first. Hidden ones go to `Q:<pid>` (retry the problem).
- Jumping from the report to a problem can't use `setResume` plus `go(chKey)` alone. In focus mode, focus.js skips past a problem that is already answered. I fixed this inside course.js by resuming on the card before the target, with `Q:<pid>` as a fallback. focus.js is untouched.
- `Q:` scopes ignore saved filters, so recommended problems never drop out.
- `insight_start` can carry an extra `from` field.
- `ctx` has three extra fields: `show`, `dev` and `consent`.
- The card visibility observer now uses thresholds [0.3, 0.6].
- me.js now asks `/api/features` before `/api/me/insight`, so it makes no request while the feature is off.

**Open issues for other owners**
- **Server is missing:**
  - `/api/features` returns only `{"ai_grade":true}`, with no `insight` flag.
  - `/api/me/insight` and `/api/me/insight/:cid` return 404 in STAGE.
  - Until they exist, only the fixture mode shows anything.
- **Server, please also:**
  - avoid cutting stems in the middle of TeX (the client trims an unclosed `\(` as a stopgap)
  - write choice labels as A–D to match the cards
- **Time factors:** TIME_FACTORS.md didn't exist yet, so `time` and `units.speed` are drawn generically.
- **Re-answering fixed problems:** they still need "기록 지우고 다시 풀기" first.
- **Not built:** feedback buttons and the AI toggle are P3/P4.
- **Fixture:** uses course 4 problem ids only.
- **Integrator, Chrome checks:** the focus-mode jump, `vis` in list mode, MathJax clearing, and the me.js row layout at 375px.

## engine owner note

The engine work is finished. The engine now implements TIME_FACTORS.md, and all 21 of my tests pass (14 engine and 1 sim before; 4 engine and 2 sim added; `node --test server/insight/test/engine.test.mjs server/insight/test/sim.test.mjs`, about 5.5 s). On the real DB copy, building one course's report takes 0.1–6.7 ms after warm-up, under the 20 ms target. No servers were started and nothing outside my files changed.

**Files changed**
- `web/js/insight-engine.js` (1121 lines, still pure: no DOM, no `node:*`, no `Date.now`). Changes on top of the earlier run's work:
  - `cutTex`: cuts stem (120), trap (160) and option text (80) without splitting a `\( \)` formula. A formula that doesn't fit becomes `[수식]`; 공학수학 stems used to break mid-formula.
  - `hasty` and `fatigue` work out expected accuracy from the chapter level **without** the fast (or late) answers. With them included, the expected rate absorbed the rushed answers and `hasty` never fired.
  - The per-unit speed result keeps its own per-kind reference speed; `target_s` uses it.
  - The `ox_bias` headline names the direction ("그럴듯한 거짓 진술에 O를 누르는 편이에요: …").
  - When `ctx.topics[code]` is just the code, the topic is named after its main chapter title.
  - `buildReport` takes an optional 5th argument `dbg` that gets the intermediate results; `det` is unchanged by it.
- `server/insight/params.js`: unchanged. `PARAMS` holds SPEC §17 plus `time`, and `data/insight_params.json` can override them.
- `server/insight/test/engine.test.mjs`: fixed the recorder's `rid` (it never increased when a `ts` was given, which broke study-block rebuilding). Added tests for `fluency` (card, slow chips with `sec`/`rel`, "timed" step with `target_s`, ☆ blocking 탄탄 and the card), `fatigue` (fires; absent when study is split), `fb_skip` (plus the `list_time` and `few_timed` caveats and the ×0.5 weight on a quick essay "모르겠어요"), and `cutTex`.
- `server/insight/test/sim.test.mjs`: rewritten with three tests that assert their thresholds; the old one printed numbers but asserted nothing.

**Simulation results (fixed seeds)**
- **약함 precision:** 0.88 / 0.91 / 0.89 (courses 4, 5, 1).
- **80% band coverage:** 0.81 / 0.79 / 0.75, measured against the learner's true accuracy including slips, (1−slip)·σ(θ−d̄). Against σ(θ−d̄) without slips it is only 0.64–0.68, because the model has no slip term. Decide whether this truth definition is acceptable.
- **With slip 0.2 (deliberately wrong model):** 약함 precision 0.79, coverage 0.68. Recorded, with only a ≥ 0.7 precision check.
- **Misconception `likely`+ precision:** 0.89 / 0.97; it found 75/120 and 76/120 planted misconceptions. With the wrong model: 0.67.
- **Misconception false flags:** I counted them per (learner, misconception) pair: 3/477 and 1/256, about 0.5%. Counted per learner, 3 of 20 learners with no misconception got at least one false `likely`.
- **Time model (300 learners per course):**

| | course 4 | course 5 |
|---|---|---|
| slow-unit precision | 0.82 (28 flagged) | 0.86 (36 flagged) |
| `fluency` candidate precision | 0.89 | 0.92 |
| `hasty` precision | 0.92 | 1.00 |
| false flags, learners with nothing planted | 0.8% | 0.8% |
| \|z\| > 1.645 share | 0.101 | 0.092 |

- **Slowness never creates 약함:** weak labels were identical in 71/71 and 35/35 comparable learners. Learners whose fast-answer filtering changed when the slowness was removed were left out of the comparison. Turning on the SRT option (λ = .5) never added a weak label (300/300).

**Contract deviations (all additive)**
- Plan step type `"redo"` for `hasty` and `fb_skip` ("천천히 다시 풀기", "해설 읽고 다시 풀기"). The web should render step types generically.
- A finding with `type: "habit"` also carries a `habit` field (`ox_bias`, `rapid_wrong`, `essay_skip`, `qualifier`). Misconception findings carry `m`. `relearn` gains `unsure`. Evidence chips may carry `sec`/`rel`.
- `det.fp` is copied from `raw.fp` (otherwise null). **Server owner:** set `raw.fp` or overwrite `det.fp`.
- `raw.aux` is optional and follows TIME_FACTORS §6; a ☆ counts only when its payload has `p.on === true`.
- Stems may contain the literal placeholder `[수식]`.

**Open issues**
1. The 3-in-20 per-learner false misconception rate matters only once tags exist (P3). One option is to require hits on 2 KST days before a card is shown; the per-pair rate is fine.
2. Slow-unit detection catches only about 6% of planted slow units in a typical learner; it is conservative by design. For learners who rush, rushed answers pull down the "usual pace", so a false slow unit occasionally appears; a trimmed baseline halved detection, so I kept the spec's version.
3. The SPEC's `ox_bias` rule can fire on just 3 errors when every true statement is answered O. I left the rule as specified.

**Heavy device `DEVICE_ID_EXAMPLE` (report date 2026-10-25)**
- **경정시 (ready).**
  - Headline: "그럴듯한 거짓 진술에 O를 누르는 편이에요: 거짓 진술 23개 중 10개를 O라고 답했어요."
  - F1 habit/`ox_bias`, not tied to a unit: "(참인 진술은 18개 모두 O)". Chips 5-12, 1-21, 2-21 are hidden (no trap sentence); 4-2 shows "바른 진술: Service".
  - F2 relearn: "고친 문제 7개 중 하루 뒤 다시 맞힌 것은 1개예요", 9 due (2 of them unsure ☆).
  - Units: 5 chapters, all 보통, speed normal.
  - Caveats: relative_only, untagged. Time: 41 timed answers, OX about 6.5 s.
- **생경론 (locked):** n_eff 24.3, 25 answers, 2 chapters.
- **진인본 (ready).**
  - Headline: "고친 문제 10개 중 하루 뒤 다시 맞힌 것은 0개예요."
  - F1 relearn; chip X-3 "④ 고름" shows its trap sentence.
  - Units: 12 보통, 1 판단 보류.
  - Caveats: relative_only, imported_history, untagged, few_timed, list_time. Time: 0 timed answers (list mode), 3 rapid answers excluded.
- **응용통계 (locked):** 12 answer events, below the 15 needed.
- **공학수학 (ready).**
  - Headline: "'중간고사 기출 2021–2025' 단원에서 막혀요: '모르겠어요' 5번 (그중 1번은 1분 넘게 고민한 뒤) · 객관식 오답 1개."
  - F1 gap on chapter `exam`. Signals add "예전 기록 오답 8개(고른 답 모름)". Chips: x23-7 "② 고름" (with trap sentence), x24-9 "모르겠어요", and three old records. Plan step "풀이 하나 읽고 3문제".
  - F2 relearn: "고친 문제 81개 중 … 36개", 82 due.
  - Units: 12 topics and 12 chapters; the `exam` chapter is 약함, 2.3 선형변환 is marked 고쳐짐 (fixed), the rest 보통.
  - Caveats: relative_only, imported_history. Time: 61 timed answers, OX about 5.5 s, 9 rapid answers excluded.

No time-based finding fires on today's data, which matches the researcher's audit.

My scratch scripts are `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/eng/summary.mjs` (prints the summary above), `dbg.mjs`, `dbg2.mjs` and `bank.cjs`.

## server owner note

The server side of the 학습 리포트 is built in the staging copy, and all 56 tests in the test folder pass, including 15 new ones in `report.test.mjs`. On the heavy device, the server returns exactly the same reports as the engine owner's own loader for all five courses.

**Files changed** (only mine), all under `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app/`:
- `server/insight/ctx.js`: `courseCtx(cid)` per Contract 2, cached for up to 8 courses. Topic names come from `info.topics`, then a chapter's first concept heading, then the code. A heading shared by several chapters ("한눈에 보기") is skipped, so 공학수학 topics get the code and the engine names them from the chapter title.
- `server/insight/evidence.js`: `loadRaw` and `fingerprint` per Contract 1. `loadRaw` also fills `raw.aux` (ai_copy, sol_dwell, bookmark), which the engine reads. The event queries use the `event_device` index.
- `server/insight/report.js`: `getInsight` returns a Packed from a 300-entry memory cache, falls back to the saved `insight` row, and only builds and saves a new row when the fingerprint changes. Also `overview` (50 ms budget) and `buildDoc`.
- `server/server.js`:
  - the two routes and their rate limits;
  - `/api/features` now includes `insight: true, insight_ai: false`;
  - `last_seen` is written at most once per 60 s;
  - `sendPacked` takes extra headers: reports go out with `private, no-cache`, `Vary: Accept-Encoding, X-Device` and a `Server-Timing: insight;dur=…` header.
- `server/insight/test/report.test.mjs`: starts the server on port 4004 against a throwaway copy; the fake Gemini address points at port 4014, where nothing listens.

**What the tests show**
- **Heavy device:** 경정시, 진인본 and 공학수학 are ready; 생경론 is locked (n_eff 24.3) and 응용통계 is locked (12 events). Every report matches Contract 4 field by field, and the saved `insight` row matches what was sent.
- **Speed:**

  | measurement | p50 | p95 | target |
  |---|---|---|---|
  | report built from scratch (in-process, after warm-up) | 1.5 ms | 4.5 ms | < 20 ms |
  | report from cache (in-process) | 0.16 ms | 0.29 ms | < 5 ms |
  | course context build | | 6–7 ms | < 25 ms |
  | cached request, server time over HTTP | 0.20 ms | 0.38 ms | |

  In a freshly started server, the first report per course takes 3–29 ms (JIT warm-up plus building the course context). One rebuild after a new answer took 14.9 ms.
- **Repeat requests:** a request with a matching ETag gets 304; 100 out of 100 did on a second device.
- **Access:**
  - a device without 기록 동의 gets `{v:1,cid,state:"no_consent"}`;
  - a missing, malformed or unknown `X-Device` gets 401;
  - an unknown or hidden course gets 404, and that check runs before the consent check.
- **Change detection:**
  - a new `answer_submit` sent through `POST /api/events` changes the fingerprint, the ETag, the saved row, and adds one first attempt, while other courses still answer 304;
  - hiding a problem from another database connection rebuilds the report without that problem.
- **Overview:** the shape is right and it agrees with each course's report.
- **last_seen:** one write, then none during 15 more requests, then another once a minute has passed.
- **Existing endpoints** still behave: catalog and course (including 304), progress read and write, events (including duplicate and no-consent cases), and grade (400s, and a 5xx with an error message when Gemini is unreachable). The API key never appears in the server log.

**Contract deviations** (all additive)
- The course-context cache key has a 7th part, the server start time. `contentVer` and `data_version` restart from the beginning on every server start, so without it a saved row from before a restart could be served with old content. The cost is one rebuild per device and course after each restart.
- The context also carries `visible` and `kc: {}`, and `courseCtx` takes an optional precomputed key.
- Essay grade results are trimmed to `{verdict, points:[{i, verdict}]}`, and an unreadable client timestamp is replaced by the server timestamp.
- The fingerprint also counts bookmark, ai_copy and sol_dwell events, progress totals and status counts, and changes to the user's essay verdict.
- **Overview edge cases:**
  - if the 50 ms budget runs out and a course has no saved row yet, that course is left out rather than given a new state;
  - a device without consent gets `{state:"no_consent"}` for each enrolled course, which is usually none.
- "Hidden" means the course or its semester is hidden, the same rule the catalog uses.

**Open issues for the integrator**
1. `node --test server/insight/test/` (the command in BUILD_P0_P1.md) fails on Node 24.20 because it treats the folder as a file. Use `node --test server/insight/test/*.test.mjs`.
2. Someone else's staging server is listening on port 4001 (PID 2749, started 09:52). It is still running the old `server.js` and needs a restart before the new routes exist there. I did not touch it; I left nothing running.
3. `ai_grade` has no index by device, so fingerprinting checks the essay grades of every problem in the course (about 450 lookups, roughly 0.1 ms). If wanted, the ai owner could add `CREATE INDEX IF NOT EXISTS ai_grade_device ON ai_grade(device_id)` to `schema.sql`.
4. SPEC §15.7 asks for 1,000 conditional requests; I ran 100 because of the 240-per-hour limit per device.

## verifier summaries

Integration run on the staged P0+P1 build: no blocker or major defects. I found 5 minor issues, listed below. Everything I started (fake Gemini on 4016, staged server on 4006) is stopped. I never touched port 4000 or ~/Desktop/2026강의/문제노트_플랫폼, and the real Gemini was never called. The STAGE tree was not modified by my runs. Its data/app.db-wal changed during the run because another agent's old server (PID 2749, port 4001) has the file open, so STAGE/data/app.db is moving data for any test that reads it.

TESTS. I made VACUUM INTO copies of STAGE/data/app.db (and of the pre-change backup data/backups/app-20261025-0015.db) in /private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/integ/ (copy.db to copy6.db).
- `node --test <dir>/` as instructed fails on Node 24.20: MODULE_NOT_FOUND, 0 pass, 1 fail.
- `node --test "server/insight/test/*.test.mjs"` gave 56 pass, 0 fail in 7 of 8 full runs. One run failed on a timing assertion (issue 3).
- report.test.mjs alone passed 4 of 4.

API CHECKS (server on 4006, copy of STAGE DB, heavy device DEVICE_ID_EXAMPLE)
- /api/features returns {ai_grade:true, insight:true, insight_ai:false}.
- I wrote a Contract 4 + TIME_FACTORS §6 validator, /private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/integ/validate.mjs. It checks field names, types and enums, ID uniqueness, and plan, scope and finding links. It also checks against the DB that evidence pids, ext, chapter and kind exist and are published, that `hidden` equals "progress status is wrong" with no trap leaked, and that the overview agrees with each report. A deliberate-mutation run showed it catches 8 injected faults.
- Result: 0 errors and 0 warnings for all 5 courses of the heavy device. Courses 3, 4 and 5 are ready; 1 and 2 are locked. All 18 consented devices across all 5 courses also gave 0 errors (locked next.pids are unseen, non-essay, and span at least 3 chapters).
- I cross-checked three headline claims against raw events.
  - 경정시: 23 false statements with 10 answered O. The 24th first event in the DB has attempt 2, so it is not a first attempt.
  - 공학수학: 5 "모르겠어요", of which 1 event took 302 s and 4 are legacy rows.
  - relearn.resolved matches the DB for courses 3, 4 and 5.
- Server round trip, in ms:

| Request | Round trip | Server time |
|---|---|---|
| First request per course after a restart, course 4 | 78 | 45.9 |
| Same, courses 5, 3, 2, 1 | 6.5–15 | 3–12 |
| Repeat request | about 2–3 | 0.12–0.29 |
| 304 with If-None-Match | p50 1.8, p95 2.2 | p50 0.2, p95 0.3 |

- All 40 conditional requests returned 304. The first overview after a restart took 84 ms.
- Encodings: br and gzip decode to the same JSON with the same ETag. Headers are `Cache-Control: private, no-cache` and `Vary: Accept-Encoding, X-Device`.
- Auth: no header, a malformed header, or an unknown device returns 401. A bogus course (999, 0, -1, abc, 1.5, 1e3, 4abc) returns 404, and 404 is checked before no_consent. Two non-consented devices get `{state:"no_consent"}` and an empty overview.
- Rate limits: the 241st detail request and the 121st overview request return 429. Other devices are unaffected.

EVENTS AND CHANGE DETECTION
- One new answer_submit for the heavy device with Contract 5 fields (153 bytes) changed the fp and ETag of that course only. basis.first went 66 to 67, the insight row was saved with the new fp, and courses 1–4 still returned 304.
- A duplicate event id stores 0 and leaves the report unchanged.
- ai_copy, sol_dwell and a lone ai_copy each change the fingerprint. An ai_copy before an answer sets time.counts.assisted to 1.
- A 33-event malformed-payload fuzz (huge, negative or string ms, bad ts, future and past ts, array or null payloads, wrong problem ids) was stored (33). Reports stayed 200, free of NaN, and valid.
- A no-consent device's POST returns {stored:0}.
- Hiding and re-publishing a problem through the real admin PATCH route removes and restores it in the report. The admin overview, activity and stats routes return 200.

GRADING
- POST /api/grade works against the fake server. The error paths return 401, 400, 400, 404, 400 and 400. The second identical answer was served from cache with no second request, and the response shape is unchanged.
- 503-everywhere returns the "붐벼요" message. 429-per-day returns the limit message, writes 3 ai_block rows until 07:00Z (16:00 KST), and writes ai_budget rows.
- 8 parallel grades with an 800 ms fake finished in 882 ms. A report GET during 4 in-flight grades took 6 ms.
- The key never appears in the server log.
- PUT /api/grade/:id changes the report ETag, and another device's PUT saves 0.

STATIC AND UPGRADE
- /js/insight.js, /js/insight-engine.js, /js/course.js, /js/me.js, /js/store.js, /js/util.js, /css/app.css, the fixture JSON, `/` and `/course/4/INSIGHT` all return 200. br and 304 work on the static files.
- `node --check` passes on all 25 JS/MJS files. All 78 imported names across web/js resolve to real exports.
- Upgrade path: the server booted on the old-schema backup copy (14 tables). It created the new tables and the event_device and tag_job_q indexes, with no errors. A second boot was idempotent and the reports validated.

FUTURE COURSES
- I imported two synthetic packs (topics and `why`; no MC with no topics) and drove them through the HTTP API. Both validated.
- The topic name comes from info.topics. The no_mc, untagged and few_timed caveats are computed from data.
- In the built-in browser at 375 px I ran hub card, report, and the Q: scope start with no console errors and no horizontal scroll. Only insight_open, insight_start and problem_shown (after the start click) were tracked. No problem_shown came from the report screen.

NOT DEFECTS
- My first-run FAIL "time.n_timed unchanged after an MC answer" was a wrong expectation. n_timed counts only active cells (at least 8 timed answers), per the engine design.
- My test pack had no `color`, which made the CTA transparent. The docs require color and checkPack does not enforce it, so this is not part of the delivered change.

---

Cross-file review of the staged P0+P1 insight build. All 56 tests pass, and the server and report screens work in a browser at 375px. One real answer leak found (items whose progress was reset), plus a handful of minor regressions and contract gaps. No blockers. I ran the staging copy on my own ports (4021/4023/4024) with fake Gemini, never touched port 4000 or the live project, and stopped everything I started. Checked clean: XSS (all problem-derived strings go through esc()), token/dark-mode use in the new CSS (no undefined tokens, no hard-coded colors), course-specific hardcoding (none found), engine and route robustness (fuzzed engine, 120 messy runs + 6000-event timing, no crashes), and det JSON field names (engine output matches insight.js reads, except the gaps listed below). Notes: (1) The built-in browser pane's only open tab was being driven by another verifier on port 4006; one JS call of mine ran in that tab, and I restored their page (back-navigation, cleared the fixture flag I may have set). I then used my own tab and closed it. (2) The ai.js 429 and 404 behaviours differ from base but match SPEC §7.1, so I did not flag the 429 change. I flagged only the persistent 404 block, which can disable grading for 24h.

---

I generated the det for device DEVICE_ID_EXAMPLE on all 5 courses from a VACUUM INTO copy (scratch dir /private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/aud) and cross-checked it against my own SQL. No project file was edited.

Nothing is a blocker: no crash, no leak of a hidden item's solution, no wrong count.

**Confirmed true**
- 경정시 ox_bias: 23 false statements, 10 answered O, all 18 true statements answered O.
- Relearn counts match my own reconstruction: 7 resolved / 1 confirmed (경정시), 81 / 36 (공학수학), 10 / 0 (진인본).
- Chip option letters, items, stems and KST dates are right.
- Hidden items carry no trap text.
- The engine ran on all 17 devices × 5 courses without error.
- Time model: |z|>1.645 is 9.8% (공학수학) and 7.3% (경정시). Shuffling the times 300 times per course fired no hasty, fluency or fatigue finding, and rapid_wrong fired 5 of 300 times in 공학수학. The time gates are strict enough; the weak spot is the ox_bias gate.

**Major defects: wrong or misleading text and numbers**
- Wrong sentences shown as "함정": the TRAP regex picks the explanation of the correct option.
- A card claims "'모르겠어요' 5번" but shows one such chip.
- Unit bars sit below the learner's actual accuracy.
- The 공학수학 headline understates the problem: its past-exam MC first tries are 0 of 8.
- Math stems and options are cut to "[수식]…".
- ☆ (saved for later) is read as "자신 없음".
- ox_bias, the top-priority habit, fires falsely for about 1 in 5 unbiased learners on thin data.

**Major gaps: patterns the report misses**
- The 진인본 headline is a boilerplate relearn line ("하루 뒤 다시 맞힌 것은 0개").
- Accuracy by question format (진인본 O/X 93%, 단답 59%, 서술형 11%).
- The weakest chapters (경정시 CH3 and CH5, 진인본 C10).

**Gates**
- ox_bias: needs a posterior gate (fix in issue 1).
- essay_skip: the denominator omits AI-graded essays, so it can fire falsely.

**Time and behaviour model, for the issues below**
- Only the O/X cells are active.
- List-mode timing is discarded although it is valid.
- The fixed length slope b_len and the idle cutoff are weak points.
- The web never shows the list_time caveat.

I prototyped three fixes in a scratch copy of the engine (legacy idk chips, option-specific trap sentence, ox_bias posterior gate) and they work on this data.