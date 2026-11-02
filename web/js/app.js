// 사용자 웹 시작점: 화면 이동(라우터), 위쪽 바, 테마, 첫 접속 안내, 내 강의실(홈), 과목 둘러보기
import { $, esc, LS, barHTML, pct, ago, toast } from "./util.js";
import { S, api, hasDevice, createDevice, adoptDevice, loadCatalog, courseMeta, courseCounts, toggleEnroll, isEnrolled, pull, startSession, onChange, savedCount, dday, ddText } from "./store.js";
import { mountCourse, REVIEW_AFTER } from "./course.js";
import { mountMe } from "./me.js";
import { CURRICULUM, KINDS } from "./curriculum.js";

const view = $("#view");

// ───────── 테마 (자동 / 라이트 / 다크) ─────────
const themeFns = new Set();
let theme = LS.get("theme", "auto");
function applyTheme() {
  if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#themeBtn").innerHTML = dark
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8Z"/></svg>`;
  $("#themeBtn").setAttribute("aria-label", dark ? "라이트 모드로" : "다크 모드로");
  themeFns.forEach(fn => fn());
}
function setTheme(v) { theme = v; LS.set("theme", v); applyTheme(); }
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
$("#themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  setTheme(dark ? "light" : "dark");
});

// ───────── 라우터 ─────────
const ctx = {
  navigate, theme: () => theme, setTheme,
  onTheme: fn => (themeFns.add(fn), () => themeFns.delete(fn)),
};
function parse() {
  const path = decodeURIComponent(location.pathname).replace(/\/+$/, "") || "/";
  const q = new URLSearchParams(location.search);
  let m;
  if ((m = path.match(/^\/course\/(\d+)(?:\/(.+))?$/))) return { name: "course", cid: +m[1], set: m[2] || null, tab: q.get("tab") === "note" ? "note" : "solve" };
  if (path === "/browse") return { name: "browse", y: q.get("y") };
  if (path === "/me") return { name: "me" };
  return { name: "home" };
}
let cur = null, seq = 0;
async function route() {
  const r = parse(); const my = ++seq;
  document.querySelectorAll(".nav a").forEach(a => a.setAttribute("aria-current", a.dataset.n === (r.name === "course" ? "" : r.name) ? "page" : "false"));
  if (cur && cur.name === "course" && r.name === "course" && cur.inst && cur.inst.cid === r.cid) { cur.inst.update(r); return; }
  if (cur && cur.inst && cur.inst.destroy) cur.inst.destroy();
  cur = { name: r.name, inst: null };
  view.className = "view v-" + r.name; view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
  scrollTo(0, 0);
  try {
    let inst;
    if (r.name === "course") inst = await mountCourse(view, r, ctx);
    else if (r.name === "me") inst = mountMe(view, ctx);
    else if (r.name === "browse") inst = mountBrowse(r);
    else inst = mountHome();
    if (my !== seq) { inst && inst.destroy && inst.destroy(); return; }
    cur.inst = inst;
  } catch (e) {
    console.error(e);
    if (my === seq) view.innerHTML = `<div class="wrap"><div class="empty">화면을 열지 못했어요. ${e.status === 404 ? "없는 과목이에요." : "인터넷 연결을 확인하고 다시 시도해 주세요."}<br><br><a class="btn pri" href="/" data-link>내 강의실로</a></div></div>`;
  }
}
function navigate(url, { replace = false } = {}) {
  if (url === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", url); route();
}
addEventListener("popstate", route);
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); navigate(a.getAttribute("href"));
});

// ───────── 과목 카드 (홈 · 둘러보기 공용) ─────────
function courseCard(c, { browse = false } = {}) {
  const k = courseCounts(c.id, c.problems); const p = pct(k); const on = isEnrolled(c.id); const sv = savedCount(c.id);
  const last = S.last[c.id];
  const col = c.color || { light: "#0066cc", dark: "#2997ff" };
  const stats = k.done
    ? `<span>풀이 <b>${k.done}</b>/${k.all}</span><span>정답률 <b>${p}%</b></span>${k.w ? `<span class="w">오답 <b>${k.w}</b></span>` : ""}${sv ? `<span>나중에 볼 <b>${sv}</b></span>` : ""}${k.last ? `<span>${ago(k.last)}</span>` : ""}`
    : `<span>${c.problems}문제</span><span>${c.lang === "en" ? "영어 문제 + 한국어 번역" : "아직 안 풀었어요"}</span>`;
  return `<div class="course" style="--c:${esc(col.light)};--cd:${esc(col.dark)}">
    <a class="cmain" href="/course/${c.id}" data-link>
      <span class="badge">${esc(c.short)}</span>
      <span class="ctext"><span class="ctitle">${esc(c.name)}${dday(c.id) !== null ? ` <span class="dd ${dday(c.id) <= 7 ? "soon" : ""}">${ddText(dday(c.id))}</span>` : ""}</span><span class="cmeta">${esc([c.professor && c.professor + " 교수", c.meta].filter(Boolean).join(" · "))}</span>
        ${k.done ? barHTML(k, "cbar") : ""}<span class="cstats">${stats}</span></span>
      ${browse ? "" : `<span class="chev">${last && last.set ? "이어 풀기" : "풀기"}<i>›</i></span>`}
    </a>
    ${!browse && k.w ? `<a class="cnote" href="/course/${c.id}/NOTE" data-link aria-label="${esc(c.short)} 틀린 문제 ${k.w}개 다시 풀기"><b>${k.w}</b><span>오답</span></a>` : ""}
    ${browse ? `<button class="starb" data-star="${c.id}" aria-pressed="${on}" aria-label="${esc(c.short)} ${on ? "내 강의실에서 빼기" : "내 강의실에 담기"}"><span class="eic" aria-hidden="true">${on ? "✓" : "＋"}</span><small>${on ? "담음" : "담기"}</small></button>` : ""}
  </div>`;
}

// ───────── 내 강의실 (홈) ─────────
/** 다가오는 시험: 가장 가까운 시험 하나와 남은 문제·오답 */
function examHTML(cs) {
  const x = cs.map(c => ({ c, n: dday(c.id) })).filter(x => x.n !== null).sort((a, b) => a.n - b.n)[0]; if (!x) return "";
  const { c, n } = x, k = courseCounts(c.id, c.problems), col = c.color || { light: "#0066cc", dark: "#2997ff" };
  return `<a class="exam-big ${n <= 7 ? "soon" : ""}" href="/course/${c.id}" data-link style="--c:${esc(col.light)};--cd:${esc(col.dark)}">
    <span class="eb-d"><small>시험까지</small><b>${ddText(n)}</b></span>
    <span class="eb-t"><b>${esc(c.name)}</b><span>안 푼 문제 ${k.all - k.done}개${k.w ? ` · 오답 ${k.w}개` : ""}</span></span><i aria-hidden="true">›</i></a>`;
}
/** 복습할 오답: 틀린 지 하루가 지난 문제를 과목별로 센다 (간격을 두고 다시 꺼내 풀기) */
function reviewHTML(cs) {
  const now = Date.now(), n = {};
  for (const r of Object.values(S.progress)) if (r.status === "wrong" && r.cid && now - Date.parse(r.updated_at || 0) >= REVIEW_AFTER) n[r.cid] = (n[r.cid] || 0) + 1;
  const rows = cs.filter(c => n[c.id]); if (!rows.length) return "";
  return `<section class="review"><div class="rv-h"><b>복습할 오답</b><small>틀린 지 하루가 지난 문제예요. 지금 다시 풀면 오래 기억나요</small></div>
    ${rows.map(c => { const col = c.color || { light: "#0066cc", dark: "#2997ff" };
      return `<a class="rv-row" href="/course/${c.id}/REVIEW" data-link style="--c:${esc(col.light)};--cd:${esc(col.dark)}"><span class="badge sm">${esc(c.short)}</span><span class="rv-n">${esc(c.name)}</span><b>${n[c.id]}문제</b><i aria-hidden="true">›</i></a>`; }).join("")}</section>`;
}
function mountHome() {
  function render() {
    const cs = S.enroll.map(courseMeta).filter(Boolean);
    let tot = { c: 0, r: 0, w: 0, done: 0, all: 0 };
    cs.forEach(c => { const k = courseCounts(c.id, c.problems); tot.c += k.c; tot.r += k.r; tot.w += k.w; tot.done += k.done; tot.all += k.all; });
    const p = pct(tot);
    const name = S.device && S.device.nickname;
    // 가장 최근에 공부한 범위 하나를 맨 위에 크게
    const recent = cs.map(c => ({ c, l: S.last[c.id] })).filter(x => x.l && x.l.set).sort((a, b) => String(b.l.at || "").localeCompare(String(a.l.at || "")))[0];
    const resume = recent ? (() => {
      const { c, l } = recent, col = c.color || { light: "#0066cc", dark: "#2997ff" };
      return `<a class="resume-big" href="/course/${c.id}/${encodeURIComponent(l.set)}" data-link style="--c:${esc(col.light)};--cd:${esc(col.dark)}">
        <span class="badge">${esc(c.short)}</span>
        <span class="rb-t"><small>이어서 공부하기</small><b>${esc(l.title || "이어 풀기")}</b><span>${esc(c.name)}${l.at ? " · " + ago(l.at) : ""}</span></span>
        <span class="rb-go" aria-hidden="true">›</span></a>`;
    })() : "";
    view.innerHTML = `<div class="wrap home">
      <header class="hero"><p class="eyebrow">${name ? esc(name) + "님의" : "나의"} 문제노트</p><h1>내 강의실</h1>
        <p class="lead">${cs.length ? `담아 둔 <b>${cs.length}과목</b>을 이어서 풀어요.` : "듣는 과목을 담으면 여기에 모여요."}</p></header>
      ${cs.length ? `${resume}<div class="sumrow">
          <div class="sum"><span>푼 문제</span><b>${tot.done}<small> / ${tot.all}</small></b>${barHTML(tot)}</div>
          <div class="sum"><span>정답률</span><b>${p === null ? "–" : p}<small>${p === null ? "" : " %"}</small></b></div>
          <div class="sum ${tot.w ? "w" : ""}"><span>남은 오답</span><b>${tot.w}</b></div></div>
        ${examHTML(cs)}${reviewHTML(cs)}<div class="courses">${cs.map(c => courseCard(c)).join("")}</div>
        <a class="addc" href="/browse" data-link><span>＋</span>과목 더 담기</a>`
      : `<div class="empty big-empty"><div class="ill" aria-hidden="true">＋</div><h2>아직 담은 과목이 없어요</h2><p>과목 둘러보기에서 <b>＋ 담기</b>를 눌러 듣는 과목을 담아 보세요.</p><a class="btn pri lg" href="/browse" data-link>과목 둘러보기</a></div>`}
    </div>`;
  }
  document.title = "내 강의실 · 문제노트";
  render();
  const off = onChange(w => { if (w !== "online") render(); });
  return { destroy: off };
}

// ───────── 과목 둘러보기 (커리큘럼: 학년 탭 + 학기 두 줄, 과목을 누르면 아래에서 창) ─────────
const TERM_ORD = { "1": 1, S: 2, "2": 3, W: 4 };
const semKey = code => { const [y, t] = String(code).split("-"); return +y * 10 + (TERM_ORD[t] || 0); };
const ALL_ITEMS = CURRICULUM.flatMap(y => y.terms.flatMap((t, i) => t.map(it => ({ ...it, year: y.year, term: i + 1 }))));
const ITEM = Object.fromEntries(ALL_ITEMS.map(it => [it.id, it]));
const NEXT = {};
const KIND_ORD = { base: 0, req: 1, opt: 2, ge: 3 };   // 학기 안에서 전공기초 → 전공필수 → 전공선택 순
const byKind = t => [...t].sort((a, b) => KIND_ORD[a.kind] - KIND_ORD[b.kind]);
ALL_ITEMS.forEach(it => (it.pre || []).forEach(p => (NEXT[p] ||= []).push(it.id)));

function mountBrowse(r) {
  // 커리큘럼 칸마다 올라온 문제 세트(최근 학기 먼저)를 잇는다
  const all = (S.catalog?.semesters || []).flatMap(s => s.courses.map(c => ({ ...c, semester: s })));
  const setsOf = it => all.filter(c => (it.codes || []).includes(c.code)).sort((a, b) => semKey(b.semester.code) - semKey(a.semester.code));
  // 커리큘럼에 없는 과목은 교양 탭에 (과목 코드 하나 = 칸 하나)
  const mapped = new Set(ALL_ITEMS.flatMap(it => it.codes || []));
  const ge = [...new Map(all.filter(c => !mapped.has(c.code)).map(c => [c.code, { id: "ge:" + c.code, name: c.name, kind: "ge", codes: [c.code] }])).values()];
  const item = id => ITEM[id] || ge.find(x => x.id === id);
  const TABS = [...CURRICULUM.map(x => ({ key: String(x.year), label: x.year + "학년", items: x.terms.flat() })), { key: "ge", label: "교양", items: ge }];
  const tabOf = it => it.kind === "ge" ? "ge" : String(it.year);
  const ready = key => TABS.find(t => t.key === key).items.filter(it => setsOf(it).length).length;
  let year = TABS.some(t => t.key === r.y) ? r.y
    : TABS.some(t => t.key === String(LS.get("browseYear", ""))) ? String(LS.get("browseYear", ""))
    : [...TABS].sort((a, b) => ready(b.key) - ready(a.key))[0].key;
  let openId = null, sheet = null, dir = 0;

  function tile(it) {
    const sets = setsOf(it), c = sets[0];
    const col = c && c.color || { light: "#0066cc", dark: "#2997ff" };
    const on = sets.some(s => isEnrolled(s.id));
    return `<button class="ctile ${c ? "" : "off"}" data-open="${it.id}" style="--c:${esc(col.light)};--cd:${esc(col.dark)}">
      <span class="kd k-${it.kind}">${KINDS[it.kind]}</span>
      <b>${esc(it.name)}</b>
      <small>${c ? `${sets.reduce((n, s) => n + s.problems, 0)}문제${on ? ` · <i class="on">✓ 담음</i>` : ""}` : "준비 중"}</small>
    </button>`;
  }
  function render() {
    const tab = TABS.find(t => t.key === year), y = CURRICULUM.find(x => String(x.year) === year);
    view.innerHTML = `<div class="wrap browse">
      <header class="hero"><p class="eyebrow">과목 둘러보기</p><h1>어떤 과목을 들어요?</h1><p class="lead">학년별로 과목을 보여 줘요. 과목을 누르면 문제를 풀거나 <b>＋ 담기</b>로 내 강의실에 담을 수 있어요.</p></header>
      <div class="yeartabs" role="tablist" aria-label="학년">${TABS.map(t => `<button role="tab" class="semtab" data-year="${t.key}" aria-selected="${t.key === year}">${t.label}<small>${ready(t.key) ? `${ready(t.key)}과목` : "준비 중"}</small></button>`).join("")}</div>
      <div class="years ${dir ? (dir > 0 ? "from-r" : "from-l") : ""}" role="tabpanel" aria-label="${tab.label}">
        ${y ? `<div class="kinds" aria-hidden="true">${["base", "req", "opt"].map(k => `<span class="kd k-${k}">${KINDS[k]}</span>`).join("")}</div>
          ${y.terms.map((t, i) => `<section class="term"><h2>${i + 1}학기</h2><div class="tiles">${byKind(t).map(tile).join("")}</div></section>`).join("")}`
        : ge.length ? `<section class="term"><h2>교양 · 다른 학과 과목</h2><div class="tiles">${ge.map(tile).join("")}</div></section>`
        : `<div class="empty">아직 올라온 교양 과목이 없어요.</div>`}
      </div>
    </div>`;
    dir = 0;
  }

  // 아래에서 올라오는 창: 문제 세트(최근 학기 먼저) + 먼저 들으면 좋은 과목 / 다음에 이어지는 과목
  function sheetHTML(it) {
    const sets = setsOf(it);
    const rel = (ids, label) => ids && ids.length ? `<div class="rel"><h3>${label}</h3><div class="relc">${ids.map(id => {
      const x = item(id); return `<button class="chip" data-open="${id}">${esc(x.name)}<small>${x.year}-${x.term}</small></button>`; }).join("")}</div></div>` : "";
    return `<div class="sh-card" role="dialog" aria-modal="true" aria-labelledby="sh-t">
      <div class="sh-grab" aria-hidden="true"></div>
      <div class="sh-head"><span class="kd k-${it.kind}">${KINDS[it.kind]}</span><span class="muted">${it.kind === "ge" ? "교양 · 다른 학과" : `${it.year}학년 ${it.term}학기`}</span>
        <button class="icon sh-x" data-close aria-label="닫기">✕</button></div>
      <h2 id="sh-t">${esc(it.name)}</h2>
      ${sets.length ? `<div class="courses">${sets.map((c, i) => `${i === 1 ? `<p class="sh-old">예전 학기 문제 세트</p>` : ""}${courseCard(c, { browse: true })}`).join("")}</div>`
        : `<div class="empty sh-empty"><b>준비 중이에요</b><br>아직 이 과목 문제가 없어요. 문제가 올라오면 여기에 나와요.</div>`}
      ${rel(it.pre, "먼저 들으면 좋은 과목")}${rel(NEXT[it.id], "다음에 이어지는 과목")}
    </div>`;
  }
  function openSheet(id) {
    const it = item(id); if (!it) return;
    openId = id;
    if (!sheet) {
      sheet = document.createElement("div"); sheet.className = "sheet";
      sheet.addEventListener("click", e => {
        if (e.target === sheet || e.target.closest("[data-close]")) return closeSheet();
        const o = e.target.closest("[data-open]"); if (o) return openSheet(o.dataset.open);
        const st = e.target.closest("[data-star]"); if (st) star(+st.dataset.star, sheet);
        if (e.target.closest("a[data-link]")) closeSheet(true);
      });
      document.body.appendChild(sheet);
      requestAnimationFrame(() => sheet.classList.add("in"));
    }
    sheet.innerHTML = sheetHTML(it);
    sheet.querySelector(".sh-card").scrollTop = 0;
    sheet.querySelector(".sh-x").focus({ preventScroll: true });
    go(tabOf(it));
  }
  function closeSheet(now) {
    const s = sheet; if (!s) return; sheet = null; const id = openId; openId = null;
    if (now) return s.remove();
    s.classList.remove("in"); setTimeout(() => s.remove(), 300);
    const b = view.querySelector(`[data-open="${id}"]`); if (b) b.focus({ preventScroll: true });
  }
  function star(id, root) {
    toggleEnroll(id); const c = courseMeta(id);
    toast(isEnrolled(id) ? `${c.short}을(를) 내 강의실에 담았어요` : `${c.short}을(를) 내 강의실에서 뺐어요`);
    const nb = root.querySelector(`[data-star="${id}"]`); if (nb) nb.classList.add("pop");
  }
  const idx = key => TABS.findIndex(t => t.key === key);
  function go(key) {
    if (key === year || idx(key) < 0) return;
    dir = idx(key) > idx(year) ? 1 : -1; year = key; LS.set("browseYear", key);
    history.replaceState(null, "", "/browse?y=" + key);
    const sy = scrollY; render(); scrollTo(0, sy);
  }
  function onClick(e) {
    const t = e.target.closest("[data-year]");
    if (t) return go(t.dataset.year);
    const o = e.target.closest("[data-open]"); if (o) return openSheet(o.dataset.open);
    const st = e.target.closest("[data-star]"); if (st) star(+st.dataset.star, view);
  }
  // 가로로 밀어서 탭 넘기기
  let sx = 0, sy0 = 0;
  const onTs = e => { if (!e.target.closest(".years")) { sx = null; return; } sx = e.touches[0].clientX; sy0 = e.touches[0].clientY; };
  const onTe = e => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy0;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const t = TABS[idx(year) + (dx < 0 ? 1 : -1)]; if (t) go(t.key);
  };
  const onKey = e => { if (e.key === "Escape" && sheet) closeSheet(); };

  document.title = "과목 둘러보기 · 문제노트";
  render();
  view.addEventListener("click", onClick);
  view.addEventListener("touchstart", onTs, { passive: true });
  view.addEventListener("touchend", onTe);
  addEventListener("keydown", onKey);
  const off = onChange(w => {
    if (w !== "enroll" && w !== "all") return;
    const sy = scrollY; render(); scrollTo(0, sy);
    if (sheet && openId) sheet.innerHTML = sheetHTML(item(openId));
  });
  return { destroy() {
    off(); closeSheet(true);
    view.removeEventListener("click", onClick); view.removeEventListener("touchstart", onTs); view.removeEventListener("touchend", onTe);
    removeEventListener("keydown", onKey);
  } };
}

// ───────── 첫 접속 안내 + 동의 ─────────
function onboarding() {
  return new Promise(resolve => {
    const wrap = document.createElement("div"); wrap.className = "onb";
    wrap.innerHTML = `<div class="onb-card" role="dialog" aria-modal="true" aria-labelledby="onb-t">
      <p class="eyebrow">베타 테스트</p>
      <h1 id="onb-t">문제노트에 오신 걸<br>환영해요</h1>
      <ul class="onb-list">
        <li><span class="oi">⚡</span><div><b>로그인 없이 바로 풀어요</b><small>이 기기에 익명 번호만 만들어요. 이름·이메일은 받지 않아요.</small></div></li>
        <li><span class="oi">📈</span><div><b>풀이 기록으로 문제를 고쳐요</b><small>동의하면 문제별 정답 여부, 고른 답, 풀이 시간이 익명으로 모여요. 너무 어렵거나 헷갈리는 문제를 찾아 고치는 데만 써요.</small></div></li>
        <li><span class="oi">🔁</span><div><b>다른 기기에서 이어 풀어요</b><small>동의하면 기록이 서버에도 저장돼, 6자리 코드로 폰과 노트북을 이어 쓸 수 있어요.</small></div></li>
      </ul>
      <details class="onb-more"><summary>모으는 것과 모으지 않는 것</summary>
        <p><b>모으는 것</b> 문제별 정답 여부 · 고른 답이나 쓴 답 · 풀이 시간 · 화면 크기와 기기 종류(폰/PC) · 오류 제보 내용</p>
        <p><b>모으지 않는 것</b> 이름 · 이메일 · 학번 · 위치 · 연락처. 동의는 마이페이지에서 언제든 끌 수 있어요.</p></details>
      <div class="onb-year"><span>몇 학년이에요? <small>(선택, 둘러보기가 그 학년부터 열려요)</small></span>
        <div class="seg" role="radiogroup" aria-label="학년">${["1", "2", "3", "4"].map(y => `<label><input type="radio" name="onbYear" value="${y}"><span>${y}학년</span></label>`).join("")}<label><input type="radio" name="onbYear" value="ge"><span>교양만</span></label></div></div>
      <label class="onb-nick"><span>닉네임 <small>(선택, 제보할 때 표시)</small></span><input id="onbNick" maxlength="20" placeholder="예: 경영 22" autocomplete="off"></label>
      <div class="onb-btns"><button class="btn pri lg" data-c="1">동의하고 시작하기</button><button class="btn ghost" data-c="0">동의하지 않고 시작 <small>기록은 이 브라우저에만 저장돼요</small></button></div>
      <form class="onb-claim" id="onbClaim"><button type="button" class="linkish" id="onbHave">이미 쓰던 기록이 있나요? 코드나 기록 열쇠로 가져오기</button>
        <div class="inrow" hidden><input id="onbCode" maxlength="64" placeholder="6자리 코드 또는 기록 열쇠" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn">가져오기</button></div></form>
    </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    const finish = () => { wrap.classList.remove("in"); setTimeout(() => wrap.remove(), 350); resolve(); };
    wrap.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.id === "onbHave") { b.nextElementSibling.hidden = false; $("#onbCode").focus(); return; }
      if (b.dataset.c !== undefined) {
        b.disabled = true;
        const yr = wrap.querySelector('input[name="onbYear"]:checked'); if (yr) LS.set("browseYear", yr.value);
        await createDevice({ consent: b.dataset.c === "1", nickname: $("#onbNick").value.trim() });
        finish(); toast(b.dataset.c === "1" ? "고마워요! 이제 과목을 담아 볼까요?" : "시작해요! 과목을 담아 볼까요?", "ok");
      }
    });
    $("#onbClaim").addEventListener("submit", async e => {
      e.preventDefault(); const v = $("#onbCode").value.trim();
      const isKey = /^[A-Za-z0-9_-]{16,64}$/.test(v);
      if (!/^\d{6}$/.test(v) && !isKey) { toast("6자리 코드나 기록 열쇠를 입력해 주세요", "bad"); return; }
      try { const r = await api("POST", "/api/transfer/claim", isKey ? { key: v } : { code: v }); await adoptDevice(r.device_id); finish(); toast("기록을 가져왔어요", "ok"); }
      catch (err) { toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
    });
  });
}

// ───────── 기록 열쇠 알림 (로그인이 없어서 기록을 잃지 않게, 30문제를 풀면 한 번) ─────────
function keyNudge() {
  if (LS.get("keyNudge", false) || !S.device || Object.keys(S.progress).length < 30 || document.querySelector(".nudge")) return;
  LS.set("keyNudge", true);
  const on = S.device.consent, el = document.createElement("div"); el.className = "nudge"; el.setAttribute("role", "status");
  el.innerHTML = `<span class="ng-i" aria-hidden="true">🔑</span><div class="ng-t"><b>${on ? "기록 열쇠를 저장해 두세요" : "기록이 이 브라우저에만 있어요"}</b>
    <small>${on ? "브라우저 기록을 지우거나 주소가 바뀌어도, 열쇠만 있으면 지금까지 푼 기록을 되찾아요." : "브라우저 기록을 지우면 사라져요. 마이페이지에서 기록 저장에 동의하면 열쇠로 되찾을 수 있어요."}</small>
    <div class="ng-b"><button class="btn pri" data-ng="go">${on ? "열쇠 보러 가기" : "마이페이지로"}</button><button class="btn ghost" data-ng="x">나중에</button></div></div>`;
  document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("in"));
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-ng]"); if (!b) return;
    el.classList.remove("in"); setTimeout(() => el.remove(), 350);
    if (b.dataset.ng === "go") { navigate("/me"); setTimeout(() => document.querySelector(on ? ".keybox" : "#consent")?.scrollIntoView({ behavior: "smooth", block: "center" }), 300); }
  });
}
onChange(w => { if (w === "progress" || w === "all") keyNudge(); });

// ───────── 오프라인 표시 ─────────
function renderNet() { $("#net").hidden = S.online; }
onChange(w => { if (w === "online") renderNet(); });

// ───────── 시작 ─────────
(async function boot() {
  applyTheme(); renderNet();
  await loadCatalog();
  route();
  if (!hasDevice()) {
    await onboarding();
    if (!S.enroll.length && (location.pathname === "/" || location.pathname === "/browse")) {   // 고른 학년 탭으로 다시 연다
      const y = LS.get("browseYear", ""), url = "/browse" + (y ? "?y=" + y : "");
      if (url === location.pathname + location.search) route(); else navigate(url, { replace: true });
    }
  } else {
    api("POST", "/api/device", S.device).catch(() => { });   // 서버 DB가 새로 만들어졌어도 기기를 다시 등록
    pull();
  }
  startSession(); keyNudge();
})();
