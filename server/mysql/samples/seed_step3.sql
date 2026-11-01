-- 3단계 테스트용 샘플 (seed.sql의 샘플 기기·문제·과목을 쓴다). 실제 사람 기록이 아니다.
-- 한 번만 실행한다 (같은 기본 키가 있으면 중복 오류).
SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE problem_solving_site;
START TRANSACTION;

INSERT INTO enrollment (device_id, course_id, sort, added_at) VALUES
 ('sample-minji-phone', 1, 0, '2026-10-21 11:59:00.000'),
 ('sample-junho',       1, 0, '2026-10-18 20:59:00.000'),
 ('sample-seoyeon',     1, 0, '2026-10-23 08:59:00.000');

-- 제출 기록(submission)과 맞춘 최신 상태
INSERT INTO progress (device_id, problem_id, version, status, attempts, wrong_count, last_answer, updated_at) VALUES
 ('sample-minji-phone', 1, 1, 'correct',  1, 0, 'A', '2026-10-21 12:00:00.000'),
 ('sample-minji-phone', 5, 1, 'resolved', 2, 1, 'X', '2026-10-22 08:30:00.000'),
 ('sample-junho',       5, 1, 'wrong',    1, 1, 'O', '2026-10-18 21:04:00.000'),
 ('sample-junho',       7, 1, 'wrong',    1, 1, 'O', '2026-10-19 20:02:30.000'),
 ('sample-dohyun',      8, 1, 'wrong',    1, 1, 'β', '2026-10-26 23:08:00.000'),
 ('sample-seoyeon',     4, 1, 'wrong',    1, 1, 'A', '2026-10-23 09:04:00.000');

INSERT INTO resume (device_id, scope_key, problem_id, updated_at) VALUES
 ('sample-minji-phone', '1|C1|solve', 5, '2026-10-22 08:30:00.000'),
 ('sample-junho',       '1|C2|solve', 7, '2026-10-19 20:02:30.000');

INSERT INTO bookmark (device_id, problem_id, added_at) VALUES
 ('sample-junho',  6, '2026-10-19 20:01:30.000'),
 ('sample-dohyun', 5, '2026-10-26 23:02:30.000');

INSERT INTO transfer_code (code, device_id, expires_at) VALUES
 ('482913', 'sample-minji-phone', '2026-10-24 19:10:00.000');

INSERT INTO exam_date (device_id, course_id, exam_on) VALUES
 ('sample-minji-phone', 1, '2026-11-05'),
 ('sample-junho',       1, '2026-11-05');

INSERT INTO event (event_id, device_id, session_id, problem_id, version, type, client_ts, server_ts, payload) VALUES
 ('e01', 'sample-junho',   'ss1', 6,    1,    'bookmark', '2026-10-19 20:01:30.000', '2026-10-19 20:01:31.000', JSON_OBJECT('on', TRUE)),
 ('e02', 'sample-junho',   'ss1', NULL, NULL, 'session',  '2026-10-19 20:05:00.000', '2026-10-19 20:05:01.000', JSON_OBJECT('sec', 900)),
 ('e03', 'sample-dohyun',  'ss2', 8,    1,    'ai_copy',  '2026-10-26 23:08:30.000', '2026-10-26 23:08:31.000', JSON_OBJECT('st', 'wrong'));

INSERT INTO report (device_id, user_id, problem_id, version, category, message, status, admin_note, created_at, resolved_at) VALUES
 ('sample-junho',  2, 6, 1, 'typo',   '문제가 너무 짧아서 무엇을 묻는지 헷갈려요', 'fixed', '버전 2에서 문장을 고쳤어요', '2026-10-19 20:03:00.000', '2026-10-20 10:00:00.000'),
 ('sample-dohyun', 4, 8, 1, 'answer', 'alpha 말고 a로 써도 정답 처리해 주세요',   'open',  '',                          '2026-10-26 23:09:00.000', NULL);

INSERT INTO ai_grade (device_id, problem_id, version, answer, result, model, ms, user_verdict, created_at) VALUES
 ('sample-seoyeon', 10, 1,
  '제1종 오류는 맞는 귀무가설을 기각하는 것이고 제2종 오류는 틀린 귀무가설을 받아들이는 것이다. 예: 무고한 사람을 유죄로 판결',
  JSON_OBJECT('verdict', 'correct', 'points', JSON_ARRAY(JSON_OBJECT('i', 0, 'verdict', 'covered'), JSON_OBJECT('i', 1, 'verdict', 'covered'), JSON_OBJECT('i', 2, 'verdict', 'covered')),
              'feedback', '세 채점 포인트가 모두 들어 있어요'),
  'gemini-flash-latest', 4200, 'correct', '2026-10-29 09:27:30.000');

COMMIT;
