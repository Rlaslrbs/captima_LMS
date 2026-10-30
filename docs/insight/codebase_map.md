# Learner-weakness report: integration map for 문제노트_플랫폼 (read-only survey, 2026-10-24)

## 0. Naming collision to settle first
"report" already means **오류 제보** (error reports) everywhere in this codebase:
- the `report` table
- the `/api/reports` and `/api/me/reports` routes, and the `"POST /api/reports"` key in LIMITS
- the exact-match `"/api/reports"` entry in the `needsDevice` list
- the `data-report` attribute that opens the 제보 sheet (`course.js:515`)
- the `.rep`, `.rlist`, `.rh`, `.rm` and `.rn` CSS classes

The new feature needs its own name, for example `insight` / `study_report`. Suggested names: `/api/me/insight`, set key `"INSIGHT"`, table `insight`. Never use `data-report`.

---

## 1. server.js route pattern

- **Route tables.** There are two plain objects: `user` (lines 143–293) and `admin` (296–365). Each entry has the shape `"METHOD /path/:param": (req, m, body, d, q) => result | Promise<result>`.
  - `m` holds the decoded path params. `body` is parsed JSON, read only for POST, PUT and PATCH (limits: user 2e5, admin 8e6, line 387).
  - `d` is the device row, or null. `q` is `URLSearchParams`.
  - Example async handler: `"POST /api/grade"` (147–161).
- **compile** (368–372) turns the keys into regexes. `needsDevice` is computed from the path: `path.startsWith("/api/me") || path.startsWith("/api/grade") || ["/api/events","/api/reports","/api/transfer"].includes(path)` (371). Any route under `/api/me/...` therefore requires a device automatically.
- **handle** (375–395):
  1. Applies the LIMITS rate limit (381–385).
  2. Calls `device(req)` and returns 401 if there is no device (386).
  3. Reads the body, then awaits `r.fn(...)` (388). Handlers can be async; a long Gemini await is fine.
  4. For admin non-GET requests, runs `contentVer++` (389).
  5. If the result has `$packed`, sends it with `sendPacked` (390). Otherwise `$status` is removed from the object and used as the HTTP code (391), and `send()` brotli/gzip-compresses anything ≥1 KB (90–98).
  6. Errors are returned as `{ $status: 4xx, error }`. A thrown error without `.status` becomes 500 "서버 오류" (418–421).
- **LIMITS** (37–44): `"KEY": [max, ms, "ip"|"device"]`. The key must equal the route-table key exactly, including `:id`. `limited()` is in-memory (30–36), so all counts reset on restart. The global limit is 3000 per IP per minute (400).
- **device(req)** (110–116): validates the `X-Device` header with `isId` (`/^[A-Za-z0-9_-]{16,64}$/`, line 107), SELECTs the device, and **UPDATEs `last_seen` on every call** (one write per request).
- **Consent** is checked only in `POST /api/events` (249: `if (!d.consent) return { stored: 0, skipped }`). `POST /api/grade` does not check device consent; it requires `body.consent === true` (AI consent only).
- **Caching:**
  - `Packed` (62–65) stores the buffer, a lazy br/gzip copy and a sha1 ETag. `sendPacked(req, res, pk, cache="no-cache")` (66–72) answers 304 when `If-None-Match` matches. It sets `Vary: Accept-Encoding` only.
  - `cachedJson(key, make)` (79–87) is keyed by `contentVer.data_version|key`, and it clears the whole map once it holds more than 40 entries.
  - **Do not use `cachedJson` for per-device reports.** `PRAGMA data_version` changes only when *another* connection commits. The server's own event and progress writes go through the same connection and never change the key. Per-device entries would also flush the catalog and course caches.
  - Use a separate cache instead: a Map or DB table keyed by `device|course|evidence-fingerprint` (for example the max `event.server_ts` plus `progress.updated_at` for that device and course). Serve it through `sendPacked(..., "private, no-cache")`, or add `Vary: X-Device`.
- **Feature flags.** `GET /api/features` (144) returns `{ ai_grade: ai.enabled() }`, and the frontend reads it through `features()` (course.js:28–29). Add a flag for the new feature, e.g. `insight_ai`.
- Two handler details to reuse: `str(v, max)` (106), and the event payload is stored as `JSON.stringify(payload).slice(0, 2000)` (255). That slice can produce **invalid JSON**, which `J()` then silently reads as `{}`, so keep any new event payloads small.

## 2. db.js conventions

- There is one connection: `new DatabaseSync(DB_FILE)` (14), opened with WAL and `busy_timeout` 3000 (15). **`schema.sql` is run again on every startup**: `db.exec(readFileSync(schema.sql))` (16). Every statement in it is `CREATE TABLE/INDEX IF NOT EXISTS`, plus `PRAGMA foreign_keys = ON`.
- **Safe migrations:**
  - New tables and indexes: append them to schema.sql with `IF NOT EXISTS`. They are created automatically at restart.
  - New columns: they are not created automatically. Per `prompts/DB_프롬프트.md` §5, add a guarded `ALTER TABLE … ADD COLUMN` in db.js after line 16, checked with `PRAGMA table_info`.
- Helpers:
  - `now()` returns an ISO string (18).
  - `J(s, d={})` is a safe JSON parse (19).
  - `tx(fn)` wraps a call in BEGIN/COMMIT/ROLLBACK (22–26). It is synchronous, so it must never span an `await`.
  - Statements use inline `db.prepare(sql).get/all/run`; there is no statement cache.
  - The DB prompt treats exported function names and return shapes as a contract with server.js.
- **Index gap:** `event` has only `event_problem(problem_id, version, type)` and `event_time(server_ts)`. Per-device reports need `CREATE INDEX IF NOT EXISTS event_device ON event(device_id, type, client_ts)`. `progress` already has the primary key `(device_id, problem_id)`.
- **Reusable code:**
  - `coursePayload(id)` (152–163) returns the published problems only, with `body` spread into each problem and `...J(course.info)`, so `concepts` is included.
  - `problemStats` (169–207) already computes first-attempt accuracy, median ms, idk rate and **`top_wrong`** (the most frequent wrong answer, 188/204). It scans every matching event on each call, so it needs a precomputed or cached version if the report uses population statistics.
  - `median` (166). Admin uses `MIN_N = 3` and `LOW = 0.5` (`admin/lib.js:26`).
- node:sqlite is synchronous. Analysis code runs on the event loop: fine for about 10³ rows, but avoid full-table scans per request.

## 3. ai.js: what to reuse and what to refactor

`gradeEssay` (59–125) is monolithic. Module-level parts that can be shared:
- `KEY` (14, never exposed), `MODEL` / `MODELS` fallback list (15–17), `BASE` (18), `enabled()`, `keySource()`
- `text(html)`, an HTML→text stripper (43–44)
- `coolUntil` + `cool(model, why)` (47–52), the 10-minute skip for overloaded models

The proposed shared function, lifted from lines 72–109:
```js
export async function generate({ system, prompt, schema, deadline = 25000, perTry = 15000, temperature = 0, msgs }) → { out, model, ms }
```
- It builds `{systemInstruction, contents, generationConfig:{temperature, responseMimeType:"application/json", responseSchema}}`.
- It loops over the non-cooled `MODELS` (80–102), with the same handling of 5xx, timeout, 404, 401/403 and bad keys. It throws `{status, message}`.
- Error messages are passed in through `msgs`, because the current ones say "직접 채점해 주세요".
- After the refactor, `gradeEssay` keeps only its prompt, its SCHEMA (31–41), the result clean-up (111–121) and its own cache (55–56; that cache key uses `MODEL`, not the model actually used).

Points for the new prompt type:
- **429 handling.** It currently throws immediately (97). Free-tier quotas are per model, so the report could cool that model and try the next one.
- **One key is shared by all users.** Report generation will compete with essay grading for quota. Add a DB-persisted per-device daily cap and a global in-process queue or semaphore; in-memory LIMITS reset on restart.
- **Latency.** Observed: `ai_grade` has 17 rows, 15 on gemini-2.5-flash (average 10.1 s) and 2 on flash-lite (11.7 s). A report prompt with many problems will be slower. Recommended flow: POST starts generation, the response returns the last cached report, and GET polls. Store generated reports in a DB table so they survive restarts.
- **Unverified, check the docs before relying on these:** limiting thinking through `thinkingConfig` (the right parameter depends on the model, and `gemini-flash-latest` is an alias whose target can change), and combining Google Search grounding with `responseSchema` (this has depended on the model).

## 4. Frontend

### Routing (app.js)
- `parse()` (33–41): `/course/(\d+)(?:/(.+))?` gives `{cid, set, tab}`, where `?tab=note` is the only tab parameter. A path like `/course/4/INSIGHT` already parses.
- `route()` (43–63): when the user stays in the same course, it calls `cur.inst.update(r)` (46) and does not remount.
- `navigate()` (64–67). Links use `<a data-link>`, intercepted at 69–73.

### course.js
- The hub is rendered by **`renderHub()`** (375–399), in this order:
  1. the `.overall` summary line (379)
  2. the `.resume` "이어 풀기" button, from `S.last[cid]` (380–384)
  3. chapter groups: `.hubh` + `.hubgrid` of `hubCard(key, hn, title, list, special, extra)` (368–374, 386–393)
  4. a "시험 대비" grid with the SPECIAL cards (8–15), the SAVED card and the NOTE button (395–397)
- **Natural slot for the new entry:** a `.hc.sp` card with `data-open="INSIGHT"` in the 시험 대비 grid, or a `.resume`-style banner right after `.overall`.
- A click goes through `onClick`: `d.open` → `go(key)` (527, 473).
- **Integration traps in `render()`** (437–456) and related code:
  - `scopeOf()` falls back to `SPECIAL[0]` ("전체 문제 풀기") for unknown keys (98). INSIGHT must be special-cased before line 447: hide `#tabsNav`, `#stats` and `#toolbar`, keep the crumb with "‹ 메뉴", and render into `main`.
  - `update()` (569) and mount (561) call `setLast(cid, set)`, which would turn "이어 풀기" into a broken entry. Skip it for INSIGHT.
  - `initFocus(main)` (474) uses a MutationObserver on `main` (focus.js:208). `watchCards()` (402–407) and `lazyMath()` (417–424) target `article.card`. **Report markup must not use `article.card`**: focus mode would take over the elements and `problem_shown` would be logged.
  - `lazyMath()` only typesets `article.card` elements once a set is open, so the report must call `typeset(el, C.math)` itself and `clearMath(el)` before re-rendering and in `destroy` (math.js:44–52; course.js already imports them as `typesetMath, clearMath`, line 6).
- `C.concepts` (공학수학 chapter concept HTML) and the full problem bodies are **already on the client**: `loadCourse` returns `coursePayload`.
- **Deep link to one problem:** call `setResume(`${cid}|${chKey}|solve`, pid)` and then `go(chKey)`. Focus mode opens on that card through `resumeGet` (476). There is no per-problem route.
- Suggestion: put the code in a new `web/js/insight.js` and import it, rather than growing course.js (579 lines).

### me.js
`study()` (26–38) renders the 학습 현황 rows (`a.srow`: dot, name, bar, done/all, %, 오답, ago) from `courseCounts`, which is local `S.progress` only. A per-course "리포트 ›" link or one short line could go here; keep it uncluttered.

### store.js: local vs synced
- **Local only:**
  - `S.last`, `ui:<cid>`, `mn:aiConsent`, theme and `focusMode`
  - in course.js: `drafts`, `aiRes` and `shownAt` (in memory)
- **Synced, only when `synced()` (`device.consent`, line 23):**
  - progress, enrollment, resume and bookmarks, through the `pending` queue (20) and `flush()` (138–155)
- **Events:** `track()` returns early unless the device consented (212), so non-consented devices keep **no event log, not even locally**. Unsent events wait in `mn:evq` (up to 2000).
- **Before requesting a report**, call `await flush()` and then `sendEvents()`; me.js:121 is the precedent.
- **Non-consented devices:** the server has only the device row and its `ai_grade` rows; no progress, events or enrollment. Their options are a client-side report from `S.progress` (status, attempts, wrong_count and `last_answer` only), or a one-off upload with explicit consent and no storage. That upload is a consent and product decision, not just an implementation detail.

### CSS (web/css/app.css)
- Tokens at 9–48, covering light, dark media query and `[data-theme=dark]`.
- Reusable classes:
  - `.panel` (433), `.stats/.stat/.big` (194–199), `.bar` (200) with `barHTML` (util.js:43), `.krow` (205), `.legend` (203)
  - `.hc/.hubgrid` (230–241), `.resume` (223), `.chip` (212), `.pill` (253)
  - `.aibox/.aitag/.aif` (513+), `.empty` (145), `.loading/.spin` (79–80)
- Color comes only from tokens (`--ok --red --hl --accent --fill --cpy-*`).

## 5. Available evidence (heavy device eEKBcd…, read-only queries)

**Server-side vs client-side**
- **Every attempt with the chosen option** exists only as `answer_submit` events, and only for consented devices. Payload (course.js:122): `kind`, `answer` (MC letter A–D, O/X, or text ≤200 chars), `correct`, `ms`, `attempt`, `self`, `ai`, `scope`, `mode`.
  - `attempt` is the **cumulative** `progress.attempts + 1`, legacy attempts included; it is not an event index.
  - MC options are not shuffled (card renders opts in order, 227–229), so the letter is the index into that version's `opts`.
  - Join on `event.version`. 160 progress rows have `version ≠ current` (공학수학 v1 vs v2). All 273 MC version pairs kept the same `ans` and `opts`, but that is not guaranteed for the future.
- **progress** keeps one row per problem with `last_answer` (≤600 chars).
  - For `resolved` rows that value is the final correct answer, so the original wrong choice is lost unless an event recorded it.
  - `wrong_count` is inflated by repeated clicks: re-clicking the same wrong option while a card is in the wrong state re-grades it.
  - Example: problem 620 (공학수학 2.6:2.2-10e) has 22 consecutive "O" answers at 0.1–5.9 s, then a correct X. ox-59 has 10× "O", mostly 0.1–0.2 s. 응용통계 8.1.3 has `wrong_count` 77 (legacy).
  - **Collapse consecutive identical answers and discard sub-second repeats.**
- **idk** events and `last_answer = "모르겠어요"`. **ai_grade** stores the full essay text (≤4000 chars) plus per-point covered/partial/missing verdicts mapped to `pts[i]`. That is the most concept-precise signal for essays.
- **Legacy gap:** 482 of the 717 rows have `updated_at` (Oct 11–18) earlier than the device's first event (2026-10-18 11:45Z). 8 progress rows point at hidden 경정시 problems; exclude them.

**Counts per course (heavy device)**

| Course | progress (c/r/w) | rows with no answer event | answer_submit (mc/ox) | wrong mc/ox with chosen option (MC letters) | idk | ever-wrong rows / wrong choice known |
|---|---|---|---|---|---|---|
| 1 응용통계 | 146 (105/30/11) | 120 | 31 (14/14, short 3) | 9 (5) | 1 | 41 / 14 (resolved: 3 of 30) |
| 2 생경론 | 3 (2/0/1) | 3 | 0 | 0 | 0 | 1 / 1 |
| 3 진인본 | 154 (123/10/21) | 122 | 46 (46/0, all in G23 기출) | 20 (20) | 5 | 31 / 26; ai_grade 9 (6 problems) |
| 4 공학수학 | 282 (183/81/18) | 162 | 181 (36/145) | 51 (4) | 2 | 99 / 34; ever-wrong MC 73, letter known for only 9 |
| 5 경정시 | 132 (109/7/16) | 75 | 59 (8/46, short 4, essay 1 self-graded) | 13 (3) | 9 | 23 / 19; ai_grade 8 |

Totals: 717 rows, 317 answer_submit, 17 idk. idk by kind: essay 13, short 2, mc 2.

**Solve time `ms` (answer_submit, ms > 0)**
- ox (n=205): p10 0.17 s, median 4.3 s, p90 18.7 s. Correct 4.8 s vs wrong 1.9 s; 46 answers under 2 s.
- mc (n=104): p10 0.30 s, median 16.3 s, p90 294 s. Correct 23.5 s vs wrong 3.6 s.
- short (n=7): p10 6.7 s, median 10.9 s, p90 180 s. essay (n=1): 137 s.
- The maximum is 3390 s, so the values need capping.
- On a retry, `ms` restarts at the previous grade (course.js:124), so retry times mean something different from first-attempt times.
- Per-course medians: 공학수학 ox 4.0 s / mc 134 s, 응용통계 ox 9.2 s / mc 23.5 s, 진인본 mc 10.5 s, 경정시 ox 6.0 s / mc 16.3 s.

**Population and content levels**
- Population data: only 2 problems have answers from 2 or more devices, and none from 3 or more. Population item statistics or IRT need shrinkage to content priors (star, chance level OX ½ / MC ¼) until more testers solve.
- Concept keys per course:
  - **공학수학:** `topic` is the best key, with 12 values on all 453 problems. `tags` are too sparse to group by: 318 distinct on 300 problems, 199 used once. Chapters `exam` and `ox` mix topics. Concept HTML exists for 10 chapter keys and contains TeX.
  - **진인본:** all 27 MC problems sit in G23. Map them back to lectures through `src[0][0]` (L#→C#). OX `fix` is present on 47/47 false items.
  - **응용통계:** chapters split 개념 and 계산 (CI/CIC, HT/HTC, N9/N9C). `fix` on 13/46 false OX.
  - **생경론:** no MC, so there are no options to analyse. `fix` on 17/19 false OX, and no trap wording in `s`.
  - **경정시:** includes an ABBR (약자) chapter; `fix` on 48/48 false OX.
- Explanations (`s`) that name traps or distractors: 응용 30, 진인본 30, 공수 60, 경정시 15.

## 6. Risks

- **The live server is running:** PID 80130 since Oct 23 15:08, port 4000, real DB.
  - `serveStatic` re-reads files when their mtime changes (130–133), so **edits to `web/` go live to testers immediately**. Half-finished edits would break the live app.
  - Changes to `server/*.js` and `schema.sql` need a restart.
  - Test on a DB copy with `PORT=4001` (per prompts).
  - The WAL file (3.8 MB, Oct 24 23:37) is newer than `app.db` (Oct 23). A plain `cp app.db` would miss recent data; use `VACUUM INTO` or the newest backup (`data/backups/app-20261024-1132.db`).
- **Other sessions:** no code file has changed since `ai.js` (Oct 22 02:22). The last edits are `인수인계.md` (Oct 23 14:52) and `data/import/KEHN.json` (Oct 23 15:10). The prompts define separate server, DB and frontend roles that may run in parallel sessions. Per those prompts, append one line to the end of `인수인계.md` after the work.
- **CSP** (server.js:50):
  - `connect-src 'self'`: all Gemini and external calls must go through the server.
  - `img-src 'self' data: blob:`: no external images.
  - `script-src` allows only self and jsdelivr (MathJax), so charts should be CSS bars or inline SVG. External links are fine.
- **Rate limits** are in-memory and reset on restart. Add `"POST /api/me/insight": [n, 36e5, "device"]` plus a DB-persisted daily Gemini budget shared with essay grading.
- **Math:** report text from 공학수학 contains `\(...\)`. Typeset only what is visible (453 problems carry about 4.3k formulas), and call `clearMath` before replacing the DOM (rule in `prompts/프론트엔드_프롬프트.md`).

Scratch query scripts (read-only, `{readOnly:true}`): `/private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/q1.mjs` … `q7.mjs`. No project file was modified.