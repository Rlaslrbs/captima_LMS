-- 테스트용 샘플 데이터: 회원 5명, 기기 7개(회원 기기 6 + 비회원 1), 과목 1개 · 단원 2개, 문제 10개(버전 11개), 제출 30개
-- 실제 사람 · 실제 비밀번호가 아니다. password_hash는 형식만 흉내 낸 가짜 값이라 로그인에 쓸 수 없다.
-- 한 번만 실행한다 (번호를 정해서 넣으므로 두 번 실행하면 중복 오류).
SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE problem_solving_site;
START TRANSACTION;

-- ───────── 회원 ─────────
INSERT INTO users (user_id, login_id, email, password_hash, nickname, created_at) VALUES
 (1, 'minji_kim',   'minji@example.com',   '$2b$12$SAMPLEONLYsampleonlysampleonlysampleonlysampleo1', '민지',   '2026-10-01 09:00:00.000'),
 (2, 'junho_lee',   'junho@example.com',   '$2b$12$SAMPLEONLYsampleonlysampleonlysampleonlysampleo2', '준호',   '2026-10-02 10:30:00.000'),
 (3, 'seoyeon_park','seoyeon@example.com', '$2b$12$SAMPLEONLYsampleonlysampleonlysampleonlysampleo3', '서연',   '2026-10-03 11:15:00.000'),
 (4, 'dohyun_choi', 'dohyun@example.com',  '$2b$12$SAMPLEONLYsampleonlysampleonlysampleonlysampleo4', '도현',   '2026-10-05 14:00:00.000'),
 (5, 'haeun_jung',  'haeun@example.com',   '$2b$12$SAMPLEONLYsampleonlysampleonlysampleonlysampleo5', '하은',   '2026-10-07 16:45:00.000');

-- 민지는 폰과 노트북 두 기기, 마지막 기기는 로그인 안 한 손님
INSERT INTO device (device_id, user_id, nickname, consent, created_at, last_seen) VALUES
 ('sample-minji-phone',  1, '민지', TRUE,  '2026-10-01 09:01:00.000', '2026-10-28 22:10:00.000'),
 ('sample-minji-laptop', 1, '민지', TRUE,  '2026-10-10 13:00:00.000', '2026-10-29 15:00:00.000'),
 ('sample-junho',        2, '준호', TRUE,  '2026-10-02 10:31:00.000', '2026-10-27 20:00:00.000'),
 ('sample-seoyeon',      3, '서연', TRUE,  '2026-10-03 11:16:00.000', '2026-10-29 09:30:00.000'),
 ('sample-dohyun',       4, '도현', TRUE,  '2026-10-05 14:01:00.000', '2026-10-26 23:40:00.000'),
 ('sample-haeun',        5, '하은', TRUE,  '2026-10-07 16:46:00.000', '2026-10-25 12:00:00.000'),
 ('sample-guest',     NULL, '',     FALSE, '2026-10-20 08:00:00.000', '2026-10-20 08:05:00.000');

-- ───────── 콘텐츠 ─────────
INSERT INTO semester (semester_id, code, name, sort) VALUES (1, '26-2', '2026년 2학기', 0);

INSERT INTO course (course_id, semester_id, code, short, name, professor, meta, info, sort) VALUES
 (1, 1, 'SAMPLE-STAT', '샘플통계', '샘플 통계학', '', '테스트용 샘플 과목',
  JSON_OBJECT('color', JSON_OBJECT('light', '#0d6b6b', 'dark', '#6cc7c2'), 'lang', 'ko', 'math', FALSE), 0);

INSERT INTO chapter (chapter_id, course_id, chapter_key, title, short, info, sort) VALUES
 (1, 1, 'C1', '1장 · 기술통계', '기술통계', JSON_OBJECT(), 1),
 (2, 1, 'C2', '2장 · 가설검정', '가설검정', JSON_OBJECT(), 2);

-- 문제 6번만 버전 2 (문장을 고침): 버전 1과 2의 기록이 따로 남는지 확인용
INSERT INTO problem (problem_id, course_id, chapter_id, ext_id, sort, current_version, difficulty, author_id, created_at) VALUES
 (1,  1, 1, '1-1', 1, 1, 1, 1,    '2026-10-10 09:00:00.000'),
 (2,  1, 1, '1-2', 2, 1, 1, 1,    '2026-10-10 09:05:00.000'),
 (3,  1, 1, '1-3', 3, 1, 2, 1,    '2026-10-10 09:10:00.000'),
 (4,  1, 1, '1-4', 4, 1, 2, NULL, '2026-10-10 09:15:00.000'),
 (5,  1, 1, '1-5', 5, 1, 3, NULL, '2026-10-10 09:20:00.000'),
 (6,  1, 2, '2-1', 1, 2, 2, 1,    '2026-10-10 09:25:00.000'),
 (7,  1, 2, '2-2', 2, 1, 2, NULL, '2026-10-10 09:30:00.000'),
 (8,  1, 2, '2-3', 3, 1, 3, NULL, '2026-10-10 09:35:00.000'),
 (9,  1, 2, '2-4', 4, 1, 4, NULL, '2026-10-10 09:40:00.000'),
 (10, 1, 2, '2-5', 5, 1, NULL, NULL, '2026-10-10 09:45:00.000');

INSERT INTO problem_version (problem_id, version, kind, star, body, note, created_at) VALUES
 (1, 1, 'mc', FALSE, JSON_OBJECT('q', '자료 2, 3, 3, 8, 9의 중앙값(median)은?', 'opts', JSON_ARRAY('3', '5', '8', '2.5'), 'ans', 0,
    's', '크기 순으로 놓았을 때 가운데 값이 중앙값이다.'), '', '2026-10-10 09:00:00.000'),
 (2, 1, 'ox', FALSE, JSON_OBJECT('q', '표본분산(sample variance)은 편차 제곱합을 n−1로 나눈다.', 'ox', TRUE,
    's', '자유도 n−1로 나누어야 모분산의 불편추정량이 된다.'), '', '2026-10-10 09:05:00.000'),
 (3, 1, 'short', FALSE, JSON_OBJECT('q', '자료 1, 2, 3, 4, 5의 범위(range)는?', 'a', '4', 'accept', JSON_ARRAY('4'),
    's', '범위 = 최댓값 − 최솟값 = 5 − 1 = 4'), '', '2026-10-10 09:10:00.000'),
 (4, 1, 'mc', FALSE, JSON_OBJECT('q', '오른쪽으로 꼬리가 긴(양의 왜도) 분포에서 흔히 성립하는 관계는?', 'opts',
    JSON_ARRAY('평균 < 중앙값', '평균 > 중앙값', '평균 = 중앙값', '알 수 없다'), 'ans', 1,
    's', '큰 값 쪽 꼬리가 평균을 끌어올린다.'), '', '2026-10-10 09:15:00.000'),
 (5, 1, 'ox', TRUE, JSON_OBJECT('q', '상관계수가 0이면 두 변수는 독립이다.', 'ox', FALSE,
    'fix', '상관계수가 0이면 선형 관계가 없을 뿐, 독립이라고는 할 수 없다.', 's', '상관계수는 선형 관계만 잰다.<p>함정: 상관 0 = 독립이라고 생각함</p>'),
    '', '2026-10-10 09:20:00.000'),
 (6, 1, 'mc', TRUE, JSON_OBJECT('q', 'α = 0.05 양측 검정에서 Z = 2.31이면?', 'opts',
    JSON_ARRAY('귀무가설을 채택한다', '귀무가설을 기각한다', '판단을 보류한다', '단측 검정으로 바꾼다'), 'ans', 1,
    's', '|Z| = 2.31 > 1.96이므로 기각한다.'), '', '2026-10-10 09:25:00.000'),
 (6, 2, 'mc', TRUE, JSON_OBJECT('q', '유의수준(significance level) α = 0.05에서 양측 검정을 할 때, 검정통계량 Z = 2.31이면 귀무가설을 어떻게 판단하는가?', 'opts',
    JSON_ARRAY('귀무가설을 채택한다', '귀무가설을 기각한다', '판단을 보류한다', '단측 검정으로 바꾼다'), 'ans', 1,
    's', '|Z| = 2.31 > 1.96이므로 기각한다.'), '문장을 더 구체적으로 고침', '2026-10-20 10:00:00.000'),
 (7, 1, 'ox', FALSE, JSON_OBJECT('q', 'p-값은 귀무가설이 참일 확률이다.', 'ox', FALSE,
    'fix', 'p-값은 귀무가설이 참일 때 지금만큼 또는 더 극단적인 결과가 나올 확률이다.', 's', 'p-값은 가설의 확률이 아니다.'),
    '', '2026-10-10 09:30:00.000'),
 (8, 1, 'short', FALSE, JSON_OBJECT('q', '제1종 오류(Type I error)를 범할 확률을 나타내는 그리스 문자는?', 'a', 'α',
    'accept', JSON_ARRAY('α', 'alpha', '알파'), 's', '유의수준 α가 곧 제1종 오류 확률의 상한이다.'), '', '2026-10-10 09:35:00.000'),
 (9, 1, 'mc', FALSE, JSON_OBJECT('q', '다른 조건이 같을 때 표본 크기를 늘리면 검정력(power)은?', 'opts',
    JSON_ARRAY('줄어든다', '변하지 않는다', '커진다', '유의수준과 같아진다'), 'ans', 2,
    's', '표준오차가 줄어 대립가설을 더 잘 가려낸다.'), '', '2026-10-10 09:40:00.000'),
 (10, 1, 'essay', FALSE, JSON_OBJECT('q', '제1종 오류와 제2종 오류의 차이를 예를 들어 설명하시오.',
    'a', '제1종 오류는 참인 귀무가설을 기각하는 것, 제2종 오류는 거짓인 귀무가설을 기각하지 못하는 것이다.',
    'pts', JSON_ARRAY('제1종 오류 정의', '제2종 오류 정의', '예시'), 's', ''), '', '2026-10-10 09:45:00.000');

-- ───────── 제출 30개 ─────────
-- 민지(잘함) 9 · 준호(보통) 7 · 서연 6 · 도현(어려워함, "모르겠어요" 포함) 4 · 하은 2 · 손님 2
-- 문제 6은 준호·도현이 버전 1을, 민지가 버전 2를 풀었다
INSERT INTO submission (client_id, device_id, user_id, problem_id, version, answer, is_correct, attempt, ms, is_idk, is_self, submitted_at) VALUES
 ('s01', 'sample-minji-phone',  1, 1, 1, 'A',  TRUE,  1, 18200, FALSE, FALSE, '2026-10-21 12:00:00.000'),
 ('s02', 'sample-minji-phone',  1, 2, 1, 'O',  TRUE,  1,  9400, FALSE, FALSE, '2026-10-21 12:01:10.000'),
 ('s03', 'sample-minji-phone',  1, 3, 1, '4',  TRUE,  1, 15100, FALSE, FALSE, '2026-10-21 12:02:30.000'),
 ('s04', 'sample-minji-phone',  1, 4, 1, 'B',  TRUE,  1, 21300, FALSE, FALSE, '2026-10-21 12:04:00.000'),
 ('s05', 'sample-minji-phone',  1, 5, 1, 'O',  FALSE, 1, 11800, FALSE, FALSE, '2026-10-21 12:05:20.000'),
 ('s06', 'sample-minji-phone',  1, 5, 1, 'X',  TRUE,  2,  6200, FALSE, FALSE, '2026-10-22 08:30:00.000'),
 ('s07', 'sample-minji-laptop', 1, 6, 2, 'B',  TRUE,  1, 24500, FALSE, FALSE, '2026-10-24 19:00:00.000'),
 ('s08', 'sample-minji-laptop', 1, 7, 1, 'X',  TRUE,  1, 13900, FALSE, FALSE, '2026-10-24 19:01:30.000'),
 ('s09', 'sample-minji-laptop', 1, 8, 1, 'α',  TRUE,  1, 17700, FALSE, FALSE, '2026-10-24 19:03:00.000'),
 ('s10', 'sample-junho',        2, 1, 1, 'B',  FALSE, 1, 25300, FALSE, FALSE, '2026-10-18 21:00:00.000'),
 ('s11', 'sample-junho',        2, 1, 1, 'A',  TRUE,  2,  8100, FALSE, FALSE, '2026-10-18 21:01:00.000'),
 ('s12', 'sample-junho',        2, 2, 1, 'O',  TRUE,  1, 12000, FALSE, FALSE, '2026-10-18 21:02:10.000'),
 ('s13', 'sample-junho',        2, 5, 1, 'O',  FALSE, 1, 14400, FALSE, FALSE, '2026-10-18 21:04:00.000'),
 ('s14', 'sample-junho',        2, 6, 1, 'A',  FALSE, 1, 31000, FALSE, FALSE, '2026-10-19 20:00:00.000'),
 ('s15', 'sample-junho',        2, 6, 1, 'B',  TRUE,  2,  9800, FALSE, FALSE, '2026-10-19 20:01:00.000'),
 ('s16', 'sample-junho',        2, 7, 1, 'O',  FALSE, 1, 16500, FALSE, FALSE, '2026-10-19 20:02:30.000'),
 ('s17', 'sample-seoyeon',      3, 1, 1, 'A',  TRUE,  1, 14000, FALSE, FALSE, '2026-10-23 09:00:00.000'),
 ('s18', 'sample-seoyeon',      3, 3, 1, '5',  FALSE, 1, 20100, FALSE, FALSE, '2026-10-23 09:01:30.000'),
 ('s19', 'sample-seoyeon',      3, 3, 1, '4',  TRUE,  2,  7300, FALSE, FALSE, '2026-10-23 09:02:10.000'),
 ('s20', 'sample-seoyeon',      3, 4, 1, 'A',  FALSE, 1, 22800, FALSE, FALSE, '2026-10-23 09:04:00.000'),
 ('s21', 'sample-seoyeon',      3, 9, 1, 'C',  TRUE,  1, 19600, FALSE, FALSE, '2026-10-29 09:20:00.000'),
 ('s22', 'sample-seoyeon',      3, 10, 1, '제1종 오류는 맞는 귀무가설을 기각하는 것이고 제2종 오류는 틀린 귀무가설을 받아들이는 것이다. 예: 무고한 사람을 유죄로 판결',
                                                TRUE,  1, 95000, FALSE, TRUE,  '2026-10-29 09:28:00.000'),
 ('s23', 'sample-dohyun',       4, 2, 1, 'X',  FALSE, 1, 30200, FALSE, FALSE, '2026-10-26 23:00:00.000'),
 ('s24', 'sample-dohyun',       4, 5, 1, '모르겠어요', FALSE, 1, 41000, TRUE, FALSE, '2026-10-26 23:02:00.000'),
 ('s25', 'sample-dohyun',       4, 6, 1, 'A',  FALSE, 1, 38700, FALSE, FALSE, '2026-10-26 23:05:00.000'),
 ('s26', 'sample-dohyun',       4, 8, 1, 'β',  FALSE, 1, 27400, FALSE, FALSE, '2026-10-26 23:08:00.000'),
 ('s27', 'sample-haeun',        5, 1, 1, 'A',  TRUE,  1, 12600, FALSE, FALSE, '2026-10-25 11:50:00.000'),
 ('s28', 'sample-haeun',        5, 9, 1, 'B',  FALSE, 1, 23900, FALSE, FALSE, '2026-10-25 11:53:00.000'),
 ('s29', 'sample-guest',     NULL, 1, 1, 'C',  FALSE, 1, 16000, FALSE, FALSE, '2026-10-20 08:02:00.000'),
 ('s30', 'sample-guest',     NULL, 1, 1, 'A',  TRUE,  2,  5200, FALSE, FALSE, '2026-10-20 08:03:00.000');

COMMIT;
