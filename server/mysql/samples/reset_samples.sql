-- 샘플 데이터 지우기 (seed.sql · seed_step3.sql · seed_step4.sql로 넣은 것만)
-- ⚠ DELETE 명령이 들어 있다. 규칙에 따라 실행 전에 확인받는다.
-- 표를 통째로 비우지 않고 "샘플 표시가 있는 줄"만 지운다 → 실제 데이터가 들어간 뒤 실수로 다시 실행해도 실제 데이터는 남는다.
--   샘플 표시: 과목 코드 SAMPLE-STAT, 기기 번호 sample-*, 회원 이메일 *@example.com(샘플 아이디 5개), AI 운영 표의 샘플 줄
-- 커리큘럼(curriculum_*)은 실제 데이터라 건드리지 않는다. 외래 키 순서대로(아래 표부터) 지우고, 한 트랜잭션으로 묶는다.
SET NAMES utf8mb4;
USE problem_solving_site;
START TRANSACTION;

SET @c = (SELECT course_id FROM course WHERE code = 'SAMPLE-STAT');

-- 학습 기록 · 수집 · 제보 (샘플 기기)
DELETE FROM ai_grade      WHERE device_id LIKE 'sample-%';
DELETE FROM report        WHERE device_id LIKE 'sample-%';
DELETE FROM event         WHERE device_id LIKE 'sample-%';
DELETE FROM bookmark      WHERE device_id LIKE 'sample-%';
DELETE FROM resume        WHERE device_id LIKE 'sample-%';
DELETE FROM progress      WHERE device_id LIKE 'sample-%';
DELETE FROM enrollment    WHERE device_id LIKE 'sample-%';
DELETE FROM exam_date     WHERE device_id LIKE 'sample-%';
DELETE FROM transfer_code WHERE device_id LIKE 'sample-%';
DELETE FROM insight       WHERE device_id LIKE 'sample-%';
DELETE FROM submission    WHERE device_id LIKE 'sample-%';

-- 진단 (샘플 과목)
DELETE FROM family_member WHERE course_id = @c;
DELETE FROM family        WHERE course_id = @c;
DELETE FROM item_tag      WHERE course_id = @c;
DELETE FROM misc          WHERE course_id = @c;
DELETE FROM facet         WHERE course_id = @c;
DELETE FROM kc            WHERE course_id = @c;
DELETE FROM tag_job       WHERE course_id = @c;

-- AI 운영 (seed_step4.sql의 샘플 줄과 정확히 같은 것만)
DELETE FROM ai_budget    WHERE day = '2026-10-29' AND model = 'gemini-flash-latest' AND purpose IN ('grade', 'narr') AND calls = 1;
DELETE FROM ai_block     WHERE model = 'gemini-2.5-pro' AND why = 'PerDay 429' AND blocked_until = '2026-10-30 07:00:00.000';
DELETE FROM insight_meta WHERE (meta_key, value) IN (('tag_rev:1', '3'), ('vocab_ver:1', '1'), ('calib_rev', '1'));

-- 콘텐츠 (샘플 과목)
DELETE FROM problem_version WHERE problem_id IN (SELECT problem_id FROM problem WHERE course_id = @c);
DELETE FROM problem  WHERE course_id = @c;
DELETE FROM chapter  WHERE course_id = @c;
DELETE FROM course   WHERE course_id = @c;
DELETE FROM semester WHERE code = '26-2' AND NOT EXISTS (SELECT 1 FROM course WHERE course.semester_id = semester.semester_id);   -- 다른 과목이 없을 때만

-- 기기 · 회원
DELETE FROM device WHERE device_id LIKE 'sample-%';
DELETE FROM users  WHERE email LIKE '%@example.com'
                     AND login_id IN ('minji_kim', 'junho_lee', 'seoyeon_park', 'dohyun_choi', 'haeun_jung');

COMMIT;
