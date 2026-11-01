# MySQL을 팀원 PC에 두고 맥 서버와 잇기

2026-11-01 · 결정: MySQL은 팀원 PC, 서버는 맥 (AWS는 나중에)

## 1. 구성
```
사용자 ─ Cloudflare 터널 ─ 맥 (Node 서버)
                              │  Tailscale 사설망 (인터넷에 포트 안 엶)
                              └─ 팀원 PC (MySQL 8, problem_solving_site)
```
- 서버는 전환이 끝날 때까지 **지금처럼 SQLite**로 돌아요. MySQL로 바꾸는 건 서버 코드 전환(아래 4) 뒤예요.

## 2. 팀원 PC에서 할 일
1. **MySQL 8 설치**, 부팅할 때 자동으로 켜지게.
2. **Tailscale 설치**, 맥과 같은 tailnet에 들어오기. 맥에서 `ping <팀원PC 이름>`이 되는지 확인.
3. **DB와 계정**
   ```sql
   CREATE DATABASE problem_solving_site CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER 'lms_server'@'100.%' IDENTIFIED BY '<긴 비밀번호>';     -- Tailscale 주소대(100.x)에서만
   GRANT SELECT, INSERT, UPDATE, DELETE ON problem_solving_site.* TO 'lms_server'@'100.%';
   ```
   비밀번호는 채팅·커밋·문서에 쓰지 않아요. 맥의 `.env`에만 넣어요.
4. **포트는 사설망에만**: `my.cnf`의 `bind-address`를 Tailscale 주소로. 공유기 포트 포워딩은 하지 않아요.
5. **표 만들기**: `server/mysql/schema.sql`, `curriculum.sql` 실행 (`server/mysql/README.md`).
6. **잠자기 끄기**: 절전·자동 업데이트 재시작이 서버를 멈춰요. 전원 연결, 잠자기 안 함.
7. **백업**: 매일 `mysqldump`를 PC 밖(외장 디스크나 맥)으로.

## 3. 맥에서 할 일
- `.env`에 `MYSQL_HOST`(Tailscale 이름) · `MYSQL_USER` · `MYSQL_PASSWORD` · `MYSQL_DATABASE`.
- 문제·진단 태그 옮기기: `python server/mysql/migrate_from_sqlite.py make` → 팀원 PC에서 실행 → `verify`.
- 응답 시간 재기: 맥 → 팀원 PC 왕복이 길면(수십 ms) 리포트 만들기가 눈에 띄게 느려져요. 전환 전에 꼭 재요.

## 4. 남은 결정
| # | 정할 것 | 메모 |
|---|---|---|
| 1 | `mysql2` 패키지 예외 | Node에 MySQL 접속 기능이 없어 필요. 팀 규칙 "npm 금지"의 예외 |
| 2 | 서버 코드 전환 담당 | DB 호출 214곳 동기 → `await`, SQL 문법 차이 (`docs/db/MYSQL_전환_계획.md` 5장) |
| 3 | 학습자 기록 옮기기 | 옮기면 학습자 풀이 기록이 팀원 PC에 저장돼요. 기기 번호는 신원과 같아서 보관 책임이 팀원 PC로 가요. 지금은 문제·태그만 옮기고 학습자 기록은 따로 정해요 |

## 5. 위험
- 맥이나 팀원 PC 중 하나라도 꺼지면 사이트가 멈춰요 (전환 뒤).
- 되돌리기: SQLite 파일은 그대로 두니 서버 설정만 SQLite로 돌리면 돼요.
