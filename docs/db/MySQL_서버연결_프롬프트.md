# MySQL 서버 연결 프롬프트 (서버 담당용)

2026-11-01 · DB 담당 작성
서버(맥)를 SQLite에서 MySQL로 옮기는 전체 절차예요. **맥의 Claude Code에 아래 "붙여 넣을 프롬프트" 한 덩어리만 넣으면** 확인 → 준비 → 복사 → 대조 → 켜기 → 보고까지 진행해요. 중간에 꼭 사람이 정해야 하는 것만 물어봐요.

- 바탕: [`MYSQL_서버전환_가이드.md`](MYSQL_서버전환_가이드.md) (바꾼 방법 · 확인 결과), `docs/db/MySQL_팀원PC_연결안내.md` (팀장 작성, MySQL을 팀원 PC에 둘 때의 망 구성. 아직 `feature/진단태깅-확신도-정리` 브랜치에만 있어요. 그 문서 3장의 python 옮기기 대신 이 절차의 `tools/mysql-setup.mjs`를 써요 — 번호(id)를 그대로 옮겨야 브라우저에 저장된 진도 · 책갈피가 맞아요)
- 걸리는 시간: MySQL이 깔려 있으면 10~20분. 그중 서버가 멈춰 있는 시간은 복사 · 대조 몇 분

## 미리 준비 (사람)
| 할 일 | 메모 |
|---|---|
| PR #5(이 브랜치)를 확인 | 합쳐졌으면 `main`, 아니면 `feature/db-mysql` 브랜치로 진행 |
| MySQL 자리 정하기 | **A. 이 맥** (가장 간단) 또는 **B. 팀원 PC** (Tailscale, `MySQL_팀원PC_연결안내.md` 2장을 팀원이 먼저 끝냄) |
| 학습자 기록을 옮길지 정하기 | 옮기면 테스터 풀이 기록이 MySQL 쪽 컴퓨터에 저장돼요. 안 옮기면 MySQL 판에서는 모두 새 기기처럼 시작해요 (SQLite 파일에는 그대로 남음) |
| 테스터에게 점검 알리기 | 복사하는 몇 분 동안 서버를 꺼요 |

## 붙여 넣을 프롬프트
````
문제노트 서버를 SQLite에서 MySQL로 옮겨 줘. 절차는 docs/db/MySQL_서버연결_프롬프트.md 의 "Claude가 따를 절차"야. 그 파일과 CLAUDE.md를 먼저 읽고, 순서대로 진행해 줘.
- MySQL 자리: <A. 이 맥 | B. 팀원 PC (Tailscale 이름: ______)>
- 학습자 기록: <옮김 | 안 옮김>
````

---

## Claude가 따를 절차
지킬 것
- **비밀번호는 화면 · 채팅 · 로그 · 커밋에 절대 내보내지 않는다.** `.env`에만 쓴다. `cat .env`, `echo $PW`, `env` 출력 금지. 기기 번호 · 관리자 경로도 보고에 쓰지 않는다.
- `DELETE` · `DROP` · `TRUNCATE`, 파일 지우기, 서버 끄기, 프로그램 설치는 **실행 전에 사용자에게 묻는다.**
- 어느 단계든 ✗가 나오거나 예상과 다르면 **멈추고 그대로 보고**한다. 우회하지 않는다 (`--no-verify` 금지).
- `data/app.db`(SQLite 원본)는 읽기만 한다. 되돌릴 때 그대로 쓴다.

### 0. 확인
1. `git status`가 깨끗한지, 지금 브랜치. `git fetch` 뒤 PR #5가 합쳐졌으면 `main`, 아니면 `feature/db-mysql`로 `git switch` + `git pull`.
   `tools/mysql-setup.mjs`와 `server/mysql/sync.js`가 있어야 한다.
2. `node -v` (24 이상), `ls data/app.db`, 지금 서버가 켜져 있는지 `lsof -nP -iTCP:4000 -sTCP:LISTEN`.
3. `npm install` (외부 패키지는 `mysql2` 하나. CLAUDE.md 3절).

### 1. MySQL 준비
**A. 이 맥에 둘 때**
1. `mysql --version`, `brew services list`. 없으면 **물어보고** `brew install mysql` → `brew services start mysql`. 8.0.19 이상이어야 한다.
2. DB와 서버 계정. 비밀번호는 만들어서 **바로 `.env`에만** 넣는다 (화면에 안 나오게). root에 비밀번호가 있으면 사용자에게 직접 입력해 달라고 한다.
   ```bash
   PW=$(openssl rand -hex 24)
   mysql -u root <<SQL
   CREATE DATABASE IF NOT EXISTS problem_solving_site CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER IF NOT EXISTS 'lms_server'@'localhost' IDENTIFIED BY '$PW';
   CREATE USER IF NOT EXISTS 'lms_server'@'127.0.0.1' IDENTIFIED BY '$PW';
   ALTER USER 'lms_server'@'localhost' IDENTIFIED BY '$PW';
   ALTER USER 'lms_server'@'127.0.0.1' IDENTIFIED BY '$PW';
   GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON problem_solving_site.* TO 'lms_server'@'localhost', 'lms_server'@'127.0.0.1';
   SQL
   ```
   서버 계정은 읽기 · 쓰기와 백업(SHOW VIEW)만. 표 만들기는 2단계에서 root로 한 번만.
3. `.env`에 아래 다섯 줄. **이미 있는 `MYSQL_` 줄은 그 줄만 바꾸고, 없으면 끝에 더한다.** 비밀번호는 위 `$PW`를 같은 셸에서 바로 쓴다.
   `MYSQL_HOST=127.0.0.1` · `MYSQL_PORT=3306` · `MYSQL_USER=lms_server` · `MYSQL_PASSWORD=<$PW>` · `MYSQL_DATABASE=problem_solving_site`
   확인은 `grep -c '^MYSQL_' .env`(5)로만 한다.

**B. 팀원 PC에 둘 때**
1. 팀원이 `MySQL_팀원PC_연결안내.md` 2장(설치 · Tailscale · DB · 계정 · bind-address)을 끝냈는지 묻는다. 계정 권한에 `SHOW VIEW`도 있어야 백업이 된다.
2. `tailscale status`, `ping -c 3 <팀원PC 이름>`.
3. `.env`에 `MYSQL_HOST=<팀원PC Tailscale 이름>` · `MYSQL_PORT=3306` · `MYSQL_USER=lms_server` · `MYSQL_DATABASE=problem_solving_site`. **비밀번호는 사용자가 직접 `.env`에 넣게 한다** (채팅으로 받지 않는다).
4. 표 만들기 권한: 팀원이 그 PC에서 `mysql -u root < server/mysql/schema.sql`과 `curriculum.sql`을 직접 실행하거나, 관리자 계정을 2단계에서만 잠깐 쓴다.

### 2. 연결 확인 · 표 만들기
1. `node --env-file=.env tools/mysql-setup.mjs check`
   - 접속 실패면 멈추고 보고. **왕복 시간이 10ms를 넘으면** 사용자에게 알린다 (서버가 쿼리마다 기다려서 리포트 · 관리자 통계가 느려짐).
2. 표 만들기 (다시 실행해도 안전):
   - A: `MYSQL_ADMIN_USER=root node --env-file=.env tools/mysql-setup.mjs schema` (root 비밀번호가 있으면 `MYSQL_ADMIN_PASSWORD`도 사용자가 입력)
     root로 접속이 안 되면: `mysql -u root problem_solving_site < server/mysql/schema.sql` → 같은 방법으로 `curriculum.sql` → `check`로 표 수 확인
   - B: 팀원이 직접 실행했으면 `check`만 다시. 아니면 관리자 계정으로 위와 같이
   - 끝 기준: `표 31개 · 뷰 3개 · 커리큘럼 41칸  ✓`

### 3. 서버 멈추고 원본 백업 (사용자에게 묻고)
1. 서버가 켜져 있으면 **사용자에게 끌지 묻는다** → `tools/start_beta.sh` 창에서 Ctrl+C (또는 `lsof -tiTCP:4000 -sTCP:LISTEN`의 프로세스를 사용자 확인 뒤 종료). 끈 뒤에 쌓이는 기록이 없어야 복사가 정확하다.
2. SQLite 원본 백업 (지우지 않는다):
   ```bash
   mkdir -p data/backups && node -e "new (require('node:sqlite').DatabaseSync)('data/app.db').exec(\"VACUUM INTO 'data/backups/app-before-mysql-$(date +%Y%m%d-%H%M).db'\")" && ls -la data/backups | tail -3
   ```

### 4. 복사 · 대조
1. 학습자 기록을 옮기면 `--with-learners`, 아니면 `--content-only`:
   ```bash
   node --env-file=.env tools/mysql-setup.mjs copy --with-learners     # 또는 --content-only
   node --env-file=.env tools/mysql-setup.mjs verify
   ```
2. 끝 기준: `copy`에 `⚠ 건너뜀`이 없고, `verify` 마지막 줄이 `✓ 옮긴 표가 모두 SQLite와 같아요`.
   - `건너뜀`이 있으면: 어떤 표 몇 줄인지(값은 빼고) 보고하고 **사용자가 정할 때까지 서버를 켜지 않는다.**
   - "MySQL 표가 비어 있지 않아…"가 나오면: 이미 옮긴 것일 수 있다. `verify`만 하고 결과를 보고한다. 비우는 것은 사용자 허락 뒤에만.

### 5. 서버 켜기 · 확인
1. `which mysqldump` (백업용). 없으면 `.env`에 `MYSQLDUMP_BIN=<경로>`(brew: `/opt/homebrew/bin/mysqldump`).
2. 먼저 로컬로: `npm run dev` (백그라운드) → 아래가 모두 맞으면 끄고 3으로
   ```bash
   curl -s http://127.0.0.1:4000/health
   curl -s http://127.0.0.1:4000/api/catalog | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('학기',j.semesters.length,'과목',j.semesters.flatMap(x=>x.courses).length,'문제',j.semesters.flatMap(x=>x.courses).reduce((a,c)=>a+c.problems,0))})"
   ```
   - 과목 · 문제 수가 SQLite 때와 같아야 한다 (`sqlite3`가 없으면 `node -e`로 `SELECT COUNT(*) FROM problem WHERE status='published'`).
   - 서버 터미널에 `백업 만듦: app-….sql`이 나오면 백업도 OK. `백업 실패`면 메시지를 보고.
3. 평소대로 `tools/start_beta.sh`로 켠다 (Tunnel 주소가 새로 나옴).

### 6. 보고 (사용자에게, 비밀 값 없이)
| 항목 | 예 |
|---|---|
| MySQL 자리 · 버전 · 왕복 시간 | 이 맥 · 8.4 · 0.3ms |
| 표 · 뷰 · 커리큘럼 | 31 · 3 · 41 |
| 옮긴 것 | 학습자 기록 포함/제외, 표별 줄 수, 대조 결과 |
| 서버 | `/health` OK, 과목 · 문제 수, 백업 OK |
| 남은 일 | 새 과목 넣기는 `npm run import -- data/import/<과목>.json` |

### 되돌리기 (문제가 생기면)
1. 서버 끄기 → `git switch` 로 SQLite 판 커밋(전환 전 `main`)으로 → `tools/start_beta.sh`.
2. `data/app.db`는 손대지 않았으니 전환 전 그대로 돌아가요. 단, **MySQL 판으로 켜 있던 동안의 새 기록은 MySQL에만** 있어요 (필요하면 따로 옮김).
3. MySQL 데이터는 지우지 않고 둔다 (다시 시도할 때 `verify`로 확인).
