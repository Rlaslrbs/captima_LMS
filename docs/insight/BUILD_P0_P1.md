# 학습 리포트 — build brief for P0 + P1 (read together with SPEC.md in this folder)

SPEC.md is the full design (all phases). This file narrows it to what is built NOW (P0 + P1), fixes
the cross-module contracts so several people can build in parallel, and records the user's decisions.

## Where to work
- Work ONLY inside the staging copy: `STAGE = /private/tmp/claude-501/-Users-rla-skrbs-Desktop-2026--/1a7961c1-ca70-46d1-9e66-72cab2914c81/scratchpad/stage/app`
  (a full copy of the project with its own `data/app.db` snapshot). Never touch `~/Desktop/2026강의/문제노트_플랫폼` (live, port 4000, testers online).
- Test server: `cd $STAGE && PORT=<your port> GEMINI_API_KEY=fake GEMINI_BASE=http://127.0.0.1:<fake port> node server/server.js`.
  Ports: ai owner 4002/4012, engine owner 4003, server owner 4004/4014, web owner 4005. Kill what you start. Never call real Gemini.
- Node 24 built-ins only (node:sqlite, node:test, node:crypto, node:zlib…). No npm. Frontend: vanilla ES modules, no build.
- Code style: match the surrounding code (short functions, Korean comments at the same density, same naming). Korean UI copy, 해요체.
- Heavy test device in the DB copy: `DEVICE_ID_EXAMPLE` (the developer). Its data is real; read it, don't modify it except in throwaway copies.

## User decisions (2026-10-25)
1. AI 정리 (narrative, P4): ON, generated **when the learner presses 리포트 뽑기** (decision 7 supersedes "on open"), within daily caps, after a one-time consent sheet. Not built now; leave `narr_state:"off"` in P1 responses.
7. (2026-10-25) **Reports are made only on a button press** and only the latest snapshot is kept — see `DECISION_7_snapshot.md`. No history, no comparison with earlier reports.
8. (2026-10-25) Reports are **per course** (each course menu shows that course's report). A course where most history was imported from the old app (응용통계: 146 solved, mostly legacy) must not stay locked just because few answers carry a chosen option.
9. Test command on Node 24: `node --test "server/insight/test/*.test.mjs"` (a bare directory does not work).
2. Tagging (P2): runs **automatically in the server background** (env/admin toggle default ON, ≤60% of daily quota, grading first). Not built now.
3. Devices without 풀이 기록 동의: show only the "기록 저장을 켜면 리포트를 볼 수 있어요" prompt. No local report.
4. Build P0+P1 first, show the user in Chrome, then P2–P5.
5. NEW REQUIREMENT — **future courses**: courses will keep being added (another session imports new problem packs).
   Nothing may be special-cased by course id/code/name. Everything is derived from data:
   - units: chapters always; plus topic units for ANY course whose items carry `topic` (names from `course.info.topics[code]`
     if present, else from the first heading of `course.info.concepts[chapterKey]` that the topic's items live in, else the code);
   - caveats computed from data (e.g. `no_mc` when the course has no published MC, `imported_history`, `relative_only`, `untagged`);
   - chapter groups (`chapter.grp`) like "기출", "모의고사 · 계산" are just chapters; past-exam flag comes from `body.exams`;
   - new optional problem fields accepted by the importer now so new packs can carry diagnosis data from authoring time:
     `why` (MC only: array aligned with `opts`, the belief of a student who picks that option, `""` for the correct one),
     `topic` (already accepted), `fix` (already accepted). Course-level `info.topics` (`{code: "한국어 이름"}`) is passed through by import.

6. NEW REQUIREMENT (2026-10-25) — **behaviour/time factors**: "사용자가 문제를 대할 때 걸리는 시간 같이 팩터로 쓸 수 있는 것들을
   찾아서 모델링". Solve time and other behaviour signals must be modelled, not just used as a rapid-guess filter.
   The model is specified in `docs/insight/TIME_FACTORS.md` (written by the time-factor researcher before the engine is built;
   the engine owner must implement it). New client instrumentation is fixed below (Contract 5) so the web owner can build it now.

## Contract 5 — behaviour instrumentation (web → events; all optional fields, old events lack them)
Added to the `answer_submit` / `idk` payload in `course.js grade()` (keep the whole payload < 300 bytes; numbers as integers):
| field | meaning |
|---|---|
| `seen` | bool, SPEC §11.3 (answered again after the solution was shown) |
| `vis` | list mode only: ms the card was actually ≥ 60% visible while unanswered (IntersectionObserver accumulates; pauses when it scrolls out or the tab hides). Focus mode: omit (ms is already reliable) |
| `away` | count of tab-hidden intervals during this attempt (interruptions → time less reliable) |
| `pos` | 1-based index of this answer within the browser session (sessionStorage counter shared by all courses) |
| `sess` | seconds since `session_start` of this browser session |
| `hr` | local hour 0–23 (`new Date().getHours()`) |
| `rd` | short/essay only: ms from shown to first keystroke in the answer box (reading/planning time); omit if never typed before submit |
| `len` | short/essay only: answer length in characters |
New events (consent-gated through `track`, tiny payloads):
- `ai_copy` `{problem_id, version, st}` when the "AI 질문용 복사" button is pressed (`st` = current progress status or "new") — a confusion/help-seeking signal.
- `sol_dwell` `{problem_id, version, ms, ok}` when the learner leaves a just-graded card (next/prev/scroll-away/route change): ms the solution stayed open after grading, capped at 10 min (feedback engagement). Fire once per grading.
Bookmarks (`bookmark` events + `bookmark` table) are already recorded: ☆ on an item answered correctly = self-reported uncertainty.

## P0 + P1 scope (and NOT in scope)
IN: SPEC §1 layout (only files listed below), §2 DDL (create ALL tables now), §3 evidence layer, §4 mastery model,
§5.3 cause classification (gap/unclear), §5.4 habits, §5.5 relearning, §5.6 findings+plan, §5.7 deterministic text,
§6 det doc, §7.1 ai.js refactor + §7.2 budget persistence (no narrative caller yet), §11.1 user routes
(`GET /api/me/insight`, `GET /api/me/insight/:cid`; features flag), §11.2 caching, §11.3 seen flag, §11.4 screens (P1 parts),
§12 consent gate, §14 optimization targets, §15 tests that apply.
OUT (later phases): tagger/prompts (P2), misconception classifier + confusion pairs + C:/X: scopes + /kc endpoint (P3),
narrative (P4), calibration/item_first/LOO (P5), admin 진단 tab. BUT keep the hooks: engine functions `misconceptions()`
and `confusions()` exist and return `[]` when ctx has no tags; finding types `misc`/`confusion` are already rendered by the
web screen (test with a fixture) so P3 needs no UI rewrite.

## File ownership (edit only your files)
| owner | files |
|---|---|
| **ai** | `server/ai.js`, `server/db.js` (only: new helper functions `meta/bumpMeta/budgetAdd/budgetToday/blockModel/blocked` + BODY_KEYS gets `"why"`, checkPack validates `why` length = opts length for mc, importPack keeps `course.topics` in `course.info` (today it keeps only color/lang/math/files/concepts)), `server/schema.sql` (append SPEC §2 DDL), `server/insight/test/ai.test.mjs`, `server/insight/test/fake-gemini.mjs` |
| **engine** | `web/js/insight-engine.js`, `server/insight/params.js`, `server/insight/test/engine.test.mjs`, `server/insight/test/sim.test.mjs` |
| **server** | `server/insight/ctx.js`, `server/insight/evidence.js`, `server/insight/report.js`, `server/server.js` (routes, LIMITS, features flag, throttled last_seen, `Vary: X-Device`), `server/insight/test/report.test.mjs` |
| **web** | `web/js/insight.js`, `web/js/course.js` (hub card, INSIGHT render branch, `Q:` scope, Contract 5 instrumentation incl. `seen`), `web/js/store.js` (only: session answer counter + session start time helpers for `pos`/`sess`), `web/js/me.js` (one "리포트 ›" link), `web/css/app.css` (append `.ins*` styles), `web/js/fixtures/insight-sample.json` (dev fixture, may be deleted later) |

## Contract 1 — raw evidence (server `evidence.js` → engine)
```js
loadRaw(deviceId, cid) → {
  events:   [{ rid, pid, v, type /* 'answer_submit'|'idk' */, sid, ts /* client_ts ISO */, p /* parsed payload object */ }], // sorted by (ts, rid)
  progress: [{ pid, v, status /* correct|wrong|resolved */, attempts, wrong_count, last_answer, updated_at }],
  grades:   [{ id, pid, v, result /* parsed {verdict, points:[{i, verdict}]} */, user_verdict, created_at }],
}
fingerprint(deviceId, cid, ctxKey, nowDay) → string   // SPEC §11.2 (max rid + count of events, max updated_at + count of progress, max ai_grade id, ctxKey, ENGINE_VER, KST day)
```

## Contract 2 — course context (server `ctx.js` → engine)
```js
courseCtx(cid) → {
  key,                                   // cache key string (data_version|contentVer|tag_rev|vocab_ver|calib_rev|PARAM_VER)
  cid, name, short, lang, math,          // course row + info
  chapters: [{ key, title, short, grp, sort }],
  items: Map<pid, { pid, ext, ch /* chapter key */, kind, v /* current version */, star /* 0|1 */, status /* published|hidden */,
                    topic /* string|null */, exam /* bool: body.exams non-empty */, len /* stripped chars of q+stem+opts */,
                    nopt /* opts.length for mc else 0 */, body /* current version body object */ }>,
  sameAsCurrent(pid, v) → bool,         // old version identical in opts+ans (mc) / q+ox (ox) / a+num+accept (short)
  topics: { [code]: name } | null,       // KC seeds (see decision 5); null when the course has no topic field
  hasConcept: Set<chapterKey>,           // chapters with course.info.concepts entries ("먼저 읽기")
  tags: Map, misc: {}, diag: Map,        // P2/P3: empty in P1
  medLen: { ox, mc, short, essay },      // median len per kind (for rapid threshold scaling)
  lnP(g, d) → { lp: Float64Array(41), lq: Float64Array(41) },   // memoised, SPEC §4.2
}
```

## Contract 3 — engine API (`web/js/insight-engine.js`, pure: no DOM, no node:*)
Exports SPEC §1 "Engine contract" functions plus:
```js
export const ENGINE_VER = 1;
export function buildReport(raw, ctx, P, nowDay /* KST day number */) → det   // whole SPEC §6 document (state ready|locked)
```
The server only calls `buildReport`. `P` = params object from `server/insight/params.js` (`export const PARAMS = {...}; export const PARAM_VER = 1;`).
`nowDay` = `Math.floor((Date.now() + 9*3600e3) / 864e5)`.

## Contract 4 — det document (server → web), SPEC §6 with these exact fields
```js
// ready
{ v: 1, cid, state: "ready", frame: "relative"|"absolute", asOf: "2026-10-25", fp,
  basis: { first, choice, legacy, n_eff },              // counts shown as "근거 · 첫 풀이 142 · 고른 답 기록 61 · 예전 기록 120(약하게 반영)"
  headline: "…",                                         // deterministic Korean sentence (§5.7)
  findings: [{ id: "F1", type: "misc"|"confusion"|"gap"|"unclear"|"habit"|"relearn", conf: "sure"|"likely"|"hyp"|null,
    unit: { kind: "kc"|"topic"|"chapter", code, name } | null, with: { code, name } | null,
    text: { diag, truth, contrast, cue, signals } ,       // strings (may be "")
    hidden_truth: bool,                                  // true → web must not show truth/contrast (items still wrong)
    evidence: [{ id: "E1", pid, ext, ch, kind, chosen, label /* "③ 고름"|"O라고 답함"|"'σ/n'이라고 씀"|"모르겠어요" */,
                 hidden /* item still wrong */, day: "10/19", fast: bool, role: "hit"|"wrong"|"idk"|"avoided"|"miss",
                 stem /* ≤120 chars, html stripped */, chosen_text /* option text or typed answer, ≤80 */,
                 trap /* trap sentence from s or fix; "" when hidden */ }],
    avoided: n, n_items: n, plan: "P1"|null }],
  plan: { today: { pids: [...], minutes: n }, steps: [{ id: "P1", type: "misc"|"contrast"|"gap"|"relearn"|"diag",
          title, scope /* "Q:12.34.56" */, n, read: { chapter: key, pid: n|null } | null }] },
  units: [{ kind: "chapter"|"topic"|"kc", code, name, ch /* chapter key for chapter units */, label: "weak"|"ok"|"solid"|"pending",
            band: [lo, hi] /* 80% interval of m_u in 0..1 */, mark: "fixed"|"slipping"|null, n /* distinct items */,
            counts: { c, w, idk } }],
  relearn: { resolved, confirmed, due: [pid...] },
  strong: [{ code, name }], pending: [{ code, name, n }],
  caveats: ["relative_only", "imported_history", "no_mc", "untagged", "few_timed"],
  time: { speed: "fast"|"normal"|"slow"|null, n_timed, notes: [ "…" ] },   // learner-level time profile (TIME_FACTORS.md); null fields when too few timed answers
  narr_state: "off" }
// finding types may also include the behaviour types defined in TIME_FACTORS.md (e.g. "fluency" = 맞히지만 오래 걸리는 개념,
// "hasty" = 서두르다 틀림, "fatigue" = 오래 풀면 정확도 저하); units may carry `speed`. The web renders any finding type generically
// (badge text from a type→label map with a neutral fallback), so new types need no UI rewrite.
// locked
{ v: 1, cid, state: "locked", fp, have: { n_eff, events, chapters }, need: { n_eff: 30, events: 15, chapters: 3 },
  next: { pids: [...] /* ≤5 high-information unseen published items across ≥3 chapters */ }, narr_state: "off" }
// no consent (from the route, not the engine)
{ v: 1, cid, state: "no_consent" }
```
Overview `GET /api/me/insight` → `{ courses: { [cid]: { state, have?, need?, n_findings?, top_type?, top_name? } } }` for the device's
enrolled courses (cheap: read `insight` rows; compute missing ones lazily but cap work to ~50 ms total).

## Web integration notes (owner: web)
- Hub card goes in the "시험 대비" grid (`renderHub`), `data-open="INSIGHT"`, title "학습 리포트", meta per SPEC §11.4
  (locked meta from LOCAL counts only, e.g. "{n}/30 풀면 열려요"; the overview fetch is idle/once per mount, never blocks render).
  Show the card only when `features().insight` is true.
- `/course/:cid/INSIGHT` renders the report screen via `import("./insight.js")`, no `article.card`, no `setLast`, no `watchCards`.
- Scope `Q:<pid.pid…>` in `scopeOf` opens exactly those problems in that order (title from cached report step, else "추천 문제").
  It must work with focus mode, grading, resume. Hidden (still-wrong) items keep their answers hidden as today.
- Evidence chip tap: for non-hidden items `setResume(cid|chKey|solve, pid); go(chKey)`; for hidden items open `Q:<pid>`.
- Before fetching: `await flush(); await sendEvents()` (store.js), then `api("GET", "/api/me/insight/"+cid)`; paint the cached
  copy from `LS["ins:"+cid]` first (try/catch).
- Math courses: `typeset(container, C.math)` after render; `clearMath(container)` before re-render and on destroy.
- Apple style, uncluttered, tokens only (`--red --hl --fill --accent --ok`), light+dark, 375px no horizontal scroll,
  `prefers-reduced-motion`. Read `prompts/프론트엔드_프롬프트.md` §3–§4 for the rules the user set.
- `seen` flag: SPEC §11.3, in `grade()`.

## Done means
- Your unit tests pass with `node --test "server/insight/test/*.test.mjs"` (or `npm test`).
- No change outside your files. A short note of what you built, any contract deviations (avoid them), and anything the
  integrator must know, as your final answer.
