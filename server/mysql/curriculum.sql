-- 산업경영공학과 커리큘럼 (학과 이수 체계도, 데모 사이트 web/js/curriculum.js와 같은 내용). 실제 데이터
-- 다시 실행해도 안전하다: 같은 학과·코드가 있으면 이름·학년·학기·분류·순서만 고친다
SET NAMES utf8mb4;
USE problem_solving_site;
START TRANSACTION;

INSERT INTO curriculum_item (program_code, item_code, name, year, term, kind, sort) VALUES
 ('IE', 'calc',    '미분적분학',           1, 1, 'base', 1),
 ('IE', 'ieintro', '산업경영공학의 이해',   1, 1, 'base', 2),
 ('IE', 'phys',    '일반물리',             1, 2, 'base', 1),
 ('IE', 'prog',    '기초프로그래밍',       1, 2, 'base', 2),
 ('IE', 'em1',     '공학수학 1',           2, 1, 'base', 1),
 ('IE', 'ds1',     '데이터사이언스 1',     2, 1, 'opt',  2),
 ('IE', 'pdms',    '제품개발및제조시스템', 2, 1, 'opt',  3),
 ('IE', 'expstat', '실험통계학',           2, 1, 'base', 4),
 ('IE', 'db',      '데이터베이스',         2, 1, 'opt',  5),
 ('IE', 'econ',    '경제성공학',           2, 1, 'opt',  6),
 ('IE', 'ergo',    '인간공학',             2, 1, 'opt',  7),
 ('IE', 'em2',     '공학수학 2',           2, 2, 'base', 1),
 ('IE', 'ds2',     '데이터사이언스 2',     2, 2, 'opt',  2),
 ('IE', 'pom',     '생산경영론',           2, 2, 'opt',  3),
 ('IE', 'appstat', '응용통계학',           2, 2, 'base', 4),
 ('IE', 'mis',     '경영정보시스템',       2, 2, 'opt',  5),
 ('IE', 'htmkt',   '하이테크마케팅',       2, 2, 'opt',  6),
 ('IE', 'ms1',     '경영과학 1',           3, 1, 'req',  1),
 ('IE', 'dm1',     '데이터마이닝 1',       3, 1, 'opt',  2),
 ('IE', 'scm',     '공급사슬관리',         3, 1, 'opt',  3),
 ('IE', 'qe',      '품질공학',             3, 1, 'opt',  4),
 ('IE', 'fe',      '금융공학',             3, 1, 'opt',  5),
 ('IE', 'mot',     '기술경영',             3, 1, 'opt',  6),
 ('IE', 'ms2',     '경영과학 2',           3, 2, 'opt',  1),
 ('IE', 'dm2',     '데이터마이닝 2',       3, 2, 'opt',  2),
 ('IE', 'isdd',    '정보시스템설계및개발', 3, 2, 'opt',  3),
 ('IE', 'logi',    '물류관리',             3, 2, 'opt',  4),
 ('IE', 'iot',     '사물인터넷',           3, 2, 'opt',  5),
 ('IE', 'ai',      '인공지능',             3, 2, 'opt',  6),
 ('IE', 'motda',   '기술경영데이터분석',   3, 2, 'opt',  7),
 ('IE', 'hci',     '인간컴퓨터인터페이스', 3, 2, 'opt',  8),
 ('IE', 'sds',     '서비스데이터사이언스', 4, 1, 'opt',  1),
 ('IE', 'cad',     'CAD/CAM',              4, 1, 'opt',  2),
 ('IE', 'sim',     '컴퓨터시뮬레이션',     4, 1, 'opt',  3),
 ('IE', 'ml',      '머신러닝',             4, 1, 'opt',  4),
 ('IE', 'beda',    '경영경제데이터분석',   4, 1, 'opt',  5),
 ('IE', 'cap1',    '창의적종합설계 1',     4, 1, 'req',  6),
 ('IE', 'algo',    '산업경영알고리즘',     4, 2, 'opt',  1),
 ('IE', 'tcomm',   '기술사업화',           4, 2, 'opt',  2),
 ('IE', 'safety',  '작업및안전관리',       4, 2, 'opt',  3),
 ('IE', 'cap2',    '창의적종합설계 2',     4, 2, 'req',  4)
AS n
ON DUPLICATE KEY UPDATE name = n.name, year = n.year, term = n.term, kind = n.kind, sort = n.sort;

-- 선수 과목 (체계도 화살표: 먼저 → 나중)
INSERT IGNORE INTO curriculum_prereq (item_id, pre_item_id)
SELECT a.item_id, b.item_id
FROM (SELECT 'ds1' item, 'prog' pre UNION ALL SELECT 'ds2', 'ds1' UNION ALL SELECT 'appstat', 'expstat'
      UNION ALL SELECT 'dm1', 'ds2' UNION ALL SELECT 'qe', 'appstat' UNION ALL SELECT 'dm2', 'dm1'
      UNION ALL SELECT 'isdd', 'prog' UNION ALL SELECT 'hci', 'ergo' UNION ALL SELECT 'sim', 'appstat'
      UNION ALL SELECT 'cap2', 'appstat') e
JOIN curriculum_item a ON a.program_code = 'IE' AND a.item_code = e.item
JOIN curriculum_item b ON b.program_code = 'IE' AND b.item_code = e.pre;

-- 문제가 올라와 있는 과목 연결 (플랫폼 과목 코드)
INSERT IGNORE INTO curriculum_course (item_id, course_code)
SELECT i.item_id, e.code
FROM (SELECT 'em2' item, 'LA2' code UNION ALL SELECT 'pom', 'IE216'
      UNION ALL SELECT 'appstat', 'IE208' UNION ALL SELECT 'mis', 'MIS'
      UNION ALL SELECT 'expstat', 'IE207' UNION ALL SELECT 'ms1', 'IE301' UNION ALL SELECT 'ms2', 'IE302') e
JOIN curriculum_item i ON i.program_code = 'IE' AND i.item_code = e.item;

COMMIT;
