-- 4단계 테스트용 샘플 (seed.sql의 샘플 과목 1 · 문제 1~10 · 기기를 쓴다). 실제 진단 데이터가 아니다.
-- 한 번만 실행한다 (같은 기본 키가 있으면 중복 오류).
SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE problem_solving_site;
START TRANSACTION;

-- 개념 2개
INSERT INTO kc (course_id, code, chapter_keys, name, definition, boundary, source, status, vocab_ver, updated_at) VALUES
 (1, 'c01', JSON_ARRAY('C1'), '기술통계', '자료의 중심 · 퍼짐 · 관계를 숫자로 요약하는 방법', '추론(검정 · 추정)은 포함하지 않는다', 'author', 'active', 1, '2026-10-12 09:00:00.000'),
 (1, 'c02', JSON_ARRAY('C2'), '가설검정', '표본으로 모집단에 대한 가설을 판단하는 절차', '신뢰구간 계산 자체는 포함하지 않는다', 'author', 'active', 1, '2026-10-12 09:00:00.000');

-- 세부 포인트 3개
INSERT INTO facet (course_id, code, kc, name, statement, kind, sort, source, status, vocab_ver, updated_at) VALUES
 (1, 'c01.1', 'c01', '중앙값의 정의', '중앙값은 자료를 크기 순으로 놓았을 때 가운데 오는 값이다', 'def', 1, 'author', 'active', 1, '2026-10-12 09:10:00.000'),
 (1, 'c01.2', 'c01', '상관과 독립', '상관계수 0은 선형 관계가 없다는 뜻일 뿐 독립을 뜻하지 않는다', 'distinction', 2, 'author', 'active', 1, '2026-10-12 09:10:00.000'),
 (1, 'c02.1', 'c02', 'p-값의 뜻', 'p-값은 귀무가설이 참일 때 지금 이상으로 극단적인 결과가 나올 확률이다', 'def', 1, 'author', 'active', 1, '2026-10-12 09:10:00.000');

-- 착각 3개
INSERT INTO misc (course_id, code, chapter_key, kc, cw, facet, belief, truth, contrast, cue, src, status, vocab_ver, updated_at) VALUES
 (1, 'm001', 'C1', 'c01', NULL, 'c01.2', '상관계수가 0이면 두 변수가 독립이라고 생각함', '상관 0은 선형 관계가 없다는 뜻이고, 독립은 그보다 강한 조건이다',
  '상관 0은 직선 관계가 없음\n독립은 어떤 관계도 없음', '"독립"이 나오면 비선형 관계를 떠올리기', 'author', 'ok', 1, '2026-10-12 09:20:00.000'),
 (1, 'm002', 'C2', 'c02', NULL, 'c02.1', 'p-값을 귀무가설이 참일 확률이라고 생각함', 'p-값은 귀무가설이 참이라고 놓고 계산한 결과의 확률이다',
  'p-값은 자료의 확률\n귀무가설의 확률이 아님', '"~일 확률"의 조건이 무엇인지 확인하기', 'author', 'ok', 1, '2026-10-12 09:20:00.000'),
 (1, 'm003', 'C1', 'c01', NULL, 'c01.1', '중앙값을 평균과 같은 것이라고 생각함', '중앙값은 가운데 값, 평균은 합을 개수로 나눈 값이다',
  '중앙값은 순서로 정함\n평균은 합으로 정함', '먼저 크기 순으로 놓았는지 확인하기', 'author', 'ok', 1, '2026-10-12 09:20:00.000');

-- 문제 태그 (opt_misc = 객관식 보기 순서대로 그 보기를 고르면 드러나는 착각, wrong_misc = O/X를 틀리면 드러나는 착각)
INSERT INTO item_tag (problem_id, version, course_id, body_hash, vocab_ver, prompt_ver, model, kcs, diag, review, facet, depth, src, conf, updated_at) VALUES
 (1, 1, 1, 'sample-hash-p1v1', 1, 1, 'author', JSON_ARRAY(JSON_ARRAY('c01', 1)), JSON_OBJECT('opt_misc', JSON_ARRAY(NULL, 'm003', NULL, NULL)), 'accepted', 'c01.1', 1, 'author', 3, '2026-10-12 10:00:00.000'),
 (3, 1, 1, 'sample-hash-p3v1', 1, 1, 'author', JSON_ARRAY(JSON_ARRAY('c01', 1)), JSON_OBJECT(), 'accepted', 'c01.1', 3, 'author', 3, '2026-10-12 10:00:00.000'),
 (5, 1, 1, 'sample-hash-p5v1', 1, 1, 'author', JSON_ARRAY(JSON_ARRAY('c01', 1)), JSON_OBJECT('wrong_misc', 'm001'), 'accepted', 'c01.2', 3, 'author', 3, '2026-10-12 10:00:00.000'),
 (7, 1, 1, 'sample-hash-p7v1', 1, 1, 'author', JSON_ARRAY(JSON_ARRAY('c02', 1)), JSON_OBJECT('wrong_misc', 'm002'), 'accepted', 'c02.1', 1, 'author', 3, '2026-10-12 10:00:00.000'),
 (6, 2, 1, 'sample-hash-p6v2', 1, 1, 'gemini-flash-latest', JSON_ARRAY(JSON_ARRAY('c02', 1)), JSON_OBJECT(), 'auto', NULL, 2, 'llm', 2, '2026-10-20 11:00:00.000');

-- 변형 묶음 1개: 중앙값 문제(기준)와, 이웃 개념(범위)으로 바꿔치기한 변형
INSERT INTO family (course_id, code, facet, base_problem_id, principle, source, status, updated_at) VALUES
 (1, 'F001', 'c01.1', 1, '자료를 크기 순으로 놓고 위치로 값을 정한다', 'author', 'ok', '2026-10-12 10:10:00.000');
INSERT INTO family_member (problem_id, course_id, family, role, delta_type, delta, body_hash, source, conf, updated_at) VALUES
 (1, 1, 'F001', 'base', NULL,        '',              'sample-hash-p1v1', 'author', 3, '2026-10-12 10:10:00.000'),
 (3, 1, 'F001', 'near', 'neighbour', '중앙값 → 범위', 'sample-hash-p3v1', 'author', 3, '2026-10-12 10:10:00.000');

-- 학습 리포트 1개 (준호, 샘플 과목)
INSERT INTO insight (device_id, course_id, fp, state, det, updated_at) VALUES
 ('sample-junho', 1, 'sample-fp-junho', 'ready',
  JSON_OBJECT('n_eff', 7, 'misc', JSON_ARRAY('m001', 'm002', 'm003'), 'weak', JSON_ARRAY('c02.1')), '2026-10-20 08:00:00.000');

-- AI 운영
INSERT INTO tag_job (course_id, stage, ref, state, tries, model, tok_in, tok_out, created_at, updated_at) VALUES
 (1, 'vocab', 'C1', 'done',   1, 'gemini-flash-latest', 3200, 900, '2026-10-12 08:00:00.000', '2026-10-12 08:01:00.000'),
 (1, 'tag',   '6:2', 'queued', 0, NULL, 0, 0, '2026-10-20 10:05:00.000', '2026-10-20 10:05:00.000');
INSERT INTO ai_budget (day, model, purpose, calls, tok_in, tok_out, tok_think) VALUES
 ('2026-10-29', 'gemini-flash-latest', 'grade', 1, 1200, 300, 150),
 ('2026-10-29', 'gemini-flash-latest', 'narr',  1, 4800, 700, 400);
INSERT INTO ai_block (model, blocked_until, why) VALUES
 ('gemini-2.5-pro', '2026-10-30 07:00:00.000', 'PerDay 429');
INSERT INTO insight_meta (meta_key, value) VALUES
 ('tag_rev:1', '3'), ('vocab_ver:1', '1'), ('calib_rev', '1');

COMMIT;
