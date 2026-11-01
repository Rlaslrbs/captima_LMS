# MySQL 스키마와 옮기기 도구

SQLite(`data/app.db`)에서 MySQL로 옮기기 위한 파일이에요. **지금 서버는 아직 SQLite를 써요.** 전환 계획은 [`docs/db/MYSQL_전환_계획.md`](../../docs/db/MYSQL_전환_계획.md)를 보세요.

## 파일
| 파일 | 내용 | 다시 실행 |
|---|---|---|
| `schema.sql` | 표 31개 + 뷰 3개. 기존 SQLite 구조 전체 + 회원 · 제출 · 커리큘럼 · 시험일 | 안전 (`IF NOT EXISTS`, `CREATE OR REPLACE`, 고침 구역은 이미 된 건 건너뜀) |
| `curriculum.sql` | 산업경영공학과 커리큘럼 41칸 · 선수 관계 10개 · 과목 연결 4개 (실제 데이터, `web/js/curriculum.js`와 같은 내용) | 안전 |
| `migrate_from_sqlite.py` | SQLite → MySQL 옮기기 (`make`) · 대조 (`verify`). Python 기본 기능만 사용 | 안전 (지우는 명령 없음) |
| `samples/seed*.sql` | 시험용 샘플 (회원 5 · 문제 10 · 제출 30 …). 실제 사람 기록이 아니에요 | **한 번만** |
| `samples/reset_samples.sql` | 위 샘플만 지우기 (샘플 표시가 있는 줄만). ⚠ DELETE가 들어 있어요 | 안전 |
| `queries/stats*.sql` | 통계 · 화면용 조회 예시 (읽기만) | 안전 |

## 처음 만들기
1. MySQL 8 이상에 DB `problem_solving_site`(utf8mb4)와 계정을 만들어요.
2. 저장소 맨 위 폴더에 접속 파일 `.my.cnf`를 만들어요. **비밀번호가 들어 있으니 올리지 않아요** (`.gitignore`, 커밋 검사가 막아요).
   ```ini
   [client]
   user=<계정>
   password=<비밀번호>
   host=<호스트>
   port=3306
   database=problem_solving_site
   ```
3. 저장소 맨 위 폴더에서:
   ```bash
   mysql --defaults-extra-file=.my.cnf --default-character-set=utf8mb4 < server/mysql/schema.sql
   mysql --defaults-extra-file=.my.cnf --default-character-set=utf8mb4 < server/mysql/curriculum.sql
   ```
   Windows PowerShell은 `Get-Content server/mysql/schema.sql -Encoding UTF8 | & "<mysql.exe 경로>" --defaults-extra-file=.my.cnf --default-character-set=utf8mb4` 처럼 넘겨요.

## SQLite 데이터 옮기기
```bash
python server/mysql/migrate_from_sqlite.py make            # server/mysql/migrate_data.sql 생성 (올리지 않음)
mysql --defaults-extra-file=.my.cnf --default-character-set=utf8mb4 < server/mysql/migrate_data.sql
python server/mysql/migrate_from_sqlite.py verify          # 표 11개를 한 줄 · 한 칸씩 대조
```
- 옮기는 것: 학기 · 과목 · 단원 · 문제 · 문제 버전 + 진단 태그(개념 · 세부 포인트 · 착각 · 문제 태그 · 변형 묶음)
- **아직 옮기지 않는 것: 학습자 기록**(기기 · 풀이 · 이벤트 · 제보 …). 운영 전환 때 더해요 (계획 문서 D단계)
- 바뀌지 않는 값(학기 코드 · 과목 코드 · 단원 키 · 문제 번호 · 버전 · 진단 코드)으로 같은 줄을 찾아 있으면 고치고 없으면 더해요. MySQL에서만 정하는 값(난이도 · 작성자)은 덮어쓰지 않아요.
- 다른 DB 파일을 쓰려면 `make <app.db 경로>`. mysql 프로그램 위치는 `MYSQL_BIN`, 접속 파일은 `MYSQL_CNF` 환경 변수로 바꿀 수 있어요.

## SQLite와 다른 점 (서버 코드를 바꿀 때 주의)
- 이름이 바뀐 칸: `chapter.key` → `chapter_key`, `insight_meta.key` → `meta_key`, `ai_block.until` → `blocked_until` (MySQL 예약어)
- id 칸 이름: `id` → `<표>_id` (`course_id`, `problem_id`, `version_id` …)
- 시간: 글자(ISO) → `DATETIME(3)`, **UTC로 저장**
- JSON 칸(`info`, `body`, `payload` …)은 MySQL `JSON` 타입
- `item_first` 표 대신 `v_item_first` 뷰 (`submission`에서 계산)
- 풀이는 `event`(원본, 학습 리포트가 읽음)와 `submission`(통계용 정리본, `client_id` = `event_id`)에 **같이** 써요
