# MySQL 서버 전환 가이드

2026-11-01 · DB 담당 · 서버 담당 · 팀 확인용
서버를 SQLite에서 MySQL로 바꾼 방법과 **로컬에서 확인한 결과**예요. 서버 담당이 맥에서 연결하는 절차는 [`MySQL_서버연결_프롬프트.md`](MySQL_서버연결_프롬프트.md).

## 1. 한 줄 요약
서버가 SQLite 대신 MySQL로 **실제로 돌아가는 것을 확인했어요.** 사용자 · 관리자 API 39개 점검을 모두 통과했어요.
바뀐 건 **DB 연결부 하나를 새로 만들고, SQL 문장만 MySQL 문법으로 고친 것**이에요. 화면(`web/` · `admin/`)과 함수 흐름은 그대로예요.

## 2. 어떻게 바꿨나
### 연결 방식
- `server/mysql/sync.js`가 `node:sqlite`와 **같은 모양**(`db.prepare(sql).get/all/run`, `db.exec`)을 MySQL로 만들어 줘요.
- 실제 접속은 작업 스레드(`server/mysql/worker.js`, `mysql2` 사용)가 하고, 서버는 대답이 올 때까지 기다려요. SQLite도 한 번에 한 쿼리씩 기다렸으니 **동작 방식이 같아요.**
- 그래서 함수 214곳을 `async/await`로 바꾸지 않고 **SQL 글자만** 고쳤어요.

| 장점 | 한계 |
|---|---|
| 바뀐 줄이 적어 검토하기 쉬움 · 흐름이 그대로라 새 버그가 적음 | 쿼리마다 서버가 잠깐 멈춰 기다려요 (SQLite와 같음). DB가 멀리 있으면(RDS) 그 왕복 시간만큼 느려져요 → 사용자가 많아지면 그때 `async`로 바꾸는 걸 검토 |

### 연결부가 알아서 맞춰 주는 것 (코드 수정 없이)
| SQLite 때 | MySQL에서 | 연결부가 하는 일 |
|---|---|---|
| 시각은 ISO 글자 `…Z` | `DATETIME(3)`은 넣을 때 `Z`를 거절 | 보낼 때 `Z` → `+00:00`, 읽을 때 다시 `…Z` (UTC) |
| `?1 ?2` 번호 자리표시 | `?`만 됨 | 순서대로 바꿔 넣음 |
| JSON은 글자 | JSON 타입 (빈칸 · 키 순서를 바꿔 저장) | 빈칸 없는 JSON 글자로 돌려줌 |
| `changes` = 조건에 맞은 줄 | 기본은 "실제로 바뀐 줄" | `FOUND_ROWS` 켬. upsert는 1로 셈 |
| `NaN` → NULL | SQL 오류 | NULL로 |
| `SUM()`은 숫자 | 소수(DECIMAL)를 글자로 줌 | 숫자로 |

## 3. 바뀐 파일
| 파일 | 내용 |
|---|---|
| `server/mysql/sync.js`, `worker.js` | **새 파일.** 위 연결부 |
| `server/db.js` | 접속(.env), 표 만들기 대신 "표가 있는지" 확인, `tx()`, 백업(mysqldump), SQL |
| `server/server.js` | SQL, 풀이 이벤트를 `submission`에도 같이 쓰기, 브라우저가 보낸 시각 정리 |
| `server/insight/*.js` (7개) | SQL (`rowid` → `seq`, JSON 함수, upsert), 백업 |
| `server/mysql/schema.sql` | 고침 3가지 (4장) |
| `tools/mysql-setup.mjs` | **새 파일.** MySQL 준비 한 번에: 연결 · 왕복 시간 → 표 만들기 → SQLite를 **같은 번호(id)로** 복사 → 표마다 한 칸씩 대조 |
| `tools/setup.mjs` | 처음 준비: `npm install`(mysql2), `.env`, 커밋 검사, MySQL 연결 확인 |
| `package.json` · `package-lock.json` | `mysql2` 하나, 시작 · 가져오기 명령에 `--env-file-if-exists=.env`, `npm test`는 엔진 시험만 |
| `.env.example` | `MYSQL_HOST · MYSQL_PORT · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE` (팀장 문서와 같은 이름. 예전 `DB_*`도 읽음), `MYSQLDUMP_BIN` |
| `tools/start_beta.sh` | `.env`를 읽고 켜기 |
| `CLAUDE.md`, `prompts/서버 · DB_프롬프트.md` | 규칙: 외부 패키지는 mysql2 하나, DB는 MySQL, 스키마는 `schema.sql`에 먼저, 삭제는 확인 뒤 |
| `docs/db/MySQL_서버연결_프롬프트.md` | 서버 담당이 맥의 Claude Code에 한 번 붙여 넣으면 끝까지 가는 절차 |

`web/`, `admin/`, `server/schema.sql`(SQLite)은 그대로예요.

## 4. SQL 바꾸는 규칙 (새 코드를 쓸 때도 이대로)
| SQLite | MySQL |
|---|---|
| `id` (semester · course · chapter · problem · report · ai_grade · tag_job) | `<표>_id` (`problem_version`은 `version_id`, `tag_job`은 `job_id`). 화면에 주는 이름은 `SELECT problem_id id`처럼 그대로 |
| `chapter.key` · `insight_meta.key` · `ai_block.until` | `chapter_key` · `meta_key` · `blocked_until` (예약어) |
| `ON CONFLICT(…) DO UPDATE SET x = excluded.x` | `VALUES (…) AS n ON DUPLICATE KEY UPDATE x = n.x` |
| upsert의 `… WHERE 조건` | 없음 → 칸마다 `x = IF(조건, n.x, 표.x)` (조건에 쓰는 칸은 맨 끝에) |
| `INSERT OR IGNORE` · `ON CONFLICT DO NOTHING` / `INSERT OR REPLACE` | `INSERT IGNORE` / `REPLACE` |
| `RETURNING` | 없음 → 쓰고 나서 다시 읽기 |
| `json_extract(x, '$.a')` | 글자로 비교하면 `x->>'$.a'`, 있는지만 보면 `JSON_EXTRACT(…) IS NULL` |
| `json_extract(payload, '$.correct') = 0` | `payload->>'$.correct' IN ('false', '0')` (MySQL은 JSON false ≠ 0) |
| `json_set(…, json(?))` · `json_patch` · `json_array_length` | `JSON_SET(…, CAST(? AS JSON))` · `JSON_MERGE_PATCH` · `JSON_LENGTH` |
| `TOTAL(x)` · `CAST(x AS INTEGER/TEXT)` | `COALESCE(SUM(x), 0)` · `CAST(x AS SIGNED/CHAR)` |
| `rowid` | `event.seq` (새 칸) |
| `substr(datetime(t, '+9 hours'), 1, 10)` | `DATE_FORMAT(t + INTERVAL 9 HOUR, '%Y-%m-%d')` |
| `PRAGMA data_version` | `dataVersion()` (내용 표의 마지막 고친 시각) |
| `VACUUM INTO` | `dumpTo(파일)` (mysqldump) |
| `GROUP BY a`에 묶지 않은 칸 | `ANY_VALUE(칸)` (MySQL `ONLY_FULL_GROUP_BY`) |
| 외래 키 검사 없음 | 있음 → 없는 문제 번호는 `INSERT … SELECT … FROM problem WHERE …`나 `INSERT IGNORE`로 건너뜀 |

## 5. 스키마 고침 (`server/mysql/schema.sql` 끝의 "고침" 구역, 다시 실행해도 안전)
1. `event.seq`: 들어온 순서 번호 (SQLite `rowid` 대신). 학습 리포트가 "마지막으로 본 뒤 새 풀이 수"를 셀 때 써요.
2. 이벤트 · 세션 번호 칸 40자 → 64자: 서버는 64자까지 받아요.
3. SQLite에서 기본값이 있던 칸에 같은 기본값: `report.admin_note`처럼 서버가 빼고 넣는 칸이 있어서 넣기가 실패했어요.

## 6. 로컬에서 켜 보기
1. MySQL 8.0.19 이상을 깔고 DB `problem_solving_site`와 계정을 만들어요.
2. `npm run setup` (mysql2 설치 · `.env` 만들기) → `.env`의 `MYSQL_…`를 채워요.
3. `node --env-file=.env tools/mysql-setup.mjs all --content-only` (SQLite `data/app.db`가 없으면 표만 만들고 `npm run import`로 문제를 넣어요)
4. `npm run dev` → `http://127.0.0.1:4000`
   - 표가 없거나 옛 판이면 켜지지 않고 "schema.sql을 먼저 실행해 주세요"라고 알려 줘요.
   - 문제 넣기도 그대로: `npm run import -- data/import/IE207.json` (`--dry`로 미리보기)

## 7. 실제 적용 순서 (팀 결정 뒤)
서버 담당이 맥에서 할 일은 [`MySQL_서버연결_프롬프트.md`](MySQL_서버연결_프롬프트.md) 하나에 정리했어요 (Claude Code에 한 번 붙여 넣기). 아래는 큰 흐름이에요.

| 단계 | 할 일 | 끝 기준 |
|---|---|---|
| 0. 결정 | DB 자리(RDS 또는 맥에 MySQL) · `mysql2` 허용 | 팀 확인 |
| 1. PR 합치기 | 이 브랜치(규칙 · 도구 · 서버 코드)를 `main`으로 | PR 합침 |
| 2. DB 준비 | MySQL 설치, DB · 서버 계정(읽기 · 쓰기 + SHOW VIEW), `tools/mysql-setup.mjs check` → `schema` | 표 31개 · 뷰 3개 · 커리큘럼 41칸 |
| 3. 점검 시간 | 사이트 점검 알림 → 맥 서버 끄기 → `app.db` 백업(VACUUM INTO) | 백업 파일 |
| 4. 복사 · 대조 | `mysql-setup.mjs copy --with-learners`(또는 `--content-only`) → `verify` | 건너뜀 없음 · "모두 SQLite와 같아요" |
| 5. 켜기 | `npm run dev`로 과목 · 문제 수 확인 → `tools/start_beta.sh` | `/health` OK, 백업 OK |
| 6. 되돌리기(문제 시) | 서버를 이전 커밋(SQLite 판)으로 되돌리고 켜기. `app.db`는 손대지 않았으니 그대로 돌아가요 | 사이트 정상 |

## 8. 남은 일 · 주의
| 할 일 | 왜 |
|---|---|
| **`ai` · `report` 시험을 MySQL로** | SQLite 사본으로 서버를 띄우는 방식이라 `npm test`에서 뺐어요 (MySQL 접속 정보가 보이면 멈춤). 시험용 DB(`…_test`)를 `mysql-setup.mjs`로 채워 돌리게 바꾸기. 엔진 시험(`engine` · `sim`)은 그대로 돌아요 — 그중 4개 실패는 main에서도 같아요 |
| **다른 브랜치의 새 SQLite SQL** | PR #1, `feature/진단태깅-확신도-정리`가 `manual-import.js` · `tagger.js` · `admin.js`에 SQLite 문법 SQL을 더했어요. 합칠 때 4장 규칙으로 바꿔야 해요 (`ON CONFLICT`, `json_set`, `p.id` …) |
| 학습자 기록 보관 | `--with-learners`로 옮기면 기기 번호(신원)가 MySQL 쪽 컴퓨터에 저장돼요. 팀장 문서 4장 #3대로 팀이 정해요 |
| 기기 번호 대소문자 | 기기 · 이벤트 번호 칸이 대소문자를 구분하지 않는 정렬(utf8mb4_0900_ai_ci)이에요. 무작위 번호라 겹칠 일은 거의 없지만, 구분하려면 `utf8mb4_bin`으로 |
| 백업 권한 | mysqldump는 `--set-gtid-purged=OFF`로 일반 계정에서 돌아가요. RDS면 자동 스냅샷이 주 백업 |
| 글자 칸에 시각 | `insight_meta`처럼 글자 칸에 넣은 시각은 `…+00:00` 모양으로 저장돼요 (같은 시각으로 읽힘) |
| 사용자가 많아지면 | 연결부가 한 번에 한 쿼리씩 기다려요. RDS로 옮기고 느려지면 `async` 전환을 검토 |

## 9. 확인한 것 (2026-11-01, 로컬 MySQL · 8과목 2,182문제)
| 묶음 | 결과 |
|---|---|
| 둘러보기 · 과목 문제 · 캐시(304) | ✅ 8과목 공개 문제 2,128개, 과목별 수 일치 |
| 기기 등록 · 내 강의실 · 진도(옛 시각은 덮어쓰지 않음) · 책갈피 · 이어 풀기 · 내 요약 | ✅ 없는 문제 · 과목은 건너뜀 |
| 풀이 이벤트 → `event` + `submission` (같은 번호) · 다시 보내면 안 쌓임 | ✅ 통계 뷰(`v_problem_stats`, `v_item_first`) 값 맞음 |
| 제보 · 기기 이동 코드 · 기록 열쇠 | ✅ |
| 학습 리포트 개요 · 뽑기 · 보기 | ✅ |
| 관리자: 개요 · 날짜별 활동 · 문제 통계 · 제보 처리 · 학기 · 과목 · 문제 상세 · 가져오기 미리보기 · 백업 · 진단 탭 7개 | ✅ 가져오기 미리보기는 문제 "바뀜 0" |
| `import.js --dry` | ✅ 문제 · 개념 · 세부 포인트 · 오개념 "그대로" |
| `tools/mysql-setup.mjs` | ✅ 빈 DB에 SQLite를 같은 번호로 복사 → 모든 표 한 칸씩 대조 일치 (아래 10장) |
| 백업(mysqldump) | ✅ SQL 파일 3.8MB |
| 응답 시간 | 과목 문제(379개) 3~18ms |

점검하지 않은 것: AI 채점 · 자동 태깅(Gemini 키 필요), 문제 고치기 · 과목 고치기(실제 내용을 바꾸므로), 화면을 눈으로 보는 확인.

## 10. 설치 도구 실전 시험 (2026-11-01, 빈 로컬 MySQL)
`node --env-file=.env tools/mysql-setup.mjs all --with-learners --from <데모 app.db>`
| 단계 | 결과 |
|---|---|
| check | 연결 ✓ · 왕복 0.3ms |
| schema | 표 31 · 뷰 3 · 커리큘럼 41 ✓ |
| copy | 25개 표 전부 복사, 건너뜀 0 (문제 2,182 · 진단 태그 1,053 · 이벤트 109 · 기기 2 …), 풀이 이벤트 → submission |
| verify | 25개 표 한 칸씩 모두 같음. 일부러 두 칸(단원 제목, 문제 본문)을 바꾸면 그 두 칸을 찾아냄 |
| 번호 | SQLite와 같음 (예: IE216 과목 2, 문제 1-1 = 212) → 브라우저에 저장된 진도 · 책갈피가 그대로 맞음 |
| 그 DB로 서버 | API 점검 39개 통과. 가져오기 미리보기에서 문제 · 진단 태그 모두 "그대로" |
| 안전 장치 | 학습자 기록 선택을 안 하면 멈춤 · 표가 비어 있지 않으면 아무것도 쓰지 않고 멈춤 |
