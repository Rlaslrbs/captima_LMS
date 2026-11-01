# MySQL 스키마와 옮기기 도구

SQLite(`data/app.db`)에서 MySQL로 옮기기 위한 파일과, 서버가 MySQL을 쓰게 하는 연결부예요. 전환 계획은 [`docs/db/MYSQL_전환_계획.md`](../../docs/db/MYSQL_전환_계획.md), 서버 전환 방법과 확인 결과는 [`docs/db/MYSQL_서버전환_가이드.md`](../../docs/db/MYSQL_서버전환_가이드.md)를 보세요.

## 파일
| 파일 | 내용 | 다시 실행 |
|---|---|---|
| `sync.js` · `worker.js` | 서버의 DB 연결부. `node:sqlite`와 같은 모양(`prepare().get/all/run`)으로 MySQL을 쓴다 (`mysql2`) | - |
| `schema.sql` | 표 31개 + 뷰 3개. 기존 SQLite 구조 전체 + 회원 · 제출 · 커리큘럼 · 시험일 | 안전 (`IF NOT EXISTS`, `CREATE OR REPLACE`, 고침 구역은 이미 된 건 건너뜀) |
| `curriculum.sql` | 산업경영공학과 커리큘럼 41칸 · 선수 관계 10개 · 과목 연결 4개 (실제 데이터, `web/js/curriculum.js`와 같은 내용) | 안전 |
| `migrate_from_sqlite.py` | (예전) 문제 · 진단 태그만 옮기기 · 대조. 번호가 새로 매겨져 운영 전환에는 안 씀 → `tools/mysql-setup.mjs` | 안전 (지우는 명령 없음) |
| `samples/seed*.sql` | 시험용 샘플 (회원 5 · 문제 10 · 제출 30 …). 실제 사람 기록이 아니에요 | **한 번만** |
| `samples/reset_samples.sql` | 위 샘플만 지우기 (샘플 표시가 있는 줄만). ⚠ DELETE가 들어 있어요 | 안전 |
| `queries/stats*.sql` | 통계 · 화면용 조회 예시 (읽기만) | 안전 |

## 처음 만들기 (한 번에)
```bash
npm run setup                                                   # mysql2 설치, .env 만들기
# .env에 MYSQL_HOST · MYSQL_PORT · MYSQL_USER · MYSQL_PASSWORD · MYSQL_DATABASE
node --env-file=.env tools/mysql-setup.mjs all --content-only    # 연결 확인 → 표 만들기 → data/app.db 복사(번호 그대로) → 대조
```
- 학습자 기록(기기 · 풀이 · 진도 · 제보 · 리포트)까지 옮기려면 `--with-learners`. 둘 중 하나를 꼭 골라요.
- 단계별로: `check` · `schema` · `copy` · `verify`. `--from <app.db 경로>`로 다른 SQLite 파일.
- 복사는 MySQL 표가 **비어 있을 때만** 해요(지우는 명령 없음). 이미 옮겼으면 `verify`로 확인.
- 표 만들기 권한이 없는 서버 계정이면 `MYSQL_ADMIN_USER`(·`MYSQL_ADMIN_PASSWORD`)를 그 명령에만 붙여요.
- 서버 담당의 운영 전환 절차: [`docs/db/MySQL_서버연결_프롬프트.md`](../../docs/db/MySQL_서버연결_프롬프트.md)

### 예전 도구: `migrate_from_sqlite.py`
문제 · 진단 태그만 옮기고 **번호(id)를 새로 매겨요.** 운영 전환에는 쓰지 않아요 (브라우저에 저장된 진도 · 책갈피가 다른 문제를 가리키게 됨). 기록용으로 남겨 둬요.

## SQLite와 다른 점 (서버 코드를 바꿀 때 주의)
- 이름이 바뀐 칸: `chapter.key` → `chapter_key`, `insight_meta.key` → `meta_key`, `ai_block.until` → `blocked_until` (MySQL 예약어)
- id 칸 이름: `id` → `<표>_id` (`course_id`, `problem_id`, `version_id` …)
- 시간: 글자(ISO) → `DATETIME(3)`, **UTC로 저장**
- JSON 칸(`info`, `body`, `payload` …)은 MySQL `JSON` 타입
- `item_first` 표 대신 `v_item_first` 뷰 (`submission`에서 계산)
- 풀이는 `event`(원본, 학습 리포트가 읽음)와 `submission`(통계용 정리본, `client_id` = `event_id`)에 **같이** 써요
