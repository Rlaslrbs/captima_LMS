-- 3단계 표로 화면에 쓸 조회 예시 (읽기만 한다)
USE problem_solving_site;

-- 1. 둘러보기 2학년 탭: 학기별 과목 칸, 분류(전공기초 → 전공필수 → 전공선택) 순, 문제가 있는지
SELECT i.term AS 학기,
       CASE i.kind WHEN 'base' THEN '전공기초' WHEN 'req' THEN '전공필수' ELSE '전공선택' END AS 분류,
       i.name AS 과목,
       COALESCE(GROUP_CONCAT(cc.course_code), '준비 중') AS 연결된_과목코드
FROM curriculum_item i
LEFT JOIN curriculum_course cc ON cc.item_id = i.item_id
WHERE i.program_code = 'IE' AND i.year = 2 AND i.visible
GROUP BY i.item_id, i.term, i.kind, i.name, i.sort
ORDER BY i.term, FIELD(i.kind, 'base', 'req', 'opt'), i.sort;

-- 2. 응용통계학 칸을 눌렀을 때: 먼저 들으면 좋은 과목 / 다음에 이어지는 과목
SELECT '먼저 들으면 좋은 과목' AS 구분, p.name AS 과목, CONCAT(p.year, '-', p.term) AS 학년_학기
FROM curriculum_item i JOIN curriculum_prereq r ON r.item_id = i.item_id JOIN curriculum_item p ON p.item_id = r.pre_item_id
WHERE i.item_code = 'appstat'
UNION ALL
SELECT '다음에 이어지는 과목', n.name, CONCAT(n.year, '-', n.term)
FROM curriculum_item i JOIN curriculum_prereq r ON r.pre_item_id = i.item_id JOIN curriculum_item n ON n.item_id = r.item_id
WHERE i.item_code = 'appstat';

-- 3. 홈의 "복습할 오답": 틀린 지 하루가 지난 문제 (기준 시각 2026-10-30 00:00 UTC로 고정해 결과가 바뀌지 않게)
SELECT d.nickname AS 기기_주인, c.short AS 과목, p.ext_id AS 문제,
       DATE_FORMAT(g.updated_at, '%m-%d %H:%i') AS 틀린_시각,
       TIMESTAMPDIFF(DAY, g.updated_at, '2026-10-30 00:00:00') AS 지난_일수
FROM progress g
JOIN device d  ON d.device_id = g.device_id
JOIN problem p ON p.problem_id = g.problem_id
JOIN course c  ON c.course_id = p.course_id
WHERE g.status = 'wrong' AND g.updated_at <= '2026-10-30 00:00:00' - INTERVAL 1 DAY
ORDER BY g.updated_at;

-- 4. 관리자 제보함: 아직 처리 안 한 제보
SELECT r.report_id AS 번호, p.ext_id AS 문제, r.version AS 버전, r.category AS 분류, r.message AS 내용,
       DATE_FORMAT(r.created_at, '%m-%d %H:%i') AS 접수
FROM report r JOIN problem p ON p.problem_id = r.problem_id
WHERE r.status = 'open'
ORDER BY r.created_at;
