# 문제노트 플랫폼 (베타, 맥에서 실행)

## 켜기 / 끄기
```bash
cd ~/Desktop/2026강의/문제노트_플랫폼
node server/server.js
```
- 켜지면 사용자 웹 주소와 관리자 웹(비밀 주소)이 터미널에 나온다. 끄려면 `Ctrl+C`.
- 관리자 비밀 주소는 `data/admin_path.txt`에 있다. 이 파일을 지우면 다음 실행 때 새 주소가 만들어진다.
- 같은 와이파이의 폰에서 쓰려면 `HOST=0.0.0.0 node server/server.js`로 켜고, 폰에서 `http://<맥 IP>:4000`으로 들어간다.

## 베타 시험 (바깥에서 접속)
```bash
tools/start_beta.sh
```
- 서버 + Cloudflare Tunnel을 켜고 `https://○○.trycloudflare.com` 주소를 보여 준다. 주소는 켤 때마다 바뀐다.
- 관리자 화면은 이 맥(127.0.0.1)에서만 열린다. 자세한 내용은 `배포안내.md` 8장.

## 문제 세트 넣기
```bash
node server/import.js --dry      # 미리보기 (DB는 그대로)
node server/import.js            # data/import/*.json 전부 넣기
node server/import.js 파일.json   # 파일 하나만
```
같은 학기·과목·문제 번호가 있으면, 내용이 바뀐 문제만 새 버전이 된다.

## 백업
- 서버가 하루 한 번 `data/backups/`에 자동으로 만들고 7개만 남긴다. 관리자 "학기·과목" 화면에서 바로 만들거나 내려받을 수 있다.
- 직접 하려면 서버를 끈 뒤 `data/app.db`를 복사한다.

## API 확인 (터미널)
```bash
curl http://127.0.0.1:4000/api/catalog            # 학기·과목 목록
curl http://127.0.0.1:4000/api/course/1           # 과목 1의 챕터·문제
```

## 폴더
| 위치 | 내용 |
|---|---|
| `server/server.js` | 웹 서버 + API |
| `server/db.js` | DB 접속, 문제 세트 가져오기, 통계 계산 |
| `server/schema.sql` | DB 구조 |
| `tools/convert.py` | 이번 학기 문제 노트 → 공통 형식 변환 |
| `data/import/` | 과목별 문제 세트(JSON) |
| `web/`, `admin/` | 사용자 웹, 관리자 웹 |

## AI 채점 도우미 (서술형, Google Gemini)
- 서술형 답안을 쓰고 "✦ AI 채점 도움"을 누르면 채점 포인트마다 들어감/애매함/빠짐을 보여 준다. 최종 판정은 사용자가 한다.
- 켜는 법 (둘 중 하나, 서버를 다시 켜야 반영)
  1. **파일 (추천, 터미널 기록에 키가 남지 않음)**: AI Studio에서 키를 복사한 뒤
     `pbpaste > data/gemini_key.txt && chmod 600 data/gemini_key.txt`
  2. 환경 변수: `GEMINI_API_KEY=… node server/server.js`
- 모델 바꾸기: `GEMINI_MODEL=gemini-2.5-flash` (기본 `gemini-flash-latest`). 기본 모델이 붐비면(503) `GEMINI_FALLBACK`의 모델로 차례로 넘긴다 (기본 `gemini-2.5-flash,gemini-flash-lite-latest`), 전체 25초 안에서
- 서버를 켜면 "AI 채점 켜짐/꺼짐"이 나온다. 꺼져 있으면 버튼이 안 보인다.
- 키는 `data/` 안에만 둔다(웹으로 내보내지 않는 폴더). 채팅·코드·브라우저에 넣지 않는다.
- 기기당 시간당 40번 제한, 같은 답안은 캐시, 20초 안에 답이 없으면 직접 채점으로.
- 기록: `ai_grade` 테이블(답안 전문, AI 판정, 사용자 판정). 관리자 대시보드에 사용 수와 일치율.
