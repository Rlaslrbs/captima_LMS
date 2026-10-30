// 과목 화면: 메뉴(챕터·시험 대비 카드) → 범위 화면(문제 풀기 / 오답노트, 집중 모드)
// 문제 카드·채점·오답노트는 이번 학기 문제노트 템플릿(quiz_template.html)을 옮겨 온 것이다.
import { $, $$, esc, LS, KIND, LETTERS, barHTML, toast, ask } from "./util.js";
import { S, loadCourse, saveProgress, deleteProgress, setResume, setLast, track, hiddenMs, toggleEnroll, isEnrolled, pullCourse, api, onChange, isSaved, toggleSaved, savedCount, flush, sendEvents, nextPos, sessionSec } from "./store.js";
import { initFocus } from "./focus.js";
import { typeset as typesetMath, clearMath } from "./math.js";

const SPECIAL = [
  { key: "ALL", hn: "전체", title: "전체 문제 풀기", note: "모든 범위를 한 번에", f: () => true },
  { key: "STAR", hn: "★ 중요", title: "중요 문제 모음", note: "시험 직전 우선 복습", f: p => p.star },
  { key: "K:ox", hn: "O/X", title: "O/X 모음", note: "개념 함정 빠르게 점검", f: p => p.kind === "ox" },
  { key: "K:mc", hn: "객관식", title: "객관식 모음", note: "보기에서 고르기", f: p => p.kind === "mc" },
  { key: "K:short", hn: "서답형", title: "서답형 모음", note: "용어·약자·계산", f: p => p.kind === "short" },
  { key: "K:essay", hn: "서술형", title: "서술형 모음", note: "모범 답안 + 채점 포인트", f: p => p.kind === "essay" },
];

/** 줄바꿈만 있는 글(공수2 문제 등)은 <br>로 바꿔 보여 준다 */
const fmt = s => (s && !/<(p|ol|ul|table|div|br|section)\b/i.test(s) ? String(s).replace(/\n/g, "<br>") : s || "");

// ───────── 채점 순간 화면 테두리 효과 (맞힘 = 초록, 틀림 = 빨강 + 흔들림) ─────────
function playHit(v) {
  let el = $("#hit"); if (!el) { el = document.createElement("div"); el.id = "hit"; el.className = "hit"; el.setAttribute("aria-hidden", "true"); document.body.appendChild(el); }
  el.className = "hit"; void el.offsetWidth; el.className = "hit " + v;
  if (v === "bad") { const st = $("#view"); st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake"); }
}

// 서버가 켜 둔 기능 (AI 채점 도우미 등). 한 번만 묻는다
let featuresP = null;
const features = () => (featuresP ||= api("GET", "/api/features").catch(() => { featuresP = null; return {}; }));
const AI_MARK = { covered: ["✓", "들어감"], partial: ["△", "애매함"], missing: ["✕", "빠짐"] };
const AI_VERDICT = { correct: "맞음에 가까움", partial: "일부 부족", wrong: "많이 부족" };

export async function mountCourse(view, route, ctx) {
  view.innerHTML = `<div class="wrap"><div class="loading"><span class="spin"></span>과목을 불러오는 중…</div></div>`;
  const [C, feat] = await Promise.all([loadCourse(route.cid), features()]);
  const aiOn = !!feat.ai_grade;
  // 학습 리포트: 서버가 켠 경우만. 개발용 ?insightFixture=1(ready|hyp|thin|locked|none|no_consent|error)이면 서버 없이 예시로 본다 (이 탭에서 계속, =0으로 끔)
  // 예시는 INSIGHT_DEV=1로 켠 서버(features.insight_dev)에서만 → 테스터는 가짜 리포트를 볼 수 없다
  const insDev = !feat.insight_dev ? "" : (() => { try { const q = new URLSearchParams(location.search).get("insightFixture"); if (q !== null) sessionStorage.setItem("mn:insightFixture", q); const v = sessionStorage.getItem("mn:insightFixture") || ""; return v === "0" ? "" : v === "1" ? "ready" : v; } catch { return ""; } })();
  const insOn = !!feat.insight || !!insDev;
  const cid = C.id;
  const P = C.problems; const BYID = {}; P.forEach(p => { BYID[p.id] = p; });
  const CHS = C.chapters; const CHBYID = {}; CHS.forEach(c => { CHBYID[c.id] = c; });
  const chOf = p => CHBYID[p.chapter_id] || {};
  const files = C.files || {};

  // 화면 상태
  let set = route.set, tab = route.tab;
  const ui = Object.assign({ kind: "all", show: "all", star: false }, LS.get("ui:" + cid, {}));
  const persist = () => LS.set("ui:" + cid, { kind: ui.kind, show: ui.show, star: ui.star, more: !!ui.more });
  const open = {};            // 정답을 펼친 문제
  const keep = new Set();     // 방금 푼 문제: 필터에서 바로 사라지지 않게 잡아 둔다
  const aiRes = {};           // AI 채점 결과 (이 화면에서만): problem_id → { id, verdict, points, feedback }
  const aiBusy = new Set();
  const graded = new Set();   // 이 화면에서 방금 채점한 문제 (틀린 문제를 다시 풀 때 직접 채점 버튼을 한 번만 보여 주려고)
  const unsaved = new Set();  // "나중에 볼 문제" 화면에서 ☆를 끈 문제 (실수로 눌러도 바로 사라지지 않게)
  const drafts = {};          // 입력 중인 답 (저장 안 함)
  const shownAt = {};         // 풀이 시간 측정: problem_id → { t, h }
  const shownLogged = new Set();
  let scopeAsk = false;
  const prog = id => S.progress[id] || {};
  // 풀이 행동 기록 (Contract 5)
  const firstKey = {};        // 서답형·서술형: 처음 글자를 친 때 → rd (읽고 계획한 시간)
  const vis = {};             // 목록 모드: 카드가 60% 넘게 보인 시간 problem_id → { ms, at, on } → vis
  let away = 0;               // 탭을 숨긴 횟수 → away (풀이 중 끊김)
  let dwell = null;           // 방금 채점한 카드 { pid, v, ok, t, h } → 떠날 때 sol_dwell
  // 학습 리포트 (insight.js)
  let ins = null, insTok = 0, insOv = null, insAsked = false, gone = false;
  let jumpTo = null, jumpVia = null;   // 리포트 근거 칩에서 연 문제 (그 장에서 바로 그 카드로)
  const qT = {};              // Q: 범위 제목 (리포트 계획에서 찾은 것)

  // 과목 색
  const dark = () => document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  function paint() {
    const col = C.color || { light: "#0066cc", dark: "#2997ff" };
    view.style.setProperty("--accent", dark() ? col.dark : col.light);
    view.style.setProperty("--accent-weak", `color-mix(in srgb, ${dark() ? col.dark : col.light} ${dark() ? 18 : 10}%, transparent)`);
  }

  view.innerHTML = `<div class="wrap cview">
    <header class="c-head">
      <div class="c-id"><span class="badge" style="--c:var(--accent)">${esc(C.short)}</span>
        <div class="c-tt"><h1 id="cTitle">${esc(C.name)}</h1><p class="sub">${esc([C.professor && C.professor + " 교수", C.meta, C.semester && C.semester.name].filter(Boolean).join(" · "))}</p></div></div>
      <button class="enroll" id="enrollBtn" aria-pressed="false"></button>
    </header>
    <div class="crumb" id="crumb" hidden></div>
    <nav class="tabs" role="tablist" id="tabsNav" hidden>
      <button class="tab" role="tab" id="tab-solve">문제 풀기</button>
      <button class="tab note" role="tab" id="tab-note">오답노트 <span class="cnt" id="noteCnt">0</span></button>
    </nav>
    <section class="stats" id="stats" hidden></section>
    <div class="toolbar" id="toolbar" hidden></div>
    <main id="main"></main>
  </div>`;
  paint();
  const main = $("#main", view);
  const mq = matchMedia("(prefers-color-scheme: dark)"); const onScheme = () => { paint(); }; mq.addEventListener("change", onScheme);
  const offTheme = ctx.onTheme(paint);

  function renderEnroll() {
    const on = isEnrolled(cid); const b = $("#enrollBtn", view);
    b.setAttribute("aria-pressed", on); b.innerHTML = `<span class="st">${on ? "★" : "☆"}</span>${on ? "내 강의실에 있음" : "내 강의실에 담기"}`;
  }

  // ───────── 범위 ─────────
  function scopeOf(key) {
    const ch = CHS.find(c => c.key === key);
    if (ch) return { key, title: ch.title, f: p => p.chapter_id === ch.id };
    if (key === "NOTE") return { key, title: "전체 오답노트", f: () => true };
    if (key === "SAVED") return { key, title: "나중에 볼 문제", f: p => isSaved(p.id) || unsaved.has(p.id) };   // 이 화면에서 뺀 문제는 나갈 때까지 남겨 둔다
    if (/^Q:/.test(key || "")) {                       // 학습 리포트가 고른 문제 묶음: 적힌 순서대로
      const ids = key.slice(2).split(".").map(Number).filter(id => BYID[id]).slice(0, 12), order = new Map(ids.map((id, i) => [id, i]));
      return { key, title: qTitle(key, ids), f: p => order.has(p.id), order };
    }
    return SPECIAL.find(x => x.key === key) || SPECIAL[0];
  }
  function qTitle(key, ids) {   // Q: 제목은 저장해 둔 리포트(계획)에서 찾는다
    if (qT[key]) return qT[key];
    const d = LS.get("ins:" + cid, null) || {}, pl = d.plan || {}, st = (pl.steps || []).find(s => s.scope === key);
    const is = a => Array.isArray(a) && a.length > 0 && key === "Q:" + a.join(".");
    return (qT[key] = st ? st.title : is(pl.today && pl.today.pids) ? "오늘의 복습" : is(d.relearn && d.relearn.due) ? "고친 문제 확인"
      : is(d.next && d.next.pids) ? "지금 풀면 좋은 문제" : ids.length === 1 ? "다시 풀기 · " + (BYID[ids[0]].no || BYID[ids[0]].ext_id) : "추천 문제");
  }
  const isQ = () => /^Q:/.test(set || "");
  const scopeLog = () => isQ() ? "Q" : set;           // 기록에는 Q: 문제 번호 목록을 다 싣지 않는다 (기록 한 줄이 길어져 잘리지 않게)
  const scoped = () => { const sc = scopeOf(set), l = P.filter(sc.f); return sc.order ? l.sort((a, b) => sc.order.get(a.id) - sc.order.get(b.id)) : l; };
  const scopeKey = () => `${cid}|${set}|${tab}`;
  function counts(list) {
    let c = 0, w = 0, r = 0; list.forEach(p => { const s = prog(p.id).status; if (s === "correct") c++; else if (s === "wrong") w++; else if (s === "resolved") r++; });
    return { c, w, r, done: c + w + r, all: list.length };
  }

  // ───────── 기록 ─────────
  function markShown(pid, idx) {
    if (!pid || !BYID[pid]) return;
    if (!shownAt[pid]) shownAt[pid] = { t: Date.now(), h: hiddenMs(), a: away };
    if (!shownLogged.has(pid)) { shownLogged.add(pid); track("problem_shown", { problem_id: pid, version: BYID[pid].v, scope: scopeLog(), mode: focus && focus.isFocus() ? "focus" : "list", idx }); }
  }
  function spent(pid) {
    const s = shownAt[pid]; if (!s) return null;
    return Math.max(0, Date.now() - s.t - (hiddenMs() - s.h));
  }
  // 목록 모드에서 카드가 실제로 보인 시간: 60% 넘게 보이고 탭이 보일 때만 잰다
  function visOn(id, on) {
    const v = vis[id] ||= { ms: 0, at: 0, on: false }; v.on = on;
    if (on && !v.at && !document.hidden) v.at = Date.now();
    if (!on && v.at) { v.ms += Date.now() - v.at; v.at = 0; }
  }
  function visStop(all) { const t = Date.now(); for (const k in vis) { const v = vis[k]; if (v.at) { v.ms += t - v.at; v.at = 0; } if (all) v.on = false; } }
  function visTake(id) { const v = vis[id], ms = v.ms + (v.at ? Date.now() - v.at : 0); v.ms = 0; if (v.at) v.at = Date.now(); return Math.round(ms); }
  function onHide() {   // 탭을 숨기면 보인 시간을 멈추고 끊김을 센다
    if (document.hidden) { away++; visStop(false); } else for (const k in vis) if (vis[k].on && !vis[k].at) vis[k].at = Date.now();
  }
  /** 답 하나의 풀이 행동 (Contract 5). ms의 뜻은 그대로 두고 옆에 붙인다 */
  function behave(pid, p) {
    const s = shownAt[pid], k = firstKey[pid], txt = p.kind === "short" || p.kind === "essay", list = !(focus && focus.isFocus());
    return { vis: list && vis[pid] ? visTake(pid) : undefined, away: s ? away - s.a : undefined, pos: nextPos(), sess: sessionSec(), hr: new Date().getHours(),
      rd: txt && k && s ? Math.max(0, Math.round(k.t - s.t - (k.h - s.h))) : undefined, len: txt ? String(drafts[pid] ?? "").trim().length : undefined };
  }
  function dwellEnd() {   // 채점한 카드를 떠남: 해설을 펼쳐 둔 시간 (숨긴 시간 빼고, 10분까지)
    if (!dwell) return; const d = dwell; dwell = null;
    track("sol_dwell", { problem_id: d.pid, version: d.v, ms: Math.min(6e5, Math.max(0, Math.round(Date.now() - d.t - (hiddenMs() - d.h)))), ok: d.ok });
  }
  const lastGrade = {};
  function grade(pid, ok, answer, extra = {}) {
    const p = BYID[pid]; const prev = prog(pid); const t = new Date().toISOString();
    const ansStr = String(answer ?? "").slice(0, 600);
    // 이미 맞혔거나 해결된 문제면 채점하지 않음
    if (prev.status && prev.status !== "wrong") return;
    // 틀린 뒤 같은 선지(답안)를 다시 누른 경우 무시 (1초 안에 여러 번 누른 연타 방지)
    if (prev.status === "wrong" && prev.last_answer === ansStr) return;
    // 300ms 이내 초고속 연속 클릭 방지 (더블 탭/터치 떨림)
    const nowMs = Date.now();
    if (lastGrade[pid] && nowMs - lastGrade[pid] < 300) return;
    lastGrade[pid] = nowMs;
    const rec = { status: ok ? (prev.wrong_count > 0 ? "resolved" : "correct") : "wrong", attempts: (prev.attempts || 0) + 1,
      wrong_count: (prev.wrong_count || 0) + (ok ? 0 : 1), last_answer: ansStr, updated_at: t, version: p.v, cid };
    const ms = spent(pid);
    const seen = !!open[pid] && prev.status === "wrong";   // 오답 뒤 해설이 펼쳐진 상태에서 다시 고름
    dwellEnd();
    track(extra.idk ? "idk" : "answer_submit", { problem_id: pid, version: p.v, kind: p.kind, answer: rec.last_answer.slice(0, 200), correct: ok, ms, attempt: rec.attempts,
      self: !!extra.self, ai: extra.ai, scope: scopeLog(), mode: focus && focus.isFocus() ? "focus" : "list", seen, ...behave(pid, p) });
    shownAt[pid] = { t: Date.now(), h: hiddenMs(), a: away };   // 다시 풀면 그때부터 다시 잰다
    delete firstKey[pid]; dwell = { pid, v: p.v, ok, t: Date.now(), h: hiddenMs() };
    open[pid] = true; graded.add(pid); keep.clear(); keep.add(pid);
    saveProgress(pid, rec);                            // → onChange("progress") → 카드만 다시 그림
    playHit(ok ? "ok" : "bad");
  }
  function resetScope() {
    const ids = scoped().filter(p => S.progress[p.id]).map(p => p.id);
    ids.forEach(id => { open[id] = false; drafts[id] = ""; });
    keep.clear(); scopeAsk = false; dwellEnd();
    track("retry", { scope: scopeLog(), n: ids.length });
    deleteProgress(ids); render();
  }
  function resetOne(id) {
    open[id] = false; drafts[id] = ""; dwellEnd(); track("retry", { problem_id: id, version: BYID[id].v });
    deleteProgress([id]); render();
  }

  // ───────── 주관식 자동 채점 ─────────
  const norm = s => String(s).toLowerCase().normalize("NFC").replace(/\([^)]*\)/g, "").replace(/[\s\-_.,'’·:;/]/g, "");
  function autoCheck(p, val) {
    if (!val.trim()) return null;
    if (p.num !== undefined) {
      const mm = val.replace(/[−–]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/-?\d*\.?\d+/);
      const x = mm ? parseFloat(mm[0]) : NaN;
      if (isNaN(x)) return false;
      return Math.abs(x - p.num) <= (p.tol ?? 0.01);
    }
    if (p.accept && p.accept.length) { const v = norm(val); return p.accept.some(a => norm(a) === v); }
    return null;   // 직접 채점
  }
  function checkShort(id) {
    const p = BYID[id]; const val = drafts[id] ?? ""; const r = autoCheck(p, val);
    if (r === null || (r === false && !p.strict && p.num === undefined)) { open[id] = true; renderCard(id); return; }   // 정답을 보여 주고 직접 채점
    grade(id, !!r, val);
  }

  // ───────── 통계 · 도구 막대 ─────────
  function renderStats() {
    const list = scoped(); const t = counts(list); const pc = t.done ? Math.round((t.c + t.r) / t.done * 100) : 0;
    const kinds = ["ox", "mc", "short", "essay"].filter(k => list.some(p => p.kind === k));
    const chs = CHS.filter(c => list.some(p => p.chapter_id === c.id));
    const row = (name, k) => `<div class="krow"><span>${esc(name)}</span>${barHTML(k, "in")}<span class="kn">${k.done}/${k.all}</span></div>`;
    const third = chs.length > 1
      ? `<div class="stat"><h3>범위별 진행</h3>${chs.map(ch => row(ch.short || ch.key, counts(list.filter(p => p.chapter_id === ch.id)))).join("")}</div>`
      : `<div class="stat"><h3>유형별 진행</h3>${kinds.map(kd => row(KIND[kd], counts(list.filter(p => p.kind === kd)))).join("")}</div>`;
    // 평소에는 한 줄 요약만 (문제가 바로 보이게). "자세히"를 누르면 통계 3칸 + 유형·기록 줄이 펼쳐진다
    const line = `<div class="sline"><span class="sl-n"><b>${t.done}</b> / ${t.all} 풀이</span>${barHTML(t, "in")}
      <span class="sl-m">정답률 <b>${t.done ? pc + "%" : "–"}</b></span>${t.w ? `<span class="sl-m w">오답 <b>${t.w}</b></span>` : ""}
      <button class="more" id="moreBtn" aria-expanded="${!!ui.more}" aria-controls="statsGrid">${ui.more ? "접기" : "자세히"}<i aria-hidden="true">›</i></button></div>`;
    if (!ui.more) { $("#stats", view).innerHTML = line; $("#noteCnt", view).textContent = list.filter(p => prog(p.id).status === "wrong").length; return; }
    $("#stats", view).innerHTML = line + `<div class="sgrid" id="statsGrid">
      <div class="stat"><h3>진행</h3><div class="big">${t.done}<small> / ${t.all}문제</small></div>${barHTML(t)}
        <div class="legend"><span><i style="background:var(--ok)"></i>한 번에 맞힘 ${t.c}</span><span><i style="background:color-mix(in srgb,var(--ok) 55%,var(--accent))"></i>다시 풀어 해결 ${t.r}</span><span><i style="background:var(--red)"></i>오답 ${t.w}</span></div></div>
      <div class="stat"><h3>정답률 (푼 문제 기준)</h3><div class="big">${t.done ? pc : "–"}<small>${t.done ? " %" : ""}</small></div>
        <div class="legend">${kinds.map(k => { const kk = counts(list.filter(p => p.kind === k)); return `<span>${KIND[k]} ${kk.done}/${kk.all}</span>`; }).join("")}</div></div>
      ${third}</div>`;
    $("#noteCnt", view).textContent = list.filter(p => prog(p.id).status === "wrong").length;
  }
  function chip(group, val, label, n) {
    return `<button class="chip" data-g="${group}" data-v="${esc(val)}" aria-pressed="${ui[group] === val}">${esc(label)}${n !== undefined ? `<span class="n">${n}</span>` : ""}</button>`;
  }
  function renderToolbar() {
    const tb = $("#toolbar", view);
    if (tab !== "solve") { tb.innerHTML = ""; return; }
    const list = scoped();
    const kinds = ["ox", "mc", "short", "essay"].filter(k => list.some(p => p.kind === k));
    const kindRow = kinds.length > 1 && !isQ() ? `<div class="chips"><span class="lab">유형</span>${chip("kind", "all", "전체", list.length)}${kinds.map(k => chip("kind", k, KIND[k], list.filter(p => p.kind === k).length)).join("")}</div>` : "";
    const starBtn = set === "STAR" || !list.some(p => p.star) ? "" : `<button class="chip" id="starBtn" aria-pressed="${ui.star}">★ 중요 문제만</button>`;
    const nDone = list.filter(p => S.progress[p.id]).length;
    const resetRow = nDone ? `<div class="chips"><span class="lab">기록</span>${scopeAsk
      ? `<span class="rs-q">이 범위에서 푼 ${nDone}문제의 기록을 지울까요?</span><button class="chip rs-yes" data-rs="yes">지우고 다시 풀기</button><button class="chip" data-rs="no">취소</button>`
      : `<button class="chip" data-rs="ask">이 범위 기록 지우고 다시 풀기</button>`}</div>` : "";
    // 접혀 있을 때 유형 필터가 걸려 있으면 알약 하나로 보여 주고, 누르면 풀린다. 리포트가 고른 문제(Q:)는 보기 줄 없음
    const kindOn = !ui.more && !isQ() && kinds.length > 1 && ui.kind !== "all" && kinds.includes(ui.kind)
      ? `<button class="chip on-x" data-g="kind" data-v="all" aria-label="${KIND[ui.kind]}만 보기 해제">${KIND[ui.kind]}만 <span aria-hidden="true">✕</span></button>` : "";
    const showRow = isQ() ? "" : `<div class="chips">${ui.more ? `<span class="lab">보기</span>` : ""}${chip("show", "all", "전체")}${chip("show", "todo", "안 푼 문제")}${chip("show", "wrong", "틀린 문제")}${starBtn}${kindOn}</div>`;
    tb.innerHTML = ui.more ? kindRow + resetRow + showRow : showRow;
  }

  // ───────── 문제 카드 ─────────
  const srcText = s => (files[s[0]] || s[0]) + (s[1] ? " · " + (/^\d/.test(s[1]) ? "p." : "") + s[1] : "");
  const srcHTML = p => p.src && p.src.length ? `<div class="src"><span class="lab">출처</span>${p.src.map(s => `<span>${esc(srcText(s))}</span>`).join("")}</div>` : "";
  const sub = s => s ? `<span class="en">${fmt(s)}</span>` : "";
  function solHTML(p, st) {
    const pr = prog(p.id);
    let head = "";
    if (st === "correct" || st === "resolved") head = `<p class="verdict ok">${st === "resolved" ? "해결됨 · " : ""}정답</p>`;
    else if (st === "wrong") head = `<p class="verdict bad">오답노트에 저장됨</p>`;
    let ans;
    if (p.kind === "ox") ans = `<div class="ans"><b>정답 ${p.ox ? "O" : "X"}</b>${p.fix ? ` — ${p.fix}` : ""}</div>`;
    else if (p.kind === "mc") ans = `<div class="ans"><b>정답 ${LETTERS[p.ans]}</b> ${fmt(p.opts[p.ans])}</div>`;
    else if (p.kind === "short") ans = `<div class="ans"><b>정답</b> ${fmt(p.a)}</div>`;
    else ans = `<div class="ans"><b>모범 답안</b><br>${fmt(p.a)}</div>`;
    const full = p.kind === "mc" && p.a && p.stem ? `<div class="ans soft"><b>풀이 결과</b> ${fmt(p.a)}</div>` : "";
    const ar = p.kind === "essay" ? aiRes[p.id] : null;
    const aiHead = ar ? `<div class="aibox"><div class="aih"><span class="aitag">✦ AI 채점 도우미</span><b class="aiv ${ar.verdict}">${AI_VERDICT[ar.verdict] || ""}</b><small>참고용 · 최종 판정은 직접 해 주세요</small></div>${ar.feedback ? `<p class="aif">${esc(ar.feedback)}</p>` : ""}</div>` : "";
    const pts = p.kind === "essay" && p.pts ? `<p><b>채점 포인트</b> — ${ar ? "AI가 확인한 결과예요. 다르면 고쳐서 판단하세요" : "내 답에 들어간 것을 체크해 보세요"}</p><ul class="pts">${p.pts.map((t, i) => {
      const pt = ar && ar.points[i]; const mk = pt && AI_MARK[pt.verdict];
      return `<li class="${pt ? "ai-" + pt.verdict : ""}"><input type="checkbox" id="pt-${p.id}-${i}" ${pt && pt.verdict === "covered" ? "checked" : ""}><label for="pt-${p.id}-${i}">${mk ? `<span class="aim" title="${mk[1]}">${mk[0]}</span>` : ""}${t}${pt && pt.reason ? `<small class="air">${esc(pt.reason)}</small>` : ""}</label></li>`;
    }).join("")}</ul>` : "";
    return `<div class="sol">${head}${aiHead}${ans}${full}${pts}<div>${p.s || ""}</div>${srcHTML(p)}</div>`;
  }
  const saveBtn = p => { const on = isSaved(p.id);
    return `<button class="savep" data-save="${p.id}" aria-pressed="${on}" title="${on ? "나중에 볼 문제에서 빼기" : "나중에 볼 문제에 담기"}" aria-label="${on ? "나중에 볼 문제에서 빼기" : "나중에 볼 문제에 담기"}">${on ? "★" : "☆"}</button>`; };
  function card(p) {
    const pr = prog(p.id); const st = pr.status || "";
    const stLabel = { correct: "맞힘", wrong: "오답", resolved: "해결됨" }[st] || "";
    // 틀린 문제는 다시 풀 때까지 정답·해설을 숨긴다 (오답 표시만 남김). 맞힌 문제는 그대로 펼쳐 둔다
    const shown = open[p.id] || (!!st && st !== "wrong");
    let body = "";
    if (p.kind === "mc") {
      const choice = st ? LETTERS.indexOf(pr.last_answer) : -1;
      body = (p.stem ? `<div class="stem">${fmt(p.stem)}</div>` : "") + `<div class="opts mc">${p.opts.map((o, i) => {
        const cls = !shown ? "" : (i === p.ans ? "good" : (choice === i ? "bad" : ""));
        return `<button class="opt ${cls}" data-mc="${i}" data-id="${p.id}"><b class="k">${LETTERS[i]}</b><span>${fmt(o)}${p.opts_sub && p.opts_sub[i] ? `<small class="ko">${fmt(p.opts_sub[i])}</small>` : ""}</span></button>`;
      }).join("")}</div>` + (!shown ? `<div class="btns"><button class="btn ghost" data-idk="${p.id}">모르겠어요</button><span class="kbd-hint">키보드 <kbd>1</kbd>~<kbd>${p.opts.length}</kbd></span></div>` : "");
    } else if (p.kind === "ox") {
      const choice = st ? (pr.last_answer === "O" ? true : pr.last_answer === "X" ? false : null) : null;
      const cls = v => !shown ? "" : (v === p.ox ? "good" : (choice === v ? "bad" : ""));
      body = `<div class="opts ox"><button class="opt ${cls(true)}" data-ox="1" data-id="${p.id}">O</button><button class="opt ${cls(false)}" data-ox="0" data-id="${p.id}">X</button></div>`;
      if (!shown) body += `<p class="kbd-hint">키보드 <kbd>O</kbd> <kbd>X</kbd></p>`;
    } else {
      const field = p.kind === "short"
        ? `<div class="inrow"><input id="in-${p.id}" type="text" placeholder="${esc(p.ph || "답을 입력")}" value="${esc(drafts[p.id] ?? "")}" autocomplete="off" spellcheck="false"><button class="btn pri" data-check="${p.id}">채점</button></div>`
        : `<textarea id="in-${p.id}" placeholder="답안을 써 보세요 (저장되지 않고, 오답일 때만 오답노트에 남습니다)">${esc(drafts[p.id] ?? "")}</textarea><div class="btns">${shown ? "" : `<button class="btn pri" data-reveal="${p.id}">모범 답안 보기</button>`}${aiOn ? `<button class="btn aibtn" data-ai="${p.id}" ${aiBusy.has(p.id) ? "disabled" : ""}>${aiBusy.has(p.id) ? '<span class="spin"></span>AI가 채점하는 중…' : aiRes[p.id] ? "✦ AI 다시 채점" : "✦ AI 채점 도움"}</button>` : ""}</div>`;
      const self = shown && (!st || (st === "wrong" && !graded.has(p.id))) ? `<div class="btns"><button class="btn okb" data-self="1" data-id="${p.id}">맞았어요</button><button class="btn badb" data-self="0" data-id="${p.id}">틀렸어요 · 오답노트로</button></div>` : "";
      const idk = !shown ? `<div class="btns"><button class="btn ghost" data-idk="${p.id}">모르겠어요</button></div>` : "";
      body = field + self + idk;
    }
    // 집중 모드에서 채점한 뒤: 해설 아래에서 바로 다음 문제로 (목록 모드에서는 CSS로 숨김). 마지막 문제면 fixNext()가 글자를 바꾼다
    const next = st && shown ? `<div class="nextrow"><button class="btn pri lg" data-next="${p.id}"><span class="nl">다음 문제</span><span aria-hidden="true">→</span></button><span class="kbd-hint"><kbd>Enter</kbd></span></div>` : "";
    const tools = `<div class="btns tools">${st ? `<button class="btn ghost" data-reset="${p.id}">기록 지우고 다시 풀기</button>` : ""}<button class="btn ghost rep" data-report="${p.id}">오류 제보</button></div>`;
    const ch = chOf(p);
    const exams = Array.isArray(p.exams) && p.exams.length ? `<span class="exb">기출 ${esc(p.exams.join(", "))}</span>` : "";
    return `<article class="card ${st ? "st-" + st : ""}" id="c-${p.id}">
      <div class="meta"><span class="no">${esc(p.no || p.ext_id)}</span><span class="kindtag">${KIND[p.kind]}</span>${p.star ? '<span class="star">★ 중요</span>' : ""}${exams}<span>${esc(ch.short || "")}</span>${pr.wrong_count ? `<span>틀린 횟수 ${pr.wrong_count}</span>` : ""}<span class="stt ${st}">${stLabel}</span>${saveBtn(p)}<button class="cpy" data-copy="${p.id}" title="문제·정답·해설을 Markdown으로 복사해서 AI에게 바로 물어보기"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>AI 질문용 복사</button></div>
      <div class="q">${fmt(p.q)}${sub(p.q_sub)}</div>
      ${body}${shown ? solHTML(p, st) : ""}${next}${tools}</article>`;
  }

  // ───────── AI 질문용 Markdown 복사 ─────────
  function htmlToMd(html) {
    const box = document.createElement("div"); box.innerHTML = html || "";
    const walk = n => {
      if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, " ");
      if (n.nodeType !== 1) return "";
      const t = n.tagName.toLowerCase(); const kids = () => Array.from(n.childNodes).map(walk).join("");
      if (t === "svg" || t === "style" || t === "script") return n.getAttribute("aria-label") ? `\n(그림: ${n.getAttribute("aria-label")})\n` : "";
      if (t === "br") return "\n";
      if (t === "b" || t === "strong") { const x = kids().trim(); return x ? `**${x}**` : ""; }
      if (t === "i" || t === "em") { const x = kids().trim(); return x ? `*${x}*` : ""; }
      if (t === "sub") return `_{${kids()}}`;
      if (t === "sup") return `^{${kids()}}`;
      if (t === "code") return "`" + kids() + "`";
      if (t === "p" || t === "div") { const x = kids().trim(); return x ? `\n${x}\n` : ""; }
      if (t === "ol" || t === "ul") {
        const items = Array.from(n.children).filter(c => c.tagName.toLowerCase() === "li");
        return "\n" + items.map((li, i) => (t === "ol" ? `${i + 1}. ` : "- ") + walk(li).trim().replace(/\n+/g, " ")).join("\n") + "\n";
      }
      if (t === "table") {
        const rows = Array.from(n.querySelectorAll("tr")).map(tr => Array.from(tr.children).map(td => walk(td).trim().replace(/\|/g, "\\|").replace(/\n+/g, " ")));
        if (!rows.length) return "";
        const w = Math.max(...rows.map(r => r.length)); const pad = r => r.concat(Array(w - r.length).fill(""));
        return "\n" + [pad(rows[0]), Array(w).fill("---"), ...rows.slice(1).map(pad)].map(r => "| " + r.join(" | ") + " |").join("\n") + "\n";
      }
      return kids();
    };
    return walk(box).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function problemMd(p) {
    const pr = prog(p.id); const L = [];
    L.push(`# ${C.name} · 문제 ${p.no || p.ext_id}`);
    L.push(`- 단원: ${chOf(p).title || ""}`, `- 유형: ${KIND[p.kind]}${p.star ? " · ★ 중요" : ""}`);
    L.push("", "## 문제", htmlToMd(p.q));
    if (p.q_sub) L.push("", htmlToMd(p.q_sub));
    if (p.kind === "ox") L.push("", "(O 또는 X로 답하는 문제)");
    if (p.kind === "mc") { if (p.stem) L.push("", htmlToMd(p.stem)); L.push("", p.opts.map((o, i) => LETTERS[i] + ". " + htmlToMd(o)).join("\n")); }
    L.push("", "## 정답");
    if (p.kind === "ox") L.push(`${p.ox ? "O" : "X"}${p.fix ? ` — ${htmlToMd(p.fix)}` : ""}`);
    else if (p.kind === "mc") L.push(LETTERS[p.ans] + ". " + htmlToMd(p.opts[p.ans]));
    else L.push(htmlToMd(p.a));
    if (p.kind === "essay" && p.pts && p.pts.length) L.push("", "## 채점 포인트", p.pts.map(x => "- " + htmlToMd(x)).join("\n"));
    const sol = htmlToMd(p.s); if (sol) L.push("", "## 해설", sol);
    if (p.src && p.src.length) L.push("", "## 출처", p.src.map(s => "- " + srcText(s)).join("\n"));
    if (pr.status === "wrong" && pr.last_answer) L.push("", "## 내가 쓴 답 (오답)", String(pr.last_answer));
    L.push("", "---", "위 문제와 해설을 보고 질문할게요. 시험 대비용이니 개념부터 쉽게 설명해 주세요.", "", "질문: ");
    return L.join("\n");
  }
  function copyText(text) {
    const fallback = () => new Promise((res, rej) => {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch { } ta.remove(); ok ? res() : rej();
    });
    return navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).catch(fallback) : fallback();
  }

  // ───────── 오류 제보 ─────────
  function openReport(pid) {
    const p = BYID[pid];
    const wrap = document.createElement("div"); wrap.className = "sheet-wrap";
    const cats = [["answer", "정답 오류"], ["explanation", "해설 오류"], ["typo", "오타·표현"], ["other", "기타"]];
    wrap.innerHTML = `<div class="modal-bg" data-close></div>
      <form class="bsheet" role="dialog" aria-modal="true" aria-labelledby="rp-t">
        <div class="grab"></div>
        <h2 id="rp-t">오류 제보</h2>
        <p class="rp-q"><b>${esc(C.short)} · ${esc(p.no || p.ext_id)}</b> ${esc(htmlToMd(p.q).replace(/\s+/g, " ").slice(0, 90))}${htmlToMd(p.q).length > 90 ? "…" : ""}</p>
        <div class="seg" role="radiogroup" aria-label="종류">${cats.map(([v, l], i) => `<label><input type="radio" name="cat" value="${v}" ${i === 0 ? "checked" : ""}><span>${l}</span></label>`).join("")}</div>
        <textarea name="msg" maxlength="1000" placeholder="어디가 어떻게 잘못됐는지 적어 주세요. (예: 정답이 B가 아니라 C예요. 교재 p.32 참고)"></textarea>
        <p class="hint">제보는 익명으로 전달돼요. 처리 결과는 마이페이지에서 볼 수 있어요.</p>
        <div class="dlg-btns"><button type="button" class="btn" data-close>취소</button><button type="submit" class="btn pri">보내기</button></div>
      </form>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    const close = () => { wrap.classList.remove("in"); setTimeout(() => wrap.remove(), 260); document.removeEventListener("keydown", key); };
    const key = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    wrap.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); });
    const form = $("form", wrap); setTimeout(() => form.msg.focus(), 280);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $('button[type="submit"]', form); btn.disabled = true; btn.textContent = "보내는 중…";
      try {
        await api("POST", "/api/reports", { problem_id: pid, category: form.cat.value, message: form.msg.value });
        close(); toast("제보했어요. 고마워요! 처리 결과는 마이페이지에서 볼 수 있어요.", "ok");
      } catch (err) { btn.disabled = false; btn.textContent = "보내기"; toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
    });
  }

  // ───────── 화면 그리기 ─────────
  function filtered() {
    // 유형 줄이 안 보이는 범위(유형이 하나뿐, 예: 서술형 모음)나 그 유형이 없는 범위에서는 저장된 유형 필터를 쓰지 않는다
    const sc = scoped(), kinds = new Set(sc.map(p => p.kind));
    if (isQ()) return sc;                               // 리포트가 고른 문제는 필터 없이 전부 (유형·보기 줄도 숨김)
    const kind = kinds.size > 1 && kinds.has(ui.kind) ? ui.kind : "all";
    return sc.filter(p => (kind === "all" || p.kind === kind) && (!ui.star || p.star || set === "STAR")
      && (ui.show === "all" || (ui.show === "todo" && (!S.progress[p.id] || keep.has(p.id))) || (ui.show === "wrong" && (prog(p.id).status === "wrong" || keep.has(p.id)))));
  }
  function withHeads(list) {
    let html = "", last = null; const multi = new Set(list.map(p => p.chapter_id)).size > 1;
    list.forEach(p => { if (multi && p.chapter_id !== last) { last = p.chapter_id; html += `<h2 class="grp-h">${esc(chOf(p).title || "")}</h2>`; } html += card(p); });
    return html;
  }
  function renderSolve() {
    const list = filtered();
    const none = set === "SAVED" && !scoped().length
      ? `<div class="empty">아직 담은 문제가 없어요. 문제 카드 오른쪽 위 <b>☆</b>를 누르면 여기에 모여요.</div>`
      : `<div class="empty">조건에 맞는 문제가 없어요. 위에서 유형이나 보기를 바꿔 보세요.</div>`;
    main.innerHTML = list.length ? withHeads(list) : none;
  }
  function renderNote() {
    const list = scoped();
    const wrong = list.filter(p => prog(p.id).status === "wrong" || (keep.has(p.id) && S.progress[p.id]));
    const res = list.filter(p => prog(p.id).status === "resolved" && !keep.has(p.id));
    if (!wrong.length && !res.length) { main.innerHTML = `<div class="empty">이 범위에는 아직 오답이 없어요. 문제를 틀리거나 "모르겠어요"를 누르면 내 답과 함께 여기에 모여요.</div>`; return; }
    main.innerHTML = (wrong.length ? `<h2 class="grp-h">다시 풀 문제 ${wrong.length}</h2>` + wrong.map(card).join("") : "")
      + (res.length ? `<h2 class="grp-h">해결됨 ${res.length}</h2>` + res.map(card).join("") : "");
  }
  function hubCard(key, hn, title, list, special, extra) {
    const k = counts(list); const stars = list.filter(p => p.star).length;
    const pc = k.done ? Math.round((k.c + k.r) / k.done * 100) : null;
    const done = k.all > 0 && k.done === k.all;     // 다 푼 단원은 ✓ 완료로 한눈에
    return `<button class="hc ${special ? "sp" : ""} ${done ? "done" : ""}" data-open="${esc(key)}">
      <span class="hc-top"><span class="hn">${esc(hn)}</span>${done ? `<span class="hc-ok">✓ 완료</span>` : ""}</span><span class="ht">${esc(title)}</span>${barHTML(k)}
      <span class="hm"><span>풀이 <b>${k.done}/${k.all}</b></span>${pc !== null ? `<span>정답률 <b>${pc}%</b></span>` : ""}${k.w ? `<span class="w">오답 <b>${k.w}</b></span>` : ""}${stars && key !== "STAR" && !k.done ? `<span>★ <b>${stars}</b></span>` : ""}${extra && !k.done ? `<span>${esc(extra)}</span>` : ""}</span>
    </button>`;
  }
  /** 과목 메뉴 맨 위 "지금 하면 좋은 것": 이어 풀기 → 남은 오답 → 안 푼 단원 → (다 풀었으면) 중요 문제 복습 중 하나만 */
  function suggestion() {
    const last = S.last[cid];
    if (last && last.set && last.set !== "NOTE") {
      const sc = scopeOf(last.set), k = counts(P.filter(sc.f));
      if (k.done < k.all) return { key: last.set, icon: "↻", t: "이어 풀기", s: `${sc.title} · ${k.done}/${k.all} 풀이` };
    }
    const w = P.filter(p => prog(p.id).status === "wrong").length;
    if (w) return { key: "NOTE", icon: "✕", t: `틀린 문제 ${w}개 다시 풀기`, s: "틀린 문제를 다시 풀어 보면 오래 기억나요" };
    const ch = CHS.find(c => P.some(p => p.chapter_id === c.id && !S.progress[p.id]));
    if (ch) {
      const left = P.filter(p => p.chapter_id === ch.id && !S.progress[p.id]).length;
      return { key: ch.key, icon: "›", t: P.some(p => S.progress[p.id]) ? "다음 단원 풀기" : "첫 단원부터 시작하기", s: `${ch.title} · ${left}문제 남음` };
    }
    return P.some(p => p.star)
      ? { key: "STAR", icon: "★", t: "모두 풀었어요! 중요 문제 복습하기", s: "시험 직전에 한 번 더 보면 좋아요" }
      : { key: "ALL", icon: "★", t: "모두 풀었어요! 전체 다시 보기", s: "푼 문제와 해설을 다시 읽어 봐요" };
  }
  function renderHub() {
    const t = counts(P); const pc = t.done ? Math.round((t.c + t.r) / t.done * 100) : null;
    let h = `<div class="overall"><span class="ov-n"><b>${t.done}</b> / ${t.all}문제 풀이</span>${barHTML(t, "in")}<span>정답률 <b>${pc === null ? "–" : pc + "%"}</b></span>${t.w ? `<span class="w">남은 오답 <b>${t.w}</b></span>` : ""}</div>`;
    const sg = suggestion();
    h += `<button class="next-up" data-open="${esc(sg.key)}"><span class="nu-i" aria-hidden="true">${sg.icon}</span><span class="nu-t"><small>지금 하면 좋은 것</small><b>${esc(sg.t)}</b><span>${esc(sg.s)}</span></span><i aria-hidden="true">›</i></button>`;
    // 챕터 카드 (묶음이 있으면 묶음별로)
    const groups = []; CHS.forEach(c => { const g = c.group || ""; let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, list: [] }); G.list.push(c); });
    groups.forEach(G => {
      h += `<div class="hubh">${esc(G.g || "단원별")}</div><div class="hubgrid">${G.list.map(c => {
        const list = P.filter(p => p.chapter_id === c.id); if (!list.length) return "";
        const kinds = ["ox", "mc", "short", "essay"].filter(k => list.some(p => p.kind === k)).map(k => `${KIND[k]} ${list.filter(p => p.kind === k).length}`).join(" · ");
        return hubCard(c.key, c.short || c.key, c.title.replace(/^.*?\s·\s/, ""), list, false, kinds);
      }).join("")}</div>`;
    });
    const openW = P.filter(p => prog(p.id).status === "wrong").length;
    // 시험 대비: 큰 카드는 전체·중요·나중에·오답노트만, 유형 모음은 알약 한 줄로 (카드가 너무 많아 보이지 않게)
    const big = SPECIAL.filter(sp => !sp.key.startsWith("K:") && P.some(sp.f));
    const kinds = SPECIAL.filter(sp => sp.key.startsWith("K:") && P.some(sp.f));
    h += `<div class="hubh">시험 대비</div><div class="hubgrid">${big.map(sp => hubCard(sp.key, sp.hn, sp.title, P.filter(sp.f), true, sp.note)).join("")}
      ${hubCard("SAVED", "☆ 나중에", "나중에 볼 문제", P.filter(p => isSaved(p.id)), true, "카드의 ☆로 담기")}
      <button class="hc sp" data-open="NOTE"><span class="hc-top"><span class="hn">오답노트</span></span><span class="ht">전체 오답노트</span><span class="hm"><span class="${openW ? "w" : ""}">못 고친 오답 <b>${openW}</b></span><span>모든 범위 모아보기</span></span></button>
      ${insOn ? `<button class="hc sp" data-open="INSIGHT"><span class="hc-top"><span class="hn">리포트</span></span><span class="ht">학습 리포트</span><span class="hm" id="insMeta">${insMeta()}</span></button>` : ""}</div>`;
    if (kinds.length > 1) h += `<div class="kindrow"><span class="lab">유형별로 풀기</span>${kinds.map(sp => {
      const k = counts(P.filter(sp.f));
      return `<button class="kpill" data-open="${esc(sp.key)}" title="${esc(sp.note)}">${esc(sp.hn)}<span class="n">${k.done}/${k.all}</span>${k.w ? `<span class="w">${k.w}</span>` : ""}</button>`;
    }).join("")}</div>`;
    main.innerHTML = h;
    loadOv();
  }
  function insMeta() {   // 학습 리포트 카드 한 줄: 개요(서버)가 오면 그것으로, 그 전엔 이 기기에 받아 둔 리포트·이 기기 풀이 수로
    if (!insDev && !(S.device && S.device.consent)) return "<span>기록 저장을 켜면 열려요</span>";
    const n = counts(P).done, c = LS.get("ins:" + cid, null), mine = c && S.device && c._did === S.device.id ? c : null;
    const o = insOv || (mine && mine.made_at ? { state: mine.state, made_at: mine.made_at, since: null, can_make: mine.can_make } : null);
    const md = iso => { const t = new Date(iso || ""); return isNaN(t) ? "" : `${t.getMonth() + 1}/${t.getDate()}`; };
    const k = o && o.since ? +o.since.answers || 0 : 0;
    if (o && o.state === "ready") return `<span>${md(o.made_at)} 리포트</span>${k > 0 ? `<span>새 기록 <b>${k}</b></span>` : ""}`;
    if (o && o.can_make && (o.state === "none" || k > 0)) return "<span>리포트 뽑기</span>";
    if (o) return n < 30 ? `<span><b>${n}</b>/30 풀면 열려요</span>` : "<span>조금만 더 풀면 열려요</span>";
    return n < 30 && !o ? `<span><b>${n}</b>/30 풀면 열려요</span>` : "<span>리포트 뽑기</span>";
  }
  function loadOv() {    // 개요는 메뉴를 다 그린 뒤 한가할 때, 이 화면에서 한 번만 묻는다 (메뉴를 늦추지 않게)
    if (!insOn || insAsked || insDev || !(S.device && S.device.consent)) return;
    insAsked = true;
    (window.requestIdleCallback || (f => setTimeout(f, 400)))(() => api("GET", "/api/me/insight").then(r => {
      insOv = (r && r.courses && r.courses[cid]) || null; const el = $("#insMeta", main); if (el) el.innerHTML = insMeta();
    }).catch(() => { }));
  }

  let io = null;
  function watchCards() {   // 목록 모드: 화면에 들어온 문제부터 풀이 시간을 잰다 (+ 실제로 보인 시간 vis, 채점한 카드를 지나가면 sol_dwell)
    if (io) io.disconnect();
    visStop(true);                                     // 다시 관찰하면 첫 알림으로 다시 켠다
    if (!set || (focus && focus.isFocus())) return;
    io = new IntersectionObserver(es => es.forEach(e => {
      const id = +e.target.id.slice(2);
      const r = e.intersectionRatio, hh = e.intersectionRect.height, vh = innerHeight, on = e.isIntersecting && (r >= 0.6 || hh >= vh * 0.6);   // 화면보다 긴 카드는 화면의 60%를 채우면 보인 것
      if (on) markShown(id);                           // 보인 때·problem_shown은 예전처럼 60%에서 (0.3은 sol_dwell 판정용)
      if (!e.target.isConnected) return;               // 채점 뒤 바꿔 끼운 옛 카드
      visOn(id, on);
      if (dwell && dwell.pid === id && (!e.isIntersecting || (r < 0.3 && hh < vh * 0.3))) dwellEnd();
    }), { threshold: [0.3, 0.6] });
    $$("article.card", main).forEach(c => io.observe(c));
  }
  const typeset = el => typesetMath(el, C.math);       // 수식 설정·모양은 math.js 한곳에서
  // 수식 과목은 보이는 카드만 그린다 (공학수학 전체는 453문제·수식 4천여 개라 한 번에 그리면 화면이 멈춤)
  //   집중 모드: 지금 문제와 앞뒤 문제 / 목록 모드: 화면 근처(위아래 800px)에 온 카드
  let mio = null;
  const mathCard = el => { if (!C.math || !el || el.dataset.tex === "1") return; el.dataset.tex = "1"; typeset(el); };
  function mathAround(cardId) {
    const cs = $$("article.card", main), i = cs.findIndex(c => c.id === cardId);
    if (i >= 0) [i, i + 1, i - 1, i + 2].forEach(k => mathCard(cs[k]));
  }
  function lazyMath() {
    if (!C.math) return;
    if (mio) { mio.disconnect(); mio = null; }
    if (!set) { typeset(main); return; }
    if (focus && focus.isFocus()) { requestAnimationFrame(() => requestAnimationFrame(() => { const c = main.querySelector("article.card.fx-cur"); if (c) mathAround(c.id); })); return; }
    mio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { mio.unobserve(e.target); mathCard(e.target); } }), { rootMargin: "800px 0px" });
    $$("article.card", main).forEach(c => mio.observe(c));
  }
  /** 방금 푼 문제가 필터(안 푼 문제·틀린 문제 등)에 더는 안 맞으면 그 카드만 뺀다. 전체를 다시 그리지 않아 빠르다 */
  function prune() {
    if (!set || tab !== "solve") { render(); return; }
    const ok = new Set(filtered().map(p => "c-" + p.id));
    const gone = $$("article.card", main).filter(c => !ok.has(c.id));
    if (!gone.length) return;
    if (gone.length === $$("article.card", main).length) { render(); return; }
    gone.forEach(c => { clearMath(c); c.remove(); });
    $$(".grp-h", main).forEach(h => { const n = h.nextElementSibling; if (!n || !n.matches("article.card")) h.remove(); });
    renderStats(); renderToolbar();
  }

  /** 학습 리포트: 문제 카드 목록이 아니라 insight.js가 main을 그린다 (탭·통계·도구 막대 숨김, 이어 풀기·풀이 시간 측정 없음) */
  function renderInsight() {
    ["#tabsNav", "#stats", "#toolbar"].forEach(s => { $(s, view).hidden = true; });
    const crumb = $("#crumb", view); crumb.hidden = false;
    crumb.innerHTML = `<button class="back" data-go="hub">‹ 메뉴</button><span class="ct">학습 리포트</span>`;
    view.classList.add("in-set"); renderEnroll(); document.title = "학습 리포트 · " + C.short;
    if (ins) { ins.update(); return; }
    clearMath(main); main.innerHTML = `<div class="loading"><span class="spin"></span>리포트를 여는 중…</div>`;
    const my = ++insTok;
    import("./insight.js").then(m => { if (my === insTok && !gone && set === "INSIGHT") ins = m.mount(main, insCtx()); })
      .catch(e => { console.error(e); if (my === insTok && set === "INSIGHT") main.innerHTML = `<div class="empty">리포트 화면을 열지 못했어요. 새로 고침해 주세요.</div>`; });
  }
  const insCtx = () => ({ C, cid, go, show: showOne, setResume, typeset: typesetMath, clearMath, api, flush, sendEvents, track, dev: insDev,
    consent: () => !!(S.device && S.device.consent), did: () => (S.device && S.device.id) || "" });
  /** 리포트의 근거 칩 → 그 문제가 있는 장을 열고 그 카드로 (setResume + go) */
  function showOne(pid) {
    const p = BYID[pid]; if (!p) return;
    const k = chOf(p).key; setResume(`${cid}|${k}|solve`, pid); jumpTo = pid; go(k);
  }
  // 집중 모드의 이어 풀기는 "이미 푼 문제면 다음 문제"로 넘기므로, 그 카드에 서도록 바로 앞 카드를 건넨다.
  // 필터에 가려졌거나 그렇게 맞출 수 없으면 그 문제만 Q:로 연다
  function jumpAfter(id) {
    const cs = $$("article.card", main), t = cs.findIndex(c => c.id === "c-" + id), done = c => /\bst-/.test(c.className);
    const solo = () => ctx.navigate(`/course/${cid}/` + encodeURIComponent("Q:" + id), { replace: true });
    if (t < 0) return solo();
    if (!focus.isFocus()) { requestAnimationFrame(() => scrollTo(0, Math.max(0, cs[t].getBoundingClientRect().top + scrollY - 90))); return; }
    const via = !done(cs[t]) || t === cs.length - 1 ? cs[t].id : t === 0 ? "" : done(cs[t - 1]) ? cs[t - 1].id : null;
    if (via === null) return solo();
    jumpVia = via;
  }

  function render() {
    if (set === "INSIGHT") { renderInsight(); return; }
    if (ins) { ins.destroy(); ins = null; insAsked = false; }   // 리포트에서 나옴 (방금 뽑았을 수 있으니 메뉴의 개요를 다시 묻는다)
    insTok++;                                          // 불러오는 중이던 리포트 화면도 취소
    const hub = !set;
    clearMath(main);                                   // 예전 수식을 MathJax 기억에서 지움 (안 지우면 메모리가 쌓여 점점 느려짐)
    if (set === "NOTE") tab = "note";
    const crumb = $("#crumb", view);
    crumb.hidden = hub; $("#tabsNav", view).hidden = hub; $("#stats", view).hidden = hub; $("#toolbar", view).hidden = hub;
    view.classList.toggle("in-set", !hub);
    renderEnroll();
    if (hub) { renderHub(); document.title = C.short + " · 문제노트"; }
    else {
      const sc = scopeOf(set);
      document.title = sc.title + " · " + C.short;
      $("#tab-solve", view).hidden = set === "NOTE";
      crumb.innerHTML = `<button class="back" data-go="hub">‹ 메뉴</button><span class="ct">${esc(sc.title)}</span>`;
      $("#tab-solve", view).setAttribute("aria-selected", tab === "solve"); $("#tab-note", view).setAttribute("aria-selected", tab === "note");
      renderStats(); renderToolbar();
      tab === "solve" ? renderSolve() : renderNote();
    }
    lazyMath(); watchCards();
  }
  /** 채점 뒤에는 그 카드와 통계만 바꾼다 (수식 과목에서 전체를 다시 그리지 않게) */
  function renderCard(id) {
    const el = $("#c-" + id, main);
    if (!el || !set) { render(); return; }
    const tmp = document.createElement("div"); tmp.innerHTML = card(BYID[id]).trim();
    const nu = tmp.firstElementChild;
    if (el.classList.contains("fx-cur")) nu.classList.add("fx-cur");
    if (el.classList.contains("fx-hide")) nu.classList.add("fx-hide");
    const before = el.getBoundingClientRect().top;
    clearMath(el); el.replaceWith(nu); renderStats(); renderToolbar(); nu.dataset.tex = ""; mathCard(nu); fixNext();
    const shift = nu.getBoundingClientRect().top - before;    // 위쪽 도구 막대가 늘어나도 보던 카드가 제자리에 있게
    if (Math.abs(shift) > 1) scrollBy(0, shift);
    if (io) io.observe(nu);
  }

  // ───────── 이동 ─────────
  const go = (s, t = "solve") => ctx.navigate(`/course/${cid}` + (s ? "/" + encodeURIComponent(s) + (t === "note" && s !== "NOTE" ? "?tab=note" : "") : ""));
  const focus = initFocus(main, {
    scopeKey, title: () => scopeOf(set).title,
    resumeGet: k => { if (jumpVia !== null) { const v = jumpVia; jumpVia = null; return v || null; } return S.resume[k] ? "c-" + S.resume[k] : null; },
    resumeSet: (k, cardId) => setResume(k, +cardId.slice(2)),
    totals: () => counts(scoped()),
    onCurrent: (cardId, idx) => { if (dwell && cardId && cardId !== "c-" + dwell.pid) dwellEnd(); if (cardId) { markShown(+cardId.slice(2), idx); mathAround(cardId); fixNext(); } else { watchCards(); lazyMath(); } },
    onLeave: () => { if (keep.size) { keep.clear(); prune(); } },
  });
  /** 지금 카드가 마지막 문제면 "다음 문제" 대신 오답 다시 풀기(오답이 있으면) 또는 메뉴로 */
  function fixNext() {
    const c = main.querySelector("article.card.fx-cur"), b = c && c.querySelector("[data-next]"); if (!b) return;
    const cs = $$("article.card", main), last = cs[cs.length - 1] === c;
    const w = scoped().filter(p => prog(p.id).status === "wrong").length;
    b.dataset.end = !last ? "" : (w && tab !== "note" ? "note" : "hub");
    b.querySelector(".nl").textContent = !last ? "다음 문제" : b.dataset.end === "note" ? `끝! 틀린 문제 ${w}개 다시 풀기` : "끝! 메뉴로 돌아가기";
  }
  // 집중 모드 키보드: O/X 키, 객관식 1~9, Enter = 다음 문제 (한글 입력 상태에서도 되게 e.code로 본다)
  function onDocKey(e) {
    if (!set || !focus.isFocus() || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (document.querySelector(".modal, .sheet-wrap, .onb")) return;
    const c = main.querySelector("article.card.fx-cur"); if (!c) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t && t.tagName === "BUTTON" && !(c.contains(t) && (t.closest(".opts") || t.dataset.next))) return;   // 다른 버튼에 포커스가 있으면 그 버튼에 맡김
    const id = +c.id.slice(2), p = BYID[id], st = prog(id).status;
    if (e.key === "Enter") { const nb = c.querySelector("[data-next]"); if (nb) { e.preventDefault(); nb.click(); } return; }
    if (st && st !== "wrong") return;
    if (c.querySelector("[data-next]")) return;                 // 방금 채점했으면 다시 누르지 않게 (Enter로 넘어감)
    let btn = null;
    if (p.kind === "ox" && (e.code === "KeyO" || e.code === "KeyX")) btn = c.querySelector(`[data-ox="${e.code === "KeyO" ? 1 : 0}"]`);
    const m = p.kind === "mc" && /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) btn = c.querySelector(`[data-mc="${+m[2] - 1}"]`);
    if (btn) { e.preventDefault(); btn.click(); }
  }
  document.addEventListener("keydown", onDocKey);

  // ───────── AI 채점 도우미 (서술형) ─────────
  async function aiGrade(id) {
    const answer = String(drafts[id] ?? "").trim();
    if (answer.length < 5) { toast("답안을 먼저 써 주세요"); $("#in-" + id, main)?.focus(); return; }
    if (!LS.get("aiConsent", false)) {
      const ok = await ask({ title: "AI 채점 도우미를 쓸까요?",
        body: "내 답안과 문제·모범 답안이 <b>Google Gemini</b>로 보내져 채점 포인트별로 확인돼요. 무료 등급에서는 Google이 서비스 개선에 쓸 수 있어요. 답안에 이름 같은 개인 정보는 쓰지 마세요. AI 결과는 참고용이고, 최종 판정은 직접 해요.",
        ok: "쓸게요" });
      if (!ok) return;
      LS.set("aiConsent", true);
    }
    aiBusy.add(id); renderCard(id);
    try {
      const r = await api("POST", "/api/grade", { problem_id: id, answer, consent: true });
      aiRes[id] = r; open[id] = true;
      track("ai_grade", { problem_id: id, version: BYID[id].v, verdict: r.verdict, cached: r.cached });
    } catch (err) { toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
    finally { aiBusy.delete(id); renderCard(id); }
  }

  function onInput(e) { const t = e.target; if (t.id && t.id.startsWith("in-")) { const id = +t.id.slice(3); drafts[id] = t.value; firstKey[id] ||= { t: Date.now(), h: hiddenMs() }; } }
  function onKey(e) { const t = e.target; if (e.key === "Enter" && t.tagName === "INPUT" && t.id && t.id.startsWith("in-")) { e.preventDefault(); checkShort(+t.id.slice(3)); } }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !view.contains(b)) return;
    const d = b.dataset;
    if (b.id === "enrollBtn") { toggleEnroll(cid); renderEnroll(); toast(isEnrolled(cid) ? `${C.short}을(를) 내 강의실에 담았어요` : "내 강의실에서 뺐어요"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); return; }
    if (d.copy) {
      track("ai_copy", { problem_id: +d.copy, version: BYID[+d.copy].v, st: prog(+d.copy).status || "new" });   // 헷갈려서 도움을 찾는 신호
      const md = problemMd(BYID[+d.copy]); const label = b.lastChild; const prev = label.nodeValue;
      const done = ok => { b.classList.toggle("done", ok); label.nodeValue = ok ? "복사됨 ✓" : "복사 실패"; setTimeout(() => { b.classList.remove("done"); label.nodeValue = prev; }, 1600); };
      copyText(md).then(() => done(true), () => { done(false); prompt("아래 내용을 복사하세요 (Ctrl/Cmd + C)", md); });
      return;
    }
    if (d.report) { openReport(+d.report); return; }
    if (d.save) {
      const id = +d.save, on = toggleSaved(id, cid);
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      if (!on && set === "SAVED") unsaved.add(id);
      track("bookmark", { problem_id: id, version: BYID[id].v, on });
      toast(on ? "나중에 볼 문제에 담았어요" : "나중에 볼 문제에서 뺐어요");
      return;
    }
    if (d.next) {
      if (d.end === "note") go(set, "note"); else if (d.end === "hub") go(null); else focus.next();
      return;
    }
    if (b.id === "moreBtn") { ui.more = !ui.more; persist(); renderStats(); renderToolbar(); return; }
    if (b.id === "tab-solve") { go(set, "solve"); return; }
    if (b.id === "tab-note") { go(set, "note"); return; }
    if (b.id === "starBtn") { keep.clear(); ui.star = !ui.star; persist(); focus.reset(); render(); return; }
    if (d.open) { go(d.open, d.open === "NOTE" ? "note" : "solve"); return; }
    if (d.go === "hub") { go(null); return; }
    if (d.g) { keep.clear(); ui[d.g] = d.v; persist(); focus.reset(); render(); return; }
    if (d.ox !== undefined) {
      const id = +d.id, p = BYID[id], v = d.ox === "1"; const pr = prog(id);
      if (pr.status && pr.status !== "wrong") return;
      const ans = v ? "O" : "X";
      if (pr.status === "wrong" && pr.last_answer === ans) return;
      grade(id, v === p.ox, ans); return;
    }
    if (d.mc !== undefined) {
      const id = +d.id, p = BYID[id], i = +d.mc; const pr = prog(id);
      if (pr.status && pr.status !== "wrong") return;
      const ans = LETTERS[i];
      if (pr.status === "wrong" && pr.last_answer === ans) return;
      grade(id, i === p.ans, ans); return;
    }
    if (d.rs) { if (d.rs === "ask") { scopeAsk = true; renderToolbar(); } else if (d.rs === "no") { scopeAsk = false; renderToolbar(); } else resetScope(); return; }
    if (d.check) { checkShort(+d.check); return; }
    if (d.reveal) { const id = +d.reveal; open[id] = true; renderCard(id); return; }
    if (d.idk) { grade(+d.idk, false, "모르겠어요", { idk: true }); return; }
    if (d.self !== undefined) {
      const id = +d.id, ok = d.self === "1", ar = aiRes[id];
      if (ar && ar.id) api("PUT", "/api/grade/" + ar.id, { verdict: ok ? "correct" : "wrong" }).catch(() => { });   // AI와 내 판정이 얼마나 같은지
      grade(id, ok, drafts[id] || "(직접 채점: 틀림)", { self: true, ai: ar ? ar.verdict : undefined }); return;
    }
    if (d.ai) { aiGrade(+d.ai); return; }
    if (d.reset) { resetOne(+d.reset); return; }
  }
  view.addEventListener("click", onClick); view.addEventListener("input", onInput); view.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onHide);
  const off = onChange(what => {
    if (what === "saved") { if (set) { $$("[data-save]", main).forEach(b => { const id = +b.dataset.save, on = isSaved(id); b.setAttribute("aria-pressed", on); b.textContent = on ? "★" : "☆"; b.title = b.ariaLabel = on ? "나중에 볼 문제에서 빼기" : "나중에 볼 문제에 담기"; }); } else render(); return; }
    if (what === "progress") { const only = keep.size === 1 ? [...keep][0] : null; only && set ? renderCard(only) : render(); }
    else if (what === "all") render();
    else if (what === "enroll") renderEnroll();
  });

  render();
  if (set && set !== "INSIGHT") setLast(cid, set, scopeOf(set).title);
  pullCourse(cid).catch(() => { });    // 다른 기기에서 푼 기록 반영

  return {
    cid,
    update(r) {
      const changed = r.set !== set || r.tab !== tab;
      set = r.set; tab = r.tab || "solve";
      if (changed) { keep.clear(); unsaved.clear(); scopeAsk = false; focus.reset(); dwellEnd(); for (const k in qT) delete qT[k]; if (set && set !== "INSIGHT") setLast(cid, set, scopeOf(set).title); }
      render(); scrollTo(0, 0);
      if (jumpTo) { const id = jumpTo; jumpTo = null; jumpAfter(id); }
    },
    destroy() {
      gone = true; dwellEnd(); if (ins) { ins.destroy(); ins = null; } document.removeEventListener("visibilitychange", onHide);
      clearMath(main); if (mio) mio.disconnect();
      focus.destroy(); off(); offTheme(); document.removeEventListener("keydown", onDocKey); mq.removeEventListener("change", onScheme); if (io) io.disconnect();
      view.removeEventListener("click", onClick); view.removeEventListener("input", onInput); view.removeEventListener("keydown", onKey);
      view.classList.remove("in-set"); view.style.removeProperty("--accent"); view.style.removeProperty("--accent-weak");
    },
  };
}
