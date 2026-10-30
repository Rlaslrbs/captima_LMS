// 사용자 웹 시작점: 화면 이동(라우터), 위쪽 바, 테마, 첫 접속 안내, 내 강의실(홈), 과목 둘러보기
import { $, esc, LS, barHTML, pct, ago, toast } from "./util.js";
import { S, api, hasDevice, createDevice, adoptDevice, loadCatalog, courseMeta, courseCounts, toggleEnroll, isEnrolled, pull, startSession, onChange, savedCount } from "./store.js";
import { mountCourse } from "./course.js";
import { mountMe } from "./me.js";

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
  if (path === "/browse") return { name: "browse", sem: q.get("sem") };
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
    ? `<span>풀이 <b>${k.done}</b>/${k.all}</span><span>정답률 <b>${p}%</b></span>${k.w ? `<span class="w">오답 <b>${k.w}</b></span>` : ""}${sv ? `<span>☆ 나중에 <b>${sv}</b></span>` : ""}${k.last ? `<span>${ago(k.last)}</span>` : ""}`
    : `<span>${c.problems}문제</span><span>${c.lang === "en" ? "영어 문제 + 한국어 번역" : "아직 안 풀었어요"}</span>`;
  return `<div class="course" style="--c:${esc(col.light)};--cd:${esc(col.dark)}">
    <a class="cmain" href="/course/${c.id}" data-link>
      <span class="badge">${esc(c.short)}</span>
      <span class="ctext"><span class="ctitle">${esc(c.name)}</span><span class="cmeta">${esc([c.professor && c.professor + " 교수", c.meta].filter(Boolean).join(" · "))}</span>
        ${k.done ? barHTML(k, "cbar") : ""}<span class="cstats">${stats}</span></span>
      ${browse ? "" : `<span class="chev">${last && last.set ? "이어 풀기" : "풀기"}<i>›</i></span>`}
    </a>
    ${!browse && k.w ? `<a class="cnote" href="/course/${c.id}/NOTE" data-link aria-label="${esc(c.short)} 틀린 문제 ${k.w}개 다시 풀기"><b>${k.w}</b><span>오답</span></a>` : ""}
    ${browse ? `<button class="starb" data-star="${c.id}" aria-pressed="${on}" aria-label="${esc(c.short)} ${on ? "내 강의실에서 빼기" : "내 강의실에 담기"}"><span>${on ? "★" : "☆"}</span></button>` : ""}
  </div>`;
}

// ───────── 내 강의실 (홈) ─────────
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
        <div class="courses">${cs.map(c => courseCard(c)).join("")}</div>
        <a class="addc" href="/browse" data-link><span>＋</span>과목 더 담기</a>`
      : `<div class="empty big-empty"><div class="ill" aria-hidden="true">☆</div><h2>아직 담은 과목이 없어요</h2><p>과목 둘러보기에서 ☆를 눌러 듣는 과목을 담아 보세요.</p><a class="btn pri lg" href="/browse" data-link>과목 둘러보기</a></div>`}
    </div>`;
  }
  document.title = "내 강의실 · 문제노트";
  render();
  const off = onChange(w => { if (w !== "online") render(); });
  return { destroy: off };
}

// ───────── 과목 둘러보기 ─────────
function mountBrowse(r) {
  const sems = S.catalog?.semesters || [];
  let sem = sems.find(s => s.code === r.sem) ? r.sem : (sems[0] && sems[0].code);
  function render() {
    const s = sems.find(x => x.code === sem);
    view.innerHTML = `<div class="wrap browse">
      <header class="hero"><p class="eyebrow">과목 둘러보기</p><h1>어떤 과목을 들어요?</h1><p class="lead"><b>☆</b>를 눌러 내 강의실에 담아요. 과목을 누르면 담지 않고도 먼저 풀어 볼 수 있어요.</p></header>
      ${sems.length > 0 ? `<div class="semtabs" role="tablist">${sems.map(x => `<button role="tab" class="semtab" data-sem="${esc(x.code)}" aria-selected="${x.code === sem}">${esc(x.code)}<small>${esc(x.name)}</small></button>`).join("")}</div>` : ""}
      ${s && s.courses.length ? `<div class="courses">${s.courses.map(c => courseCard(c, { browse: true })).join("")}</div>`
        : `<div class="empty">이 학기에는 아직 올라온 과목이 없어요.</div>`}
    </div>`;
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.sem) { sem = b.dataset.sem; history.replaceState(null, "", "/browse?sem=" + encodeURIComponent(sem)); render(); return; }
    if (b.dataset.star) {
      const id = +b.dataset.star; toggleEnroll(id); const c = courseMeta(id);
      toast(isEnrolled(id) ? `${c.short}을(를) 내 강의실에 담았어요` : `${c.short}을(를) 내 강의실에서 뺐어요`);
      const nb = view.querySelector(`[data-star="${id}"]`); if (nb) nb.classList.add("pop");
    }
  }
  document.title = "과목 둘러보기 · 문제노트";
  render(); view.addEventListener("click", onClick);
  let popId = null;
  view.addEventListener("click", e => { const b = e.target.closest("[data-star]"); if (b) popId = +b.dataset.star; }, true);
  const off = onChange(w => {
    if (w !== "enroll" && w !== "all") return;
    const y = scrollY; render(); scrollTo(0, y);
    if (popId) { const nb = view.querySelector(`[data-star="${popId}"]`); if (nb) nb.classList.add("pop"); popId = null; }
  });
  return { destroy() { off(); view.removeEventListener("click", onClick); } };
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
    if (location.pathname === "/" && !S.enroll.length) navigate("/browse", { replace: true });
  } else {
    api("POST", "/api/device", S.device).catch(() => { });   // 서버 DB가 새로 만들어졌어도 기기를 다시 등록
    pull();
  }
  startSession();
})();
