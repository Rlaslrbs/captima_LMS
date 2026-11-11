-- 문제노트 플랫폼 DB 구조 (SQLite. 나중에 Postgres로 옮길 때도 그대로 쓰도록 표준 타입만 사용)
PRAGMA foreign_keys = ON;

-- ───────── 콘텐츠 ─────────
CREATE TABLE IF NOT EXISTS semester (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,          -- 26-2
  name       TEXT NOT NULL,                 -- 2026년 2학기
  sort       INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS course (
  id         INTEGER PRIMARY KEY,
  semester_id INTEGER NOT NULL REFERENCES semester(id),
  code       TEXT NOT NULL,                 -- MIS
  short      TEXT NOT NULL,
  name       TEXT NOT NULL,
  professor  TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '',
  info       TEXT NOT NULL DEFAULT '{}',    -- JSON: color, lang, math, files, concepts, topics(있을 때만)
  sort       INTEGER NOT NULL DEFAULT 0,
  visible    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (semester_id, code)
);

CREATE TABLE IF NOT EXISTS chapter (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES course(id),
  key        TEXT NOT NULL,
  title      TEXT NOT NULL,
  short      TEXT NOT NULL DEFAULT '',
  grp        TEXT NOT NULL DEFAULT '',
  info       TEXT NOT NULL DEFAULT '{}',
  sort       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (course_id, key)
);

CREATE TABLE IF NOT EXISTS problem (
  id         INTEGER PRIMARY KEY,
  course_id  INTEGER NOT NULL REFERENCES course(id),
  chapter_id INTEGER NOT NULL REFERENCES chapter(id),
  ext_id     TEXT NOT NULL,                 -- 원래 문제 번호 (1-1, tf12 …)
  sort       INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'published',   -- published | hidden
  UNIQUE (course_id, ext_id)
);

CREATE TABLE IF NOT EXISTS problem_version (
  id         INTEGER PRIMARY KEY,
  problem_id INTEGER NOT NULL REFERENCES problem(id),
  version    INTEGER NOT NULL,
  kind       TEXT NOT NULL,                 -- ox | mc | short | essay
  star       INTEGER NOT NULL DEFAULT 0,
  body       TEXT NOT NULL,                 -- JSON: 문제·보기·정답·해설·출처 …
  note       TEXT NOT NULL DEFAULT '',      -- 바꾼 이유
  created_at TEXT NOT NULL,
  UNIQUE (problem_id, version)
);

-- ───────── 사용자 (로그인 없음: 기기 ID) ─────────
CREATE TABLE IF NOT EXISTS device (
  id         TEXT PRIMARY KEY,              -- 브라우저가 만든 익명 ID
  nickname   TEXT NOT NULL DEFAULT '',
  consent    INTEGER NOT NULL DEFAULT 0,    -- 풀이 기록 수집 동의
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollment (     -- 내 강의실
  device_id  TEXT NOT NULL REFERENCES device(id),
  course_id  INTEGER NOT NULL REFERENCES course(id),
  sort       INTEGER NOT NULL DEFAULT 0,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (device_id, course_id)
);

CREATE TABLE IF NOT EXISTS progress (
  device_id  TEXT NOT NULL REFERENCES device(id),
  problem_id INTEGER NOT NULL REFERENCES problem(id),
  version    INTEGER NOT NULL,
  status     TEXT NOT NULL,                 -- correct | wrong | resolved
  attempts   INTEGER NOT NULL DEFAULT 1,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_answer TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, problem_id)
);

CREATE TABLE IF NOT EXISTS resume (         -- 이어 풀기 위치
  device_id  TEXT NOT NULL REFERENCES device(id),
  scope_key  TEXT NOT NULL,
  problem_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, scope_key)
);

CREATE TABLE IF NOT EXISTS transfer_code (  -- 기기 이동 코드 (10분)
  code       TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES device(id),
  expires_at TEXT NOT NULL
);

-- ───────── 수집 · 제보 ─────────
CREATE TABLE IF NOT EXISTS event (          -- 추가만 하고 고치지 않는다
  id         TEXT PRIMARY KEY,              -- 브라우저가 만든 ID (중복 전송 방지)
  device_id  TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  problem_id INTEGER,
  version    INTEGER,
  type       TEXT NOT NULL,
  client_ts  TEXT NOT NULL,
  server_ts  TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS event_problem ON event(problem_id, version, type);
CREATE INDEX IF NOT EXISTS event_time ON event(server_ts);

CREATE TABLE IF NOT EXISTS report (
  id         INTEGER PRIMARY KEY,
  device_id  TEXT NOT NULL,
  problem_id INTEGER NOT NULL REFERENCES problem(id),
  version    INTEGER NOT NULL,
  category   TEXT NOT NULL,                 -- answer | explanation | typo | other
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open',  -- open | fixed | rejected
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS report_status ON report(status, created_at);

CREATE TABLE IF NOT EXISTS bookmark (       -- 나중에 볼 문제 (문제 카드의 ☆)
  device_id  TEXT NOT NULL REFERENCES device(id),
  problem_id INTEGER NOT NULL REFERENCES problem(id),
  added_at   TEXT NOT NULL,
  PRIMARY KEY (device_id, problem_id)
);

CREATE TABLE IF NOT EXISTS ai_grade (       -- AI 채점 도우미 기록 (서술형 답안 전문 + AI 판정). 나중에 채점 모델을 학습·비교할 자료
  id         INTEGER PRIMARY KEY,
  device_id  TEXT NOT NULL,
  problem_id INTEGER NOT NULL REFERENCES problem(id),
  version    INTEGER NOT NULL,
  answer     TEXT NOT NULL,                 -- 학생 답안 전문 (최대 4000자)
  result     TEXT NOT NULL,                 -- JSON: { verdict, points:[{i, verdict, reason}], feedback }
  model      TEXT NOT NULL,
  ms         INTEGER NOT NULL DEFAULT 0,    -- AI가 답하는 데 걸린 시간
  user_verdict TEXT,                        -- 사용자가 마지막에 누른 판정 (correct / wrong). 일치율 계산용
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_grade_problem ON ai_grade(problem_id, version);

-- ───────── 학습 리포트 (insight) ─────────
CREATE TABLE IF NOT EXISTS insight_meta (          -- cross-process revision counters (tag_rev:<cid>, vocab_ver:<cid>, calib_rev, budget flags)
  key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS kc (                    -- concept vocabulary
  course_id INTEGER NOT NULL REFERENCES course(id),
  code TEXT NOT NULL,                              -- stable, never renumbered: c01… (tagger) or the pack topic key (det); facet codes are "<kc>.<f>"
  parent TEXT,                                     -- 공수 child KC → topic code
  chapter_keys TEXT NOT NULL DEFAULT '[]',         -- JSON ["3.1-2", …]
  name TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '', boundary TEXT NOT NULL DEFAULT '',
  confusable TEXT NOT NULL DEFAULT '[]',           -- JSON [code]
  source TEXT NOT NULL,                            -- topic | author | llm | admin
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | active | retired
  merged_into TEXT, vocab_ver INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS misc (                  -- misconception catalog, shared by all learners
  course_id INTEGER NOT NULL, code TEXT NOT NULL,  -- m001…
  chapter_key TEXT NOT NULL DEFAULT '',
  kc TEXT NOT NULL, cw TEXT,                       -- cw = confused-with KC ("A를 B와 혼동")
  belief TEXT NOT NULL,                            -- learner view "~라고 생각함" ≤ 70자
  truth TEXT NOT NULL DEFAULT '',                  -- 바른 진술 ≤ 90자
  contrast TEXT NOT NULL DEFAULT '',               -- 2줄 "A는 …\nB는 …"
  cue TEXT NOT NULL DEFAULT '',                    -- 풀 때 할 행동 ≤ 50자
  src TEXT NOT NULL DEFAULT 'llm',                 -- llm | author | admin
  status TEXT NOT NULL DEFAULT 'auto',             -- auto | ok | rejected | retired (code never reused)
  vocab_ver INTEGER NOT NULL, updated_at TEXT NOT NULL,
  facet TEXT,                                      -- v2: the goal facet this belief distorts (db.js adds it to old DBs)
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS item_tag (
  problem_id INTEGER NOT NULL, version INTEGER NOT NULL,
  body_hash TEXT NOT NULL, vocab_ver INTEGER NOT NULL, prompt_ver INTEGER NOT NULL, model TEXT NOT NULL,
  kcs TEXT NOT NULL,                               -- [["c07",0.7],["c03",0.3]]  Σ=1
  diag TEXT NOT NULL,                              -- §8.2.4
  qa TEXT NOT NULL DEFAULT '{}',                   -- {cycle:{"1":true,…}, fit:{c07:"yes"}, gold:bool}
  review TEXT NOT NULL DEFAULT 'auto',             -- auto | accepted | edited | rejected | stale
  updated_at TEXT NOT NULL,
  facet TEXT, depth INTEGER,                       -- v2: primary facet, depth 1 정의 · 2 적용 · 3 구별 · 4 조건
  src TEXT NOT NULL DEFAULT 'llm',                 -- v2: author | llm | admin (admin rows are never overwritten)
  conf INTEGER NOT NULL DEFAULT 2,                 -- v2: 1..3 tag trust (DATA §8.5)
  PRIMARY KEY (problem_id, version)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tag_job (
  id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL,
  stage TEXT NOT NULL,                             -- vocab | merge | tag | verify | contrast | gold
  ref TEXT NOT NULL,                               -- chapter key, or "pid:v,pid:v,…" batch
  state TEXT NOT NULL DEFAULT 'queued',            -- queued | running | done | failed
  lease_until TEXT, tries INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  model TEXT, tok_in INTEGER NOT NULL DEFAULT 0, tok_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tag_job_q ON tag_job(state, course_id, stage);

CREATE TABLE IF NOT EXISTS insight (               -- last deterministic report + narrative per device/course
  device_id TEXT NOT NULL, course_id INTEGER NOT NULL,
  fp TEXT NOT NULL, state TEXT NOT NULL,           -- locked | ready
  det TEXT NOT NULL,                               -- JSON (≈ 6–12 KB)
  ev_hash TEXT, narr TEXT, narr_model TEXT, narr_at TEXT, narr_n INTEGER,   -- narr_n = n_eff when generated
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, course_id)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ai_budget (             -- persisted daily usage, Pacific day
  day TEXT NOT NULL, model TEXT NOT NULL, purpose TEXT NOT NULL,   -- grade | narr | tag | verify | vocab
  calls INTEGER NOT NULL DEFAULT 0, tok_in INTEGER NOT NULL DEFAULT 0,
  tok_out INTEGER NOT NULL DEFAULT 0, tok_think INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model, purpose)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ai_block (              -- model exhausted until (PerDay 429) or missing (404)
  model TEXT PRIMARY KEY, until TEXT NOT NULL, why TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS item_first (            -- (P5) first event-level attempt per device per item version
  problem_id INTEGER NOT NULL, version INTEGER NOT NULL, device_id TEXT NOT NULL,
  y REAL NOT NULL, opt INTEGER, ms INTEGER, mode TEXT, day INTEGER NOT NULL,
  PRIMARY KEY (problem_id, version, device_id)) WITHOUT ROWID;

-- ───────── 학습 리포트 v2: 세부 포인트 · 변형 묶음 (docs/insight/v2/DATA.md §5) ─────────
-- kc · facet · misc codes are stable forever: a rename keeps the code, a retirement sets status 'retired' and the code is never reused.
CREATE TABLE IF NOT EXISTS facet (                 -- 세부 포인트 (goal facet)
  course_id INTEGER NOT NULL REFERENCES course(id),
  code TEXT NOT NULL,                              -- "<kc>.<f>"  det.swap
  kc TEXT NOT NULL,
  name TEXT NOT NULL,                              -- ≤ 20자
  statement TEXT NOT NULL,                         -- 바른 진술 ≤ 90자
  kind TEXT NOT NULL DEFAULT 'property',           -- def | property | condition | procedure | relation | distinction
  confusable TEXT NOT NULL DEFAULT '[]',           -- JSON [facet code]
  sort INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                            -- author | llm | admin
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | active | retired
  merged_into TEXT, vocab_ver INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS family (                -- 변형 묶음: 같은 세부 포인트, 같은 원리
  course_id INTEGER NOT NULL, code TEXT NOT NULL,  -- F001… (tagger) or the author's id
  facet TEXT NOT NULL,
  base_problem_id INTEGER,
  principle TEXT NOT NULL DEFAULT '',              -- what every member keeps fixed, ≤ 90자
  source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'auto',   -- auto | ok | rejected
  updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS family_member (
  problem_id INTEGER PRIMARY KEY REFERENCES problem(id),        -- one family per problem
  course_id INTEGER NOT NULL, family TEXT NOT NULL,
  role TEXT NOT NULL,                              -- base | iso | near
  delta_type TEXT,                                 -- null for base; surface | repr | object | condition | qualifier | reverse | neighbour | combine
  delta TEXT NOT NULL DEFAULT '',                  -- what changed vs base, learner-readable ≤ 40자
  body_hash TEXT NOT NULL,                         -- membership is stale when the current version's hash differs
  source TEXT NOT NULL, conf INTEGER NOT NULL DEFAULT 2, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS family_member_f ON family_member(course_id, family);
-- item_tag_facet index: created in db.js after the column migration

CREATE INDEX IF NOT EXISTS event_device ON event(device_id, type, problem_id);
CREATE INDEX IF NOT EXISTS ai_grade_device ON ai_grade(device_id, problem_id);   -- 학습 리포트: 기기의 서술형 채점 기록 (지문·기록 읽기)
