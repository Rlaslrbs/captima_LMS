# MySQL 스키마 · 연결부

서버가 쓰는 MySQL의 표 구조와 연결부예요. 바꾼 방법과 확인 결과는 [`docs/db/MYSQL_서버전환_가이드.md`](../../docs/db/MYSQL_서버전환_가이드.md), 서버 담당의 연결 절차는 [`docs/db/MySQL_서버연결_프롬프트.md`](../../docs/db/MySQL_서버연결_프롬프트.md)를 보세요.

## 파일
| 파일 | 내용 | 다시 실행 |
|---|---|---|
| `schema.sql` | 표 31개 + 뷰 3개. 기존 SQLite 구조 전체 + 회원 · 제출 · 커리큘럼 · 시험일 · 통계 뷰 | 안전 (`IF NOT EXISTS`, `CREATE OR REPLACE`, 고침 구역은 이미 된 건 건너뜀) |
| `curriculum.sql` | 산업경영공학과 커리큘럼 41칸 · 선수 관계 10개 · 과목 연결 8개 (`web/js/curriculum.js`와 같은 내용) | 안전 |
| `sync.js` · `worker.js` | 서버의 DB 연결부. `node:sqlite`와 같은 모양(`prepare().get/all/run`)으로 MySQL을 쓴다 (`mysql2`) | - |

## 처음 만들기 (한 번에)
```bash
npm run setup                                                   # mysql2 설치, .env 만들기
# .env에 MYSQL_HOST · MYSQL_PORT · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE
node --env-file=.env tools/mysql-setup.mjs all --content-only    # 연결 확인 → 표 만들기 → data/app.db 복사(번호 그대로) → 대조
```
- 학습자 기록(기기 · 풀이 · 진도 · 제보 · 리포트)까지 옮기려면 `--with-learners`. 둘 중 하나를 꼭 골라요.
- 단계별로: `check` · `schema` · `copy` · `verify`. `--from <app.db 경로>`로 다른 SQLite 파일. SQLite가 없으면 표만 만들고 문제는 `npm run import`로 넣어요.
- 복사는 MySQL 표가 **비어 있을 때만** 해요(지우는 명령 없음). 이미 옮겼으면 `verify`로 확인.
- 표 만들기 권한이 없는 서버 계정이면 `MYSQL_ADMIN_USER`(·`MYSQL_ADMIN_PASSWORD`)를 그 명령에만 붙여요.
- 표를 바꿀 때는 `schema.sql`에 먼저 쓰고(끝의 "고침" 구역처럼 다시 실행해도 안전하게) `mysql-setup.mjs schema`로 실행해요.

## SQLite와 다른 점 (서버 코드를 쓸 때 주의, 전체 규칙은 가이드 4장)
- 이름이 바뀐 칸: `chapter.key` → `chapter_key`, `insight_meta.key` → `meta_key`, `ai_block.until` → `blocked_until` (MySQL 예약어)
- id 칸 이름: `id` → `<표>_id` (`course_id`, `problem_id`, `version_id` …)
- 시간: `DATETIME(3)`, **UTC로 저장**. 서버 코드는 예전처럼 ISO 글자(`…Z`)로 주고받아요 (연결부가 바꿔 줌)
- JSON 칸(`info`, `body`, `payload` …)은 MySQL `JSON` 타입
- `item_first` 표 대신 `v_item_first` 뷰 (`submission`에서 계산), SQLite `rowid` 대신 `event.seq`
- 풀이는 `event`(원본, 학습 리포트가 읽음)와 `submission`(통계용 정리본, `client_id` = `event_id`)에 **같이** 써요
