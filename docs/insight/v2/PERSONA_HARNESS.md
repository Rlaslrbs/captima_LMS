# 개인 페르소나 하네스 (설계, 2026-10-26)

DECISIONS #8: "개인 페르소나 기반 하네스 구조를 염두해둬 나중에 업데이트 할 수 있도록".
v2에서는 **씨앗만** 만든다. 페르소나를 쓰는 AI 기능은 아직 없다. 이 문서는 나중에 그것을 붙일 자리를 정한다.

## 1. 무엇으로 만드나

페르소나는 **결정적(deterministic)** 이다. 같은 기록이면 같은 페르소나가 나온다. LLM이 만들지 않는다.

| 재료 | 출처 | 비고 |
|---|---|---|
| 세부 포인트별 상태 (확실히 앎 · 착각 · 덜 다져짐 · 판단 보류), tier, sub, 깊이 | `insight-depth.js` `depthModel` → `profileOf` | ALGORITHM §5 규칙 |
| 오개념 확률 (p ≥ .3, 상위 20) | 같은 곳 | misc 코드 |
| 풀이 습관 (hab id) | v1 엔진의 습관 찾기 | 성급함·찍기 등 |
| 형식 강약 (OX · 객관식 · 단답 · 서술형) | v1 엔진 | strong[] · weak[] |
| 속도 (형식별 기준 시간 대비) | v1 엔진 pace | |

det v2의 `profile` 블록이 그것이다.

```
profile: { profile_v: 1,
  facets: { "<facet code>": { state, tier, sub?, depth, n } },
  misc:   [{ code, facet, p, tier }],
  habits: [hab id], formats: { strong: [], weak: [] }, pace: { ox, mc, short } }
```

- 모든 키는 **안정된 코드**다 (kc · facet · misc). 이름을 바꿔도 코드는 그대로이고, 없앨 때는 `retired` (+ `merged_into`)로만 둔다 (db.js `retireVocab`). 그래서 시간이 지나도 같은 학습자의 페르소나를 이어 붙일 수 있다.
- 은퇴한 코드가 `merged_into`를 가지면, 읽는 쪽이 새 코드로 옮겨 읽는다.
- `profile_v`가 오르면 읽는 쪽이 옛 판을 버리거나 옮긴다.

## 2. 어디에 저장되나

- 지금: `insight.det` (기기 × 과목, 마지막으로 뽑은 리포트 한 장) 안의 `profile`. 따로 표를 만들지 않는다.
- 나중 (필요할 때): `persona(device_id, course_id, profile_v, profile JSON, updated_at)` 표를 더해, 리포트를 뽑을 때마다 `profile`을 복사한다. 과목을 넘는 요약(습관·형식)은 `course_id = 0` 행으로 둔다.
- 사용자 기록(event · progress · ai_grade …)에서 언제든 다시 계산할 수 있으므로, 페르소나는 **캐시**다. 지워도 잃는 것이 없다.

## 3. 프롬프트·도구가 어떻게 쓰나 (나중)

모든 AI 호출은 `server/ai.js generate({ purpose, … })` 하나를 지난다. 페르소나를 쓰는 기능은 새 purpose를 하나 받는다.

| purpose (예) | 하는 일 | 페르소나에서 넣는 것 |
|---|---|---|
| `narr` (v1 AI 정리) | 리포트 문장 다듬기 | 상위 착각 2개 + 덜 다져진 것 2개의 **코드와 바른 진술**만 |
| `tutor` (미래) | 문제 하나 설명 | 그 문제의 facet 상태 + 관련 misc 1–2개 |
| `plan` (미래) | 다음에 풀 문제 고르기 | 결정적으로 고른 probes를 설명만 |

규칙:
1. 프롬프트에는 **코드 + 짧은 진술**만 넣는다. 기기 id, 별명, 원 기록, 답안 원문은 넣지 않는다.
2. 페르소나를 프롬프트 문장으로 바꾸는 함수는 한 곳에 둔다: `server/insight/persona.js` (미래) `personaPrompt(profile, { purpose, budget })` → 문자열. 토큰 상한을 받는다.
3. 도구(tool/function calling)를 쓸 때는 LLM이 페르소나를 **읽기만** 한다. 쓰기(상태 바꾸기)는 결정적 엔진만 한다.
4. 결정은 엔진이, 말은 LLM이: 착각·확실히 앎 판정, 확인 문제 고르기는 LLM이 바꾸지 못한다.

## 4. 동의

> 2026-10-28 바뀜 (DECISIONS #10): 리포트를 뽑을 때의 Gemini 오답 진단(`insight_diag`)은 사용자 결정으로 따로 동의 없이 모든 학습자에게 쓴다 (관리자 스위치 기본 꺼짐, 최근 오답 3–5개만 보냄). 아래 규칙은 그 밖의 페르소나 사용(tutor·plan 등)에 그대로 적용한다.

- 페르소나는 **`insight_ai` 동의가 없으면 어떤 LLM에도 보내지 않는다.** 지금 `/api/features`는 `insight_ai: false`이므로 보내는 경로 자체가 없다.
- 동의는 기기마다, 끄면 바로 멈춘다. 끈 뒤에 이미 만든 AI 문장(`insight.narr`)은 지운다 (사용자 기록이 아니라 파생물).
- 서술형 AI 채점 동의(`ai_grade` consent)와는 **별개**다. 채점 동의가 페르소나 전송 동의를 뜻하지 않는다.
- 관리자 미리보기(`GET /api/insight/preview/:cid?device=`)는 이 맥 안에서만 계산하고 저장하지 않으며, LLM에 보내지 않는다.

## 5. 지금 v2에서 한 것 / 안 한 것

- 한 것: det v2 `profile` 블록, 안정 코드 규칙(db.js), 모든 AI 호출을 `generate({purpose})` 하나로.
- 안 한 것: `persona` 표, `persona.js`, 페르소나를 쓰는 purpose. 화면에도 보이지 않는다.
