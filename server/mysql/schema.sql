-- 문제노트 플랫폼 MySQL 스키마 · 1단계 (회원 · 콘텐츠 · 제출 · 통계)
-- 기존 SQLite 구조(server/schema.sql)를 옮기고 회원 · 제출 · 통계를 더했다.
-- 다시 실행해도 안전하다: 표는 CREATE TABLE IF NOT EXISTS, 뷰는 CREATE OR REPLACE.
-- 시간은 모두 UTC로 저장한다 (서버와 seed는 접속하자마자 SET time_zone = '+00:00').
USE problem_solving_site;

-- ───────── 회원 ─────────
CREATE TABLE IF NOT EXISTS users (
  user_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  login_id      VARCHAR(30)  NOT NULL,                 -- 로그인 아이디 (영문·숫자·_ 4~30자)
  email         VARCHAR(255) NOT NULL,                 -- 비밀번호 찾기용
  password_hash VARCHAR(255) NOT NULL,                 -- bcrypt · argon2id 결과. 원문 비밀번호는 저장하지 않는다
  nickname      VARCHAR(30)  NOT NULL,                 -- 중복 허용
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deleted_at    DATETIME(3)  NULL,                     -- 탈퇴 시각. 탈퇴하면 아이디·이메일·닉네임을 지우고 풀이 기록은 익명으로 남긴다
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_login_id (login_id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT ck_users_login_id CHECK (login_id REGEXP '^[A-Za-z0-9_]{4,30}$' OR deleted_at IS NOT NULL),
  CONSTRAINT ck_users_email CHECK (email LIKE '%_@_%' OR deleted_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 기기(브라우저): 로그인 없이도 쓰고, 로그인하면 회원과 잇는다 (회원 한 명이 기기 여러 개)
CREATE TABLE IF NOT EXISTS device (
  device_id   VARCHAR(64) NOT NULL,                    -- 브라우저가 만든 익명 번호
  user_id     BIGINT UNSIGNED NULL,
  nickname    VARCHAR(20) NOT NULL DEFAULT '',
  consent     BOOLEAN     NOT NULL DEFAULT FALSE,      -- 풀이 기록 수집 동의
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id),
  KEY ix_device_user (user_id),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ───────── 콘텐츠 ─────────
CREATE TABLE IF NOT EXISTS semester (
  semester_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(8)  NOT NULL,                    -- 26-2
  name        VARCHAR(30) NOT NULL,                    -- 2026년 2학기
  sort        INT         NOT NULL DEFAULT 0,
  visible     BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (semester_id),
  UNIQUE KEY uq_semester_code (code),
  CONSTRAINT ck_semester_code CHECK (code REGEXP '^[0-9]{2}-(1|2|S|W)$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS course (
  course_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  semester_id INT UNSIGNED NOT NULL,
  code        VARCHAR(20)  NOT NULL,                   -- IE208
  short       VARCHAR(10)  NOT NULL,                   -- 응용통계
  name        VARCHAR(100) NOT NULL,
  professor   VARCHAR(50)  NOT NULL DEFAULT '',
  meta        VARCHAR(300) NOT NULL DEFAULT '',        -- 어떤 자료로 만들었는지
  info        JSON         NOT NULL DEFAULT (JSON_OBJECT()),                -- color, lang, math, files, concepts, topics
  sort        INT          NOT NULL DEFAULT 0,
  visible     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (course_id),
  UNIQUE KEY uq_course_code (semester_id, code),
  KEY ix_course_list (semester_id, sort),
  CONSTRAINT fk_course_semester FOREIGN KEY (semester_id) REFERENCES semester (semester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS chapter (
  chapter_id  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id   INT UNSIGNED NOT NULL,
  chapter_key VARCHAR(30)  NOT NULL,                   -- SQLite의 key (MySQL 예약어라 이름을 바꿈)
  title       VARCHAR(200) NOT NULL,
  short       VARCHAR(50)  NOT NULL DEFAULT '',
  grp         VARCHAR(50)  NOT NULL DEFAULT '',        -- 단원 묶음
  info        JSON         NOT NULL DEFAULT (JSON_OBJECT()),
  sort        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (chapter_id),
  UNIQUE KEY uq_chapter_key (course_id, chapter_key),
  KEY ix_chapter_list (course_id, sort),
  CONSTRAINT fk_chapter_course FOREIGN KEY (course_id) REFERENCES course (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 문제의 바뀌지 않는 정보. 내용은 problem_version에 (고칠 때마다 새 버전)
CREATE TABLE IF NOT EXISTS problem (
  problem_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id       INT UNSIGNED    NOT NULL,
  chapter_id      INT UNSIGNED    NOT NULL,
  ext_id          VARCHAR(40)     NOT NULL,            -- 원래 문제 번호 (1-1, tf12 …). 바꾸지 않는다
  sort            INT             NOT NULL DEFAULT 0,
  current_version INT UNSIGNED    NOT NULL DEFAULT 1,
  status          VARCHAR(10)     NOT NULL DEFAULT 'published',
  difficulty      TINYINT UNSIGNED NULL,               -- 1(쉬움) ~ 5(어려움). 모르면 비움
  author_id       BIGINT UNSIGNED NULL,                -- 작성자. 가져온 문제는 비움
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (problem_id),
  UNIQUE KEY uq_problem_ext (course_id, ext_id),
  KEY ix_problem_list (chapter_id, sort),
  KEY ix_problem_author (author_id),
  CONSTRAINT fk_problem_course  FOREIGN KEY (course_id)  REFERENCES course (course_id),
  CONSTRAINT fk_problem_chapter FOREIGN KEY (chapter_id) REFERENCES chapter (chapter_id),
  CONSTRAINT fk_problem_author  FOREIGN KEY (author_id)  REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT ck_problem_status CHECK (status IN ('published', 'hidden')),
  CONSTRAINT ck_problem_difficulty CHECK (difficulty BETWEEN 1 AND 5),
  CONSTRAINT ck_problem_version CHECK (current_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS problem_version (
  version_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  problem_id  BIGINT UNSIGNED NOT NULL,
  version     INT UNSIGNED    NOT NULL,
  kind        VARCHAR(8)      NOT NULL,                -- ox | mc | short | essay
  star        BOOLEAN         NOT NULL DEFAULT FALSE,  -- 중요 문제
  body        JSON            NOT NULL,                -- 본문 q, 보기 opts, 정답 ans/a/ox, 해설 s, 출처 src …
  note        VARCHAR(300)    NOT NULL DEFAULT '',     -- 고친 이유
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version_id),
  UNIQUE KEY uq_problem_version (problem_id, version),
  CONSTRAINT fk_version_problem FOREIGN KEY (problem_id) REFERENCES problem (problem_id),
  CONSTRAINT ck_version_kind CHECK (kind IN ('ox', 'mc', 'short', 'essay')),
  CONSTRAINT ck_version_no CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ───────── 제출 ─────────
-- 제출 한 번 = 한 줄. 추가만 하고 고치지 않는다. 어떤 버전을 풀었는지까지 남긴다
-- 원본은 event 표의 풀이 이벤트(answer_submit · idk)다. 서버가 같은 요청 안에서 두 곳에 함께 쓰고, 이 표는 통계용으로 정리한 사본이다.
-- (학습 리포트 엔진 · 관리자 통계는 event의 행동 정보 vis · away · seen · rd · len … 를 읽는다)
CREATE TABLE IF NOT EXISTS submission (
  submission_id BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  client_id     VARCHAR(64)      NOT NULL,             -- = event.event_id (같은 풀이 이벤트와 1:1). 같은 제출이 두 번 와도 한 줄만
  session_id    VARCHAR(64)      NOT NULL DEFAULT '',  -- = event.session_id
  mode          VARCHAR(8)       NULL,                 -- focus 한 문제씩 | list 목록 (모르면 비움)
  device_id     VARCHAR(64)      NOT NULL,
  user_id       BIGINT UNSIGNED  NULL,                 -- 로그인했을 때만
  problem_id    BIGINT UNSIGNED  NOT NULL,
  version       INT UNSIGNED     NOT NULL,
  answer        TEXT             NOT NULL,             -- 고른 답(A, O …)이나 쓴 답
  is_correct    BOOLEAN          NOT NULL,
  attempt       SMALLINT UNSIGNED NOT NULL,            -- 이 기기가 이 문제를 몇 번째로 풀었나 (1 = 첫 시도)
  ms            INT UNSIGNED     NULL,                 -- 풀이 시간
  is_idk        BOOLEAN          NOT NULL DEFAULT FALSE,   -- "모르겠어요"
  is_self       BOOLEAN          NOT NULL DEFAULT FALSE,   -- 서술형 자기 채점
  submitted_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (submission_id),
  UNIQUE KEY uq_submission_client (client_id),
  KEY ix_submission_user (user_id, submitted_at),
  KEY ix_submission_device (device_id, problem_id, submitted_at),
  KEY ix_submission_problem (problem_id, version, attempt, is_correct),
  CONSTRAINT fk_submission_device  FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_submission_user    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT fk_submission_version FOREIGN KEY (problem_id, version) REFERENCES problem_version (problem_id, version),
  CONSTRAINT ck_submission_attempt CHECK (attempt >= 1),
  CONSTRAINT ck_submission_idk CHECK (NOT (is_idk AND is_correct)),  -- "모르겠어요"는 정답일 수 없다
  CONSTRAINT ck_submission_mode CHECK (mode IN ('focus', 'list'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 고침 (2026-11-01): 위 정의보다 먼저 만든 submission 표에 session_id · mode 칸과 mode 검사를 더한다.
-- MySQL은 ADD COLUMN IF NOT EXISTS가 없어서, 없을 때만 실행하도록 먼저 확인한다 (다시 실행해도 안전). 아래 뷰가 이 칸을 쓰므로 뷰보다 앞에 둔다
SET @q = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE submission ADD COLUMN session_id VARCHAR(40) NOT NULL DEFAULT '''' AFTER client_id', 'DO 0')
          FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'submission' AND column_name = 'session_id');
PREPARE st FROM @q; EXECUTE st; DEALLOCATE PREPARE st;
SET @q = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE submission ADD COLUMN mode VARCHAR(8) NULL AFTER session_id', 'DO 0')
          FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'submission' AND column_name = 'mode');
PREPARE st FROM @q; EXECUTE st; DEALLOCATE PREPARE st;
SET @q = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE submission ADD CONSTRAINT ck_submission_mode CHECK (mode IN (''focus'', ''list''))', 'DO 0')
          FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'submission' AND constraint_name = 'ck_submission_mode');
PREPARE st FROM @q; EXECUTE st; DEALLOCATE PREPARE st;

-- ───────── 통계 (조회할 때마다 계산하는 뷰) ─────────
-- 첫 시도 정답률 = 처음 푼 제출 중 맞힌 비율 (같은 문제를 여러 번 틀려도 왜곡되지 않음, 대표 값)
-- 제출 기준 정답률 = 모든 제출 중 맞힌 비율
CREATE OR REPLACE VIEW v_user_stats AS
SELECT u.user_id,
       u.nickname,
       COUNT(DISTINCT s.problem_id)                                         AS attempted,
       COUNT(DISTINCT CASE WHEN s.is_correct THEN s.problem_id END)         AS solved,
       COUNT(s.submission_id)                                               AS submissions,
       ROUND(100 * SUM(s.attempt = 1 AND s.is_correct) / NULLIF(SUM(s.attempt = 1), 0), 1) AS first_try_pct,
       ROUND(100 * SUM(s.is_correct) / NULLIF(COUNT(s.submission_id), 0), 1)               AS submit_pct,
       MAX(s.submitted_at)                                                  AS last_submitted_at
FROM users u
LEFT JOIN submission s ON s.user_id = u.user_id
WHERE u.deleted_at IS NULL
GROUP BY u.user_id, u.nickname;

-- 문제별: 지금 공개 중인 버전 기준 (고치기 전 버전의 기록은 섞지 않는다)
CREATE OR REPLACE VIEW v_problem_stats AS
SELECT p.problem_id,
       pv.version,
       c.code                                                               AS course_code,
       p.ext_id,
       pv.kind,
       p.difficulty,
       COUNT(DISTINCT s.device_id)                                          AS solvers,
       COUNT(s.submission_id)                                               AS submissions,
       ROUND(100 * SUM(s.attempt = 1 AND s.is_correct) / NULLIF(SUM(s.attempt = 1), 0), 1) AS first_try_pct,
       ROUND(100 * SUM(s.is_correct) / NULLIF(COUNT(s.submission_id), 0), 1)               AS submit_pct,
       ROUND(AVG(s.ms) / 1000, 1)                                           AS avg_sec
FROM problem p
JOIN course c           ON c.course_id = p.course_id
JOIN problem_version pv ON pv.problem_id = p.problem_id AND pv.version = p.current_version
LEFT JOIN submission s  ON s.problem_id = pv.problem_id AND s.version = pv.version
WHERE p.status = 'published'
GROUP BY p.problem_id, pv.version, c.code, p.ext_id, pv.kind, p.difficulty;

-- ═════════ 3단계: 학습 기록 · 수집 · 제보 · 커리큘럼 ═════════
-- 학습 기록의 주인은 기기(device). 로그인한 회원은 서버가 그 회원의 기기 기록을 합쳐 보여 준다.
-- 기기를 지워도 기록이 같이 지워지지 않게 외래 키에 CASCADE를 걸지 않는다 (지울 때는 확인받고 따로).

-- 내 강의실
CREATE TABLE IF NOT EXISTS enrollment (
  device_id  VARCHAR(64)  NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  sort       INT          NOT NULL DEFAULT 0,          -- 화면 순서
  added_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, course_id),
  KEY ix_enrollment_course (course_id),
  CONSTRAINT fk_enrollment_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_enrollment_course FOREIGN KEY (course_id) REFERENCES course (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 문제별 최신 상태 (화면을 빨리 그리기 위한 요약. 원본은 submission)
CREATE TABLE IF NOT EXISTS progress (
  device_id   VARCHAR(64)       NOT NULL,
  problem_id  BIGINT UNSIGNED   NOT NULL,
  version     INT UNSIGNED      NOT NULL,              -- 마지막으로 푼 버전
  status      VARCHAR(10)       NOT NULL,              -- correct 한 번에 맞힘 | wrong 오답 | resolved 다시 풀어 해결
  attempts    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  wrong_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_answer TEXT              NOT NULL DEFAULT (''),
  updated_at  DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, problem_id),
  KEY ix_progress_recent (device_id, status, updated_at),   -- 복습할 오답 (틀린 지 하루 지난 문제)
  KEY ix_progress_problem (problem_id),
  CONSTRAINT fk_progress_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_progress_problem FOREIGN KEY (problem_id) REFERENCES problem (problem_id),
  CONSTRAINT ck_progress_status CHECK (status IN ('correct', 'wrong', 'resolved')),
  CONSTRAINT ck_progress_attempts CHECK (attempts >= 1 AND wrong_count <= attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 이어 풀기 위치
CREATE TABLE IF NOT EXISTS resume (
  device_id  VARCHAR(64)     NOT NULL,
  scope_key  VARCHAR(255)    NOT NULL,                 -- 과목|단원|탭
  problem_id BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, scope_key),
  KEY ix_resume_problem (problem_id),
  CONSTRAINT fk_resume_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_resume_problem FOREIGN KEY (problem_id) REFERENCES problem (problem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 나중에 볼 문제 (문제 카드의 책갈피)
CREATE TABLE IF NOT EXISTS bookmark (
  device_id  VARCHAR(64)     NOT NULL,
  problem_id BIGINT UNSIGNED NOT NULL,
  added_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, problem_id),
  KEY ix_bookmark_problem (problem_id),
  CONSTRAINT fk_bookmark_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_bookmark_problem FOREIGN KEY (problem_id) REFERENCES problem (problem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 기기 이동 코드 (10분)
CREATE TABLE IF NOT EXISTS transfer_code (
  code       CHAR(6)     NOT NULL,
  device_id  VARCHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (code),
  KEY ix_transfer_expires (expires_at),                -- 만료된 코드 정리
  CONSTRAINT fk_transfer_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT ck_transfer_code CHECK (code REGEXP '^[0-9]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 과목별 시험일 (D-day). 과목당 하나
CREATE TABLE IF NOT EXISTS exam_date (
  device_id  VARCHAR(64)  NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  exam_on    DATE         NOT NULL,
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, course_id),
  KEY ix_exam_course (course_id),
  CONSTRAINT fk_exam_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_exam_course FOREIGN KEY (course_id) REFERENCES course (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ───────── 수집 · 제보 ─────────
-- 화면 행동 기록. 추가만 하고 고치지 않는다. 빨리 쌓도록 외래 키 없이 인덱스만.
-- 풀이 이벤트(answer_submit · idk)도 여기에 그대로 쌓는다: 학습 리포트 엔진 · 관리자 통계가 행동 정보를 여기서 읽는다.
-- submission은 같은 풀이를 통계용으로 정리한 사본 (submission.client_id = event_id)
CREATE TABLE IF NOT EXISTS event (
  event_id   VARCHAR(64)     NOT NULL,                 -- 브라우저가 만든 번호 (중복 전송 방지)
  seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,  -- 들어온 순서 (SQLite rowid 대신). 학습 리포트가 "마지막으로 본 이벤트 뒤로 몇 개"를 센다
  device_id  VARCHAR(64)     NOT NULL,
  session_id VARCHAR(64)     NOT NULL DEFAULT '',
  problem_id BIGINT UNSIGNED NULL,
  version    INT UNSIGNED    NULL,
  type       VARCHAR(30)     NOT NULL,
  client_ts  DATETIME(3)     NOT NULL,
  server_ts  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  payload    JSON            NOT NULL DEFAULT (JSON_OBJECT()),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_event_seq (seq),
  KEY ix_event_problem (problem_id, version, type),
  KEY ix_event_time (server_ts),
  KEY ix_event_device (device_id, type, problem_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 오류 제보
CREATE TABLE IF NOT EXISTS report (
  report_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id   VARCHAR(64)     NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  problem_id  BIGINT UNSIGNED NOT NULL,
  version     INT UNSIGNED    NOT NULL,
  category    VARCHAR(12)     NOT NULL,                -- answer 정답 | explanation 해설 | typo 오타 | other
  message     TEXT            NOT NULL DEFAULT (''),
  status      VARCHAR(10)     NOT NULL DEFAULT 'open', -- open | fixed | rejected
  admin_note  TEXT            NOT NULL DEFAULT (''),
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3)     NULL,
  PRIMARY KEY (report_id),
  KEY ix_report_status (status, created_at),
  KEY ix_report_problem (problem_id, version),
  KEY ix_report_device (device_id),
  CONSTRAINT fk_report_device  FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_report_user    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE SET NULL,
  CONSTRAINT fk_report_version FOREIGN KEY (problem_id, version) REFERENCES problem_version (problem_id, version),
  CONSTRAINT ck_report_category CHECK (category IN ('answer', 'explanation', 'typo', 'other')),
  CONSTRAINT ck_report_status CHECK (status IN ('open', 'fixed', 'rejected')),
  CONSTRAINT ck_report_resolved CHECK ((status = 'open') = (resolved_at IS NULL))   -- 처리한 제보만 처리 시각이 있다
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- AI 채점 도우미 기록 (서술형 답안 전문 + AI 판정 + 사용자가 마지막에 누른 판정)
CREATE TABLE IF NOT EXISTS ai_grade (
  ai_grade_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id    VARCHAR(64)     NOT NULL,
  problem_id   BIGINT UNSIGNED NOT NULL,
  version      INT UNSIGNED    NOT NULL,
  answer       TEXT            NOT NULL,               -- 4,000자까지
  result       JSON            NOT NULL,               -- { verdict, points:[{i, verdict, reason}], feedback }
  model        VARCHAR(60)     NOT NULL,
  ms           INT UNSIGNED    NOT NULL DEFAULT 0,     -- AI가 답하는 데 걸린 시간
  user_verdict VARCHAR(10)     NULL,                   -- correct | wrong (AI와 사람 판정 일치율)
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ai_grade_id),
  KEY ix_ai_grade_problem (problem_id, version),
  KEY ix_ai_grade_device (device_id, problem_id),
  CONSTRAINT fk_ai_grade_device  FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_ai_grade_version FOREIGN KEY (problem_id, version) REFERENCES problem_version (problem_id, version),
  CONSTRAINT ck_ai_grade_answer CHECK (CHAR_LENGTH(answer) <= 4000),
  CONSTRAINT ck_ai_grade_verdict CHECK (user_verdict IN ('correct', 'wrong'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ───────── 커리큘럼 (둘러보기 화면의 학년 · 학기 체계도) ─────────
CREATE TABLE IF NOT EXISTS curriculum_item (
  item_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  program_code VARCHAR(20)  NOT NULL DEFAULT 'IE',     -- 학과 (다른 학과 커리큘럼도 넣을 수 있게)
  item_code    VARCHAR(30)  NOT NULL,                  -- calc, ds1 … (바꾸지 않는다)
  name         VARCHAR(100) NOT NULL,
  year         TINYINT UNSIGNED NOT NULL,
  term         TINYINT UNSIGNED NOT NULL,
  kind         VARCHAR(4)   NOT NULL,                  -- base 전공기초 | req 전공필수 | opt 전공선택
  sort         INT          NOT NULL DEFAULT 0,
  visible      BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (item_id),
  UNIQUE KEY uq_curriculum_code (program_code, item_code),
  KEY ix_curriculum_list (program_code, year, term, sort),
  CONSTRAINT ck_curriculum_year CHECK (year BETWEEN 1 AND 4),
  CONSTRAINT ck_curriculum_term CHECK (term BETWEEN 1 AND 2),
  CONSTRAINT ck_curriculum_kind CHECK (kind IN ('base', 'req', 'opt'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 먼저 들으면 좋은 과목 (체계도의 화살표: pre_item → item)
CREATE TABLE IF NOT EXISTS curriculum_prereq (
  item_id     INT UNSIGNED NOT NULL,
  pre_item_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (item_id, pre_item_id),
  KEY ix_prereq_pre (pre_item_id),                     -- "다음에 이어지는 과목" 찾기
  CONSTRAINT fk_prereq_item FOREIGN KEY (item_id) REFERENCES curriculum_item (item_id),
  CONSTRAINT fk_prereq_pre  FOREIGN KEY (pre_item_id) REFERENCES curriculum_item (item_id),
  CONSTRAINT ck_prereq_self CHECK (item_id <> pre_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 커리큘럼 칸 ↔ 실제 과목. 과목 코드로 이어서 학기가 바뀌어 같은 과목이 새로 올라와도 자동으로 연결된다
-- (course.code는 학기마다 겹칠 수 있어 외래 키는 걸 수 없다. 연결이 없는 칸은 화면에서 "준비 중")
CREATE TABLE IF NOT EXISTS curriculum_course (
  item_id     INT UNSIGNED NOT NULL,
  course_code VARCHAR(20)  NOT NULL,
  PRIMARY KEY (item_id, course_code),
  KEY ix_curriculum_course_code (course_code),
  CONSTRAINT fk_curriculum_course_item FOREIGN KEY (item_id) REFERENCES curriculum_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ═════════ 4단계: 학습 리포트 · AI 운영 ═════════
-- 개념(kc) · 세부 포인트(facet) · 착각(misc) 코드는 한 번 만들면 바꾸지 않는다. 없앨 때는 status = 'retired'.
-- 외래 키에 CASCADE를 걸지 않아서, 딸린 세부 포인트 · 착각 · 태그가 있으면 상위 코드를 지울 수 없다.
-- 태깅 단계(stage) · AI 사용 목적(purpose)은 값이 늘어나는 중이라 값 목록 제약을 걸지 않는다.
--   지금 쓰는 값: stage = vocab, merge, tag, verify, contrast, gold, second, third, family
--               purpose = grade, narr, insight_diag, tag, verify, vocab, other

-- 개념 (과목마다 10~30개)
CREATE TABLE IF NOT EXISTS kc (
  course_id    INT UNSIGNED NOT NULL,
  code         VARCHAR(64)  NOT NULL,                  -- c01 … 또는 저자 코드 disrupt (바꾸지 않는다)
  parent       VARCHAR(64)  NULL,                      -- 상위 개념
  chapter_keys JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  name         VARCHAR(100) NOT NULL,
  definition   TEXT         NOT NULL DEFAULT (''),
  boundary     TEXT         NOT NULL DEFAULT (''),                  -- 어디까지가 이 개념인지
  confusable   JSON         NOT NULL DEFAULT (JSON_ARRAY()),   -- 헷갈리는 개념 코드
  source       VARCHAR(10)  NOT NULL,                  -- topic | author | llm | admin
  status       VARCHAR(10)  NOT NULL DEFAULT 'draft',  -- draft | active | retired
  merged_into  VARCHAR(64)  NULL,
  vocab_ver    INT UNSIGNED NOT NULL,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (course_id, code),
  CONSTRAINT fk_kc_course FOREIGN KEY (course_id) REFERENCES course (course_id),
  CONSTRAINT ck_kc_source CHECK (source IN ('topic', 'author', 'llm', 'admin')),
  CONSTRAINT ck_kc_status CHECK (status IN ('draft', 'active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 세부 포인트: 시험에서 틀릴 수 있는 한 문장
CREATE TABLE IF NOT EXISTS facet (
  course_id   INT UNSIGNED NOT NULL,
  code        VARCHAR(100) NOT NULL,                   -- <개념>.<세부> (세부는 30자 이내)
  kc          VARCHAR(64)  NOT NULL,
  name        VARCHAR(40)  NOT NULL,                   -- 20자 이하
  statement   VARCHAR(200) NOT NULL,                   -- 바른 진술 90자 이하
  kind        VARCHAR(12)  NOT NULL DEFAULT 'property',
  confusable  JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  sort        INT          NOT NULL DEFAULT 0,
  source      VARCHAR(10)  NOT NULL,                   -- author | llm | admin
  status      VARCHAR(10)  NOT NULL DEFAULT 'draft',   -- draft | active | retired
  merged_into VARCHAR(100) NULL,
  vocab_ver   INT UNSIGNED NOT NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (course_id, code),
  KEY ix_facet_kc (course_id, kc),
  CONSTRAINT fk_facet_kc FOREIGN KEY (course_id, kc) REFERENCES kc (course_id, code),
  CONSTRAINT ck_facet_name CHECK (CHAR_LENGTH(name) <= 20),
  CONSTRAINT ck_facet_statement CHECK (CHAR_LENGTH(statement) <= 90),
  CONSTRAINT ck_facet_kind CHECK (kind IN ('def', 'property', 'condition', 'procedure', 'relation', 'distinction')),
  CONSTRAINT ck_facet_source CHECK (source IN ('author', 'llm', 'admin')),
  CONSTRAINT ck_facet_status CHECK (status IN ('draft', 'active', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 착각 목록 ("~라고 생각함"). 모든 학습자가 같이 쓴다
CREATE TABLE IF NOT EXISTS misc (
  course_id   INT UNSIGNED NOT NULL,
  code        VARCHAR(48)  NOT NULL,                   -- m001 … 또는 저자 코드 m_disrupt_highend (41자 이내, 다시 쓰지 않는다)
  chapter_key VARCHAR(30)  NOT NULL DEFAULT '',
  kc          VARCHAR(64)  NOT NULL,
  cw          VARCHAR(64)  NULL,                       -- 헷갈린 상대 개념 ("A를 B와 혼동")
  facet       VARCHAR(100) NULL,                       -- 이 착각이 비트는 세부 포인트
  belief      VARCHAR(140) NOT NULL,                   -- 학생 생각 70자 이하
  truth       VARCHAR(180) NOT NULL DEFAULT '',        -- 바른 진술 90자 이하
  contrast    VARCHAR(300) NOT NULL DEFAULT '',        -- 두 줄 "A는 …\nB는 …"
  cue         VARCHAR(100) NOT NULL DEFAULT '',        -- 풀 때 할 행동 50자 이하
  src         VARCHAR(10)  NOT NULL DEFAULT 'llm',     -- llm | author | admin
  status      VARCHAR(10)  NOT NULL DEFAULT 'auto',    -- auto | ok | rejected | retired
  vocab_ver   INT UNSIGNED NOT NULL,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (course_id, code),
  KEY ix_misc_kc (course_id, kc),
  KEY ix_misc_facet (course_id, facet),
  CONSTRAINT fk_misc_kc    FOREIGN KEY (course_id, kc) REFERENCES kc (course_id, code),
  CONSTRAINT fk_misc_facet FOREIGN KEY (course_id, facet) REFERENCES facet (course_id, code),
  CONSTRAINT ck_misc_len CHECK (CHAR_LENGTH(belief) <= 70 AND CHAR_LENGTH(truth) <= 90 AND CHAR_LENGTH(cue) <= 50),
  CONSTRAINT ck_misc_src CHECK (src IN ('llm', 'author', 'admin')),
  CONSTRAINT ck_misc_status CHECK (status IN ('auto', 'ok', 'rejected', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 문제 버전마다 진단 태그: 개념 비중 · 세부 포인트 · 깊이 · 보기별 착각 · 확신도
CREATE TABLE IF NOT EXISTS item_tag (
  problem_id BIGINT UNSIGNED  NOT NULL,
  version    INT UNSIGNED     NOT NULL,
  course_id  INT UNSIGNED     NOT NULL,                -- facet과 잇고 과목별로 빨리 찾으려고 둔다
  body_hash  VARCHAR(64)      NOT NULL,                -- 문제 내용 지문 sha1 16진수 40자 (내용이 바뀌면 태그가 낡은 것)
  vocab_ver  INT UNSIGNED     NOT NULL,
  prompt_ver INT UNSIGNED     NOT NULL,
  model      VARCHAR(60)      NOT NULL,
  kcs        JSON             NOT NULL,                -- [["c07",0.7],["c03",0.3]] 합 1
  diag       JSON             NOT NULL,                -- 보기별 착각 등 (opt_misc, wrong_misc …)
  qa         JSON             NOT NULL DEFAULT (JSON_OBJECT()),
  review     VARCHAR(10)      NOT NULL DEFAULT 'auto', -- auto | accepted | edited | rejected | stale
  facet      VARCHAR(100)     NULL,
  depth      TINYINT UNSIGNED NULL,                    -- 1 정의 · 2 적용 · 3 구별 · 4 조건
  src        VARCHAR(10)      NOT NULL DEFAULT 'llm',  -- author | llm | admin (admin 태그는 덮어쓰지 않는다)
  conf       TINYINT UNSIGNED NOT NULL DEFAULT 2,      -- 1 낮음 · 2 두 판단 일치 · 3 해설이 근거
  updated_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (problem_id, version),
  KEY ix_item_tag_facet (course_id, facet),
  CONSTRAINT fk_item_tag_version FOREIGN KEY (problem_id, version) REFERENCES problem_version (problem_id, version),
  CONSTRAINT fk_item_tag_course  FOREIGN KEY (course_id) REFERENCES course (course_id),
  CONSTRAINT fk_item_tag_facet   FOREIGN KEY (course_id, facet) REFERENCES facet (course_id, code),
  CONSTRAINT ck_item_tag_review CHECK (review IN ('auto', 'accepted', 'edited', 'rejected', 'stale')),
  CONSTRAINT ck_item_tag_depth CHECK (depth BETWEEN 1 AND 4),
  CONSTRAINT ck_item_tag_src CHECK (src IN ('author', 'llm', 'admin')),
  CONSTRAINT ck_item_tag_conf CHECK (conf BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 변형 묶음: 같은 세부 포인트를 같은 원리로 바꿔 낸 문제끼리
CREATE TABLE IF NOT EXISTS family (
  course_id       INT UNSIGNED    NOT NULL,
  code            VARCHAR(64)     NOT NULL,            -- F001 … 또는 저자가 정한 이름 disrupt
  facet           VARCHAR(100)    NOT NULL,
  base_problem_id BIGINT UNSIGNED NULL,                -- 기준 문제
  principle       VARCHAR(200)    NOT NULL DEFAULT '', -- 모든 변형이 지키는 것, 90자 이하
  source          VARCHAR(10)     NOT NULL,
  status          VARCHAR(10)     NOT NULL DEFAULT 'auto',   -- auto | ok | rejected
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (course_id, code),
  KEY ix_family_facet (course_id, facet),
  CONSTRAINT fk_family_facet FOREIGN KEY (course_id, facet) REFERENCES facet (course_id, code),
  CONSTRAINT fk_family_base  FOREIGN KEY (base_problem_id) REFERENCES problem (problem_id),
  CONSTRAINT ck_family_principle CHECK (CHAR_LENGTH(principle) <= 90),
  CONSTRAINT ck_family_status CHECK (status IN ('auto', 'ok', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 묶음에 속한 문제 (문제 하나는 묶음 하나에만)
CREATE TABLE IF NOT EXISTS family_member (
  problem_id BIGINT UNSIGNED  NOT NULL,
  course_id  INT UNSIGNED     NOT NULL,
  family     VARCHAR(64)      NOT NULL,
  role       VARCHAR(5)       NOT NULL,                -- base 기준 | iso 같은 깊이 변형 | near 한 가지만 바꾼 변형
  delta_type VARCHAR(10)      NULL,                    -- 기준 문제만 비어 있다
  delta      VARCHAR(80)      NOT NULL DEFAULT '',     -- 기준에서 바뀐 점, 40자 이하
  body_hash  VARCHAR(64)      NOT NULL,                -- sha1 16진수 40자. 지금 버전의 지문과 다르면 묶음이 낡은 것
  source     VARCHAR(10)      NOT NULL,
  conf       TINYINT UNSIGNED NOT NULL DEFAULT 2,
  updated_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (problem_id),
  KEY ix_family_member_f (course_id, family),
  CONSTRAINT fk_family_member_problem FOREIGN KEY (problem_id) REFERENCES problem (problem_id),
  CONSTRAINT fk_family_member_family  FOREIGN KEY (course_id, family) REFERENCES family (course_id, code),
  CONSTRAINT ck_family_member_role CHECK (role IN ('base', 'iso', 'near')),
  CONSTRAINT ck_family_member_delta CHECK (delta_type IN ('surface', 'repr', 'object', 'condition', 'qualifier', 'reverse', 'neighbour', 'combine')),
  CONSTRAINT ck_family_member_base CHECK ((role = 'base') = (delta_type IS NULL)),
  CONSTRAINT ck_family_member_dlen CHECK (CHAR_LENGTH(delta) <= 40),
  CONSTRAINT ck_family_member_conf CHECK (conf BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 기기 · 과목마다 만들어 둔 학습 리포트 (계산 결과 + AI가 쓴 설명)
CREATE TABLE IF NOT EXISTS insight (
  device_id  VARCHAR(64)  NOT NULL,
  course_id  INT UNSIGNED NOT NULL,
  fp         VARCHAR(64)  NOT NULL,                    -- 다시 만들지 판단하는 지문
  state      VARCHAR(8)   NOT NULL,                    -- locked | ready
  det        JSON         NOT NULL,                    -- 계산된 리포트 (6~12KB)
  ev_hash    VARCHAR(64)  NULL,
  narr       TEXT         NULL,
  narr_model VARCHAR(60)  NULL,
  narr_at    DATETIME(3)  NULL,
  narr_n     INT UNSIGNED NULL,                        -- 설명을 만들 때의 유효 풀이 수
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (device_id, course_id),
  KEY ix_insight_course (course_id),
  CONSTRAINT fk_insight_device FOREIGN KEY (device_id) REFERENCES device (device_id),
  CONSTRAINT fk_insight_course FOREIGN KEY (course_id) REFERENCES course (course_id),
  CONSTRAINT ck_insight_state CHECK (state IN ('locked', 'ready'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 문제별 첫 풀이 (예전 item_first 표 대신 submission에서 계산)
CREATE OR REPLACE VIEW v_item_first AS
SELECT s.problem_id, s.version, s.device_id, s.user_id,
       s.is_correct AS y, s.answer AS opt, s.ms, s.mode, s.is_idk, DATE(s.submitted_at) AS day
FROM submission s
WHERE s.attempt = 1;

-- ───────── AI 운영 ─────────
-- 태깅 작업 대기열
CREATE TABLE IF NOT EXISTS tag_job (
  job_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id   INT UNSIGNED    NOT NULL,
  stage       VARCHAR(20)     NOT NULL,                -- 값 목록은 맨 위 주석
  ref         TEXT            NOT NULL,                -- 단원 키, 또는 "pid:v,pid:v,…" 묶음
  state       VARCHAR(8)      NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  lease_until DATETIME(3)     NULL,
  tries       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error  TEXT            NULL,
  model       VARCHAR(60)     NULL,
  tok_in      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tok_out     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (job_id),
  KEY ix_tag_job_q (state, course_id, stage),
  CONSTRAINT fk_tag_job_course FOREIGN KEY (course_id) REFERENCES course (course_id),
  CONSTRAINT ck_tag_job_state CHECK (state IN ('queued', 'running', 'done', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 날짜 · 모델 · 목적별 AI 사용량 (하루 = 미국 서부 날짜, Gemini 한도 기준)
CREATE TABLE IF NOT EXISTS ai_budget (
  day       DATE            NOT NULL,
  model     VARCHAR(60)     NOT NULL,
  purpose   VARCHAR(20)     NOT NULL,                  -- 값 목록은 맨 위 주석
  calls     INT UNSIGNED    NOT NULL DEFAULT 0,
  tok_in    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tok_out   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tok_think BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model, purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 한도 초과(429) · 없는 모델(404)로 잠시 막힌 모델 (SQLite의 until은 MySQL 예약어라 이름을 바꿈)
CREATE TABLE IF NOT EXISTS ai_block (
  model         VARCHAR(60)  NOT NULL,
  blocked_until DATETIME(3)  NOT NULL,
  why           VARCHAR(200) NOT NULL,
  PRIMARY KEY (model)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 여러 서버가 같이 보는 설정 값 · 버전 카운터 (tag_rev:<과목>, vocab_ver:<과목>, calib_rev …)
CREATE TABLE IF NOT EXISTS insight_meta (
  meta_key VARCHAR(100) NOT NULL,                      -- SQLite의 key (MySQL 예약어라 이름을 바꿈)
  value    MEDIUMTEXT   NOT NULL,                      -- 단원별 어휘 초안 JSON도 들어간다
  PRIMARY KEY (meta_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ═════════ 고침 (2026-10-30): 코드 칸 길이 늘리기 ═════════
-- 처음 설계 때 자동 태깅 코드(m001, F001)만 보고 길이를 정해, 작성자가 붙이는 코드(m_disrupt_highend 등)가 들어가지 않았다.
-- 위의 표 정의는 이미 고쳤고, 아래는 그전에 만든 표를 같은 길이로 맞춘다. 길이를 늘리기만 해서 데이터는 그대로다.
-- 외래 키로 이어진 칸을 함께 바꾸는 동안만 외래 키 검사를 끄고 바로 다시 켠다. 다시 실행해도 안전하다.
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE kc            MODIFY code VARCHAR(64) NOT NULL, MODIFY parent VARCHAR(64) NULL, MODIFY merged_into VARCHAR(64) NULL;
ALTER TABLE facet         MODIFY code VARCHAR(100) NOT NULL, MODIFY kc VARCHAR(64) NOT NULL, MODIFY merged_into VARCHAR(100) NULL;
ALTER TABLE misc          MODIFY code VARCHAR(48) NOT NULL, MODIFY kc VARCHAR(64) NOT NULL, MODIFY cw VARCHAR(64) NULL, MODIFY facet VARCHAR(100) NULL;
ALTER TABLE item_tag      MODIFY facet VARCHAR(100) NULL;
ALTER TABLE family        MODIFY code VARCHAR(64) NOT NULL, MODIFY facet VARCHAR(100) NOT NULL;
ALTER TABLE family_member MODIFY family VARCHAR(64) NOT NULL;
ALTER TABLE insight_meta  MODIFY value MEDIUMTEXT NOT NULL;
-- 고침 (2026-11-01): 문제 내용 지문은 sha1 16진수 40자 (처음엔 20자 지문 함수만 보고 24자로 잡았다)
ALTER TABLE item_tag      MODIFY body_hash VARCHAR(64) NOT NULL;
ALTER TABLE family_member MODIFY body_hash VARCHAR(64) NOT NULL;
-- 고침 (2026-11-01): 서버가 받는 이벤트 번호 · 세션 번호는 64자까지 (isId 16~64자, session_id 64자)
ALTER TABLE event      MODIFY event_id VARCHAR(64) NOT NULL, MODIFY session_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE submission MODIFY client_id VARCHAR(64) NOT NULL, MODIFY session_id VARCHAR(64) NOT NULL DEFAULT '';
SET FOREIGN_KEY_CHECKS = 1;

-- 고침 (2026-11-01): 이벤트가 들어온 순서 seq (SQLite rowid 대신). 학습 리포트가 이 번호로 "새 풀이가 몇 개 쌓였나"를 센다
-- 이미 있는 event 표에만 더한다 (없을 때만 실행, 다시 실행해도 안전)
SET @q = (SELECT IF(COUNT(*) = 0, 'ALTER TABLE event ADD COLUMN seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT AFTER event_id, ADD UNIQUE KEY uq_event_seq (seq)', 'DO 0')
          FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'event' AND column_name = 'seq');
PREPARE st FROM @q; EXECUTE st; DEALLOCATE PREPARE st;

-- 고침 (2026-11-01): SQLite에서 기본값이 있던 칸은 MySQL에서도 같은 기본값 (서버 코드가 이 칸을 빼고 넣는 곳이 있다: report.admin_note, kc.boundary)
-- 글자(TEXT) · JSON 칸은 식 기본값 ('') · (JSON_OBJECT())로 준다 (MySQL 8.0.13 이상). 같은 정의로 다시 실행해도 안전
ALTER TABLE course   MODIFY info JSON NOT NULL DEFAULT (JSON_OBJECT());
ALTER TABLE chapter  MODIFY info JSON NOT NULL DEFAULT (JSON_OBJECT());
ALTER TABLE progress MODIFY last_answer TEXT NOT NULL DEFAULT ('');
ALTER TABLE report   MODIFY message TEXT NOT NULL DEFAULT (''), MODIFY admin_note TEXT NOT NULL DEFAULT ('');
ALTER TABLE kc       MODIFY definition TEXT NOT NULL DEFAULT (''), MODIFY boundary TEXT NOT NULL DEFAULT ('');
