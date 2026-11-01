-- 통계 쿼리 예시 (읽기만 한다)
USE problem_solving_site;

-- 1. 회원별 정답률: 첫 시도 정답률 높은 순
SELECT nickname          AS 회원,
       attempted         AS 시도한_문제,
       solved            AS 맞힌_문제,
       submissions       AS 제출,
       first_try_pct     AS 첫시도_정답률,
       submit_pct        AS 제출기준_정답률,
       DATE_FORMAT(last_submitted_at, '%m-%d %H:%i') AS 마지막_제출_UTC
FROM v_user_stats
ORDER BY first_try_pct DESC, solved DESC;

-- 2. 문제별 정답률: 어려운 문제(첫 시도 정답률 낮은 순)부터. 지금 공개 중인 버전 기준
SELECT ext_id            AS 문제,
       version           AS 버전,
       kind              AS 유형,
       difficulty        AS 난이도,
       solvers           AS 푼_기기,
       submissions       AS 제출,
       first_try_pct     AS 첫시도_정답률,
       submit_pct        AS 제출기준_정답률,
       avg_sec           AS 평균_초
FROM v_problem_stats
ORDER BY first_try_pct IS NULL, first_try_pct, ext_id;
