// 마이페이지: 프로필(닉네임·동의·테마) / 학습 현황 / 내 강의실 관리 / 내 오류 제보 / 기기 이동
import { $, esc, barHTML, pct, ago, toast, ask } from "./util.js";
import { S, api, updateDevice, setEnroll, courseCounts, courseMeta, adoptDevice, onChange, flush } from "./store.js";

const CAT = { answer: "정답 오류", explanation: "해설 오류", typo: "오타·표현", other: "기타" };
const RST = { open: ["접수됨", ""], fixed: ["수정됨", "correct"], rejected: ["반려", "wrong"] };

export function mountMe(view, ctx) {
  let reports = null, code = null, timer = null, showKey = false;
  let ins = null;   // 학습 리포트 개요 { cid: { state, … } } — 뽑아 둔 리포트가 있는 과목 줄에만 "리포트 ›"

  function profile() {
    const d = S.device; const th = ctx.theme();
    return `<section class="panel">
      <h2>프로필</h2>
      <form class="row-f" id="nickF"><label for="nick">닉네임</label><input id="nick" maxlength="20" value="${esc(d.nickname)}" placeholder="베타 테스터 이름 (안 적어도 돼요)" autocomplete="off"><button class="btn pri">저장</button></form>
      <div class="kv"><span>기기 번호</span><code>${esc(d.id.slice(0, 6))}…</code></div>
      <label class="tog"><span class="tt"><b>풀이 기록 모으기에 동의</b><small>${d.consent
        ? "정답률·풀이 시간이 익명으로 모여 문제를 고치는 데 쓰여요. 내 기록은 서버에도 저장돼 다른 기기에서 이어 풀 수 있어요."
        : "지금은 기록이 이 브라우저에만 저장돼요. 동의하면 문제 개선에 쓰이고, 다른 기기로 옮길 수 있어요."}</small></span>
        <span class="sw"><input type="checkbox" id="consent" ${d.consent ? "checked" : ""}><i></i></span></label>
      <div class="kv"><span>화면</span><div class="seg sm" role="radiogroup" aria-label="화면 테마">${[["auto", "자동"], ["light", "라이트"], ["dark", "다크"]].map(([v, l]) =>
        `<label><input type="radio" name="theme" value="${v}" ${th === v ? "checked" : ""}><span>${l}</span></label>`).join("")}</div></div>
    </section>`;
  }

  function study() {
    const sems = (S.catalog?.semesters || []).map(s => ({ s, cs: s.courses.filter(c => S.enroll.includes(c.id) || courseCounts(c.id).done) })).filter(x => x.cs.length);
    if (!sems.length) return `<section class="panel"><h2>학습 현황</h2><p class="muted">아직 푼 문제가 없어요. <a href="/browse" data-link>과목을 담고</a> 풀어 보세요.</p></section>`;
    const ready = id => !!(ins && ins[id] && (ins[id].state === "ready" || ins[id].state === "locked")), anyR = sems.some(({ cs }) => cs.some(c => ready(c.id)));   // 줄 칸이 어긋나지 않게 하나라도 있으면 모두 자리를 둔다
    return `<section class="panel"><h2>학습 현황</h2>${sems.map(({ s, cs }) => `<h3 class="sem">${esc(s.name)}</h3>
      <div class="srows">${cs.map(c => {
        const k = courseCounts(c.id, c.problems); const p = pct(k);
        const row = `<a class="srow" href="/course/${c.id}" data-link style="--c:${esc(c.color?.light || "#0066cc")}">
          <span class="sdot"></span><span class="sn">${esc(c.short)}</span>${barHTML(k)}
          <span class="sv"><b>${k.done}</b>/${k.all}</span><span class="sv">${p === null ? "–" : p + "%"}</span><span class="sv so${k.w ? " w" : ""}">오답 ${k.w}</span>
          <span class="sl">${k.last ? ago(k.last) : ""}</span></a>`;
        return anyR ? `<div class="ins-mrow">${row}${ready(c.id) ? `<a class="ins-me" href="/course/${c.id}/INSIGHT" data-link>리포트 ›</a>` : `<span class="ins-me"></span>`}</div>` : row;
      }).join("")}</div>`).join("")}
      <p class="hint">진행 막대: 초록 = 한 번에 맞힘 · 연초록 = 다시 풀어 해결 · 빨강 = 오답</p></section>`;
  }

  function classroom() {
    const cs = S.enroll.map(id => courseMeta(id)).filter(Boolean);
    return `<section class="panel"><h2>내 강의실 관리 <small>${cs.length}과목</small></h2>${cs.length ? `<ul class="olist">${cs.map((c, i) => `<li>
        <span class="badge sm" style="--c:${esc(c.color?.light || "#0066cc")};--cd:${esc(c.color?.dark || "#2997ff")}">${esc(c.short)}</span><span class="on"><b>${esc(c.name)}</b><small>${esc(c.semester.name)}</small></span>
        <button class="ib" data-mv="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="위로">↑</button><button class="ib" data-mv="${i}" data-d="1" ${i === cs.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button>
        <button class="btn ghost danger-t" data-rm="${c.id}">빼기</button></li>`).join("")}</ul>`
      : `<p class="muted">담은 과목이 없어요.</p>`}<a class="btn" href="/browse" data-link>＋ 과목 담으러 가기</a></section>`;
  }

  function myReports() {
    let body;
    if (reports === null) body = `<p class="muted"><span class="spin"></span>불러오는 중…</p>`;
    else if (reports === false) body = `<p class="muted">제보 내역을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>`;
    else if (!reports.length) body = `<p class="muted">보낸 제보가 없어요. 문제 카드 아래 <b>오류 제보</b>로 알려 주세요.</p>`;
    else body = `<ul class="rlist">${reports.map(r => { const [lab, cls] = RST[r.status] || RST.open; return `<li>
        <div class="rh"><span class="pill ${cls}">${lab}</span><b>${esc(r.course)} · ${esc(r.ext_id)}</b><span class="cat">${CAT[r.category] || r.category}</span><span class="when">${ago(r.created_at)}</span></div>
        ${r.message ? `<p class="rm">${esc(r.message)}</p>` : ""}${r.admin_note ? `<p class="rn"><b>답변</b> ${esc(r.admin_note)}</p>` : ""}</li>`; }).join("")}</ul>`;
    return `<section class="panel"><h2>내 오류 제보</h2>${body}</section>`;
  }

  function transfer() {
    const d = S.device;
    let mine;
    if (!d.consent) mine = `<p class="muted">기록 모으기에 동의해야 다른 기기로 옮길 수 있어요. (기록이 서버에 있어야 옮길 수 있어요)</p>`;
    else if (code) mine = `<div class="code" aria-label="이동 코드 ${code.code.split("").join(" ")}">${code.code.split("").map(ch => `<span>${ch}</span>`).join("")}</div><p class="hint" id="codeLeft"></p>`;
    else mine = `<button class="btn pri" id="mkCode">이동 코드 만들기</button>`;
    return `<section class="panel"><h2>기기 이동</h2>
      <div class="two">
        <div><h3>이 기기 기록을 다른 기기로</h3><p class="muted">코드를 만들어 새 기기의 마이페이지에 입력하세요. 코드는 10분 동안 쓸 수 있어요.</p>${mine}</div>
        <form id="claimF"><h3>다른 기기 기록 가져오기</h3><p class="muted">다른 기기에서 만든 6자리 코드나 <b>기록 열쇠</b>를 넣으세요. 이 기기의 지금 기록은 가져온 기록으로 바뀌어요.</p>
          <div class="inrow"><input id="claim" maxlength="64" placeholder="6자리 코드 또는 기록 열쇠" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn">가져오기</button></div></form>
      </div>
      <div class="keybox"><h3>내 기록 열쇠</h3>
        <p class="muted">사이트 주소가 바뀌거나 브라우저 기록을 지워도, 이 열쇠를 위 칸에 넣으면 기록을 되찾아요. 메모 앱 같은 곳에 저장해 두세요. <b>다른 사람에게 보여 주지 마세요.</b> 이 열쇠만 있으면 내 기록을 쓸 수 있어요.</p>
        ${d.consent ? `<div class="inrow"><input id="myKey" readonly value="${esc(d.id)}" type="${showKey ? "text" : "password"}" spellcheck="false"><button class="btn" type="button" id="toggleKey">${showKey ? "숨기기" : "보기"}</button><button class="btn pri" type="button" id="copyKey">복사</button></div>`
          : `<p class="muted">기록 모으기에 동의해야 열쇠로 되찾을 수 있어요. (기록이 서버에 있어야 해요)</p>`}
      </div></section>`;
  }

  function render() {
    if (!S.device) return;
    view.innerHTML = `<div class="wrap me">
      <header class="hero sm"><p class="eyebrow">마이페이지</p><h1>${esc(S.device.nickname || "익명 베타 테스터")}</h1></header>
      ${profile()}${study()}${classroom()}${myReports()}${transfer()}</div>`;
    tick();
  }
  function tick() {
    clearInterval(timer);
    if (!code) return;
    const upd = () => {
      const left = Math.max(0, new Date(code.expires_at) - Date.now()); const el = $("#codeLeft", view);
      if (!left) { code = null; clearInterval(timer); render(); return; }
      if (el) el.textContent = `남은 시간 ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")} · 새 기기에서 입력하면 바로 사라져요`;
    };
    upd(); timer = setInterval(upd, 1000);
  }
  async function loadReports() {
    try { reports = (await api("GET", "/api/me/reports")).reports; } catch { reports = false; }
    render();
  }
  async function loadIns() {   // 기록 동의한 기기만 (서버에 기록이 있어야 리포트가 있다)
    if (!S.device || !S.device.consent) return;
    try {
      if (!(await api("GET", "/api/features")).insight) return;   // 기능이 꺼져 있으면 묻지 않는다
      ins = (await api("GET", "/api/me/insight")).courses || null; if (ins) render();
    } catch { }
  }

  async function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.mv !== undefined) {
      const i = +b.dataset.mv, j = i + +b.dataset.d; const a = [...S.enroll]; [a[i], a[j]] = [a[j], a[i]]; setEnroll(a); render(); return;
    }
    if (b.dataset.rm) {
      const c = courseMeta(+b.dataset.rm);
      if (await ask({ title: `${c.short}을(를) 내 강의실에서 뺄까요?`, body: "풀이 기록은 지워지지 않아요. 다시 담으면 그대로 이어서 풀 수 있어요.", ok: "빼기", danger: true })) {
        setEnroll(S.enroll.filter(x => x !== c.id)); render();
      }
      return;
    }
    if (b.id === "toggleKey") { showKey = !showKey; render(); return; }
    if (b.id === "copyKey") {
      try { await navigator.clipboard.writeText(S.device.id); toast("기록 열쇠를 복사했어요. 안전한 곳에 저장해 두세요", "ok"); }
      catch { showKey = true; render(); $("#myKey", view).select(); toast("열쇠를 길게 눌러 복사해 주세요"); }
      return;
    }
    if (b.id === "mkCode") {
      b.disabled = true;
      try { await flush(); code = await api("POST", "/api/transfer"); render(); }
      catch (err) { b.disabled = false; toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
    }
  }
  async function onSubmit(e) {
    e.preventDefault();
    if (e.target.id === "nickF") {
      const v = $("#nick", view).value.trim();
      try { await updateDevice({ nickname: v }); toast("닉네임을 저장했어요", "ok"); render(); } catch { toast("저장하지 못했어요. 인터넷 연결을 확인해 주세요", "bad"); }
    }
    if (e.target.id === "claimF") {
      const v = $("#claim", view).value.trim();
      const isKey = /^[A-Za-z0-9_-]{16,64}$/.test(v);
      if (!/^\d{6}$/.test(v) && !isKey) { toast("6자리 코드나 기록 열쇠를 입력해 주세요", "bad"); return; }
      const ok = await ask({ title: "다른 기기의 기록을 가져올까요?", body: "이 기기에 있던 내 강의실과 풀이 기록은 가져온 기록으로 바뀌어요.", ok: "가져오기" });
      if (!ok) return;
      try {
        const r = await api("POST", "/api/transfer/claim", isKey ? { key: v } : { code: v });
        await adoptDevice(r.device_id); code = null; reports = null; render(); loadReports();
        toast("기록을 가져왔어요. 이제 두 기기에서 같은 기록을 써요.", "ok");
      } catch (err) { toast(err.status ? err.message : "인터넷 연결을 확인해 주세요", "bad"); }
    }
  }
  async function onChangeEv(e) {
    const t = e.target;
    if (t.id === "consent") {
      const v = t.checked;
      if (!v && !(await ask({ title: "기록 모으기를 그만할까요?", body: "앞으로의 풀이 기록은 이 브라우저에만 저장되고, 다른 기기로 옮길 수 없어요. 이미 모인 익명 기록은 그대로 남아요.", ok: "그만하기", danger: true }))) { t.checked = true; return; }
      try { await updateDevice({ consent: v }); toast(v ? "고마워요! 이제 기록이 서버에도 저장돼요." : "이제 기록은 이 브라우저에만 저장돼요.", "ok"); render(); }
      catch { t.checked = !v; toast("바꾸지 못했어요. 인터넷 연결을 확인해 주세요", "bad"); }
    }
    if (t.name === "theme") ctx.setTheme(t.value);
  }
  view.addEventListener("click", onClick); view.addEventListener("submit", onSubmit); view.addEventListener("change", onChangeEv);
  const off = onChange(w => { if (w !== "online") render(); });
  document.title = "마이페이지 · 문제노트";
  render(); loadReports(); loadIns();
  return {
    destroy() { clearInterval(timer); off(); view.removeEventListener("click", onClick); view.removeEventListener("submit", onSubmit); view.removeEventListener("change", onChangeEv); },
  };
}
