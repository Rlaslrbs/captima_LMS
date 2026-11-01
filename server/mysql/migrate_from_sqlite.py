"""SQLite(문제노트 app.db) → MySQL(problem_solving_site) 옮기기 도구

쓰는 법 (.my.cnf가 있는 폴더에서. 저장소에서는 저장소 맨 위 폴더)
  python <이 파일> make   [app.db 경로]   → 이 파일 옆에 migrate_data.sql 만들기 (SQLite는 읽기 전용으로만 연다)
  mysql --defaults-extra-file=.my.cnf --default-character-set=utf8mb4 < <이 파일 폴더>/migrate_data.sql   → 실행
  python <이 파일> verify [app.db 경로]   → MySQL과 SQLite를 한 칸씩 대조 (읽기만)
  app.db 경로를 빼면 저장소의 data/app.db (또는 데모_사이트/data/app.db)를 쓴다.
  mysql 프로그램은 MYSQL_BIN 환경 변수 → PATH → Windows 기본 설치 위치 순서로 찾는다. 접속 파일은 MYSQL_CNF (기본 .my.cnf)

옮기는 것: 학기 · 과목 · 단원 · 문제 · 문제 버전 + 진단 태그(개념 · 세부 포인트 · 착각 · 문제 태그 · 변형 묶음)
옮기지 않는 것: 학습자 기록(기기 · 풀이 · 이벤트 · 제보 …), AI 운영 기록
여러 번 돌려도 안전하다: 바뀌지 않는 값(학기 코드 · 과목 코드 · 단원 키 · 문제 번호 · 버전 · 진단 코드)으로 같은 줄을 찾아
있으면 고치고 없으면 더한다. 지우는 명령은 만들지 않는다 (SQLite에서 사라진 줄은 MySQL에 남는다).
MySQL에서만 정하는 값(문제 난이도 · 작성자)은 덮어쓰지 않는다.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [os.path.join(HERE, "데모_사이트", "data", "app.db"),          # 로컬 작업 폴더
              os.path.join(HERE, "..", "..", "data", "app.db")]             # 저장소 server/mysql/
DEFAULT_DB = next((p for p in CANDIDATES if os.path.exists(p)), CANDIDATES[-1])
OUT = os.path.join(HERE, "migrate_data.sql")
MYSQL = os.environ.get("MYSQL_BIN") or shutil.which("mysql") or r"C:\Program Files\MySQL\MySQL Server 26.10\bin\mysql.exe"
CNF = os.environ.get("MYSQL_CNF", ".my.cnf")


def lit(v):
    """SQL 값 글자로 (MySQL 문자열 규칙: 역슬래시와 따옴표를 이스케이프)"""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("\\", "\\\\").replace("'", "\\'").replace("\0", "\\0").replace("\x1a", "\\Z")
    return "'" + s + "'"


def ts(v):
    """SQLite ISO 시각(2026-10-30T05:59:41.675Z) → MySQL DATETIME(3) (UTC)"""
    if not v:
        return None
    v = str(v).replace("T", " ").rstrip("Z")
    return v[:23]


def upsert(table, row, keys):
    """INSERT … AS n ON DUPLICATE KEY UPDATE (키가 아닌 칸만 고친다). row 값은 이미 SQL 식"""
    cols = list(row)
    upd = ", ".join(f"{c} = n.{c}" for c in cols if c not in keys) or f"{keys[0]} = n.{keys[0]}"
    return f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(row.values())}) AS n ON DUPLICATE KEY UPDATE {upd};"


def open_lite(path):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    return db


# ───────── make ─────────
def make(path):
    db = open_lite(path)
    L = []
    w = L.append
    w("-- 자동 생성: python migrate_from_sqlite.py make (손으로 고치지 않는다)")
    w(f"-- 원본: {os.path.relpath(path, HERE)}")
    w("SET NAMES utf8mb4;\nSET time_zone = '+00:00';\nUSE problem_solving_site;\nSTART TRANSACTION;")

    sem = {r["id"]: r for r in db.execute("SELECT * FROM semester")}
    for r in sem.values():
        w(upsert("semester", {"code": lit(r["code"]), "name": lit(r["name"]), "sort": lit(r["sort"]), "visible": lit(r["visible"])}, ["code"]))

    courses = db.execute("SELECT * FROM course ORDER BY id").fetchall()
    for c in courses:
        s = sem[c["semester_id"]]
        w(f"\n-- ═════ 과목 {c['code']} ({c['name']}) ═════")
        w(f"SET @s = (SELECT semester_id FROM semester WHERE code = {lit(s['code'])});")
        w(upsert("course", {"semester_id": "@s", "code": lit(c["code"]), "short": lit(c["short"]), "name": lit(c["name"]),
                            "professor": lit(c["professor"]), "meta": lit(c["meta"]), "info": lit(c["info"] or "{}"),
                            "sort": lit(c["sort"]), "visible": lit(c["visible"]), "created_at": lit(ts(c["created_at"]))},
                 ["semester_id", "code", "created_at"]))
        w(f"SET @co = (SELECT course_id FROM course WHERE semester_id = @s AND code = {lit(c['code'])});")

        chapters = {r["id"]: r for r in db.execute("SELECT * FROM chapter WHERE course_id = ? ORDER BY sort, id", (c["id"],))}
        for ch in chapters.values():
            w(upsert("chapter", {"course_id": "@co", "chapter_key": lit(ch["key"]), "title": lit(ch["title"]), "short": lit(ch["short"]),
                                 "grp": lit(ch["grp"]), "info": lit(ch["info"] or "{}"), "sort": lit(ch["sort"])}, ["course_id", "chapter_key"]))

        ext = {}                                           # SQLite 문제 id → 문제 번호
        for ch in chapters.values():
            w(f"SET @ch = (SELECT chapter_id FROM chapter WHERE course_id = @co AND chapter_key = {lit(ch['key'])});")
            for p in db.execute("SELECT * FROM problem WHERE chapter_id = ? ORDER BY sort, id", (ch["id"],)):
                ext[p["id"]] = p["ext_id"]
                vers = db.execute("SELECT * FROM problem_version WHERE problem_id = ? ORDER BY version", (p["id"],)).fetchall()
                w(upsert("problem", {"course_id": "@co", "chapter_id": "@ch", "ext_id": lit(p["ext_id"]), "sort": lit(p["sort"]),
                                     "current_version": lit(p["current_version"]), "status": lit(p["status"]),
                                     "created_at": lit(ts(vers[0]["created_at"]) if vers else None)},
                         ["course_id", "ext_id", "created_at"]))
                w(f"SET @p = (SELECT problem_id FROM problem WHERE course_id = @co AND ext_id = {lit(p['ext_id'])});")
                for v in vers:
                    w(upsert("problem_version", {"problem_id": "@p", "version": lit(v["version"]), "kind": lit(v["kind"]), "star": lit(v["star"]),
                                                 "body": lit(v["body"]), "note": lit(v["note"]), "created_at": lit(ts(v["created_at"]))},
                             ["problem_id", "version", "created_at"]))

        # 진단 태그
        P = lambda pid: f"(SELECT problem_id FROM problem WHERE course_id = @co AND ext_id = {lit(ext[pid])})"
        n_kc = db.execute("SELECT COUNT(*) FROM kc WHERE course_id = ?", (c["id"],)).fetchone()[0]
        if n_kc:
            w(f"-- 진단 태그")
        for r in db.execute("SELECT * FROM kc WHERE course_id = ? ORDER BY code", (c["id"],)):
            w(upsert("kc", {"course_id": "@co", "code": lit(r["code"]), "parent": lit(r["parent"]), "chapter_keys": lit(r["chapter_keys"] or "[]"),
                            "name": lit(r["name"]), "definition": lit(r["definition"]), "boundary": lit(r["boundary"]),
                            "confusable": lit(r["confusable"] or "[]"), "source": lit(r["source"]), "status": lit(r["status"]),
                            "merged_into": lit(r["merged_into"]), "vocab_ver": lit(r["vocab_ver"]), "updated_at": lit(ts(r["updated_at"]))},
                     ["course_id", "code"]))
        for r in db.execute("SELECT * FROM facet WHERE course_id = ? ORDER BY code", (c["id"],)):
            w(upsert("facet", {"course_id": "@co", "code": lit(r["code"]), "kc": lit(r["kc"]), "name": lit(r["name"]), "statement": lit(r["statement"]),
                               "kind": lit(r["kind"]), "confusable": lit(r["confusable"] or "[]"), "sort": lit(r["sort"]), "source": lit(r["source"]),
                               "status": lit(r["status"]), "merged_into": lit(r["merged_into"]), "vocab_ver": lit(r["vocab_ver"]),
                               "updated_at": lit(ts(r["updated_at"]))}, ["course_id", "code"]))
        for r in db.execute("SELECT * FROM misc WHERE course_id = ? ORDER BY code", (c["id"],)):
            w(upsert("misc", {"course_id": "@co", "code": lit(r["code"]), "chapter_key": lit(r["chapter_key"]), "kc": lit(r["kc"]), "cw": lit(r["cw"]),
                              "facet": lit(r["facet"]), "belief": lit(r["belief"]), "truth": lit(r["truth"]), "contrast": lit(r["contrast"]),
                              "cue": lit(r["cue"]), "src": lit(r["src"]), "status": lit(r["status"]), "vocab_ver": lit(r["vocab_ver"]),
                              "updated_at": lit(ts(r["updated_at"]))}, ["course_id", "code"]))
        for r in db.execute("SELECT t.* FROM item_tag t JOIN problem p ON p.id = t.problem_id WHERE p.course_id = ? ORDER BY p.sort, t.version", (c["id"],)):
            w(upsert("item_tag", {"problem_id": P(r["problem_id"]), "version": lit(r["version"]), "course_id": "@co", "body_hash": lit(r["body_hash"]),
                                  "vocab_ver": lit(r["vocab_ver"]), "prompt_ver": lit(r["prompt_ver"]), "model": lit(r["model"]), "kcs": lit(r["kcs"]),
                                  "diag": lit(r["diag"]), "qa": lit(r["qa"] or "{}"), "review": lit(r["review"]), "facet": lit(r["facet"]),
                                  "depth": lit(r["depth"]), "src": lit(r["src"]), "conf": lit(r["conf"]), "updated_at": lit(ts(r["updated_at"]))},
                     ["problem_id", "version"]))
        for r in db.execute("SELECT * FROM family WHERE course_id = ? ORDER BY code", (c["id"],)):
            w(upsert("family", {"course_id": "@co", "code": lit(r["code"]), "facet": lit(r["facet"]),
                                "base_problem_id": P(r["base_problem_id"]) if r["base_problem_id"] else "NULL",
                                "principle": lit(r["principle"]), "source": lit(r["source"]), "status": lit(r["status"]),
                                "updated_at": lit(ts(r["updated_at"]))}, ["course_id", "code"]))
        for r in db.execute("SELECT * FROM family_member WHERE course_id = ? ORDER BY family, problem_id", (c["id"],)):
            w(upsert("family_member", {"problem_id": P(r["problem_id"]), "course_id": "@co", "family": lit(r["family"]), "role": lit(r["role"]),
                                       "delta_type": lit(r["delta_type"]), "delta": lit(r["delta"]), "body_hash": lit(r["body_hash"]),
                                       "source": lit(r["source"]), "conf": lit(r["conf"]), "updated_at": lit(ts(r["updated_at"]))},
                     ["problem_id"]))

    w("\nCOMMIT;")
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    print(f"만듦: {os.path.basename(OUT)} ({os.path.getsize(OUT) / 1e6:.1f} MB, {sum(1 for x in L if x.startswith('INSERT'))}개 INSERT)")


# ───────── verify ─────────
# 표마다 (SQLite 조회, MySQL 조회, JSON 칸 번호). 두 쪽 모두 같은 열 순서, 첫 열들이 키
CHECKS = {
    "semester": ("SELECT code, name, sort, visible FROM semester",
                 "SELECT code, name, sort, visible FROM semester", []),
    "course": ("SELECT c.code, c.short, c.name, c.professor, c.meta, c.info, c.sort, c.visible FROM course c",
               "SELECT c.code, c.short, c.name, c.professor, c.meta, c.info, c.sort, c.visible FROM course c", [5]),
    "chapter": ("SELECT c.code, h.key, h.title, h.short, h.grp, h.info, h.sort FROM chapter h JOIN course c ON c.id = h.course_id",
                "SELECT c.code, h.chapter_key, h.title, h.short, h.grp, h.info, h.sort FROM chapter h JOIN course c USING (course_id)", [5]),
    "problem": ("SELECT c.code, p.ext_id, h.key, p.sort, p.current_version, p.status FROM problem p JOIN course c ON c.id = p.course_id JOIN chapter h ON h.id = p.chapter_id",
                "SELECT c.code, p.ext_id, h.chapter_key, p.sort, p.current_version, p.status FROM problem p JOIN course c USING (course_id) JOIN chapter h USING (chapter_id)", []),
    "problem_version": ("SELECT c.code, p.ext_id, v.version, v.kind, v.star, v.body, v.note FROM problem_version v JOIN problem p ON p.id = v.problem_id JOIN course c ON c.id = p.course_id",
                        "SELECT c.code, p.ext_id, v.version, v.kind, v.star, v.body, v.note FROM problem_version v JOIN problem p USING (problem_id) JOIN course c ON c.course_id = p.course_id", [5]),
    "kc": ("SELECT c.code, k.code, k.parent, k.chapter_keys, k.name, k.definition, k.boundary, k.confusable, k.source, k.status, k.merged_into, k.vocab_ver FROM kc k JOIN course c ON c.id = k.course_id",
           "SELECT c.code, k.code, k.parent, k.chapter_keys, k.name, k.definition, k.boundary, k.confusable, k.source, k.status, k.merged_into, k.vocab_ver FROM kc k JOIN course c USING (course_id)", [3, 7]),
    "facet": ("SELECT c.code, f.code, f.kc, f.name, f.statement, f.kind, f.confusable, f.sort, f.source, f.status, f.vocab_ver FROM facet f JOIN course c ON c.id = f.course_id",
              "SELECT c.code, f.code, f.kc, f.name, f.statement, f.kind, f.confusable, f.sort, f.source, f.status, f.vocab_ver FROM facet f JOIN course c USING (course_id)", [6]),
    "misc": ("SELECT c.code, m.code, m.chapter_key, m.kc, m.cw, m.facet, m.belief, m.truth, m.contrast, m.cue, m.src, m.status FROM misc m JOIN course c ON c.id = m.course_id",
             "SELECT c.code, m.code, m.chapter_key, m.kc, m.cw, m.facet, m.belief, m.truth, m.contrast, m.cue, m.src, m.status FROM misc m JOIN course c USING (course_id)", []),
    "item_tag": ("SELECT c.code, p.ext_id, t.version, t.body_hash, t.model, t.kcs, t.diag, t.qa, t.review, t.facet, t.depth, t.src, t.conf FROM item_tag t JOIN problem p ON p.id = t.problem_id JOIN course c ON c.id = p.course_id",
                 "SELECT c.code, p.ext_id, t.version, t.body_hash, t.model, t.kcs, t.diag, t.qa, t.review, t.facet, t.depth, t.src, t.conf FROM item_tag t JOIN problem p USING (problem_id) JOIN course c ON c.course_id = p.course_id", [5, 6, 7]),
    "family": ("SELECT c.code, f.code, f.facet, b.ext_id, f.principle, f.source, f.status FROM family f JOIN course c ON c.id = f.course_id LEFT JOIN problem b ON b.id = f.base_problem_id",
               "SELECT c.code, f.code, f.facet, b.ext_id, f.principle, f.source, f.status FROM family f JOIN course c USING (course_id) LEFT JOIN problem b ON b.problem_id = f.base_problem_id", []),
    "family_member": ("SELECT c.code, p.ext_id, m.family, m.role, m.delta_type, m.delta, m.body_hash, m.source, m.conf FROM family_member m JOIN problem p ON p.id = m.problem_id JOIN course c ON c.id = m.course_id",
                      "SELECT c.code, p.ext_id, m.family, m.role, m.delta_type, m.delta, m.body_hash, m.source, m.conf FROM family_member m JOIN problem p USING (problem_id) JOIN course c ON c.course_id = m.course_id", []),
}


def mysql_rows(sql, ncols):
    """MySQL 조회 결과를 칸마다 HEX로 받아 그대로 복원 (줄바꿈 · 탭이 든 글도 안전하게)"""
    inner = sql.split(" FROM ", 1)
    cols = [c.strip() for c in split_cols(inner[0][len("SELECT "):])]
    hexed = ", ".join(f"IFNULL(HEX(CAST({c} AS CHAR)), '~')" for c in cols)
    q = f"SELECT {hexed} FROM {inner[1]}"
    # 접속 파일은 지금 폴더 기준 상대 경로로 넘긴다 (Windows mysql.exe는 한글이 든 절대 경로를 못 연다)
    r = subprocess.run([MYSQL, "--defaults-extra-file=" + CNF, "--default-character-set=utf8mb4", "-N", "-B", "-e", q],
                       capture_output=True)
    if r.returncode:
        sys.exit(r.stderr.decode("utf-8", "replace"))
    out = []
    for line in r.stdout.decode("ascii").splitlines():
        vals = line.split("\t")
        out.append([None if v == "~" else bytes.fromhex(v).decode("utf-8") for v in vals])
    return out


def split_cols(s):
    parts, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    return parts + [cur]


def norm(v, is_json):
    if v is None:
        return None
    if is_json:
        return json.loads(v)
    return str(v)


def verify(path):
    db = open_lite(path)
    bad = 0
    print(f"{'표':16} {'SQLite':>7} {'MySQL':>7}  내용")
    for t, (lq, mq, jcols) in CHECKS.items():
        lrows = [list(r) for r in db.execute(lq)]
        mrows = mysql_rows(mq, len(lrows[0]) if lrows else 0)
        nkey = {"semester": 1, "course": 1, "chapter": 2, "problem": 2, "problem_version": 3, "item_tag": 3, "family_member": 2}.get(t, 2)
        L = {tuple(map(str, r[:nkey])): [norm(v, i in jcols) for i, v in enumerate(r)] for r in lrows}
        M = {tuple(map(str, r[:nkey])): [norm(v, i in jcols) for i, v in enumerate(r)] for r in mrows}
        miss = [k for k in L if k not in M]
        diff = [k for k in L if k in M and L[k] != M[k]]
        extra = [k for k in M if k not in L]
        ok = not miss and not diff
        bad += not ok
        note = "모두 같음" if ok else f"빠짐 {len(miss)} · 다름 {len(diff)}"
        if extra:
            note += f" (MySQL에만 {len(extra)})"
        print(f"{t:16} {len(L):>7} {len(M):>7}  {note}")
        for k in (miss + diff)[:3]:
            print("   예:", k, "\n     SQLite:", str(L[k])[:200], "\n     MySQL :", str(M.get(k))[:200])
    print("\n결과:", "모든 표가 같아요" if not bad else f"다른 표 {bad}개")
    return bad


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("make", "verify"):
        sys.exit(__doc__)
    src = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DB
    if not os.path.exists(src):
        sys.exit(f"SQLite 파일이 없어요: {src}")
    if sys.argv[1] == "make":
        make(src)
    else:
        sys.exit(1 if verify(src) else 0)
