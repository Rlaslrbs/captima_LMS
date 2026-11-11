// 관리자 웹: 대시보드 · 진단(diag.js) · 오류 제보함 · 학기·과목 관리 · 문제 세트 올리기 (+ problem.js: 문제 품질 · 편집기)
import { api, BASE, esc, toast, ask, ago, KIND, pct, sec, n, strip, accCell, previewHTML, typeset, mem, MIN_N } from "./lib.js";
import { mountQuality, mountEditor } from "./problem.js";
import { mountDiag } from "./diag.js";

const main = document.getElementById("main");

// ───────── 테마 ─────────
function applyTheme() {
  const t = localStorage.getItem("mn:adminTheme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches);
  const b = document.getElementById("themeBtn");
  b.innerHTML = dark
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8Z"/></svg>`;
  b.setAttribute("aria-label", dark ? "라이트 모드로" : "다크 모드로");
}
document.getElementById("themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  try { localStorage.setItem("mn:adminTheme", dark ? "light" : "dark"); } catch { }
  applyTheme();
});
applyTheme();

// ───────── 새 제보 수 (왼쪽 메뉴) ─────────
async function refreshCount() {
  try { const o = await api("GET", "/reports/unread-count"); const el = document.getElementById("repCnt"); el.textContent = o.open_reports; el.hidden = !o.open_reports; } catch { }
}

// ───────── 라우터 (#/경로?질의) ─────────
let cur = null;
async function route() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);
  const name = parts[0] || "dash";
  document.querySelectorAll("#snav a").forEach(a => a.setAttribute("aria-current", a.dataset.r === (name === "problem" ? "quality" : name) ? "page" : "false"));
  if (cur && cur.destroy) cur.destroy();
  cur = null; main.innerHTML = ""; main.classList.remove("enter"); void main.offsetWidth; main.classList.add("enter"); scrollTo(0, 0);
  try {
    let r;
    if (name === "quality") r = await mountQuality(main, params);
    else if (name === "problem") r = await mountEditor(main, +parts[1], params);
    else if (name === "diag") r = await mountDiag(main, parts[1], params);
    else if (name === "reports") r = await mountReports(params);
    else if (name === "manage") r = await mountManage();
    else if (name === "import") r = mountImport();
    else r = await mountDash();
    cur = typeof r === "function" ? { destroy: r } : r;
  } catch (e) { console.error(e); main.innerHTML = `<div class="box empty">화면을 열지 못했어요: ${esc(e.message)}</div>`; }
  refreshCount();
}
let lastHash = location.hash;
addEventListener("hashchange", () => {
  if (cur && cur.canLeave && !cur.canLeave()) { history.replaceState(null, "", lastHash); return; }
  lastHash = location.hash; route();
});

// ───────── 대시보드 ─────────
function barChart(data, key, label) {
  const W = 560, H = 150, pad = { l: 28, r: 6, t: 16, b: 22 };
  const max = Math.max(1, ...data.map(d => d[key]));
  const nice = max <= 5 ? max : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const bw = (W - pad.l - pad.r) / data.length, ih = H - pad.t - pad.b;
  const bars = data.map((d, i) => {
    const h = d[key] / nice * ih, x = pad.l + i * bw + bw * 0.18, y = pad.t + ih - h;
    const day = d.date.slice(5).replace("-", "/");
    return `<g><title>${d.date} · ${label} ${d[key]}</title><rect class="b" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(h, d[key] ? 1.5 : 0).toFixed(1)}" rx="2"/>
      ${d[key] ? `<text class="lb" x="${(x + bw * 0.32).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${d[key]}</text>` : ""}
      ${i % 2 === (data.length - 1) % 2 ? `<text class="ax" x="${(x + bw * 0.32).toFixed(1)}" y="${H - 6}" text-anchor="middle">${day}</text>` : ""}</g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 ${data.length}일 ${label}">
    <line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/><line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t}" y2="${pad.t}" stroke-dasharray="2 3"/>
    <text class="ax" x="${pad.l - 6}" y="${pad.t + 3}" text-anchor="end">${nice}</text><text class="ax" x="${pad.l - 6}" y="${pad.t + ih + 3}" text-anchor="end">0</text>${bars}</svg>`;
}
async function mountDash() {
  main.innerHTML = `<div class="box"><span class="spin"></span>불러오는 중…</div>`;
  const [o, act, st, reps] = await Promise.all([api("GET", "/overview"), api("GET", "/activity?days=14"), api("GET", "/stats/problems"), api("GET", "/reports?status=open")]);
  const low = st.problems.filter(p => p.attempts >= MIN_N && p.accuracy !== null).sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts).slice(0, 10);
  main.innerHTML = `<div class="ph"><div><h1>대시보드</h1><p>오늘·이번 주 사용 현황과 먼저 살펴볼 문제예요. (한국 시간 기준)</p></div><button class="btn" data-reload>새로 고침</button></div>
    <div class="kpis">
      <div class="kpi"><span>오늘 사용자</span><b>${n(o.active_day)}</b><small>최근 24시간</small></div>
      <div class="kpi"><span>이번 주 사용자</span><b>${n(o.active_week)}</b><small>최근 7일</small></div>
      <div class="kpi"><span>오늘 풀이</span><b>${n(o.answers_day)}</b><small>채점 횟수</small></div>
      <div class="kpi"><span>이번 주 풀이</span><b>${n(o.answers_week)}</b><small>채점 횟수</small></div>
      <a class="kpi ${o.open_reports ? "bad" : ""}" href="#/reports"><span>새 오류 제보</span><b>${n(o.open_reports)}</b><small>처리 안 한 것</small></a>
      <div class="kpi"><span>기기</span><b>${n(o.devices)}</b><small>기록 수집 동의 ${n(o.consented)}</small></div>
      <div class="kpi"><span>AI 채점 (서술형)</span><b>${o.ai && o.ai.enabled ? n(o.ai.total) : "꺼짐"}</b><small>${!o.ai || !o.ai.enabled ? "서버에 Gemini 키 없음" : o.ai.judged ? `내 판정과 일치 ${pct(o.ai.agreement)} · ${o.ai.judged}건` : `이번 주 ${n(o.ai.week)} · 아직 판정 없음`}</small></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="box"><div class="hd"><h2>날짜별 풀이 수</h2><small>최근 14일 합계 ${n(act.days.reduce((s, d) => s + d.answers, 0))}</small></div>${barChart(act.days, "answers", "풀이")}</div>
      <div class="box"><div class="hd"><h2>날짜별 사용자 수</h2><small>그날 한 번이라도 쓴 기기</small></div>${barChart(act.days, "users", "사용자")}</div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="box"><div class="hd"><h2>정답률 낮은 문제 Top 10</h2><small>첫 시도 ${MIN_N}회 이상</small></div>
        ${low.length ? `<div class="tw"><table><thead><tr><th>과목</th><th>번호</th><th>문제</th><th class="n">정답률</th><th class="n">시도</th><th class="n">시간</th></tr></thead><tbody>
        ${low.map(p => `<tr class="click" data-pid="${p.id}"><td>${esc(p.course)}</td><td class="no">${esc(p.no)}</td><td><span class="q">${esc(p.q)}</span></td><td class="n">${accCell(p.accuracy, p.attempts)}</td><td class="n">${p.attempts}</td><td class="n">${sec(p.median_ms)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="muted">아직 첫 시도가 ${MIN_N}회 넘은 문제가 없어요. 베타 테스터가 풀기 시작하면 여기에 모여요.</p>`}</div>
      <div class="box"><div class="hd"><h2>새 제보</h2><a href="#/reports">제보함 열기 ›</a></div>
        ${reps.reports.length ? `<ul class="rlist">${reps.reports.slice(0, 6).map(r => `<li data-rep="${r.id}"><div class="rl1"><b>${esc(r.course)} · ${esc(r.ext_id)}</b><span class="tag">${CAT[r.category] || r.category}</span><span class="t">${ago(r.created_at)}</span></div>${r.message ? `<div class="rl2">${esc(r.message)}</div>` : ""}</li>`).join("")}</ul>`
        : `<p class="muted">처리할 제보가 없어요.</p>`}</div>
    </div>
    <div class="box"><div class="hd"><h2>과목별</h2><a href="#/manage">학기·과목 관리 ›</a></div><div class="tw"><table><thead><tr><th>학기</th><th>과목</th><th class="n">문제</th><th class="n">담은 사람</th><th class="n">풀린 문제</th><th class="n">첫 시도 정답률</th><th class="n">열린 제보</th></tr></thead><tbody>
      ${o.courses.map(c => { const ps = st.problems.filter(p => p.course_id === c.id); const sv = ps.filter(p => p.attempts); const t = sv.reduce((s, p) => s + p.attempts, 0), ok = sv.reduce((s, p) => s + p.attempts * p.accuracy, 0); const rp = ps.reduce((s, p) => s + p.open_reports, 0);
        return `<tr class="click" data-course="${c.id}"><td>${esc(c.semester)}</td><td><b>${esc(c.short)}</b> <span class="muted">${esc(c.name)}</span></td><td class="n">${n(c.problems)}</td><td class="n">${n(c.enrolled)}</td><td class="n">${n(sv.length)}</td><td class="n">${t ? accCell(ok / t, t) : "–"}</td><td class="n">${rp ? `<span class="bad">${rp}</span>` : "–"}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  const onClick = e => {
    const t = e.target.closest("[data-pid],[data-rep],[data-course],[data-reload]"); if (!t) return;
    if (t.dataset.pid) location.hash = "#/problem/" + t.dataset.pid;
    else if (t.dataset.rep) location.hash = "#/reports?id=" + t.dataset.rep;
    else if (t.dataset.course) location.hash = "#/quality?course=" + t.dataset.course;
    else route();
  };
  main.addEventListener("click", onClick);
  return () => main.removeEventListener("click", onClick);
}

// ───────── 오류 제보함 ─────────
const CAT = { answer: "정답 오류", explanation: "해설 오류", typo: "오타·표현", other: "기타" };
const RST = { open: ["접수", "red"], fixed: ["수정함", "ok"], rejected: ["반려", ""] };
async function mountReports(params) {
  let status = params.get("id") ? "all" : mem.get("repStatus", "open");
  let all = [], selId = +params.get("id") || null, detail = null;
  async function load() { all = (await api("GET", "/reports?status=all")).reports; if (!selId) { const f = list()[0]; selId = f ? f.id : null; } render(); if (selId) openDetail(selId); }
  const list = () => all.filter(r => status === "all" || r.status === status);
  function render() {
    const cnt = s => all.filter(r => s === "all" || r.status === s).length;
    const L = list();
    main.innerHTML = `<div class="ph"><div><h1>오류 제보함</h1><p>제보를 보고 문제를 고친 뒤 "수정함"으로, 문제가 없으면 "반려"로 처리하세요. 처리 결과와 답변은 제보한 사람의 마이페이지에 보여요.</p></div></div>
      <div class="bar"><div class="seg">${[["open", "접수"], ["fixed", "수정함"], ["rejected", "반려"], ["all", "전체"]].map(([v, l]) => `<button data-st="${v}" aria-pressed="${status === v}">${l}<span class="c">${cnt(v)}</span></button>`).join("")}</div></div>
      <div class="split">
        <div class="box" style="padding:8px">${L.length ? `<ul class="rlist">${L.map(r => `<li data-id="${r.id}" aria-selected="${r.id === selId}">
            <div class="rl1"><span class="tag ${RST[r.status][1]}">${RST[r.status][0]}</span><b>${esc(r.course)} · ${esc(r.ext_id)}</b><span class="tag">${CAT[r.category] || r.category}</span><span class="t">${ago(r.created_at)}</span></div>
            ${r.message ? `<div class="rl2">${esc(r.message)}</div>` : ""}</li>`).join("")}</ul>` : `<div class="empty">${status === "open" ? "처리할 제보가 없어요 🎉" : "제보가 없어요."}</div>`}</div>
        <div id="detail" class="sticky">${selId ? `<div class="box"><span class="spin"></span>불러오는 중…</div>` : `<div class="box empty">왼쪽에서 제보를 고르세요.</div>`}</div>
      </div>`;
  }
  async function openDetail(id) {
    selId = id; main.querySelectorAll(".rlist li").forEach(li => li.setAttribute("aria-selected", +li.dataset.id === id));
    const r = all.find(x => x.id === id); if (!r) return;
    const el = main.querySelector("#detail"); el.innerHTML = `<div class="box"><span class="spin"></span>불러오는 중…</div>`;
    detail = await api("GET", "/problems/" + r.problem_id);
    if (selId !== id) return;
    const v = detail.versions.find(x => x.version === r.version) || detail.versions[0];
    const cv = detail.versions[0]; const changed = detail.current_version > r.version;
    const s = detail.stats || {};
    el.innerHTML = `<div class="box">
        <div class="hd"><h2>${esc(r.course)} · ${esc(r.ext_id)} <span class="tag">${CAT[r.category] || r.category}</span> <span class="tag ${RST[r.status][1]}">${RST[r.status][0]}</span></h2><small>${ago(r.created_at)}${r.nickname ? " · " + esc(r.nickname) : ""}</small></div>
        ${r.message ? `<p class="msg">${esc(r.message)}</p>` : `<p class="muted">내용 없음</p>`}
        <p class="muted" style="margin:10px 0 0">이 문제: 첫 시도 정답률 ${pct(s.accuracy ?? null)} (${s.attempts || 0}회) · 열린 제보 ${s.open_reports || 0}건${s.top_wrong ? ` · 가장 많은 오답 "${esc(String(s.top_wrong.answer).slice(0, 20))}" ${pct(s.top_wrong.share)}` : ""}</p>
      </div>
      <div class="box"><div class="hd"><h2>제보한 버전 (v${v.version})</h2>${changed ? `<span class="tag ok">그 뒤 v${detail.current_version}으로 고침</span>` : `<small>지금 버전</small>`}</div>
        <div id="rpv">${previewHTML({ kind: v.kind, star: v.star, body: v.body, files: detail.files })}</div>
        <div style="margin-top:12px"><a class="btn" href="#/problem/${detail.id}?report=${r.id}">문제 편집하기 ›</a></div></div>
      <div class="box"><h2>처리</h2>
        <label class="f"><span>답변 <small>제보한 사람에게 보여요 (선택)</small></span><textarea id="anote" rows="2" maxlength="500" placeholder="예: 정답을 C로 고쳤어요. 알려 줘서 고마워요!">${esc(r.admin_note || "")}</textarea></label>
        <div class="bar" style="margin:0">${r.status !== "fixed" ? `<button class="btn okb" data-do="fixed">수정함으로 처리</button>` : ""}${r.status !== "rejected" ? `<button class="btn" data-do="rejected">반려</button>` : ""}${r.status !== "open" ? `<button class="btn" data-do="open">다시 접수로</button>` : `<button class="btn sm" data-do="note" style="margin-left:auto">답변만 저장</button>`}</div>
        ${!changed && r.status === "open" && r.category !== "typo" ? `<p class="muted" style="margin:10px 0 0;font-size:12.5px">아직 문제를 고치지 않았어요. 고칠 게 있으면 먼저 "문제 편집하기"에서 새 버전으로 저장하세요.</p>` : ""}
      </div>`;
    typeset(el.querySelector("#rpv"), detail.math);
  }
  async function act(st) {
    const r = all.find(x => x.id === selId); const note = main.querySelector("#anote").value.trim();
    try {
      const nr = await api("PATCH", "/reports/" + r.id, { status: st === "note" ? r.status : st, admin_note: note });
      Object.assign(r, nr); toast(st === "fixed" ? "수정함으로 처리했어요" : st === "rejected" ? "반려했어요" : st === "open" ? "다시 접수로 돌렸어요" : "답변을 저장했어요");
      if (st !== "note" && status !== "all" && status !== st) { const L = list(); selId = L[0] ? L[0].id : null; }
      render(); if (selId) openDetail(selId); refreshCount();
    } catch (e) { toast(e.message); }
  }
  const onClick = e => {
    const t = e.target.closest("[data-st],[data-id],[data-do]"); if (!t) return;
    if (t.dataset.st) { status = t.dataset.st; mem.set("repStatus", status); const L = list(); selId = L.some(r => r.id === selId) ? selId : (L[0] ? L[0].id : null); render(); if (selId) openDetail(selId); return; }
    if (t.dataset.id) { openDetail(+t.dataset.id); return; }
    if (t.dataset.do) act(t.dataset.do);
  };
  main.addEventListener("click", onClick);
  await load();
  return () => main.removeEventListener("click", onClick);
}

// ───────── 학기·과목 관리 ─────────
async function mountManage() {
  let sems = [], courses = [], backups = [], bdir = "";
  async function load() {
    [sems, courses] = await Promise.all([api("GET", "/semesters").then(r => r.semesters), api("GET", "/courses").then(r => r.courses)]);
    const b = await api("GET", "/backups"); backups = b.backups; bdir = b.dir; render();
  }
  const mb = x => (x / 1048576).toFixed(1) + "MB";
  const backupBox = () => `<div class="box"><div class="hd"><h2>백업</h2><small>서버가 하루 한 번 자동으로 만들고 최근 7개만 남겨요</small></div>
    ${backups.length ? `<div class="tw"><table><thead><tr><th>파일</th><th>만든 때</th><th class="n">크기</th><th></th></tr></thead><tbody>${backups.map(b => `<tr><td class="no">${esc(b.name)}</td><td class="muted">${ago(b.at)}</td><td class="n">${mb(b.size)}</td>
      <td><a class="btn sm" href="${BASE}/backup-file/${encodeURIComponent(b.name)}" download>내려받기</a></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">아직 백업이 없어요.</p>`}
    <div class="bar" style="margin:14px 0 0"><button class="btn pri" data-backup>지금 백업</button><span class="muted" style="font-size:12.5px">저장 위치: ${esc(bdir)}</span></div></div>`;
  function render() {
    main.innerHTML = `<div class="ph"><div><h1>학기·과목</h1><p>학기를 추가하고, 과목 이름·순서·보이기를 바꿔요. 새 과목은 <a href="#/import">문제 세트 올리기</a>로 추가해요.</p></div></div>
      <div class="box"><div class="hd"><h2>학기</h2><small>숨긴 학기는 사용자 둘러보기에 안 보여요</small></div>
        <div class="tw"><table><thead><tr><th>코드</th><th>이름</th><th class="n">과목</th><th>사용자에게 보이기</th></tr></thead><tbody>
        ${sems.map(s => `<tr><td class="no">${esc(s.code)}</td><td><input type="text" data-semname="${s.id}" value="${esc(s.name)}" maxlength="30"></td><td class="n">${courses.filter(c => c.semester_id === s.id).length}</td>
          <td><span class="sw"><input type="checkbox" data-semvis="${s.id}" ${s.visible ? "checked" : ""} aria-label="${esc(s.code)} 보이기"><i></i></span></td></tr>`).join("")}</tbody></table></div>
        <form class="bar" id="semF" style="margin:14px 0 0"><input type="text" name="code" placeholder="학기 코드 (예: 27-1, 26-W)" required pattern="\\d{2}-(1|2|S|W)" style="width:200px"><input type="text" name="name" placeholder="이름 (예: 2027년 1학기)" maxlength="30" style="width:220px"><button class="btn pri">학기 추가</button></form>
      </div>
      ${sems.map(s => { const cs = courses.filter(c => c.semester_id === s.id).sort((a, b) => a.sort - b.sort); return `<div class="box"><div class="hd"><h2>${esc(s.name)} 과목</h2><small>위에서부터 사용자 화면 순서</small></div>
        ${cs.length ? `<div class="tw"><table><thead><tr><th>순서</th><th>짧은 이름</th><th>과목명</th><th>교수</th><th>설명</th><th class="n">문제</th><th>보이기</th><th></th></tr></thead><tbody>
        ${cs.map((c, i) => `<tr data-cid="${c.id}"><td style="white-space:nowrap"><button class="ib" data-mv="${c.id}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="위로">↑</button> <button class="ib" data-mv="${c.id}" data-d="1" ${i === cs.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button></td>
          <td><input type="text" data-cf="short" value="${esc(c.short)}" maxlength="20" style="width:90px"></td><td><input type="text" data-cf="name" value="${esc(c.name)}" maxlength="60" style="width:180px"></td>
          <td><input type="text" data-cf="professor" value="${esc(c.professor)}" maxlength="30" style="width:90px"></td><td><input type="text" data-cf="meta" value="${esc(c.meta)}" maxlength="120" style="width:220px"></td>
          <td class="n">${n(c.problems)}</td><td><span class="sw"><input type="checkbox" data-cvis="${c.id}" ${c.visible ? "checked" : ""} aria-label="${esc(c.short)} 보이기"><i></i></span></td>
          <td><a class="btn sm" href="#/quality?course=${c.id}">문제 ›</a></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">아직 과목이 없어요. <a href="#/import">문제 세트 올리기</a>에서 이 학기 코드로 올리면 생겨요.</p>`}</div>`; }).join("")}${backupBox()}`;
  }
  async function patchCourse(id, body, msg) { try { await api("PATCH", "/courses/" + id, body); toast(msg || "저장했어요"); } catch (e) { toast(e.message); } }
  const onChange = async e => {
    const t = e.target;
    if (t.dataset.semname) { await api("PATCH", "/semesters/" + t.dataset.semname, { name: t.value.trim() }).then(() => toast("학기 이름을 저장했어요"), err => toast(err.message)); return; }
    if (t.dataset.semvis) { await api("PATCH", "/semesters/" + t.dataset.semvis, { visible: t.checked }).then(() => toast(t.checked ? "학기를 보이게 했어요" : "학기를 숨겼어요"), err => toast(err.message)); return; }
    if (t.dataset.cvis) { await patchCourse(+t.dataset.cvis, { visible: t.checked }, t.checked ? "과목을 보이게 했어요" : "과목을 숨겼어요"); return; }
    if (t.dataset.cf) { const id = +t.closest("tr").dataset.cid; await patchCourse(id, { [t.dataset.cf]: t.value.trim() }); const c = courses.find(x => x.id === id); c[t.dataset.cf] = t.value.trim(); }
  };
  const onClick = async e => {
    const bk = e.target.closest("[data-backup]");
    if (bk) { bk.disabled = true; try { const r = await api("POST", "/backups"); backups = r.backups; render(); toast("백업했어요: " + r.made.name); } catch (err) { bk.disabled = false; toast(err.message); } return; }
    const b = e.target.closest("[data-mv]"); if (!b) return;
    const c = courses.find(x => x.id === +b.dataset.mv); const cs = courses.filter(x => x.semester_id === c.semester_id).sort((a, b) => a.sort - b.sort);
    const i = cs.indexOf(c), j = i + +b.dataset.d; [cs[i], cs[j]] = [cs[j], cs[i]];
    await Promise.all(cs.map((x, k) => x.sort === k ? null : api("PATCH", "/courses/" + x.id, { sort: k }).then(() => { x.sort = k; })));
    render(); toast("순서를 바꿨어요");
  };
  const onSubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { await api("POST", "/semesters", { code: f.code.value.trim(), name: f.name.value.trim() }); toast("학기를 추가했어요"); load(); } catch (err) { toast(err.message); }
  };
  main.addEventListener("change", onChange); main.addEventListener("click", onClick); main.addEventListener("submit", onSubmit);
  await load();
  return () => { main.removeEventListener("change", onChange); main.removeEventListener("click", onClick); main.removeEventListener("submit", onSubmit); };
}

// ───────── 문제 세트 올리기 ─────────
function mountImport() {
  let pack = null, fileName = "", result = null;
  function render() {
    const kinds = pack && Array.isArray(pack.problems) ? ["ox", "mc", "short", "essay"].map(k => [k, pack.problems.filter(p => p.kind === k).length]).filter(x => x[1]) : [];
    const P = result && result.plan;
    main.innerHTML = `<div class="ph"><div><h1>문제 세트 올리기</h1><p>공통 형식(format: 1) JSON을 올리면 먼저 미리보기로 무엇이 바뀌는지 보여 주고, 확인한 뒤 게시해요. 같은 과목·문제 번호가 있으면 내용이 바뀐 문제만 새 버전이 돼요.</p></div></div>
      <div class="box">
        <label class="drop" id="drop"><input type="file" id="file" accept=".json,application/json" hidden>
          ${pack ? `<b>${esc(fileName)}</b><br>${esc(pack.course?.name || "?")} · ${esc(pack.semester?.code || "?")} · 문제 ${n(pack.problems?.length || 0)}개<br><small>다른 파일을 올리려면 다시 누르거나 끌어 놓으세요</small>` : `<b>JSON 파일을 여기에 끌어 놓거나 눌러서 고르세요</b><br><small>예: data/import/MIS.json</small>`}</label>
        <details class="adv" style="margin-top:12px"><summary>JSON 붙여 넣기</summary><textarea class="code" id="paste" rows="8" placeholder='{"format":1,"semester":{"code":"27-1"},"course":{...},"chapters":[...],"problems":[...]}'></textarea><div style="margin-top:6px"><button class="btn sm" data-paste>붙여 넣은 내용 읽기</button></div></details>
        <details class="adv"><summary>형식 안내</summary><pre class="code" style="white-space:pre-wrap;margin:8px 0 0;background:var(--fill2);padding:10px;border-radius:10px">{
  "format": 1,
  "semester": { "code": "27-1", "name": "2027년 1학기" },
  "course": { "code": "MS", "short": "경과", "name": "경영과학", "professor": "…", "meta": "…",
              "color": { "light": "#1f5f8b", "dark": "#7fb6dd" }, "lang": "ko", "math": false, "files": { "L1": "1강 PPT" } },
  "chapters": [ { "key": "CH1", "title": "CH1 · 선형계획", "short": "CH1" } ],
  "problems": [
    { "ext_id": "1-1", "chapter": "CH1", "kind": "ox", "q": "…", "ox": true, "s": "해설", "src": [["L1", "12"]] },
    { "ext_id": "1-2", "chapter": "CH1", "kind": "mc", "q": "…", "opts": ["…", "…"], "ans": 0 },
    { "ext_id": "1-3", "chapter": "CH1", "kind": "short", "q": "…", "a": "정답", "accept": ["정답", "answer"] },
    { "ext_id": "1-4", "chapter": "CH1", "kind": "essay", "q": "…", "a": "모범 답안", "pts": ["포인트 1"] }
  ]
}</pre><p class="muted" style="margin:8px 0 0;font-size:13px">수식 과목은 <code>course.math</code>를 <code>true</code>로 해 주세요. 수식은 문장 속이면 <code>\\( … \\)</code>, 따로 한 줄이면 <code>\\[ … \\]</code>로 써요. <code>$ … $</code>는 화면에 안 나와서 올릴 때 오류로 알려 줘요.</p></details>
      </div>
      ${pack ? `<div class="box"><div class="hd"><h2>미리보기</h2>${result && result.ok ? `<small>${result.dry ? "아직 DB는 바뀌지 않았어요" : "게시 완료"}</small>` : ""}</div>
        ${!result ? `<span class="spin"></span>검사 중…` : !result.ok ? `<p class="bad" style="margin:0">오류 ${result.errors.length}개 때문에 올릴 수 없어요. 파일을 고친 뒤 다시 올려 주세요.</p><ol class="errs">${result.errors.slice(0, 200).map(e => `<li>${esc(e)}</li>`).join("")}</ol>`
        : `<div class="plan">
            <div><span>학기 ${esc(pack.semester.code)}</span><b>${P.semester === "new" ? "새로 만듦" : "기존"}</b></div>
            <div><span>과목 ${esc(pack.course.short || pack.course.code)}</span><b>${P.course === "new" ? "새로 만듦" : "기존 과목 갱신"}</b></div>
            <div><span>챕터</span><b>${pack.chapters.length}</b> <small class="muted">새 ${P.chapters.add} · 바뀜 ${P.chapters.update}</small></div>
            <div><span>새 문제</span><b>${n(P.problems.add)}</b></div>
            <div><span>내용 바뀐 문제 → 새 버전</span><b class="${P.problems.changed ? "" : "muted"}">${n(P.problems.changed)}</b></div>
            <div><span>그대로</span><b class="muted">${n(P.problems.same)}</b></div>
          </div>
          <p class="muted" style="margin:0 0 12px">${kinds.map(([k, c]) => `${KIND[k]} ${c}`).join(" · ")}</p>
          ${result.dry ? `<button class="btn pri" data-publish ${P.problems.add + P.problems.changed + P.chapters.add + P.chapters.update === 0 && P.course !== "new" ? "disabled" : ""}>게시하기</button>${P.problems.add + P.problems.changed === 0 && P.course !== "new" ? ` <span class="muted">바뀐 문제가 없어요</span>` : ""}`
            : `<a class="btn pri" href="#/quality?course=${result.courseId}">문제 품질에서 보기 ›</a> <a class="btn" href="/course/${result.courseId}" target="_blank" rel="noopener">사용자 화면에서 보기 ↗</a>`}`}
      </div>
      ${result && result.ok ? `<div class="box"><h2>앞의 문제 5개</h2>${pack.problems.slice(0, 5).map(p => previewHTML({ kind: p.kind, star: p.star, body: p, label: `<b>${esc(p.ext_id)}</b>` })).join('<div style="height:10px"></div>')}</div>` : ""}` : ""}`;
    if (result && result.ok) typeset(main, pack.course && pack.course.math);
  }
  async function check(text, name) {
    try { pack = JSON.parse(text); } catch { toast("JSON 형식이 아니에요"); return; }
    fileName = name; result = null; render();
    try { result = await api("POST", "/import?dry=1", pack); } catch (e) { result = { ok: false, errors: (e.data && e.data.errors) || [e.message] }; }
    render();
  }
  const readFile = f => { if (!f) return; const r = new FileReader(); r.onload = () => check(String(r.result), f.name); r.readAsText(f); };
  const onChange = e => { if (e.target.id === "file") readFile(e.target.files[0]); };
  const onClick = async e => {
    const b = e.target.closest("[data-paste],[data-publish]"); if (!b) return;
    if (b.dataset.paste !== undefined) { check(main.querySelector("#paste").value, "붙여 넣은 JSON"); return; }
    const P = result.plan;
    if (!(await ask({ title: "게시할까요?", body: `새 문제 ${P.problems.add}개, 새 버전 ${P.problems.changed}개가 사용자 화면에 바로 반영돼요.`, ok: "게시하기" }))) return;
    b.disabled = true;
    try { result = await api("POST", "/import", pack); toast("게시했어요"); render(); } catch (err) { b.disabled = false; toast(err.message); }
  };
  const over = e => { e.preventDefault(); const d = main.querySelector("#drop"); if (d) d.classList.toggle("over", e.type === "dragover"); };
  const drop = e => { e.preventDefault(); const d = main.querySelector("#drop"); if (d) d.classList.remove("over"); readFile(e.dataTransfer.files[0]); };
  main.addEventListener("change", onChange); main.addEventListener("click", onClick);
  main.addEventListener("dragover", over); main.addEventListener("dragleave", over); main.addEventListener("drop", drop);
  render();
  return () => { main.removeEventListener("change", onChange); main.removeEventListener("click", onClick); main.removeEventListener("dragover", over); main.removeEventListener("dragleave", over); main.removeEventListener("drop", drop); };
}

route();
