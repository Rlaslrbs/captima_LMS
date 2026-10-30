# 학습 리포트 v2 decisions (user, 2026-10-26)

1. **Missing variant items (250–500):** written by Claude authoring sessions. A blind Sonnet solver checks each one. They are imported hidden and published only after admin approval. Gemini does not write them.
2. **Confidence tap (확신/반반/찍음):** not collected. Thresholds must work without it.
3. **Judgment strictness:** looser than the current strict proposal. The user wants more diagnoses sooner and accepts occasional wrong calls.
   - 서버 proposes the new thresholds for 착각 / 확실히 앎 / 판단 보류, together with simulated false-call rates.
   - Every claim must still show its evidence chain.
   - Weaker claims use hedged wording (for example "~일 수 있어요" plus a 확인 문제), never a firm verdict.
4. **Card wording:** OK. The card title is "알고 있다고 착각하고 있어요" and the body is "~와 섞고 있어요". The depth levels are **1 정의 · 2 적용 · 3 구별 · 4 조건**, the order the user confirmed on 2026-10-26. The DATA/ALGORITHM order stands; only level 4's label is 조건, not 경계.
5. **Rollout:** per course, as soon as a course is tagged. The order, confirmed by the user, is 생경론 → 공학수학 → 경정시 → 진인본 → 응용통계. Untagged courses keep the v1 report. New items stay hidden until admin approval.
6. **Not chosen for now:**
   - The learner-facing "이 진단이 맞나요?" button. Leave it out of the learner UI. An admin-only view is fine later.
   - The LA2 x23-7 explanation fix. Leave the content unchanged for now.
8. **Future: per-learner persona harness (user, 2026-10-26).** "개인 페르소나 기반 하네스 구조를 염두해둬 나중에 업데이트 할 수 있도록" means learner-specific AI. Each learner builds up a persona: weak facets, active misconceptions, solving habits, preferred formats and pace. Later, AI 정리, a tutor and recommendations take that persona as input and adapt to it.
   - **Now:** do NOT build the harness, but leave clean extension points.
     - **Stable ids.** facet, kc and misc ids never change meaning. A rename keeps the id; a retirement marks the id retired and never reuses it.
     - **det v2 `profile` block.** det v2 carries a compact, versioned `profile` block (`profile_v`). It holds the current facet states, active misconceptions with their strength, habits, format strengths and pace. Everything in it is deterministic, so it is the persona's seed.
     - **One entry point for AI calls.** Every AI call goes through `ai.js generate({purpose, ...})`, so a persona-context step can be inserted later in one place.
   - **Docs:** 서버 writes a short `docs/insight/v2/PERSONA_HARNESS.md` sketch covering:
     - the data the persona is built from;
     - where it would be stored;
     - how prompts and tools would consume it;
     - privacy and consent: it stays inside the consented device data and is never sent to an LLM without the insight_ai consent.
9. **Still design only.** The user approves building separately. No tests unless the user asks.
10. **Report-time Gemini diagnosis (user, 2026-10-28).**
    - **Decision:** the user chose report-time Gemini for all learners, without a separate consent step ("모든 학습자 (동의 절차 없이)").
      - This replaces the earlier design: no Gemini at report time, and the persona is never sent to an LLM without insight_ai consent (#8, PERSONA_HARNESS.md §4).
    - **Admin switch:** default OFF, global (`insight_meta insight_ai`) or per course (`insight_ai:<cid>`). Only the admin turns it on.
    - **Minimized payload:** only the learner's last 3–5 wrong ox/mc/short items (question, correct answer, chosen answer, solution, fix) plus the course's concept list.
      - Items are sent as w1…w5. No device id, nickname, timestamps or other learners' data.
    - **Calls:** `ai.generate({purpose:"insight_diag"})`, counted in the same per-model 60% daily cap, with grading first.
    - **Async:** the deterministic report is saved and returned first. On any failure or timeout nothing changes for the learner.
    - **Validated output only:** the concept must come from the real facet, topic or chapter list. The evidence must match the learner's chosen answer. Low-confidence items are dropped. At most 3 cards.
    - **Deterministic only (phase 1, same day):** behaviour findings (habit, fluency, format) never take the top 3 cards; they go to `det.habits`.
