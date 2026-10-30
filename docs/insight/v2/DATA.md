# 학습 리포트 v2: data model and tagging (DATA.md)

Owner: DB session. Status: **design final (2026-10-26), decisions in DECISIONS.md; building needs the user's separate go**. No code, DB or `data/` changes were made.
Pairs with `ALGORITHM.md` (서버), which consumes this data, and `REPORT_UX.md` (프론트엔드), which shows it.
Builds on `docs/insight/SPEC.md` §2 (tables) and §8 (tagging). Where this file and SPEC disagree, this file is the v2 proposal.

---

## 0. Decisions in one screen

1. **Concept map = 단원 → 개념(kc) → 세부 포인트(facet).**
   - A facet is one checkable piece of understanding, written as a correct statement (a "goal facet").
   - A misconception (`misc`) hangs off one facet (a "problematic facet") and optionally points to a confusable kc (`cw`).
2. **Every item gets the following:**
   - one primary **facet**;
   - a **depth** 1–4: 정의 · 적용 · 구별 · 조건 (the user's labels, DECISIONS 4);
   - per-option (or per-statement) **misconception ids**;
   - optionally a **variant family** with a **delta type** saying what changed versus the family's base item.
3. **Annotations never create a new problem version.**
   - Packs carry them in a separate `dx` block.
   - They are stored in `item_tag` (author-sourced) and two new family tables, not in `problem_version.body`.
   - So adding or fixing tags never splits accuracy statistics across versions.
4. **Coverage targets per facet** (aligned with ALGORITHM.md, so the algorithm can make a depth or illusion claim at all):
   - ≥ 4 items in total;
   - 1–2 items at depth 1–2;
   - 1–2 near variants at depth 3–4 with different delta types;
   - ≥ 3 items that offer the facet's leading misconception, so one confirmation item is still unseen after two hits;
   - ×1.5 for ★/exam facets.
5. **Existing 1,193 published items are tagged by Gemini in 6 passes:**
   - vocabulary + facets;
   - merge;
   - item facet/depth/misc;
   - second opinion;
   - families;
   - verification.

   Confidence comes from agreement plus grounding in the author's own `fix`/`함정`/`why`. Estimated **≈ 550 calls**, run **one course at a time**. Each course switches to the v2 report when it passes its gate (§8.6).
6. **Missing variants are written by an authoring session from a measured gap list**, not invented ahead of time. They are imported hidden and published after admin approval.

---

## 1. What the data looks like today (measured on a `VACUUM INTO` copy, 2026-10-25)

| course | published items | ox / mc / short / essay | chapters | `topic` | MC `why` | X items with `fix` | `함정:` in `s` |
|---|---|---|---|---|---|---|---|
| IE208 응용통계 | 211 | 84 / 75 / 45 / 7 | 7 | 0 | 0 | 13 / 46 | 0 |
| IE216 생경론 | 123 | 44 / 8 / 58 / 13 | 6 | 0 | 0 | 22 / 24 | 1 |
| KEHN 진인본 | 178 | 91 / 27 / 44 / 16 | 13 | 0 | 0 | 47 / 47 | 20 |
| LA2 공학수학 | 453 | 134 / 319 / 0 / 0 | 12 | 453 (12 topics) | 0 | 0 / 64 | 9 |
| MIS 경정시 | 228 | 93 / 24 / 83 / 28 | 6 | 0 | 0 | 48 / 48 | 2 |
| **total** | **1,193** (1,252 problems incl. hidden; 1,556 versions) | 446 / 453 / 230 / 64 | 44 | | | | |

What this means:
- `kc`, `misc`, `item_tag` and `tag_job` exist in the live DB since today's deploy, but all are **empty**. The SPEC §8 tagger is not built yet. So v2 can still reshape these tables cheaply.
- Only LA2 has concept labels: `topic`, plus free-form `tags`. Nobody has depth, facet or family labels.
- Author grounding is thin. There are no MC `why` at all, and `함정:` lines appear on only 32 of 1,193 items. Most grounding will come from `fix` on false O/X items and from explanations.
- Heavy device `DEVICE_ID_EXAMPLE` answered **325 distinct items** with first attempts in the event log: 공학수학 120, 생경론 83, 경정시 64, 진인본 32, 응용통계 26. These are tagged first (§8.6).

---

## 2. What the design rests on (short)

- **Attribute hierarchies.**
  - The Attribute Hierarchy Method orders skills so that a learner's pattern of right and wrong answers is read against a structure, not as independent skills (Leighton, Gierl & Hunka 2004).
  - Our depth ladder is a tiny, fixed hierarchy inside each facet: 정의 ⊂ 적용 ⊂ 구별 ⊂ 조건.
  - So "right at 1–2, wrong at 3–4" has a defined meaning, "얕게 앎", which the engine can test.
- **Depth of knowledge, not difficulty.**
  - Webb's DOK rates how much a learner must know to respond, not which verb is used. Revised Bloom (Anderson & Krathwohl 2001) splits the knowledge type from the cognitive process.
  - Our 4 levels borrow that idea but are defined per facet and per item, with decision rules a tagger can apply (§4.2). Difficulty stays a separate, data-estimated number (Rasch b in the engine).
- **Facets.**
  - Minstrell's facet clusters group a correct "goal facet" with the problematic facets learners hold about the same idea. A facet is the piece of knowledge or reasoning used on one problem.
  - That is exactly 세부 포인트 + its misconceptions.
- **Item families.**
  - Automatic item generation separates *incidentals* (surface features that vary randomly) from *radicals* (structural features that change what the item measures). Items that differ only in incidentals are isomorphs or clones; items from one model are siblings with similar properties (Gierl & Lai).
  - Families can be calibrated as a group (Sinharay, Johnson & Williamson 2003). That is how a family keeps working with very little data per item.
  - Our `role = iso` is an incidental change and `role = near` is one radical change. The engine reads "base right, near variant wrong" as a transfer failure.
- **Diagnostic distractors.**
  - Ordered multiple-choice items tie each option to a level of understanding (Briggs, Alonzo, Schwab & Wilson 2006).
  - SICM models ability and misconception presence together (Bradshaw & Templin 2014).
  - Hence `mis` per option and `misc → facet`.
- **Confidence tiers.**
  - Two-tier tests add a reason, three- and four-tier tests add confidence on the answer and the reason. Without confidence a misconception cannot be told apart from lack of knowledge (Caleon & Subramaniam 2010; CRI, Hasan et al. 1999).
  - High-confidence errors are the ones most often corrected after feedback, the hypercorrection effect (Butterfield & Metcalfe 2001). So a confidence tap is worth asking where it matters (§4.5).
- **LLM tagging limits.**
  - Candidate-list size dominates accuracy (see `research/misconceptions.md`).
  - LLM-generated KC sets tend to come out too many and too fine (Wang, Lin & Koedinger 2025: 569 vs 101 expert KCs).
  - Hence chapter-scoped enums, a merge pass and caps on counts (§8).

---

## 3. Concept map: 단원 → 개념 → 세부 포인트

### 3.1 Levels

| level | table | code | count rule | example (공학수학) |
|---|---|---|---|---|
| 단원 unit | `chapter` (exists) | chapter key | as taught | `3.1-2` 행렬식 |
| 개념 kc | `kc` (exists) | short English lowercase, stable (`det`) | 10–30 per course (§3-6 of 과목추가) | `det` 행렬식 |
| 세부 포인트 facet | **`facet` (new)** | `<kc>.<f>` (`det.swap`) | 1–5 per kc, ≈ 3 on average | `det.swap` 행 교환과 부호 |
| 오개념 misc | `misc` (exists, + `facet`) | `m###` or author code | 0–3 per facet, only with evidence | "치환행렬의 det는 항상 1이라고 생각함" |

A kc may span chapters (`kc.chapter_keys`). A facet belongs to exactly one kc.

### 3.2 What a facet is (rules for authors and for the tagger)

- It is **one sentence a learner could get wrong on a test**, stated correctly. The statement is ≤ 90자; the name is ≤ 20자.
- It has one of 6 kinds:
  - `def`: what it is;
  - `property`: what is always true of it;
  - `condition`: when it applies, its scope or prerequisite;
  - `procedure`: how to do it;
  - `relation`: how it links to another kc;
  - `distinction`: how it differs from a named neighbour.
- **지엽 = fine conceptual detail, never case trivia.**
  - A facet can be the exact wording of a definition, a sub-category, a boundary, a requirement, or a cause→effect step inside a theory.
  - A facet can never be a number, year, person, company or product from a case. Cases are only scenes in which a facet is asked.
  - This rule is repeated in every tagging and generation prompt.
- Two facets are distinct only if some plausible learner could know one and not the other. Otherwise merge them.
- A `distinction` facet exists only when the course has items that pit the two concepts against each other, or when it should have them (§7).

### 3.3 Example (real course content)

```
kc det 행렬식
  det.swap   (property)   두 행을 바꾸면 det의 부호가 바뀐다. 따라서 치환행렬의 det는 ±1이다.
  det.rowop  (property)   한 행의 배수를 다른 행에 더해도 det는 그대로, 한 행을 k배 하면 det도 k배.
  det.lin    (property)   det는 각 행에 대해 따로 선형이다. det(A+B)≠det A+det B, det(cA)=cⁿdet A.
  det.block  (condition)  블록 행렬의 det = det A·det D 는 블록 삼각(B=0 또는 C=0)일 때만 성립한다.
  det.inv    (relation)   det A = 0 ⇔ A는 가역이 아니다.
    misc m_det_perm1 → det.swap   "치환행렬은 1을 옮긴 것뿐이라 det가 항상 1이라고 생각함"
    misc m_det_2x2   → det.block  "2×2 공식 ad−bc를 블록에도 그대로 쓸 수 있다고 생각함"

kc dfx 제품 설계 기법 (생경론)
  dfx.dfa    (def)          DFA = 부품 수를 줄이고 조립 방법·순서를 단순화하는 설계
  dfx.dfd    (def)          DFD = 쓴 제품을 쉽게 분해할 수 있게 하는 설계 (재제조용)
  dfx.dfa_dfd (distinction) DFA는 생산 때 조립을 쉽게, DFD는 다 쓴 뒤 분해를 쉽게
    misc m_dfa_dfd (cw = dfx.dfd) "조립 용이 설계(DFA)와 분해 용이 설계(DFD)를 같은 것으로 봄"
```

---

## 4. Item annotations

All of these describe the **current version** of an item. The tagger re-checks them when `body_hash` changes.

### 4.1 Fields

| field | type | meaning | who fills it |
|---|---|---|---|
| `facet` | facet code | the facet the item is *about*; the correct answer depends on it | author / tagger |
| `facets2` | ≤ 2 facet codes | other facets needed on the way (weights in `kcs`, as in SPEC) | tagger |
| `depth` | 1–4 | what the learner must do with `facet` (§4.2) | author / tagger |
| `depth_why` | rubric clause id (`D1a`…`D4d`) | which rule of §4.2 decided it, for review and the gold test | tagger |
| `mis` | MC: array parallel to `opts` (`""` = correct option, `null` = no diagnosable belief); OX: one code for the planted error of a false statement (`mr` for a reverse belief, as in SPEC); short: per expected wrong pattern; essay: per point | which misconception choosing that response signals | author / tagger |
| `family`, `role`, `delta_type`, `delta` | §4.3. `delta` is a **learner-readable phrase ≤ 40자** shown in the report (e.g. "블록 삼각 → 일반 블록") | variant structure | author / tagger |
| `conf` | 1–3 | how much the engine may trust the tag (§8.5) | server |
| `src` | author / llm / admin | origin | server |

### 4.2 Depth rubric (decide by "what must the learner do with the facet to answer correctly?")

Labels everywhere (UI, engine `lv` L1–L4, docs): **1 정의 · 2 적용 · 3 구별 · 4 조건**. Level 4 is called 조건 but also covers transfer to a new object and combination (D4a, D4d), as the rules below say.

| depth | name | rule (any one clause) | DOK / Bloom anchor |
|---|---|---|---|
| **1** | 정의 | **D1a** the item restates the facet as taught (definition, term, rule); recognising the lecture sentence is enough. **D1b** a false statement with one word flipped to its opposite (줄인다→늘린다). **D1c** short answer = naming the defined term. | DOK 1, remember |
| **2** | 적용 | **D2a** use the facet on a case shaped like the lecture examples (compute, classify a typical example, run the taught procedure). **D2b** same object and representation as taught. | DOK 2, apply |
| **3** | 구별 | **D3a** the learner must choose between this facet and a neighbour concept, and the wrong option is the neighbour. **D3b** the learner must check whether the facet's condition holds (scope, prerequisite). **D3c** a false statement that attaches a neighbour concept's property. | DOK 2–3, analyze |
| **4** | 조건 | **D4a** the facet on an object or representation not shown in the lecture. **D4b** an exception or boundary case. **D4c** a universal qualifier (항상·모든·만·반드시) that the facet fails, or a converse/contrapositive. **D4d** the answer needs this facet combined with another facet. | DOK 3, analyze/evaluate |

- **"As taught" means the course material.** If the lecture (or `course.concepts`, or the facet statement) already states the exact fact, a flipped version of it is depth 1 (D1b), even if it looks like an edge case. Pass C therefore receives the chapter's taught statements (§8.2). Example: LA2's 3.1-2 summary states "치환행렬 det P = ±1" and "det(A+B) ≠ det A + det B", so ox-59 and ox-52 are depth 1, not 4.
- **Tie-break.** When two levels fit, take the higher one only if a learner who knows just the lower level would answer wrongly, that is, the trap lives at the higher level. Otherwise take the lower one.
- **Depth ≠ difficulty.** A depth-1 item about an obscure term can be hard, and a depth-4 item can be easy. Difficulty is estimated from data by the engine.
- **Essays.** Depth is set per point (`pts[i]`), and the item depth is the maximum.

**Examples (heavy device, LA2 `det`):**

| item | statement | facet | depth | rule | device's first answer |
|---|---|---|---|---|---|
| ox-54 | 두 행을 바꾸면 행렬식의 부호가 바뀐다. (O) | det.swap | 1 | D1a | O ✓ |
| **ox-59** | 치환행렬의 행렬식은 항상 1이다. (X) | det.swap | **1** | D1b (taught "det P = ±1", flipped) | **O ✗** |
| ox-64 | 행렬식은 각 행에 대해 따로 선형이다. (O) | det.lin | 1 | D1a | O ✓ |
| ox-52 | det(A+B) = det A + det B (X) | det.lin | 1 | D1b (taught "≠", flipped) | X ✓ |
| ox-53 | n×n에서 det(cA) = c det A (X) | det.lin | 3 | D3b (n-dependence) | X ✓ |
| ox-55 | 한 행의 배수를 다른 행에 더해도 행렬식은 변하지 않는다. (O) | det.rowop | 1 | D1a | O ✓ |
| 3.2-8 | 사다리꼴로 행축약하여 4×4 행렬식을 구하여라 (MC) | det.rowop | 2 | D2a | C ✓ |
| x21-t11 | det[[A,B],[0,D]] = det A det D 가 항상 성립 (O) | det.block | 1 | D1a (taught) | not tried |
| **ox-60** | det[[A,B],[C,D]] = det A det D − det B det C (X) | det.block | **4** | D4b, delta condition "블록 삼각 → 일반 블록" | **O ✗** |
| x24-9 | 테두리 블록 행렬 C의 det (MC) | det.block | 4 | D4d | 모르겠어요 |

### 4.3 Variant families

A **family** is a set of items that test the same facet with the same governing principle. One item is the `base`, normally the lowest depth. Every other member records what changed:

| role | meaning (AIG terms) | depth vs base |
|---|---|---|
| `base` | reference item | — |
| `iso` | only incidentals changed: numbers, wording, order, language, case dressing | same depth |
| `near` | exactly one radical changed (one `delta_type`) | usually higher |

| `delta_type` | what changed | example |
|---|---|---|
| `surface` | numbers or wording only (`iso` only) | another 4×4 matrix to reduce |
| `repr` | representation: formula ↔ words ↔ table ↔ graph, matrix ↔ system | the same rule given as a linear system |
| `object` | the same rule applied to a new object or case type not taught with it | "행 교환 규칙 → 처음 보는 행렬" |
| `condition` | a condition added, removed or flipped; the boundary of validity | "블록 삼각 → 일반 블록" (x21-t11 → ox-60) |
| `qualifier` | a universal or exclusive qualifier added | "항상 1이다" |
| `reverse` | converse, contrapositive, or direction of an implication | "det = 0 이면 비가역" → "비가역이면 det = 0" |
| `neighbour` | the concept swapped for its confusable neighbour | DFD's name on DFA's definition (생경론 4-4) |
| `combine` | the facet combined with another facet | block structure + row operations (x24-9) |

Rules:
- An item is in at most one family. Its family's facet equals the item's `facet`.
- Each family has exactly one base and at least 2 members.
- `iso` members must keep the depth of the base. A `near` member's delta type must be one of the table rows except `surface`.

Family ids:
- Authors write `family` as any short string unique in the course.
- The tagger creates `F###`.

**Why the algorithm needs this.** "착각" in the user's sense is "gets the familiar form right, misses the slightly changed one". That is a statement about a *pair*, `base` ✓ and `near` ✗ on the same facet. It is only checkable when the pair exists and is labelled. A wrong answer on an unrelated item of the same kc does not show it.

### 4.4 Two-tier reason and confidence tap: **not collected now** (DECISIONS 2, 6)

- The user chose not to ask learners for a confidence tap (확신/반반/찍음) or a "왜 그렇게 답했나요?" reason. The thresholds in ALGORITHM.md work without them.
- Nothing is reserved in the schema or the pack for them: no `tier2` body key and no `conf`/`t2` payload fields. If they are wanted later, both fit without a migration (body key / event payload), as sketched in the research (§2).

---

## 5. Storage: changes against SPEC §2

### 5.1 New tables (append to `schema.sql`, all `IF NOT EXISTS`)

```sql
-- ───────── 학습 리포트 v2: 세부 포인트 · 변형 묶음 ─────────
CREATE TABLE IF NOT EXISTS facet (                 -- 세부 포인트 (goal facet)
  course_id INTEGER NOT NULL REFERENCES course(id),
  code TEXT NOT NULL,                              -- "<kc>.<f>"  det.swap  (stable, never renumbered)
  kc TEXT NOT NULL,
  name TEXT NOT NULL,                              -- ≤ 20자
  statement TEXT NOT NULL,                         -- 바른 진술 ≤ 90자
  kind TEXT NOT NULL DEFAULT 'property',           -- def | property | condition | procedure | relation | distinction
  confusable TEXT NOT NULL DEFAULT '[]',           -- JSON [facet code]
  sort INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                            -- author | llm | admin
  status TEXT NOT NULL DEFAULT 'draft',            -- draft | active | retired
  merged_into TEXT, vocab_ver INTEGER NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS family (                -- 변형 묶음: 같은 세부 포인트, 같은 원리
  course_id INTEGER NOT NULL, code TEXT NOT NULL,  -- F001… or the author's id
  facet TEXT NOT NULL,
  base_problem_id INTEGER,
  principle TEXT NOT NULL DEFAULT '',              -- what every member keeps fixed (the radical), ≤ 90자
  source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'auto',   -- auto | ok | rejected
  updated_at TEXT NOT NULL,
  PRIMARY KEY (course_id, code)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS family_member (
  problem_id INTEGER PRIMARY KEY REFERENCES problem(id),        -- one family per problem
  course_id INTEGER NOT NULL, family TEXT NOT NULL,
  role TEXT NOT NULL,                              -- base | iso | near
  delta_type TEXT,                                 -- null for base; surface | repr | object | condition | qualifier | reverse | neighbour | combine
  delta TEXT NOT NULL DEFAULT '',                  -- what changed vs base, learner-readable ≤ 40자 ("블록 삼각 → 일반 블록")
  body_hash TEXT NOT NULL,                         -- membership is stale when the current version's hash differs
  source TEXT NOT NULL, conf INTEGER NOT NULL DEFAULT 2, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS family_member_f ON family_member(course_id, family);
```

### 5.2 Columns added to tables that already exist live (`db.js` start-up migration)

`kc`, `misc` and `item_tag` already exist live (empty). `CREATE TABLE IF NOT EXISTS` will not add columns, so `db.js` adds them when `PRAGMA table_info` shows they are missing (DB_프롬프트 §5).

```sql
ALTER TABLE misc     ADD COLUMN facet TEXT;                       -- the goal facet this belief distorts
ALTER TABLE item_tag ADD COLUMN facet TEXT;                       -- primary facet
ALTER TABLE item_tag ADD COLUMN depth INTEGER;                    -- 1..4
ALTER TABLE item_tag ADD COLUMN src   TEXT NOT NULL DEFAULT 'llm';  -- author | llm | admin
ALTER TABLE item_tag ADD COLUMN conf  INTEGER NOT NULL DEFAULT 2;   -- 1..3
CREATE INDEX IF NOT EXISTS item_tag_facet ON item_tag(facet);
```
- `item_tag.diag` keeps the SPEC §8.2.4 shape. It adds `"depth_why"`, `"facets2"`, the `mis` arrays under the existing `opt`/`ox`/`short`/`pts` keys, and per-field confidence `"cf": {"facet":3,"depth":2,"mis":2}`.
- **Why columns rather than JSON:** coverage queries (§7) and the admin review queue filter by facet and depth across a whole course. Plain columns keep those to one indexed SQL query.
- No change to `event`.
- Raw events stay exactly as recorded. For example, KEHN X-22 answered "B" 9 times within 1 s is kept as 9 rows. Collapsing repeats is the evidence layer's job (ALGORITHM.md), never a DB cleanup.

### 5.3 Versioning rule (important)

- `problem_version.body` = what the learner sees. Changing it creates a new version, as today.
- **Diagnostic annotations** (`facet`, `depth`, `family`, `role`, `delta_type`, `delta`, `mis`) are **not body keys**:
  - `importPack` takes them from the pack's `dx` block;
  - it writes `item_tag` with `src='author'`, `review='accepted'`, `model='author'`, `prompt_ver=0`, and the hash of the current body;
  - it writes `family` / `family_member` rows the same way.
  - Re-importing a pack with only `dx` changes gives the plan "changed 0" for content plus "tags N".
- `topic` and MC `why` are already body keys (shipped today). They stay there for compatibility, and the tagger reads them as author hints.
- When a new content version appears, the item's tag rows go `stale` through `body_hash` (SPEC §8.4). Author tags are carried over when the change is `fix`/`s`-only (`body_hash` excludes `s` for this check). Otherwise the tags are re-proposed and kept for review.

### 5.4 `db.js` additions (names for 서버)

| function | returns |
|---|---|
| `facetsOf(courseId)` | `[{code, kc, name, statement, kind, confusable[], status}]` |
| `familiesOf(courseId)` | `[{code, facet, base, principle, members:[{pid, role, delta_type, delta, stale}]}]` |
| `miscOf(courseId, facet = null)` | misc rows, optionally for one facet: `{code, facet, kc, cw, belief, truth, contrast, cue, status}` |
| `coverage(courseId)` | per facet: `{n, d12, d34, deltaTypes[], miscOffers:{m:count}, star, exam, target, gaps[]}` (§7) |
| `putAuthorTags(pid, version, dx)` | called by `importPack` |
| `checkPack` | + `dx` rules (§6.3) |

---

## 6. Pack format (format 1, backward compatible) and 과목추가 rules

### 6.1 Course block

`course.topics` keeps today's form `{"det": "행렬식"}`. A value may now also be an object carrying facets:

```json
"topics": {
  "det": { "name": "행렬식", "confusable": ["inv"],
    "facets": {
      "swap":  { "name": "행 교환과 부호", "kind": "property", "statement": "두 행을 바꾸면 det의 부호가 바뀐다. 치환행렬의 det는 ±1이다" },
      "block": { "name": "블록 행렬식",   "kind": "condition", "statement": "블록 삼각(B=0 또는 C=0)일 때만 det = det A·det D" } } },
  "inv": "역행렬"
},
"misconceptions": {
  "m_det_perm1": { "facet": "det.swap",  "belief": "치환행렬은 1을 옮긴 것뿐이라 det가 항상 1이라고 생각함", "truth": "행 교환이 홀수 번이면 det = −1이다" },
  "m_det_2x2":   { "facet": "det.block", "belief": "2×2 공식 ad−bc를 블록에도 그대로 쓸 수 있다고 생각함", "truth": "블록 삼각일 때만 det A·det D", "cw": null }
}
```

### 6.2 Problem block: `dx`

```json
{ "ext_id": "ox-59", "chapter": "3.1-2", "kind": "ox", "ox": false, "topic": "det",
  "q": "치환행렬의 행렬식은 항상 1이다.", "fix": "치환행렬의 det는 ±1 (교환 횟수가 홀수면 −1)",
  "s": "<p>…</p><p>함정: 단위행렬의 행을 바꾼 것이라 1처럼 보이지만, 한 번 바꿀 때마다 부호가 바뀝니다.</p>",
  "dx": { "facet": "det.swap", "depth": 4, "family": "det-swap", "role": "near",
          "delta": ["object", "행 교환 규칙을 치환행렬에 적용 + '항상'"], "mis": "m_det_perm1" } }
```

For MC items, `dx.mis` is an array parallel to `opts`: `""` for the correct option, `null` when no belief is diagnosable. `why` keeps the learner-view text for each option.

### 6.3 `checkPack` rules for `dx`

All rules apply only when the field is present, so old packs pass unchanged.

- `dx.facet` = `<topic>.<f>`, and the facet exists in `course.topics[topic].facets`. If `topics[topic]` is a plain string, the facet is accepted as a new draft facet with a warning.
- `dx.depth` ∈ 1..4.
- `role` ∈ base/iso/near. `delta[0]` ∈ the delta types. A base has no delta. An `iso` member uses `surface` or `repr` and has the same depth as its base.
- Per family: exactly one base, ≥ 2 members, all on the same facet.
- `mis` codes exist in `course.misconceptions`. For MC, the array length equals `opts`, and the correct index is `""`.
- `misconceptions[*].facet` exists. The belief is ≤ 70자 and ends with "생각함". The truth is ≤ 90자.
- A confusion pair needs both directions: a `cw` between two facets needs items whose `mis` point A→B and B→A, otherwise a warning (not an error).

### 6.4 Proposed text for 과목추가_프롬프트.md §3-7 (to add after approval)

> **3-7. 깊이·세부 포인트·변형 (학습 리포트 v2)**
> - 개념(`topics`)마다 세부 포인트(`facets`) 1~5개를 둔다. 세부 포인트는 "시험에서 틀릴 수 있는 한 문장"을 **바르게** 쓴 것이다 (90자 이내). 지엽 = 개념의 세부(정의 문구, 하위 분류, 경계, 요건, 원인→결과)이며, 사례의 수치·이름·연도는 세부 포인트가 아니다.
> - 문제마다 `dx`를 쓴다: `facet`, `depth`(1 정의 · 2 적용 · 3 구별 · 4 조건, 판단 규칙은 DATA.md §4.2), 오답 보기·거짓 진술마다 `mis`(과목 `misconceptions`의 코드).
> - 세부 포인트마다 4문제 이상: 깊이 1–2 문제 1~2개 + 깊이 3–4 "살짝 바꾼" 문제 1~2개(바뀐 점 `delta`의 종류가 서로 다르게) + 대표 오개념을 고를 수 있는 문제 3개 이상(겹쳐도 됨). ★·기출 세부 포인트는 6문제.
> - 깊이는 "강의에서 그대로 배운 문장인가"로 먼저 가른다. 배운 문장을 뒤집은 O/X는 경계처럼 보여도 깊이 1이다.
> - 살짝 바꾼 문제는 기준 문제(`role: base`)와 같은 `family`로 묶고, 무엇을 바꿨는지 `delta`에 쓴다(대상·조건·한정어·역·이웃 개념·결합·표현 중 하나만 바꾼다).
> - 헷갈리는 개념 쌍은 A를 B로, B를 A로 착각하는 문제를 둘 다 둔다.
> - 해설에서 보기를 "둘째 보기"처럼 **위치로 가리키지 않는다**. 보기 순서가 바뀌면 틀린 말이 된다. 보기별 착각은 `why`에 쓴다.

---

## 7. How many variants are needed, and how coverage is measured

### 7.1 Targets per facet

These come from the **looser** decision rules in `ALGORITHM.md` §5 (서버, 2026-10-26, after DECISIONS 3). Only items whose tags have conf ≥ 2 count; legacy rows don't count. Weaker claims always use hedged wording plus a 확인 문제.

| claim | evidence rule (ALGORITHM.md §5) | what the facet must offer |
|---|---|---|
| 착각 (misconception), firm | P(m) ≥ .70, m chosen on ≥ 2 different items; no depth condition | ≥ 3 items offering m, so one confirmation item is still unseen after two hits |
| 착각 (misconception), hedged ("~일 수 있어요" + 확인 문제) | P(m) ≥ .55, m chosen on ≥ 1 item (a re-pick of the same item after feedback counts) | ≥ 2 items offering m: one to hit, one to confirm |
| 착각 (familiar), firm only | on one facet: ≥ 1 correct on base/iso + ≥ 2 wrong on *different* near items (first attempts, not rapid); P(S) ≥ .65; no m with P > .5 | a family: base + ≥ 2 near items with different `delta_type` |
| 확실히 앎, firm | P(K) ≥ .80, P(m) < .30, ≥ 3 items, ≥ 1 correct at depth 3–4 or on a near item | ≥ 3 items, ≥ 1 at depth 3–4 |
| 확실히 앎, hedged | P(K) ≥ .70, P(m) < .30, ≥ 3 items | ≥ 3 items |
| 덜 다져짐 (hedged only) | P(S) + P(N) ≥ .70, ≥ 2 items. Sub-labels: 얕게 앎 = P(S) ≥ .65 + ≥ 1 correct at depth 1–2 + ≥ 1 wrong at depth 3–4; 모름 = P(N) ≥ .70 | items at depth 1–2 **and** 3–4, so the sub-label can say which level fails |
| 판단 보류 | none of the above; `why` = few_items · one_format · no_variant · untagged · rapid_only | — (`no_variant` and `few_items` feed `need_variant`) |

**Target per facet: ≥ 4 items** (the minimum to reach a firm claim; agreed with 서버):
- 1–2 at depth 1–2 (the base);
- 1–2 near variants at depth 3–4 with different `delta_type` (2 are needed for the familiar-form 착각);
- ≥ 3 items offering the leading misc. These may overlap with the above.

★/exam facets get ×1.5, which means **6** items.

When a learner's report wants a confirmation item that doesn't exist, the engine emits `need_variant {facet, depth, delta_type, m}`. The generator treats these exactly like `coverage()` gaps, with higher priority (§9).

### 7.2 Coverage query (what `coverage(cid)` computes)

- For each active facet, count:
  - published current items by depth band (1–2, 3–4);
  - distinct near `delta_type`s;
  - the number of items whose `mis` offers each misc.
- Then compare with the target and emit gaps such as `{"need":"near","depth":"3-4","avoid_delta":["object"],"misc":"m_det_perm1","n":1}`.
- The admin "진단" tab shows this as a facet × depth grid, and the generator (§9) reads it.

### 7.3 Expected size (estimate, to be replaced by the measured gap list)

- At about 20 kcs × 3 facets per course, there are ≈ 300 facets across 5 courses. At 4–6 items each, the bank needs ≈ 1,200–1,600 well-spread items.
- We have 1,193, unevenly spread. LA2 alone has 453, mostly depth 1–2 O/X and MC that restate taught facts.
- A plausible gap is **250–500 new variant items**, concentrated in deep (3–4) near variants and in misc-offering items.
- The real number comes from `coverage()` after tagging. It can be cut by targeting only facets that learners actually reach (§9 order).

---

## 8. Tagging the existing 1,193 items

### 8.1 Passes

| pass | unit | output | change vs SPEC §8 |
|---|---|---|---|
| **A vocab** | one call per chapter (44) | kcs (2–6) **with facets (1–5 each)**, misc catalog with `facet` | facets added. For LA2 the kc enum is the 12 topics and the pass outputs facets plus misc only |
| **B merge** | one call per course (5) | merged kcs **and facets**: 15–40 kcs, ≤ 4 facets per kc on average | facets merged too. Facets with < 2 supporting items are folded into the nearest facet |
| — admin approves the vocabulary (one screen per course), which bumps `vocab_ver:<cid>` | | | |
| **C item** | batches by chapter × kind: OX 8, MC 4, short 5, essay 3 (≈ 238 calls) | facet (+ ≤ 2 secondary), depth + `depth_why`, per-option/statement `mis` with `d`, `src`, `err` (SPEC fields kept) | facet, depth, depth_why added |
| **D second opinion** | 12 items per call (≈ 100), different model or shuffled order, compact schema | facet + depth only | new: gives `conf` |
| **E family** | one call per facet with ≥ 2 items, 4 facets per call (≈ 80) | families: base, members, role, delta_type, delta, principle | new |
| **F verify** | SPEC §8.2.5 unchanged (≈ 70) | blind-pick check of inferred misc with d ≥ 2, plus facet fit | — |

### 8.2 Pass C prompt additions (Korean system prompt, appended to SPEC §8.2.3)

```
9. facet: 아래 세부 포인트 목록에서 "이 문제의 정답이 무엇에 달려 있는가"를 하나 고른다. 풀이 중 잠깐 쓰이는 것은 facets2(최대 2개).
10. depth: 학생이 그 세부 포인트로 무엇을 해야 맞히는지로 정한다. 규칙 id를 depth_why에 쓴다.
   D1a 배운 문장 그대로 알아보기 · D1b 한 단어만 반대로 바꾼 거짓 진술 · D1c 정의된 용어 이름 대기
   D2a 강의 예와 같은 모양에 적용(계산·분류·절차) · D2b 같은 대상·같은 표현
   D3a 이웃 개념과 고르기(오답이 이웃 개념) · D3b 조건이 성립하는지 확인 · D3c 이웃 개념의 성질을 붙인 거짓 진술
   D4a 강의에 없던 대상·표현 · D4b 예외·경계 · D4c 항상·모든·만·반드시, 역·대우 · D4d 다른 세부 포인트와 결합
   두 단계가 다 맞으면, 낮은 단계만 아는 학생이 틀리게 되는 경우에만 높은 단계를 고른다. 깊이는 난이도가 아니다.
11. 사례·수치·인명·연도는 세부 포인트가 아니다. 사례 문제는 그 사례가 보여 주는 개념의 세부 포인트로 고른다.
```

Schema addition inside each item object:

```json
"facet":{"type":"STRING","enum":["f1","…"]},
"facets2":{"type":"ARRAY","maxItems":2,"items":{"type":"STRING","enum":["f1","…"]}},
"depth":{"type":"STRING","enum":["1","2","3","4"]},
"depth_why":{"type":"STRING","enum":["D1a","D1b","D1c","D2a","D2b","D3a","D3b","D3c","D4a","D4b","D4c","D4d"]}
```
- Facet refs are local, `f1…` per batch: the chapter's facets plus their confusables, ≤ 20. That follows the small-candidate-list rule.
- **The prompt input adds the chapter's taught statements:** the facet statements, plus `course.concepts[chapter]` text when it exists, cut to ≈ 1,500 characters. Without them the tagger cannot apply D1b ("taught statement flipped") and will over-rate depth, as the ox-59 case in §10.1 shows.
- The server validates that `depth` is consistent with `depth_why` (the prefix digit).

### 8.3 Pass E (families) prompt and schema

```
아래는 같은 세부 포인트 "{statement}"를 묻는 문제들이다. 같은 원리를 묻는 문제끼리 변형 묶음으로 나눈다.
- 묶음마다 기준 문제(base) 1개: 가장 배운 모양에 가까운 것.
- 나머지는 기준에서 무엇이 바뀌었는지: iso(겉모습만: 숫자·문장·순서·언어) 또는 near(한 가지 구조만 바뀜).
  near의 delta_type: repr · object · condition · qualifier · reverse · neighbour · combine 중 하나, delta에 무엇이 바뀌었는지 40자 이내.
- 두 가지 이상 바뀌었거나 원리가 다르면 같은 묶음에 넣지 않는다(혼자 남겨도 된다).
- principle: 묶음 전체가 지키는 원리 한 문장.
```
```json
{"type":"OBJECT","properties":{"families":{"type":"ARRAY","items":{"type":"OBJECT",
 "propertyOrdering":["principle","base","members"],"properties":{
 "principle":{"type":"STRING"},
 "base":{"type":"STRING","enum":["q1","…"]},
 "members":{"type":"ARRAY","minItems":1,"items":{"type":"OBJECT","propertyOrdering":["ref","role","delta_type","delta"],"properties":{
   "ref":{"type":"STRING","enum":["q1","…"]},
   "role":{"type":"STRING","enum":["iso","near"]},
   "delta_type":{"type":"STRING","enum":["surface","repr","object","condition","qualifier","reverse","neighbour","combine"]},
   "delta":{"type":"STRING"}},"required":["ref","role","delta_type","delta"]}}},
 "required":["principle","base","members"]}}},"required":["families"]}
```

Server checks before writing:
- each ref appears at most once;
- `iso` ⇒ `delta_type ∈ {surface, repr}` and same depth as the base, otherwise demote to `near` (if the delta type is not surface) or drop;
- warn when a near member's depth is below the base's;
- families of size 1 are dropped.

### 8.4 Validation (on top of SPEC §8.2.4)

- **Depth sanity vs item form.**
  - A short answer that only names a term cannot be depth > 1 unless `depth_why` is D4a/D4d.
  - A false OX statement whose `fix` differs from the statement by one word antonym is D1b.
  - Disagreements are lowered to `conf = 1`.
- **`neighbour` deltas** require the neighbour facet to be in the base facet's `confusable`. Otherwise the delta is added there as a draft.
- **Positional references.** Explanations that point at options by position ("둘째 보기") are flagged to the admin queue, because they break silently when options change. One real case is in §10.3.

### 8.5 Confidence (`item_tag.conf`, `family_member.conf`)

| conf | when |
|---|---|
| **3** | `src` = author or admin; **or** passes C and D agree on facet and depth, **and** the item is grounded (the misc came from `fix`, a `함정:` line or author `why`, i.e. SPEC `src` ∈ {explanation, fix}) |
| **2** | C and D agree, not grounded |
| **1** | C and D disagree. Facet disagreement: keep C, send to review. Depth off by one: keep the lower, send to review only if the item is high-demand |

The engine weighs evidence by `conf` (see ALGORITHM.md). A depth-based claim ("얕게 앎", "착각") should rest on conf ≥ 2 items only.

### 8.6 Order, quota and schedule

- **Rollout is per course** (DECISIONS 5). One course runs through every pass, then the short review (§8.7), then the gate. Only then does it switch to the v2 report; untagged courses keep v1.
- **Gate:** `insight_meta('v2_ready:<cid>') = '1'` is set when all of these hold:
  - the course vocabulary is approved;
  - that course's 12 gold items pass (§8.7);
  - ≥ 90% of its published items have tags with conf ≥ 2 or a review.

  The engine and UI read this flag per course.
- **Course order (confirmed by the user):**

| order (confirmed) | course | ≈ calls | heavy-device items | why |
|---|---|---|---|---|
| 1 | 생경론 IE216 | 58 | 83 | smallest, so the first v2 report arrives fastest (1–2 days even at worst-case quota) |
| 2 | 공학수학 LA2 | 213 (incl. 15 gold) | 120 | most evidence; kc layer is free from `topic` |
| 3 | 경정시 MIS | 94 | 64 | |
| 4 | 진인본 KEHN | 83 | 32 | |
| 5 | 응용통계 IE208 | 95 | 26 | |

- **Within a course:** SPEC §8.4 demand-first (devices with wrong first attempts, devices that answered, MC, ★, exams).
- **Quota:** tagging uses at most **60% of each model's daily quota**, and essay grading always comes first (brief). Budget is read from `ai_budget` (already live).

| pass | calls |
|---|---|
| A vocab (44 chapters) | 44 |
| B merge | 5 |
| gold (§8.7) | 15 |
| C item | ≈ 238 |
| D second opinion | ≈ 100 |
| E family | ≈ 80 |
| F verify | ≈ 70 |
| **total** | **≈ 550** |

| quota assumption | tagging calls/day at 60% | whole bank | heavy device's items (≈ 150 calls incl. A/B) |
|---|---|---|---|
| 250 RPD per model × 2 models | 300 | ≈ 2 days | day 1 |
| worst case 20 RPD × 3 models (SPEC C11) | 36 | ≈ 15 days | ≈ 4 days |

### 8.7 Gold test and admin review

- **Gold set:** 60 items, 12 per course, stratified by kind and chapter. Each item gets two independent labels: Gemini pass C, and a Claude/Sonnet labeller with the same rubric.
  - **Go** if facet agreement ≥ 85% (the SPEC gate) and depth weighted κ ≥ 0.6.
  - Depth labels are expected to be the least reliable tag. If κ < 0.6, first tighten the rubric examples. If it is still low, collapse to 3 levels (merge 1 and 2) and tell 서버.
- **Admin review, designed to stay short: about 15 minutes per course, done when that course rolls out.**
  1. **Vocabulary screen (required, about 10 min).**
     - Shows kcs → facets → misc, each with its item count and two example items.
     - Everything starts accepted. The admin only renames, merges or drops what is wrong, then presses one "확인" button.
  2. **Tag check (optional, at most 20 items, about 4 min).**
     - Only conf-1 tags on items that learners have actually answered, sorted by impact.
     - Each card shows the item, the proposed facet and depth, and a one-line reason, with two buttons: 맞음 / 고치기.
     - Unreviewed items simply stay conf 1. The engine then won't use them for depth or 착각 claims, only for general mastery. So skipping this step makes reports more cautious, never wrong.
  3. **Families:** no manual step. Low-confidence families just don't feed the "familiar ✓ / changed ✗" rule.
- **New variant items (§9)** are approved in small batches: ≤ 3 per facet, shown next to their base item with the blind solver's result. About 20 s per item, whenever a batch is ready.
- Review edits set `src = 'admin'` and `conf = 3`, and the tagger never overwrites them (SPEC `review` rule).

---

## 9. Generating the missing variants

1. **Input = two queues, merged.**
   - The engine's `need_variant {facet, depth, delta_type, m}` comes first, because a real learner is waiting for that confirmation item.
   - Then the `coverage()` gap list: facet, missing depth band, delta types already present (to avoid repeating them), leading misc, ★/exam flag, the family base item and its source pages.
2. **Writer = a Claude authoring session** (DECISIONS 1; Gemini never writes items), following 과목추가 §3-7. It works per course and per facet. For each gap it writes a near variant of the base item by changing **one** radical of an unused delta type, with:
   - full `dx`;
   - `why` per option;
   - `fix` on X items;
   - a `함정:` line;
   - the `src` page checked against the lecture PDF.

   The research summary found LLM distractor rationales weaker than human ones. Grounding in the course PDF and the existing base item is the mitigation.
3. **Checks before import:**
   - `checkPack` with the §6.3 rules.
   - A Sonnet (high effort) verifier that solves blind and must reach the key.
   - The verifier confirms that exactly one radical changed and that it matches `delta_type`.
   - The verifier confirms that the depth matches the rubric and that no case trivia is asked.
4. **Import hidden.** A pack-level `"publish": false` (new `importPack` option) creates the items with `status='hidden'`. The admin "검토 대기" list shows them next to their base item, and approving one publishes it.
   - As built (2026-10-26): `"publish": false` also works **per problem**, and that is the recommended form. Variants are **appended to the course's own pack file**, each placed right after its base item. A separate pack would replace the course block, and every author facet or misc missing from it would be retired.
   - Existing problems never change status on import.
   - Stable ids: a kc, facet or misc code that drops out of a pack becomes `retired` and can never be reused (the import refuses it). A rename keeps the code. In author packs the kc code is the topic key itself (`det`, `dfx`).
5. **Order:**
   - facets where some learner already has an open signal (e.g. heavy device `det.swap`, §10);
   - then ★/exam facets;
   - then the rest.
6. **Later option:** for numeric items (LA2), computational-blueprint generation of `iso` twins. Kim et al. (2025) report generated isomorphs with fewer errors than expert-written ones. This is for retest volume, not for diagnosis.

---

## 10. Worked example: what this data lets the report say (heavy device)

### 10.1 `det.swap` (행 교환과 부호): the "as taught" check changes the story

- ox-54 "두 행을 바꾸면 부호가 바뀐다" is depth 1 ✓.
- ox-59 "치환행렬의 det는 항상 1" was answered **O ✗**. It looks like a transfer item, but the course summary (3.1-2) states "치환행렬 det P = ±1" outright. So it is **depth 1 (D1b)**: a taught point not recalled.
- Correct reading: "행 교환 규칙은 알지만, 강의에서 따로 짚은 '치환행렬 = ±1' 포인트는 기억 못 함" — a gap on a fine point, **not 착각**.
- If ox-59 had been tagged depth 4 + near, the engine would have shown a false "착각". That is why pass C receives the taught statements (§4.2, §8.2) and why ox-59 belongs in the gold set.
- The neighbouring facets are solid on this device:
  - `det.rowop`: ox-55 ✓ (d1), 3.2-8 ✓ (d2);
  - `det.lin`: ox-64 ✓, ox-52 ✓ (both d1), ox-53 ✓ (d3).

### 10.2 `det.block` (블록 행렬식): a real "familiar ✓ / changed ✗" candidate

- **Base x21-t11** "det[[A,B],[0,D]] = det A det D 가 항상 성립 (O)" is depth 1 (taught: 블록 상삼각, 2021 기출). This device has **not tried it**.
- **ox-60** drops the condition (delta `condition`, "블록 삼각 → 일반 블록") and is depth 4. It was answered **O ✗**, with misc `m_det_2x2`.
- **x24-9** combines block structure with row operations (depth 4, D4d) and got **모르겠어요**.
- With ALGORITHM.md's rule (base ✓ + ≥ 2 different near ✗), this facet **cannot be judged yet**. The plan should serve x21-t11 first:
  - ✓ there plus one more near ✗ that offers `m_det_2x2` → **착각** ("블록에도 2×2 공식을 쓴다고 믿음");
  - ✗ there → **모름**.
- The facet has only 1 near item offering `m_det_2x2`, so it emits `need_variant {det.block, 4, object, m_det_2x2}`. A good item to generate is a numeric MC: a 4×4 matrix with 2×2 blocks B ≠ 0 and C ≠ 0, where one wrong option equals det A·det D − det B·det C. That is a new object and it offers the misc. Rewording ox-60 would only be an `iso`.
- ox-46 (block-diagonal *inverse*) ✓ is a different facet (`inv.block`). Without facets, an engine would pool it as "block 1/3 correct".

### 10.3 진인본: one misconception across two items (example from REPORT_UX)

- misc "이타적 행동 = 서로 이익이 되는 행동(상리)이라고 생각함" is offered by:
  - 7-2 (OX, X: "나와 상대의 적합도를 동시에 높이는 행동을 이타적 행동이라 한다");
  - X-13 option A ("상리적인 행동과 이타적인 행동").
- The device chose **A on X-13 ✗**. 7-2 has only a legacy progress row (no event), which ALGORITHM.md excludes.
- So there is one counted hit, which needs a third offering item (target ≥ 3) before 착각 can be claimed.

### 10.4 Data-quality finds while building this example

- **LA2 `x23-7` (block-diagonal inverse, MC).** The explanation says "둘째 보기는 det의 부호를, 셋째는 ½을, 넷째는 전치를 실수", but in the current option order:
  - ① has the sign error;
  - ② is missing the ½;
  - ③ has the transpose;
  - ④ is correct.

  The device chose **B (②, missing ½)**, and the explanation tells them it was a sign error. This is the reason for the "no positional references" rule for new content (§6.4, §8.4). The user decided to leave x23-7 itself unchanged for now (DECISIONS 6).
- **생경론 4-4** was rewritten today as a DFD item. The DFA ↔ DFD pair now exists in one direction only: 4-4 is DFD's name with DFA's definition, and M-19 names DFD. The reverse (DFA's name with DFD's definition) is a ready-made gap for §9.

---

## 11. User decisions applied (DECISIONS.md, 2026-10-26)

| decision | where in this file |
|---|---|
| Variant items: Claude authoring sessions + blind Sonnet solver, imported hidden, published on admin approval | §9 |
| No confidence tap, no two-tier "왜?" | §4.4 (nothing reserved) |
| Looser judgment thresholds (서버) | §7.1 coverage targets follow ALGORITHM.md |
| Per-course rollout as soon as a course is tagged | §8.6 gate `v2_ready:<cid>` and course order |
| Admin review kept short | §8.7, about 15 min per course |
| x23-7 explanation left unchanged | §10.4 |

Also confirmed by the user: depth labels 1 정의 · 2 적용 · 3 구별 · 4 조건 (§4.2), and the course order 생경론 → 공학수학 → 경정시 → 진인본 → 응용통계 (§8.6).

---

## Sources

- Leighton, Gierl & Hunka (2004), attribute hierarchy method, *J. Educational Measurement* 41: [Attribute hierarchy method](https://en.wikipedia.org/wiki/Attribute_hierarchy_method), [Leighton, Cui & Corr (2009) application](https://journal.psych.ac.cn/acps/EN/abstract/abstract3186.shtml)
- Webb's Depth of Knowledge vs revised Bloom: [Ohio DOE comparison](https://dam.assets.ohio.gov/image/upload/sboe.ohio.gov/Educator-Evaluations/QualityAssessments/DOK-Compared-to-Blooms-Taxonomy.pdf), [Keystone DOK guide](https://bhs.bwschools.net/uploaded/Keystone_Exams_Understanding_Depth_of_Knowledge_and_Cognitive_Complexity.pdf), [Anderson & Krathwohl overview](https://www.structural-learning.com/post/anderson-and-krathwohl)
- Minstrell facets, goal vs problematic facets: [NRC appendix](https://nap.nationalacademies.org/read/6296/chapter/231.html), [IES facet-based assessment project](https://ies.ed.gov/use-work/awards/establishing-validity-and-diagnostic-capacity-facet-based-science-assessments)
- Item models, incidentals vs radicals, siblings: [Automatic item generation](https://en.wikipedia.org/wiki/Automatic_item_generation), [Gierl & Lai NCME module](https://ncme.org/wp-content/uploads/2025/10/Module-34-Automated-Item-Generation-Gierl-Lai.pdf)
- Item family calibration: [Sinharay, Johnson & Williamson, ETS RR-03-04](https://www.ets.org/research/policy_research_reports/publications/report/2003/hsgg.html), [Johnson & Sinharay RR-03-23](https://www.ets.org/research/policy_research_reports/publications/report/2003/hygj.html)
- Ordered multiple choice: [Briggs, Alonzo, Schwab & Wilson (2006)](https://experts.colorado.edu/display/pubid_97217); distractor-based DCMs: [Psychometrika 2025](https://www.cambridge.org/core/journals/psychometrika/article/plausible-and-proper-multiplechoice-items-for-diagnostic-classification/A1203B5CC2DC34212A01DBB3223FE08C)
- SICM: [Bradshaw & Templin (2014), Psychometrika](https://www.cambridge.org/core/journals/psychometrika/article/combining-item-response-theory-and-diagnostic-classification-models-a-psychometric-model-for-scaling-ability-and-diagnosing-misconceptions/C84E77F9C56B4857BD6DE3CC047D6A7A)
- Multi-tier tests and CRI: [Review of four-tier tests](https://www.tused.org/index.php/tused/article/view/1180)
- Hypercorrection: [Hypercorrection (psychology)](https://en.wikipedia.org/wiki/Hypercorrection_(psychology)), [Duke: understanding the hypercorrection effect](https://dukespace.lib.duke.edu/items/d6ab09ca-f55c-4efb-9d32-2788bc5838b2)
- LLM-generated KCs: [Wang, Lin & Koedinger (2025)](https://papers.cool/arxiv/2511.09935), [KC generation for coding problems](https://arxiv.org/html/2502.18632v3)
- Isomorphic problem generation: [Kim, Nam & Jo, Computational Blueprints (EMNLP 2025 Industry)](https://arxiv.org/html/2511.07932v1)
- Prior internal research: `docs/insight/research/misconceptions.md`, `learner_model.md`
