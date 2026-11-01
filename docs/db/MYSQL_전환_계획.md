# MySQL 전환 계획

2026-11-01 · DB 담당 · 팀 확인용

## 1. 한 줄 요약
MySQL 스키마와 데이터 옮기기 도구는 **준비됐어요.** 남은 건 **DB를 둘 곳 정하기 → 서버 코드 전환 → 운영 데이터 이전**이고, 이 중 앞의 두 가지는 팀이 정해야 해요.

## 2. 지금 상태
| 항목 | 상태 |
|---|---|
| 스키마 (`server/mysql/schema.sql`) | ✅ 표 31개 + 뷰 3개. 기존 SQLite 표 26개 · 칸 212개를 빠짐없이 옮겼음 (프로그램으로 대조) |
| 새 표 | ✅ 회원(`users`), 제출(`submission`), 커리큘럼 3개, 시험일(`exam_date`), 통계 뷰 2개 |
| 데이터 규칙 | ✅ 외래 키 · CHECK 제약. 잘못된 값 넣기 시험 40여 개 모두 막힘 |
| 옮기기 도구 | ✅ 로컬 SQLite(5과목 · 문제 1,306 · 생경론 진단 태그)로 옮기고 표 11개 전부 대조 일치. 두 번 돌려도 그대로 |
| 서버 | 🟡 MySQL 판을 로컬에서 확인함 (API 39개 점검 통과, [`MYSQL_서버전환_가이드.md`](MYSQL_서버전환_가이드.md)). 운영은 아직 SQLite |
| 운영 데이터 | ⬜ 맥의 `data/app.db` 그대로 |

## 3. 팀이 정할 것
| # | 정할 것 | 추천 | 이유 |
|---|---|---|---|
| 1 | **MySQL을 둘 곳** | AWS RDS (MySQL 8) | 원래 계획이 AWS 이전. 팀원 모두 같은 DB를 쓰고, 백업 · 스냅샷이 자동 |
| 2 | **`mysql2` 패키지 예외** | 허용 (이 패키지 하나만) | Node에는 MySQL 접속 기능이 내장돼 있지 않아요. 팀 규칙 "npm 패키지 금지"의 예외가 필요 |
| 3 | **전환 방식** | 한 번에 전환 (짧은 점검 시간) | 두 DB에 동시에 쓰는 기간을 두면 어긋날 위험이 커요. 베타라 사용자가 적어 점검 시간이 부담이 적어요 |
| 4 | **회원 로그인 시기** | 전환이 끝난 뒤 따로 | 표는 준비돼 있어요. 기능(가입 · 로그인 화면, API, 비밀번호 해시)은 전환과 섞지 않아요 |

## 4. 단계
### A. DB 자리 만들기 (결정 1 뒤)
- RDS(또는 정한 곳)에 `problem_solving_site`(utf8mb4) · 서버용 계정(읽기 · 쓰기) · 분석용 계정(읽기 전용)
- `schema.sql`, `curriculum.sql` 실행
- 끝 기준: 표 31개 · 뷰 3개, 커리큘럼 41칸

### B. 서버 코드 전환 (결정 2 뒤, 서버 담당과 함께, 가장 큼)
아래 5장 체크리스트. 끝 기준: `npm test`가 MySQL 복사본에서 통과, 화면 · 관리자 · 학습 리포트가 지금과 같게 동작

### C. 옮기기 도구에 학습자 기록 더하기 (DB 담당)
지금 도구는 문제 · 진단 태그만 옮겨요. 더할 것: `device`, `enrollment`, `progress`, `resume`, `bookmark`, `event`, `report`, `ai_grade`, `insight`, `tag_job`, `ai_budget`, `ai_block`, `insight_meta`, 그리고 `event`의 풀이 이벤트로 `submission` 채우기.
끝 기준: 맥 DB **사본**으로 옮기고 `verify`가 모든 표 일치

### D. 운영 전환 (점검 시간)
1. 사이트 점검 표시 → 맥 서버 중지
2. `data/app.db` 백업 (`VACUUM INTO`)
3. 옮기기 도구 `make` → 실행 → `verify`
4. 서버를 MySQL로 켜고 `/health`, 주요 화면 확인
5. 문제가 있으면 **SQLite로 되돌림**: SQLite 파일은 손대지 않았으니 서버 설정만 되돌리면 돼요

### E. 정리
- 백업 방식 교체: `VACUUM INTO`(11곳) → RDS 자동 스냅샷 + 필요하면 `mysqldump`
- 새 표를 쓰는 기능: 커리큘럼을 DB에서 읽기, 시험일 서버 동기화, 관리자 통계를 뷰로, 회원 로그인

## 5. 서버 코드 전환 체크리스트 (B단계)
숫자는 `main` 기준. PR #1(어휘 확인)이 합쳐지면 조금 늘어요.

| 할 일 | 규모 | 메모 |
|---|---|---|
| DB 호출을 비동기로 | `db.prepare(` 214곳 · 14개 파일 | `node:sqlite`는 동기(`.get/.all/.run`), `mysql2`는 `await`. 가장 큰 일 |
| `ON CONFLICT … DO UPDATE` → `ON DUPLICATE KEY UPDATE` | 17곳 (PR #1 +2) | `excluded.x` → `INSERT … AS n` 의 `n.x` |
| `INSERT OR IGNORE/REPLACE` | 5곳 | `INSERT IGNORE` / `… ON DUPLICATE KEY UPDATE` |
| `json_extract(…)` | 13곳 | MySQL도 있지만 글자 값은 따옴표째 나와요 → `->>` 사용 |
| `PRAGMA`, `WITHOUT ROWID` | 7곳 · 8곳 | 빼거나 `information_schema`로 |
| `VACUUM INTO` 백업 | 11곳 | E단계에서 교체 |
| 이름 바뀐 칸 | `chapter_key`, `meta_key`, `blocked_until`, `id` → `<표>_id` | `server/mysql/README.md` |
| 시간 값 | 전부 | 지금은 ISO 글자(`…Z`)로 쓰고 읽어요. MySQL은 `DATETIME(3)` UTC. 쓸 때 형식 변환, 읽을 때 `dateStrings: true`로 글자 유지 권장 |
| JSON 칸 읽기 | `J(…)` 약 60곳 | `mysql2`는 JSON 칸을 **객체로** 돌려줘서 `J()`(JSON.parse)가 실패하고 기본값을 돌려줘요 → 연결 옵션 `jsonStrings: true` 또는 `J()`가 객체를 그대로 받게 |
| 풀이 기록 | `/api/events` 등 | `event`와 `submission`에 **한 트랜잭션으로** 같이 쓰기 (`submission.client_id` = `event_id`) |
| 테스트 | `server/insight/test/*` | 운영 DB 사본 대신 MySQL 시험 DB를 쓰게 |
| 접속 정보 | | `.env`에 `MYSQL_HOST/USER/PASSWORD/DATABASE`. 코드 · 로그에 쓰지 않음 |

## 6. 위험과 대응
| 위험 | 대응 |
|---|---|
| 옮기다 데이터가 빠지거나 바뀜 | `verify`가 표마다 한 줄 · 한 칸씩 대조 (JSON 포함). 일부러 바꾼 사본으로 잡아내는 것까지 확인함 |
| 전환 후 문제 발견 | SQLite 원본을 그대로 두고 서버 설정만 되돌리기 |
| 코드 길이 · 글자 수 초과 | 실제 데이터(경정시 변형 문제 PR #3의 작성자 코드 포함)로 칸 길이를 다시 맞춤 |
| 비밀번호 유출 | `.my.cnf` · `.env`는 `.gitignore`와 커밋 검사가 막음 |

## 7. 파일
- `server/mysql/` — 스키마, 커리큘럼, 옮기기 도구, 샘플, 조회 예시 (사용법은 그 폴더 `README.md`)
- 설계 때 정한 것: 학습 기록의 주인은 기기(로그인하면 회원과 연결), `progress`는 화면용 요약(원본은 `event` · `submission`), 진단 코드는 바꾸지 않고 없앨 땐 `retired`, 외래 키에 CASCADE 없음(지울 땐 확인받고 따로)
