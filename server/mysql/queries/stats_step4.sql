-- 4단계 표로 진단 탭 · 학습 리포트에 쓸 조회 예시 (읽기만 한다)
USE problem_solving_site;

-- 1. 진단 탭: 세부 포인트별 태그 붙은 문제 수와 깊이 분포 (지금 공개 중인 버전 기준)
SELECT f.code AS 세부포인트, f.name AS 이름,
       COUNT(t.problem_id)  AS 문제수,
       SUM(t.depth = 1)     AS 깊이1_정의,
       SUM(t.depth = 2)     AS 깊이2_적용,
       SUM(t.depth = 3)     AS 깊이3_구별,
       SUM(t.depth = 4)     AS 깊이4_조건
FROM facet f
LEFT JOIN item_tag t ON t.course_id = f.course_id AND t.facet = f.code
LEFT JOIN problem p  ON p.problem_id = t.problem_id
WHERE f.course_id = 1 AND f.status <> 'retired' AND (t.problem_id IS NULL OR t.version = p.current_version)
GROUP BY f.code, f.name
ORDER BY f.code;

-- 2. 착각: 틀린 답이 드러내는 착각을 학생별로. 서로 다른 문제 2개 이상에서 같은 착각이어야 "착각"으로 판정, 아니면 판단 보류
WITH wrong AS (
  SELECT s.device_id, s.problem_id,
         CASE
           WHEN pv.kind = 'mc' AND s.answer REGEXP '^[A-D]$'
             THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(t.diag, CONCAT('$.opt_misc[', ASCII(s.answer) - 65, ']'))), 'null')
           WHEN pv.kind = 'ox' THEN JSON_UNQUOTE(JSON_EXTRACT(t.diag, '$.wrong_misc'))
         END AS misc_code
  FROM submission s
  JOIN problem_version pv ON pv.problem_id = s.problem_id AND pv.version = s.version
  JOIN item_tag t         ON t.problem_id = s.problem_id AND t.version = s.version
  WHERE NOT s.is_correct AND NOT s.is_idk
)
SELECT COALESCE(d.nickname, '손님') AS 학생, w.misc_code AS 착각, m.belief AS 내용,
       COUNT(DISTINCT w.problem_id) AS 드러난_문제수,
       IF(COUNT(DISTINCT w.problem_id) >= 2, '착각', '판단 보류 (확인 문제 필요)') AS 판정
FROM wrong w
JOIN device d ON d.device_id = w.device_id
JOIN misc m   ON m.course_id = 1 AND m.code = w.misc_code
WHERE w.misc_code IS NOT NULL
GROUP BY d.nickname, w.misc_code, m.belief
ORDER BY 학생, 착각;

-- 3. 변형 묶음: 기준 문제는 맞히는데 변형에서 무너지는지 (첫 풀이 정답률)
SELECT fm.family AS 묶음, p.ext_id AS 문제, fm.role AS 역할, fm.delta AS 바뀐_점,
       COUNT(v.device_id) AS 첫풀이_수,
       ROUND(100 * AVG(v.y), 1) AS 첫풀이_정답률
FROM family_member fm
JOIN problem p ON p.problem_id = fm.problem_id
LEFT JOIN v_item_first v ON v.problem_id = p.problem_id AND v.version = p.current_version
WHERE fm.course_id = 1
GROUP BY fm.family, p.ext_id, fm.role, fm.delta
ORDER BY fm.family, FIELD(fm.role, 'base', 'iso', 'near');
