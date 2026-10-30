# Decision 7 (2026-10-25): report is generated only on a button press ("리포트 뽑기")

User: "컴퓨터 자원을 너무 사용하니 버튼을 누르면 리포트를 뽑아주게" → chose "버튼으로 뽑기".
Apply AFTER the current build workflow finishes (do not inject mid-run).

- GET /api/me/insight/:cid → returns the LAST SAVED snapshot only (no engine run) + `since: { answers }` (count of new
  answer_submit/idk events after the snapshot's max rid; one indexed COUNT) + `can_make` (gate). No snapshot yet →
  `{state: "none", can_make, have, need}`.
- POST /api/me/insight/:cid → run engine (fingerprint short-circuit: unchanged data → return the same snapshot), overwrite
  the single `insight` row (device+course) with it, return it. LIMITS e.g. [30, 864e5, "device"].
  P4: the AI narrative is generated here (not on open).
- NO history, NO comparison with earlier reports (user, 2026-10-25: "이건 없어도 될거같아"). Only the latest snapshot is kept.
- Web: report screen shows the saved snapshot with its date; primary action [리포트 뽑기] / [새로 뽑기 · 새 기록 n개];
  no auto-fetch-compute on open (GET is cheap). Hub card meta: "리포트 뽑기" | "10/25 리포트 · 새 기록 n" | "{n}/30 풀면 열려요".
- Overview GET /api/me/insight reads snapshot rows + since counts only.
