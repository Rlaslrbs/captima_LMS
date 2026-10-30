// 관리자 "진단" 탭 (학습 리포트 v2): 과목 현황 · 어휘 확인 · 태그 확인(≤20장) · 새 문제 승인 · 커버리지 · 태깅 작업
// API: 서버의 /api/insight/… (관리자 비밀 주소 아래). 쓰기 응답은 바뀐 결과를 그대로 돌려준다
import { api, esc, toast, ask, ago, KIND, LETTERS, pct, n, strip, previewHTML, typeset, mem } from "./lib.js";

const DEPTH = { 1: "정의", 2: "적용", 3: "구별", 4: "조건" };   // 학습자 화면과 같은 이름 (DECISIONS 4)
const TABS = [["vocab", "어휘"], ["check", "태그 확인"], ["new", "새 문제 승인"], ["cover", "커버리지"], ["jobs", "태깅 작업"]];
const STAGE = { tag: "문제 태깅", vocab: "어휘 만들기", gold: "골드 검사", review: "검토", generate: "변형 문제" };
const yes = (b, t = "통과", f = "아직") => `<span class="tag ${b ? "ok" : ""}">${b ? t : f}</span>`;

export async function mountDiag(main, cid, params) {
  return cid ? mountCourse(main, cid, params.get("tab") || mem.get("diagTab", "vocab")) : mountList(main);
}

// ───────── 과목 현황 ─────────
async function mountList(main) {
  main.innerHTML = `<div class="ph"><div><h1>진단</h1><p>세부 포인트 진단(v2)을 과목마다 켜기 전에 확인할 것들이에요. 어휘 확인 · 골드 검사 · 태그 90%가 모두 통과하면 켤 수 있어요.</p></div></div><div class="box"><span class="spin"></span>불러오는 중…</div>`;
  const [o, A] = await Promise.all([api("GET", "/insight/courses"), api("GET", "/insight/ai").catch(() => null)]);
  const sw = (on, attrs, label) => `<label class="sw" title="${label}"><input type="checkbox" role="switch" ${attrs} ${on ? "checked" : ""} aria-label="${label}"><i></i></label>`;
  const C = [...(o.courses || [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const b = o.budget || {}, used = Object.values(b.used || {}).reduce((s, x) => s + (+x || 0), 0);
  main.innerHTML = `<div class="ph"><div><h1>진단</h1><p>세부 포인트 진단(v2)을 과목마다 켜기 전에 확인할 것들이에요. 어휘 확인 · 골드 검사 · 태그 90%가 모두 통과하면 켤 수 있어요.</p></div><button class="btn" data-reload>새로 고침</button></div>
    <div class="kpis">
      <div class="kpi"><span>v2 켠 과목</span><b>${C.filter(c => c.v2_ready).length} / ${C.length}</b><small>여는 순서대로</small></div>
      <div class="kpi"><span>오늘 AI 사용 (태깅)</span><b>${n(b.total ?? used)}</b><small>하루 한도의 60%까지 · 채점이 먼저</small></div>
      ${A ? `<div class="kpi"><span>AI 오답 진단 (전체)</span><b>${sw(A.global, 'data-ai="global"', "AI 오답 진단 전체 켜기")}</b><small>${A.global ? "켜짐 · 리포트 뽑을 때 AI가 틀린 이유를 추정해요" : "꺼짐 (기본)"}</small></div>` : ""}
      <div class="kpi ${o.ai ? "" : "bad"}"><span>AI 키</span><b>${o.ai ? "있음" : "없음"}</b><small>${o.ai ? "태깅을 시작할 수 있어요" : "키가 없으면 태깅을 시작할 수 없어요"}</small></div>
    </div>
    <div class="box" style="margin-top:16px"><table><thead><tr><th>순서</th><th>과목</th><th>어휘</th><th>골드</th><th>태그</th><th>작업</th>${A ? "<th>AI 진단</th>" : ""}<th>v2</th></tr></thead><tbody>
    ${C.map((c, i) => {
      const t = c.tags || {}, g = c.gold || {}, j = c.jobs || {}, gt = c.gate || {};
      return `<tr class="click" data-cid="${c.cid}"><td>${i + 1}</td><td><b>${esc(c.short || c.name)}</b></td>
        <td>${yes(gt.vocab, "확인됨")}${c.vocab && c.vocab.ver ? ` <small class="muted">v${c.vocab.ver}</small>` : ""}</td>
        <td>${c.gold == null ? `<span class="muted">골드 없음</span>` : yes(gt.gold)}${g.n ? ` <small class="muted">${g.n}문제 · 포인트 일치 ${pct(g.facet_agree)}</small>` : ""}</td>
        <td>${yes(gt.share90, pct(t.share), pct(t.share))} <small class="muted">${n(t.tagged)} / ${n(t.published)}</small></td>
        <td>${j.running ? `<span class="tag hl">진행 중</span>` : j.failed ? `<span class="tag red">실패 ${j.failed}</span>` : j.queued ? `<span class="tag">대기 ${j.queued}</span>` : `<span class="muted">–</span>`}</td>
        ${A ? `<td data-noclick>${sw(!!(A.courses || {})[c.cid], `data-ai="${c.cid}"`, "이 과목 AI 오답 진단")}</td>` : ""}
        <td>${gt.hold ? `<span class="tag red">멈춤</span>` : c.v2_ready ? `<span class="tag ok">켜짐</span>` : gt.can_enable ? `<span class="tag hl">켤 수 있음</span>` : `<span class="muted">꺼짐</span>`}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  const on = async e => {
    const sw = e.target.closest && e.target.closest("[data-ai]");
    if (sw) {   // AI 오답 진단 스위치: 전체 또는 과목별 (기본 꺼짐). 행 클릭으로 넘어가지 않게 여기서 끝낸다
      e.stopPropagation(); if (e.type !== "change") return;
      const on = sw.checked, cid = sw.dataset.ai === "global" ? undefined : +sw.dataset.ai;
      try { await api("POST", "/insight/ai", cid === undefined ? { on } : { cid, on }); toast(on ? "AI 오답 진단을 켰어요" : "AI 오답 진단을 껐어요"); mountList(main); }
      catch (err) { toast(err.message, "bad"); sw.checked = !on; }
      return;
    }
    if (e.target.closest("[data-noclick]")) return;
    if (e.target.closest("[data-reload]")) return mountList(main);
    const tr = e.target.closest("tr[data-cid]"); if (tr) location.hash = "#/diag/" + tr.dataset.cid;
  };
  main.addEventListener("click", on); main.addEventListener("change", on);
  return () => { main.removeEventListener("click", on); main.removeEventListener("change", on); };
}

// ───────── 과목 한 개: 탭 ─────────
async function mountCourse(main, cid, tab) {
  let dead = false, cleanup = null;
  const { courses } = await api("GET", "/insight/courses");
  const c = (courses || []).find(x => String(x.cid) === String(cid));
  if (!c) { main.innerHTML = `<div class="box empty">과목을 찾지 못했어요</div>`; return; }
  function shell(inner) {
    return `<div class="crumb"><a href="#/diag">‹ 진단</a></div>
      <div class="ph"><div><h1>${esc(c.short || c.name)}</h1><p>${esc(c.name)} · 세부 포인트 진단 ${c.v2_ready ? "켜짐" : "꺼짐"}</p></div></div>
      <div class="bar"><div class="seg">${TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join("")}</div></div>
      <div id="dg">${inner}</div>`;
  }
  async function show(t) {
    tab = t; mem.set("diagTab", t);
    if (cleanup) { cleanup(); cleanup = null; }
    main.innerHTML = shell(`<div class="box"><span class="spin"></span>불러오는 중…</div>`);
    const box = main.querySelector("#dg");
    try {
      const fn = { vocab: vocabTab, check: checkTab, new: newTab, cover: coverTab, jobs: jobsTab }[t] || vocabTab;
      cleanup = await fn(box, cid);
    } catch (e) { if (!dead) box.innerHTML = `<div class="box empty">불러오지 못했어요: ${esc(e.message)}</div>`; }
  }
  const on = e => { const b = e.target.closest("[data-tab]"); if (b && main.contains(b) && !b.closest("#dg")) show(b.dataset.tab); };
  main.addEventListener("click", on);
  await show(tab);
  return () => { dead = true; if (cleanup) cleanup(); main.removeEventListener("click", on); };
}

// ───────── 어휘: 개념 › 세부 포인트 › 오개념. 처음엔 모두 수락 상태, 고칠 것만 고치고 [확인] ─────────
async function vocabTab(box, cid) {
  let V = await api("GET", "/insight/vocab/" + cid), open = null;
  const live = x => x.status !== "retired";
  function miscHTML(m) {
    return `<li class="dx-m${live(m) ? "" : " off"}"><div class="dx-mh"><span class="tag red">오개념</span><b>${esc(m.belief)}</b><small class="muted">${m.n_items || 0}문제${m.cw ? ` · 헷갈리는 것 ${esc(m.cw)}` : ""}</small>
      ${live(m) ? `<span class="dx-act"><button class="btn sm" data-edit="misc" data-code="${esc(m.code)}">고치기</button><button class="btn sm" data-drop="misc" data-code="${esc(m.code)}">빼기</button></span>` : `<span class="tag">뺌</span>`}</div>
      <p class="dx-sub"><span>바르게</span>${esc(m.truth || "")}${m.cue ? `<br><span>풀 때</span>${esc(m.cue)}` : ""}</p></li>`;
  }
  function facetHTML(f, kc) {
    return `<li class="dx-f${live(f) ? "" : " off"}"><div class="dx-fh"><b>${esc(f.name)}</b><small class="muted">${f.n_items || 0}문제 · ${esc(f.code)}</small>
      ${live(f) ? `<span class="dx-act"><button class="btn sm" data-edit="facet" data-code="${esc(f.code)}">고치기</button><button class="btn sm" data-merge="facet" data-code="${esc(f.code)}" data-kc="${esc(kc.code)}">합치기</button><button class="btn sm" data-drop="facet" data-code="${esc(f.code)}">빼기</button></span>` : `<span class="tag">뺌</span>`}</div>
      <p class="dx-st">${esc(f.statement || "")}</p>
      ${(f.examples || []).length ? `<p class="dx-ex">${f.examples.map(x => `<span><b>${esc(x.ext)}</b> ${esc(strip(x.q).slice(0, 60))}</span>`).join("")}</p>` : ""}
      ${(f.misc || []).length ? `<ul class="dx-ml">${f.misc.map(miscHTML).join("")}</ul>` : ""}</li>`;
  }
  function render() {
    const kcs = V.kcs || [], nf = kcs.reduce((s, k) => s + (k.facets || []).filter(live).length, 0), nm = kcs.reduce((s, k) => s + (k.facets || []).reduce((t, f) => t + (f.misc || []).filter(live).length, 0), 0);
    box.innerHTML = `<div class="box"><div class="hd"><h2>어휘 ${V.ver ? `<small>v${V.ver}</small>` : ""}</h2><small>개념 ${kcs.length} · 세부 포인트 ${nf} · 오개념 ${nm}</small></div>
      <p class="muted" style="margin:0 0 12px">AI가 만든 초안이에요. 이름이 어색하거나 겹치는 것만 고치고 [확인]을 눌러 주세요. 뺀 것은 지워지지 않고 '뺌'으로만 남아요.</p>
      <div class="bar"><button class="btn pri" data-confirm ${V.approved && !V.pending ? "disabled" : ""}>${V.approved && !V.pending ? "확인했어요" : "이대로 확인"}</button>${V.pending ? `<span class="tag hl">합친 초안이 확인을 기다려요</span>` : ""}</div>
      ${kcs.map(k => `<details class="dx-kc" data-kc="${esc(k.code)}" ${open === k.code ? "open" : ""}><summary><b>${esc(k.name)}</b><small class="muted">${(k.facets || []).filter(live).length}개 포인트</small>
        <button class="btn sm" data-edit="kc" data-code="${esc(k.code)}">이름 고치기</button></summary><ul class="dx-fl">${(k.facets || []).map(f => facetHTML(f, k)).join("")}</ul></details>`).join("")}
      ${(V.misc_unassigned || []).length ? `<details class="dx-kc"><summary><b>포인트가 없는 오개념</b><small class="muted">${V.misc_unassigned.length}개</small></summary><ul class="dx-ml">${V.misc_unassigned.map(miscHTML).join("")}</ul></details>` : ""}</div>`;
  }
  const find = (type, code) => {
    for (const m of V.misc_unassigned || []) if (type === "misc" && m.code === code) return m;
    for (const k of V.kcs || []) { if (type === "kc" && k.code === code) return k;
      for (const f of k.facets || []) { if (type === "facet" && f.code === code) return f; for (const m of f.misc || []) if (type === "misc" && m.code === code) return m; } }
    return null;
  };
  async function patch(op) { V = await api("PATCH", "/insight/vocab/" + cid, { ops: [op] }); render(); toast((V.warnings || []).length ? V.warnings.join(" · ") : "저장했어요"); }
  const on = async e => {
    const b = e.target.closest("button"); if (!b || !box.contains(b)) return;
    const d = b.dataset; const kc = b.closest("details.dx-kc"); if (kc) open = kc.dataset.kc;
    if (d.edit) {
      e.preventDefault();
      const x = find(d.edit, d.code); if (!x) return;
      const fields = d.edit === "misc" ? [["belief", "잘못된 생각", 80], ["truth", "바르게", 120], ["cue", "풀 때 (선택)", 60]] : d.edit === "facet" ? [["name", "이름 (20자 이내)", 20], ["statement", "설명 (90자 이내)", 90]] : [["name", "개념 이름", 30]];
      const html = fields.map(([k, l, max]) => `<label class="f"><span>${l}</span><textarea data-k="${k}" rows="2" maxlength="${max}">${esc(x[k] || "")}</textarea></label>`).join("");
      const r = await ask({ title: "고치기", body: html, ok: "저장" }); if (!r) return;
      const set = {}; document.querySelectorAll(".dialog [data-k]").forEach(t => { if (t.value.trim() !== (x[t.dataset.k] || "")) set[t.dataset.k] = t.value.trim(); });
      if (Object.keys(set).length) await patch({ op: "edit", type: d.edit, code: d.code, set }).catch(err => toast(err.message, "bad"));
    } else if (d.drop) {
      if (!(await ask({ title: "뺄까요?", body: "지워지지 않고 '뺌'으로 표시돼요. 이 포인트로 태깅된 문제는 다음 태깅 때 다시 분류돼요.", ok: "빼기", danger: true }))) return;
      await patch({ op: "drop", type: d.drop, code: d.code }).catch(err => toast(err.message, "bad"));
    } else if (d.merge) {
      const k = (V.kcs || []).find(x => x.code === d.kc), others = ((k && k.facets) || []).filter(f => live(f) && f.code !== d.code);
      if (!others.length) { toast("같은 개념 안에 합칠 포인트가 없어요"); return; }
      const r = await ask({ title: "어느 포인트로 합칠까요?", body: `<select class="dx-into">${others.map(f => `<option value="${esc(f.code)}">${esc(f.name)}</option>`).join("")}</select>`, ok: "합치기" }); if (!r) return;
      const into = document.querySelector(".dialog .dx-into")?.value; if (into) await patch({ op: "merge", type: "facet", from: d.code, into }).catch(err => toast(err.message, "bad"));
    } else if (d.confirm !== undefined) {
      const r = await api("POST", "/insight/vocab/" + cid + "/confirm"); V = { ...V, ...r }; render(); toast("어휘를 확인했어요");
    }
  };
  render(); box.addEventListener("click", on);
  return () => box.removeEventListener("click", on);
}

// ───────── 태그 확인: AI가 덜 확신한 문제만, 영향 큰 순서로 20장까지 ─────────
async function checkTab(box, cid) {
  let o = await api("GET", "/insight/tagcheck/" + cid), i = 0;
  function card(c) {
    const b = { q: c.q, opts: c.opts, ans: c.ans, ox: c.ans === true || c.ans === "O" };
    const alts = [c.facet, ...(c.alt || [])].filter(Boolean);
    return `<div class="dx-cc"><div class="dx-ccp">${previewHTML({ kind: c.kind, body: b, label: `<span class="tag">${esc(c.ext)}</span>` })}</div>
      <div class="dx-ccq"><p class="muted" style="margin:0">AI 분류 · ${esc(c.reason || "")}${c.answered_by ? ` · ${n(c.answered_by)}명이 풀었어요` : ""}</p>
        <label class="f"><span>세부 포인트</span><select data-k="facet">${alts.map(f => `<option value="${esc(f.code)}" ${f.code === c.facet.code ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></label>
        <label class="f"><span>깊이 <small>${esc(c.depth_why || "")}</small></span><div class="seg">${[1, 2, 3, 4].map(d => `<button data-depth="${d}" aria-pressed="${d === c.depth}">${d} ${DEPTH[d]}</button>`).join("")}</div></label>
        <div class="bar"><button class="btn okb" data-ok>맞아요</button><button class="btn pri" data-fix>고쳐서 저장</button><button class="btn" data-skip>건너뛰기</button></div></div></div>`;
  }
  function render() {
    const C = o.cards || [];
    if (i >= C.length) { box.innerHTML = `<div class="box empty">${C.length ? "이번 묶음을 다 봤어요." : "확인할 태그가 없어요."}${o.left ? ` 남은 ${n(o.left)}장 · <button class="btn sm" data-more>다음 묶음</button>` : ""}</div>`; return; }
    box.innerHTML = `<div class="box"><div class="hd"><h2>태그 확인</h2><small>${i + 1} / ${C.length}${o.left ? ` · 뒤에 ${n(o.left)}장 더` : ""}</small></div>${card(C[i])}</div>`;
    typeset(box);
  }
  const on = async e => {
    const b = e.target.closest("button"); if (!b || !box.contains(b)) return;
    const c = (o.cards || [])[i];
    if (b.dataset.depth) { b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); return; }
    if (b.dataset.more !== undefined) { o = await api("GET", "/insight/tagcheck/" + cid); i = 0; render(); return; }
    if (!c) return;
    try {
      if (b.dataset.ok !== undefined) await api("POST", "/insight/tagcheck/" + c.pid, { action: "ok" });
      else if (b.dataset.fix !== undefined) {
        const facet = box.querySelector('[data-k="facet"]').value, dp = box.querySelector("[data-depth][aria-pressed='true']");
        await api("POST", "/insight/tagcheck/" + c.pid, { action: "fix", facet, depth: dp ? +dp.dataset.depth : c.depth });
      } else if (b.dataset.skip === undefined) return;
      i++; render();
    } catch (err) { toast(err.message, "bad"); }
  };
  render(); box.addEventListener("click", on);
  return () => box.removeEventListener("click", on);
}

// ───────── 새 문제 승인: 숨긴 변형 문제를 세부 포인트별로 묶어 한 번에 ─────────
async function newTab(box, cid) {
  let o = await api("GET", "/insight/pending/" + cid);
  const sel = new Set();
  function item(x) {
    const dx = x.dx || {}, s = x.solver;
    const solv = !s ? `<span class="tag">풀이 검사 없음</span>` : s.ok ? `<span class="tag ok">검사 풀이 맞힘</span>` : `<span class="tag red">검사 풀이 틀림${s.picked != null ? ` · ${esc(typeof s.picked === "number" ? LETTERS[s.picked] : s.picked)}` : ""}</span>`;
    return `<li class="dx-ni"><label class="dx-nck"><input type="checkbox" data-pid="${x.pid}" ${sel.has(x.pid) ? "checked" : ""}> <b>${esc(x.ext || "#" + x.pid)}</b></label>
      <div class="dx-nm"><span class="tag">${dx.depth ? dx.depth + " " + DEPTH[dx.depth] : "깊이 ?"}</span>${dx.role ? `<span class="tag">${esc(dx.role)}</span>` : ""}${dx.delta ? `<span class="tag hl">바뀐 점: ${esc(dx.delta)}</span>` : ""}${solv}</div>
      ${s && s.note ? `<p class="muted dx-note">${esc(s.note)}</p>` : ""}
      <div class="dx-two">${x.base ? `<div><p class="dx-cap">기본형 ${esc(x.base.ext || "")}</p>${previewHTML({ kind: x.base.kind, body: x.base.body })}</div>` : ""}<div><p class="dx-cap">새 문제</p>${previewHTML({ kind: x.kind, body: x.body })}</div></div></li>`;
  }
  function render() {
    const G = o.groups || [], all = G.flatMap(g => g.items || []);
    box.innerHTML = !all.length ? `<div class="box empty">승인을 기다리는 새 문제가 없어요.</div>`
      : `<div class="box"><div class="hd"><h2>새 문제 승인</h2><small>${all.length}문제${o.left ? ` · 뒤에 ${n(o.left)}문제 더` : ""}</small></div>
        <p class="muted" style="margin:0 0 12px">게시하기 전까지 학습자에게 보이지 않아요. 검사 풀이가 틀린 문제는 문제나 정답이 애매할 수 있어요.</p>
        <div class="bar dx-sticky"><button class="btn sm" data-all>${sel.size === all.length ? "모두 해제" : "검사 통과만 선택"}</button><span class="muted">${sel.size}개 선택</span>
          <button class="btn pri" data-act="publish" ${sel.size ? "" : "disabled"}>게시</button><button class="btn badb" data-act="reject" ${sel.size ? "" : "disabled"}>버리기</button></div>
        ${G.map(g => `<section class="dx-g"><h3>${esc(g.facet.name)}</h3><ul class="dx-nl">${(g.items || []).map(item).join("")}</ul></section>`).join("")}</div>`;
    typeset(box);
  }
  const on = async e => {
    const t = e.target;
    if (t.matches && t.matches("input[data-pid]")) { const id = +t.dataset.pid; t.checked ? sel.add(id) : sel.delete(id); render(); return; }
    const b = t.closest("button"); if (!b || !box.contains(b)) return;
    const all = (o.groups || []).flatMap(g => g.items || []);
    if (b.dataset.all !== undefined) { if (sel.size === all.length) sel.clear(); else all.filter(x => x.solver && x.solver.ok).forEach(x => sel.add(x.pid)); render(); return; }
    if (b.dataset.act) {
      const pub = b.dataset.act === "publish";
      if (!(await ask({ title: pub ? "게시할까요?" : "버릴까요?", body: pub ? `${sel.size}문제가 학습자 화면에 바로 보여요.` : `${sel.size}문제를 숨긴 채로 버려요.`, ok: pub ? "게시하기" : "버리기", danger: !pub }))) return;
      try { const r = await api("POST", "/insight/pending", { pids: [...sel], action: b.dataset.act }); toast(`${r.done}문제 ${pub ? "게시" : "버림"}`); sel.clear(); o = await api("GET", "/insight/pending/" + cid); render(); }
      catch (err) { toast(err.message, "bad"); }
    }
  };
  render(); box.addEventListener("click", on); box.addEventListener("change", on);
  return () => { box.removeEventListener("click", on); box.removeEventListener("change", on); };
}

// ───────── 커버리지: 세부 포인트 × 깊이 (모자란 곳 = 변형 문제가 필요한 곳) ─────────
async function coverTab(box, cid) {
  const o = await api("GET", "/insight/coverage/" + cid);
  const raw = o.facets || o.coverage || {};
  const rows = Array.isArray(raw) ? raw : Object.entries(raw).filter(([k, v]) => v && typeof v === "object" && "n" in v).map(([code, v]) => ({ code, ...v }));
  const need = o.need || [];
  const gap = r => (r.gaps || []).length;
  box.innerHTML = `<div class="box"><div class="hd"><h2>커버리지</h2><small>세부 포인트 ${rows.length} · 모자란 곳 ${rows.filter(gap).length}</small></div>
    <p class="muted" style="margin:0 0 12px">포인트마다 4문제(★·기출 6문제), 정의·적용 1–2 · 구별·조건 1–2 · 오개념을 고를 수 있는 문제 3개가 목표예요.</p>
    <table><thead><tr><th>세부 포인트</th><th>문제</th><th>정의·적용</th><th>구별·조건</th><th>바뀐 종류</th><th>모자란 것</th></tr></thead><tbody>
    ${rows.sort((a, b) => gap(b) - gap(a)).map(r => `<tr><td><b>${esc(r.name || r.code)}</b>${r.star ? ' <span class="tag hl">★</span>' : ""}${r.exam ? ' <span class="tag">기출</span>' : ""}</td>
      <td class="${r.n < (r.target || 4) ? "bad" : ""}">${r.n ?? 0}${r.target ? ` / ${r.target}` : ""}</td><td>${r.d12 ?? 0}</td><td class="${!r.d34 ? "bad" : ""}">${r.d34 ?? 0}</td>
      <td>${(r.deltaTypes || []).map(x => `<span class="tag">${esc(x)}</span>`).join(" ") || '<span class="muted">–</span>'}</td>
      <td>${(r.gaps || []).map(g => `<span class="tag red">${esc(g.need || "")}${g.depth ? " " + esc(g.depth) : ""}${g.n ? " ×" + g.n : ""}</span>`).join(" ") || '<span class="tag ok">충분</span>'}</td></tr>`).join("")}</tbody></table></div>
    ${need.length ? `<div class="box"><div class="hd"><h2>리포트가 찾은 빈 곳</h2><small>학습자 확인 문제가 없던 곳</small></div><table><thead><tr><th>세부 포인트</th><th>깊이</th><th>바뀐 종류</th><th>오개념</th><th>학습자</th></tr></thead><tbody>
      ${need.map(x => `<tr><td>${esc(x.facet)}</td><td>${esc(DEPTH[x.depth] || x.depth || "")}</td><td>${esc(x.delta_type || "")}</td><td>${esc(x.m || "")}</td><td>${n(x.n_learners)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

// ───────── 태깅 작업: 계획 → 시작 · 멈춤 (실제 Gemini 키가 없으면 시작이 막혀요) ─────────
async function jobsTab(box, cid) {
  let o = await api("GET", "/insight/jobs/" + cid), timer = 0;
  function render() {
    const S = o.stages || [];
    box.innerHTML = `<div class="box"><div class="hd"><h2>태깅 작업</h2><small>${o.running ? "진행 중" : "멈춤"}${o.paused_until ? ` · ${esc(ago(o.paused_until))}까지 쉼` : ""}</small></div>
      <p class="muted" style="margin:0 0 12px">하루 AI 한도의 60%까지만 쓰고, 학습자 서술형 채점이 항상 먼저예요.</p>
      <div class="bar"><button class="btn" data-act="plan">계획 세우기</button><button class="btn pri" data-act="start" ${o.running ? "disabled" : ""}>시작</button><button class="btn" data-act="pause" ${o.running ? "" : "disabled"}>멈춤</button>
        <span style="flex:1"></span>${(o.gate || {}).can_enable ? `<button class="btn okb" data-act="enable">이 과목 v2 켜기</button>` : ""}${(o.gate || {}).hold ? `<button class="btn okb" data-act="unhold">이 과목 v2 다시 켜기</button>` : `<button class="btn badb" data-act="hold">이 과목 v2 멈추기</button>`}</div>
      ${o.plan && o.plan.waiting === "vocab_confirm" ? `<p class="tag hl">어휘를 확인하면 태깅이 이어져요</p>` : ""}
      ${S.length ? `<table><thead><tr><th>단계</th><th>대기</th><th>진행</th><th>끝남</th><th>실패</th></tr></thead><tbody>${S.map(s => `<tr><td>${esc(STAGE[s.stage] || s.stage)}</td><td>${n(s.queued)}</td><td>${n(s.running)}</td><td>${n(s.done)}</td><td class="${s.failed ? "bad" : ""}">${n(s.failed)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">아직 계획이 없어요.</p>`}</div>
      ${(o.recent_errors || []).length ? `<div class="box"><div class="hd"><h2>최근 오류</h2></div><ul class="dx-err">${o.recent_errors.map(r => `<li><span class="tag red">${esc(STAGE[r.stage] || r.stage)}</span> ${esc(r.ref || "")} · ${esc(r.error)} <small class="muted">${esc(ago(r.at))}</small></li>`).join("")}</ul></div>` : ""}`;
  }
  const on = async e => {
    const b = e.target.closest("button[data-act]"); if (!b || !box.contains(b)) return;
    if (b.dataset.act === "start" && !(await ask({ title: "태깅을 시작할까요?", body: "실제 AI 사용량을 쓰고, 분류 결과가 DB에 저장돼요.", ok: "시작" }))) return;
    if (b.dataset.act === "enable" && !(await ask({ title: "이 과목 v2를 켤까요?", body: "다음 리포트부터 학습자에게 세부 포인트 진단이 보여요. 언제든 '멈추기'로 되돌릴 수 있어요.", ok: "켜기" }))) return;
    if (b.dataset.act === "hold" && !(await ask({ title: "이 과목 v2를 멈출까요?", body: "학습자에게는 다시 v1 리포트가 보여요. 태그와 기록은 그대로 남아요.", ok: "멈추기", danger: true }))) return;
    try { o = await api("POST", "/insight/jobs/" + cid, { action: b.dataset.act }); render(); }
    catch (err) { toast(err.status === 409 ? err.message : err.message, "bad"); if (err.status === 409) { try { o = await api("GET", "/insight/jobs/" + cid); render(); } catch { } } }   // 409 = 조건 미달·멈춤·키 없음: 이유만 보여 주고 다시 시도하지 않는다
  };
  render(); box.addEventListener("click", on);
  timer = setInterval(async () => { if (!o.running) return; try { o = await api("GET", "/insight/jobs/" + cid); render(); } catch { } }, 10000);
  return () => { clearInterval(timer); box.removeEventListener("click", on); };
}
