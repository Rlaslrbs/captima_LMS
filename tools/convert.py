# 이번 학기 문제 노트 5과목 → 플랫폼 공통 형식(JSON) 변환
# 사용: python3 tools/convert.py   →  data/import/<과목코드>.json
#
# 공통 형식 (과목 하나 = 파일 하나)
# {
#   "format": 1,
#   "semester": {"code": "26-2", "name": "2026년 2학기"},
#   "course": {"code", "name", "short", "professor", "meta", "color": {"light","dark"}, "lang", "math", "files": {키: 파일 설명}},
#   "chapters": [{"key", "title", "short", "group"}],
#   "problems": [{
#       "ext_id", "chapter", "kind": "ox|mc|short|essay", "star",
#       "q", "q_sub"(작은 번역 줄), "stem"(객관식 질문, 선택),
#       "ox"(O/X 정답), "opts", "opts_sub", "ans"(객관식 정답 번호),
#       "a"(정답 표시), "accept", "strict", "num", "tol", "ph",   ← 서답형 자동 채점
#       "pts"(서술형 채점 포인트), "s"(해설 HTML), "src"[[파일키, 쪽]], "fix", "tags", "exams"
#   }]
# }
import hashlib, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                    # 문제노트_플랫폼
LEC = os.path.dirname(ROOT)                     # 2026강의
OUT = os.path.join(ROOT, "data", "import")
SEM = {"code": "26-2", "name": "2026년 2학기"}

COURSES = [
    dict(code="MIS", short="경정시", name="경영정보시스템", professor="최현홍", meta="Topic 1~5 PPT + 필기",
         file="경정시/_source/quiz_경정시.html", light="#1f5f8b", dark="#7fb6dd", lang="ko"),
    dict(code="IE216", short="생경론", name="생산경영론", professor="정호영", meta="Lecture 02~05 PPT",
         file="생산경영롬/_source/quiz_생경론.html", light="#2f6b3f", dark="#7fc493", lang="ko"),
    dict(code="KEHN", short="진인본", name="진화와 인간 본성", professor="전중환", meta="1~12강 PPT + 23-1 기출",
         file="진화와인간본성/_source/quiz_진인본.html", light="#8a4b2a", dark="#e0a07c", lang="ko"),
    dict(code="IE208", short="응용통계", name="응용통계학", professor="전현우", meta="Ch1~9 PPT + 교재 8장 + T/F 3탄",
         file="응용통계학/_source/quiz_응통.html", light="#0d6b6b", dark="#6cc7c2", lang="en"),
]
FIELDS = ["q", "ox", "opts", "ans", "a", "accept", "strict", "num", "tol", "ph", "pts", "s", "src", "fix"]


def template_course(c):
    html = open(os.path.join(LEC, c["file"]), encoding="utf-8").read()
    Q = json.loads(re.search(r"window\.QUIZ = (\{.*?\});\n</script>", html, re.S).group(1))
    chapters = [{"key": ch["key"], "title": ch["title"], "short": ch.get("short", ch["key"]), "group": ""} for ch in Q["chapters"]]
    problems = []
    for p in Q["problems"]:
        d = {"ext_id": p["id"], "no": p.get("no", p["id"]), "chapter": p["ch"], "kind": p["kind"], "star": bool(p.get("star"))}
        for k in FIELDS:
            if k in p and p[k] not in (None, "", []): d[k] = p[k]
        if p.get("qen"): d["q_sub"] = p["qen"]                 # 응통: 영어 문제 + 한국어 번역
        if p.get("optsko") and any(p["optsko"]): d["opts_sub"] = p["optsko"]
        problems.append(d)
    course = {k: c[k] for k in ("code", "short", "name", "professor", "meta", "lang")}
    course.update(color={"light": c["light"], "dark": c["dark"]}, math=False, files=Q.get("files", {}))
    return {"format": 1, "semester": SEM, "course": course, "chapters": chapters, "problems": problems}


def shuffled(key, opts):
    """정답이 0번인 보기를 문제마다 고정된 순서로 섞고 정답 번호를 돌려준다."""
    idx = list(range(len(opts))); h = int(hashlib.md5(key.encode()).hexdigest(), 16)
    for i in range(len(idx) - 1, 0, -1):
        j = h % (i + 1); h //= (i + 1); idx[i], idx[j] = idx[j], idx[i]
    return [opts[i] for i in idx], idx.index(0)


def la_course():
    raw = json.load(open(os.path.join(ROOT, "data", "raw", "la_raw.json"), encoding="utf-8"))
    group = {"1.1-2": "1장", "1.3": "1장", "2.1-2": "2장", "2.3": "2장", "2.4": "2장", "2.5": "2장", "2.6": "2장",
             "2.7-8": "2장", "3.1-2": "3장 · 행렬식", "3.3": "3장 · 행렬식", "exam": "시험 대비", "ox": "시험 대비"}
    chapters, problems, files = [], [], {}
    for s in raw["sets"]:
        chapters.append({"key": s["key"], "title": s["title"], "short": s["key"] if s["key"] not in ("exam", "ox") else ("기출" if s["key"] == "exam" else "O/X"),
                         "group": group.get(s["key"], ""), "sections": s.get("sections", [])})
        files[s["key"]] = s.get("pdf", "")
        for p in s["problems"]:
            d = {"ext_id": p["id"], "no": f'{p.get("sec","")} · {p.get("n","")}'.strip(" ·"), "chapter": s["key"],
                 "star": bool(p.get("star")), "q": p.get("ko") or p["q"], "a": p["a"], "s": p["s"], "math": True,
                 "src": [[s["key"], f'{p.get("sec","")} {p.get("n","")}'.strip()]]}
            if p.get("ko"): d["q_sub"] = p["q"]                    # 공수2: 한국어 문제 + 작은 영어 원문 (2026-10-19 사용자 요청)
            if p.get("tags"): d["tags"] = p["tags"]
            if p.get("exams"): d["exams"] = p["exams"]
            if p.get("kind"): d["topic"] = p["kind"]
            if p.get("isOX"):
                d["kind"] = "ox"; d["ox"] = bool(p["ox"])
            else:
                d["kind"] = "mc"
                if p["mc"].get("stem"): d["stem"] = p["mc"]["stem"]
                d["opts"], d["ans"] = shuffled("la:" + p["id"], p["mc"]["o"])
            problems.append(d)
    course = {"code": "LA2", "short": "공학수학", "name": "공학수학2 · 선형대수", "professor": "", "meta": "1~3장 우선 문제 + 중간 기출 2021~2025 + O/X 카드",
              "lang": "ko", "color": {"light": "#2448a8", "dark": "#86a2f6"}, "math": True, "files": files,
              "concepts": raw.get("concepts", {})}
    return {"format": 1, "semester": SEM, "course": course, "chapters": chapters, "problems": problems}


def check(pack):
    """기본 검사: 필수 값, 정답 번호 범위, 챕터 연결, 번호 중복"""
    errs = []; keys = {c["key"] for c in pack["chapters"]}; seen = set()
    for p in pack["problems"]:
        i = p["ext_id"]
        if i in seen: errs.append(f"{i}: 번호 중복")
        seen.add(i)
        if p["chapter"] not in keys: errs.append(f"{i}: 없는 챕터 {p['chapter']}")
        if not p.get("q"): errs.append(f"{i}: 문제 없음")
        k = p["kind"]
        if k == "ox" and not isinstance(p.get("ox"), bool): errs.append(f"{i}: O/X 정답 없음")
        if k == "mc" and not (p.get("opts") and 0 <= p.get("ans", -1) < len(p["opts"])): errs.append(f"{i}: 객관식 정답 번호 오류")
        if k == "short" and not p.get("a"): errs.append(f"{i}: 서답형 정답 없음")
        if k == "essay" and not p.get("a"): errs.append(f"{i}: 서술형 모범 답안 없음")
    return errs


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    from collections import Counter
    packs = [template_course(c) for c in COURSES] + [la_course()]
    total = 0
    for pk in packs:
        errs = check(pk)
        path = os.path.join(OUT, pk["course"]["code"] + ".json")
        json.dump(pk, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        kinds = Counter(p["kind"] for p in pk["problems"]); total += len(pk["problems"])
        print(f'{pk["course"]["code"]:6} {pk["course"]["name"]:14} 챕터 {len(pk["chapters"]):2} · 문제 {len(pk["problems"]):3} · {dict(kinds)} · 오류 {len(errs)}')
        for e in errs[:5]: print("   ", e)
    print("합계", total)
