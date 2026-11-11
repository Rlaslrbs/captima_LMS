// 문제 품질 표 + 문제 편집기 (고치면 새 버전으로 저장)
import { api, esc, toast, ask, ago, KIND, LETTERS, pct, sec, n, strip, accCell, previewHTML, typeset, mem, MIN_N, LOW } from "./lib.js";

// ───────── 문제 품질 ─────────
const COLS = [
  ["no", "번호"], ["chapter", "챕터"], ["kind", "유형"], ["q", "문제"], ["accuracy", "정답률", "n"], ["attempts", "시도", "n"],
  ["median_ms", "풀이 시간", "n"], ["idk_rate", "모르겠어요", "n"], ["top_wrong", "가장 많은 오답"], ["open_reports", "제보", "n"], ["status", "상태"],
];
export async function mountQuality(main, params) {
  main.innerHTML = `<div class="ph"><div><h1>문제 품질</h1><p>첫 시도 정답률, 풀이 시간(중앙값), 모르겠어요 비율, 가장 많이 고른 오답을 문제마다 보여 줘요. 행을 누르면 편집기가 열려요.</p></div></div><div class="box"><span class="spin"></span>불러오는 중…</div>`;
  const { courses } = await api("GET", "/courses");
  const st = Object.assign({ course: courses[0]?.id, chapter: "", kind: "", status: "", min: 0, q: "", issues: false, sort: "accuracy", dir: 1, limit: 200 }, mem.get("quality", {}));
  if (params.get("course")) st.course = +params.get("course");
  if (!courses.some(c => c.id === st.course)) st.course = courses[0]?.id;
  let rows = [];

  async function load() {
    rows = (await api("GET", "/stats/problems?course=" + st.course)).problems;
    if (st.chapter && !rows.some(r => String(r.chapter_id) === st.chapter)) st.chapter = "";
    render();
  }
  const issue = r => (r.accuracy !== null && r.accuracy < LOW && r.attempts >= MIN_N) || r.open_reports > 0;
  function filtered() {
    const q = st.q.trim().toLowerCase();
    return rows.filter(r => (!st.chapter || String(r.chapter_id) === st.chapter) && (!st.kind || r.kind === st.kind) && (!st.status || r.status === st.status)
      && r.attempts >= st.min && (!st.issues || issue(r)) && (!q || (r.no + " " + r.q + " " + r.ext_id).toLowerCase().includes(q)));
  }
  function sorted(list) {
    const k = st.sort, d = st.dir;
    const val = r => k === "top_wrong" ? (r.top_wrong ? r.top_wrong.share : null) : r[k];
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;   // 값 없는 것은 항상 뒤로
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ko", { numeric: true }) : x - y) * d;
    });
  }
  function render() {
    const list = sorted(filtered());
    const solved = rows.filter(r => r.attempts > 0);
    const tot = solved.reduce((s, r) => s + r.attempts, 0), ok = solved.reduce((s, r) => s + r.attempts * r.accuracy, 0);
    const chs = [...new Map(rows.map(r => [r.chapter_id, r.chapter])).entries()];
    const kinds = ["ox", "mc", "short", "essay"].filter(k => rows.some(r => r.kind === k));
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, l, c]) => `<button data-set="${key}" data-v="${esc(v)}" aria-pressed="${String(st[key]) === String(v)}">${esc(l)}${c !== undefined ? `<span class="c">${c}</span>` : ""}</button>`).join("")}</div>`;
    main.innerHTML = `<div class="ph"><div><h1>문제 품질</h1><p>첫 시도 정답률, 풀이 시간(중앙값), 모르겠어요 비율, 가장 많이 고른 오답을 문제마다 보여 줘요. 행을 누르면 편집기가 열려요.</p></div></div>
      <div class="bar">${seg("course", courses.map(c => [c.id, `${c.semester} ${c.short}`]))}</div>
      <div class="kpis">
        <div class="kpi"><span>문제</span><b>${n(rows.length)}</b><small>숨김 ${rows.filter(r => r.status === "hidden").length}</small></div>
        <div class="kpi"><span>한 번 이상 풀린 문제</span><b>${n(solved.length)}</b><small>${rows.length ? Math.round(solved.length / rows.length * 100) : 0}%</small></div>
        <div class="kpi"><span>첫 시도 정답률 (전체)</span><b>${tot ? pct(ok / tot) : "–"}</b><small>첫 시도 ${n(tot)}회</small></div>
        <div class="kpi ${rows.some(issue) ? "bad" : ""}"><span>살펴볼 문제</span><b>${rows.filter(issue).length}</b><small>정답률 ${LOW * 100}% 미만(${MIN_N}회 이상) 또는 제보</small></div>
      </div>
      <div class="box" style="margin-top:16px">
        <div class="bar">
          <select data-set="chapter" aria-label="챕터"><option value="">모든 챕터</option>${chs.map(([id, t]) => `<option value="${id}" ${String(id) === st.chapter ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
          ${seg("kind", [["", "전체 유형"], ...kinds.map(k => [k, KIND[k], rows.filter(r => r.kind === k).length])])}
          ${seg("status", [["", "전체"], ["published", "게시"], ["hidden", "숨김"]])}
          <label class="muted">시도 <input type="number" min="0" data-set="min" value="${st.min}" style="width:64px"> 회 이상</label>
          <button class="btn sm ${st.issues ? "badb" : ""}" data-toggle="issues" aria-pressed="${st.issues}">살펴볼 문제만</button>
          <input type="search" data-set="q" value="${esc(st.q)}" placeholder="번호·문제 검색" style="flex:1;min-width:160px">
        </div>
        <div class="hd"><small>${n(list.length)}문제 · 정답률이 낮은 순으로 보려면 정답률 머리를 누르세요</small></div>
        <div class="tw"><table><thead><tr>${COLS.map(([k, l, cls]) => `<th class="sort ${cls || ""}" data-sort="${k}" ${st.sort === k ? `aria-sort="${st.dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`).join("")}</tr></thead>
        <tbody>${list.slice(0, st.limit).map(r => `<tr class="click" data-pid="${r.id}">
          <td class="no">${esc(r.no)}</td><td><span class="tag">${esc(String(r.chapter).split(" · ")[0].slice(0, 14))}</span></td><td>${KIND[r.kind]}${r.star ? " <span class='tag hl'>★</span>" : ""}</td>
          <td><span class="q" title="${esc(r.q)}">${esc(r.q)}</span></td>
          <td class="n">${accCell(r.accuracy, r.attempts)}</td><td class="n">${r.attempts || "–"}</td><td class="n">${sec(r.median_ms)}</td>
          <td class="n">${r.idk_rate === null ? "–" : `<span class="${r.idk_rate >= 0.3 && r.attempts >= MIN_N ? "bad" : ""}">${pct(r.idk_rate)}</span>`}</td>
          <td>${r.top_wrong ? `<span class="tag ${r.top_wrong.share >= 0.6 && r.top_wrong.n >= MIN_N ? "red" : ""}" title="오답 가운데 ${pct(r.top_wrong.share)}">${esc(String(r.top_wrong.answer).slice(0, 18))} · ${pct(r.top_wrong.share)}</span>` : "–"}</td>
          <td class="n">${r.open_reports ? `<span class="bad">${r.open_reports}</span>` : "–"}</td>
          <td>${r.status === "hidden" ? '<span class="tag red">숨김</span>' : '<span class="muted">게시</span>'}</td></tr>`).join("") || `<tr><td colspan="${COLS.length}" class="empty">조건에 맞는 문제가 없어요.</td></tr>`}</tbody></table></div>
        ${list.length > st.limit ? `<div class="more"><button class="btn" data-more>${n(list.length - st.limit)}문제 더 보기</button></div>` : ""}
      </div>`;
    const qi = main.querySelector('input[data-set="q"]'); if (focusQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); focusQ = false; }
  }
  let focusQ = false, qT = null;
  const save = () => mem.set("quality", { ...st, limit: 200 });
  function onClick(e) {
    const t = e.target.closest("[data-set],[data-sort],[data-pid],[data-more],[data-toggle]"); if (!t || t.tagName === "SELECT" || t.tagName === "INPUT") return;
    if (t.dataset.sort) { const k = t.dataset.sort; if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = ["attempts", "open_reports", "median_ms", "idk_rate", "top_wrong"].includes(k) ? -1 : 1; } save(); render(); return; }
    if (t.dataset.pid) { location.hash = "#/problem/" + t.dataset.pid; return; }
    if (t.dataset.more !== undefined) { st.limit += 300; render(); return; }
    if (t.dataset.toggle) { st.issues = !st.issues; save(); render(); return; }
    const k = t.dataset.set, v = t.dataset.v;
    if (k === "course") { st.course = +v; st.chapter = ""; save(); history.replaceState(null, "", "#/quality?course=" + v); load(); return; }
    st[k] = v; save(); render();
  }
  function onInput(e) {
    const t = e.target; if (!t.dataset || !t.dataset.set) return;
    if (t.dataset.set === "q") { st.q = t.value; clearTimeout(qT); qT = setTimeout(() => { focusQ = true; save(); render(); }, 250); return; }
    if (t.dataset.set === "min") { st.min = Math.max(0, +t.value || 0); save(); render(); return; }
    if (t.dataset.set === "chapter") { st.chapter = t.value; save(); render(); }
  }
  main.addEventListener("click", onClick); main.addEventListener("input", onInput); main.addEventListener("change", onInput);
  await load();
  return () => { main.removeEventListener("click", onClick); main.removeEventListener("input", onInput); main.removeEventListener("change", onInput); };
}

// ───────── 문제 편집기 ─────────
const ONLY = { ox: ["ox", "fix"], mc: ["stem", "opts", "opts_sub", "ans"], short: ["accept", "strict", "num", "tol", "ph"], essay: ["pts"] };
export async function mountEditor(main, id, params) {
  main.innerHTML = `<div class="box"><span class="spin"></span>불러오는 중…</div>`;
  let P = await api("GET", "/problems/" + id);
  let kind, star, body, dirty = false;
  const fromVersion = v => { kind = v.kind; star = !!v.star; body = JSON.parse(JSON.stringify(v.body)); };
  fromVersion(P.versions[0]);
  const fromReport = params.get("report");

  const ta = (k, label, rows = 3, hint = "") => `<label class="f"><span>${label}${hint ? ` <small>${hint}</small>` : ""}</span><textarea data-k="${k}" rows="${rows}">${esc(body[k] ?? "")}</textarea></label>`;
  const inp = (k, label, hint = "", type = "text") => `<label class="f"><span>${label}${hint ? ` <small>${hint}</small>` : ""}</span><input type="${type}" data-k="${k}" value="${esc(body[k] ?? "")}" ${type === "number" ? 'step="any"' : ""}></label>`;
  function kindFields() {
    if (kind === "ox") return `<div class="f"><span>정답</span><div class="radios"><label><input type="radio" name="ox" value="1" ${body.ox ? "checked" : ""}> O (참)</label><label><input type="radio" name="ox" value="0" ${body.ox === false ? "checked" : ""}> X (거짓)</label></div></div>${inp("fix", "고친 문장", "X일 때 바르게 고친 내용")}`;
    if (kind === "mc") {
      const opts = body.opts || (body.opts = ["", ""]); const sub = Array.isArray(body.opts_sub);
      return ta("stem", "질문 줄", 1, "보기 위에 따로 묻는 문장 (선택)") + `<div class="f"><span>보기 <small>왼쪽 동그라미 = 정답</small></span>${opts.map((o, i) => `<div class="opt-row">
          <label class="k ${i === body.ans ? "right" : ""}"><input type="radio" name="ans" value="${i}" ${i === body.ans ? "checked" : ""} aria-label="${LETTERS[i]}를 정답으로"> ${LETTERS[i]}</label>
          <div><textarea data-opt="${i}" rows="1">${esc(o)}</textarea>${sub ? `<input type="text" data-optsub="${i}" value="${esc(body.opts_sub[i] ?? "")}" placeholder="한국어 번역 (선택)" style="width:100%;margin-top:4px">` : ""}</div>
          <button class="ib" data-rmopt="${i}" ${opts.length <= 2 ? "disabled" : ""} aria-label="보기 지우기">✕</button></div>`).join("")}
        <div><button class="btn sm" data-addopt ${opts.length >= 8 ? "disabled" : ""}>＋ 보기 추가</button> <button class="btn sm" data-togsub>${sub ? "번역 칸 없애기" : "번역 칸 추가"}</button></div></div>` + ta("a", "풀이 결과", 2, "채점 뒤에 보여 줄 짧은 답 (선택)");
    }
    if (kind === "short") return ta("a", "정답 (보여 줄 답)", 2) + `<label class="f"><span>허용 답 <small>쉼표로 구분. 띄어쓰기·대소문자·괄호 안은 무시하고 비교해요</small></span><input type="text" data-list="accept" value="${esc((body.accept || []).join(", "))}"></label>
      <div class="frow">${inp("num", "숫자 정답", "숫자 문제만", "number")}${inp("tol", "허용 오차", "기본 0.01", "number")}${inp("ph", "입력칸 안내", "예: 숫자만 입력")}</div>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-bool="strict" ${body.strict ? "checked" : ""}> <span>허용 답과 다르면 바로 오답 처리 <small>(끄면 정답을 보여 주고 직접 채점)</small></span></label>`;
    return ta("a", "모범 답안", 6) + `<label class="f"><span>채점 포인트 <small>한 줄에 하나</small></span><textarea data-list="pts" data-sep="line" rows="4">${esc((body.pts || []).join("\n"))}</textarea></label>`;
  }
  const fileKeys = Object.keys(P.files || {});
  function formHTML() {
    return `<div class="frow"><div class="f"><span>유형</span><div class="radios">${Object.entries(KIND).map(([k, l]) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
        <div class="f" style="flex:0 0 auto"><span>중요</span><label class="radios"><label><input type="checkbox" id="star" ${star ? "checked" : ""}> ★ 중요 문제</label></label></div></div>
      ${inp("no", "표시 번호", "화면에 보이는 번호")}
      ${ta("q", "문제", 3, "HTML 가능")}${ta("q_sub", "번역·보조 문장", 2, "작은 글씨로 아래에 나와요 (선택)")}
      ${kindFields()}
      ${ta("s", "해설", 6, "HTML 가능")}
      <label class="f"><span>출처 <small>한 줄에 하나: 파일키 | 위치${fileKeys.length ? ` · 파일키: ${esc(fileKeys.join(", "))}` : ""}</small></span><textarea data-src rows="2">${esc((body.src || []).map(s => s.join(" | ")).join("\n"))}</textarea></label>
      <details class="adv"><summary>고급: 내용 JSON 직접 고치기</summary><textarea class="code" id="rawJson" rows="12" spellcheck="false">${esc(JSON.stringify(body, null, 2))}</textarea>
        <div style="margin-top:6px"><button class="btn sm" data-applyjson>JSON 적용</button></div></details>`;
  }
  function verRows() {
    const vs = new Map((P.version_stats || []).map(v => [v.version, v]));
    return P.versions.map(v => { const s = vs.get(v.version) || {}; return `<tr>
      <td class="no">v${v.version}${v.version === P.current_version ? ' <span class="tag ok">지금</span>' : ""}</td><td class="muted">${ago(v.created_at)}</td><td>${esc(v.note || "")}</td>
      <td class="n">${s.attempts || "–"}</td><td class="n">${accCell(s.accuracy ?? null, s.attempts || 0)}</td><td class="n">${sec(s.median_ms ?? null)}</td>
      <td>${v.version !== P.current_version ? `<button class="btn sm" data-loadv="${v.version}">이 내용 불러오기</button>` : ""}</td></tr>`; }).join("");
  }
  const CAT = { answer: "정답 오류", explanation: "해설 오류", typo: "오타·표현", other: "기타" };
  const RST = { open: ["접수", "red"], fixed: ["수정함", "ok"], rejected: ["반려", ""] };
  function render() {
    const s = P.stats || {};
    main.innerHTML = `<div class="crumb"><a href="#/quality?course=${P.course_id}">‹ 문제 품질</a>${fromReport ? ` · <a href="#/reports?id=${esc(fromReport)}">제보로 돌아가기</a>` : ""}</div>
      <div class="ph"><div><h1>${esc(P.course)} · ${esc(body.no || P.ext_id)}</h1><p>${esc(P.chapter)} · 문제 번호 ${esc(P.ext_id)} · 지금 v${P.current_version}</p></div>
        <label class="radios" style="gap:10px"><span class="muted">${P.status === "hidden" ? "사용자에게 숨김" : "사용자에게 보임"}</span><span class="sw"><input type="checkbox" id="pub" ${P.status !== "hidden" ? "checked" : ""}><i></i></span></label></div>
      <div class="kpis" style="margin-bottom:16px">
        <div class="kpi ${s.accuracy !== null && s.accuracy < LOW && s.attempts >= MIN_N ? "bad" : ""}"><span>첫 시도 정답률 (지금 버전)</span><b>${pct(s.accuracy ?? null)}</b><small>첫 시도 ${s.attempts || 0}회</small></div>
        <div class="kpi"><span>풀이 시간 (중앙값)</span><b>${sec(s.median_ms ?? null)}</b></div>
        <div class="kpi"><span>모르겠어요</span><b>${pct(s.idk_rate ?? null)}</b></div>
        <div class="kpi ${s.top_wrong && s.top_wrong.share >= 0.6 ? "bad" : ""}"><span>가장 많은 오답</span><b style="font-size:18px">${s.top_wrong ? esc(String(s.top_wrong.answer).slice(0, 24)) : "–"}</b><small>${s.top_wrong ? `오답 중 ${pct(s.top_wrong.share)} (${s.top_wrong.n}회)` : ""}</small></div>
      </div>
      <div class="ed">
        <div class="box"><div class="hd"><h2>내용 고치기</h2><small>저장하면 v${P.current_version + 1}이 돼요. 이전 기록은 버전별로 따로 집계돼요</small></div>
          <div id="form">${formHTML()}</div>
          <div class="savebar"><input type="text" id="note" placeholder="바꾼 이유 (예: 정답 B→C, 제보 #12 반영)" maxlength="200"><button class="btn pri" id="saveBtn" ${dirty ? "" : "disabled"}>새 버전으로 저장</button></div>
        </div>
        <div>
          <div class="box"><div class="hd"><h2>미리보기</h2><small>사용자에게 보이는 모습 (정답 포함)</small></div><div id="pv"></div></div>
          <div class="box"><h2>버전별 성적</h2><div class="tw"><table><thead><tr><th>버전</th><th>저장</th><th>바꾼 이유</th><th class="n">시도</th><th class="n">정답률</th><th class="n">시간</th><th></th></tr></thead><tbody>${verRows()}</tbody></table></div></div>
          <div class="box"><h2>이 문제의 제보 <small class="muted">${P.reports.length}건</small></h2>${P.reports.length ? `<ul class="rlist">${P.reports.map(r => `<li data-rep="${r.id}"><div class="rl1"><span class="tag ${RST[r.status][1]}">${RST[r.status][0]}</span><b>${CAT[r.category] || r.category}</b><span class="t">v${r.version} · ${ago(r.created_at)}</span></div>${r.message ? `<div class="rl2">${esc(r.message)}</div>` : ""}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">제보가 없어요.</p>`}</div>
        </div>
      </div>`;
    preview();
  }
  let pvT = null;
  function preview() {
    const el = main.querySelector("#pv"); if (!el) return;
    el.innerHTML = previewHTML({ kind, star, body, files: P.files });
    clearTimeout(pvT); pvT = setTimeout(() => typeset(el, P.math || body.math), 250);
  }
  function rerenderForm() { main.querySelector("#form").innerHTML = formHTML(); preview(); }
  function touch() { dirty = true; const b = main.querySelector("#saveBtn"); if (b) b.disabled = false; const raw = main.querySelector("#rawJson"); if (raw && document.activeElement !== raw) raw.value = JSON.stringify(body, null, 2); preview(); }
  const setOrDel = (k, v) => { if (v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length)) delete body[k]; else body[k] = v; };

  function onInput(e) {
    const t = e.target;
    if (t.dataset.k) { const k = t.dataset.k; setOrDel(k, t.type === "number" ? (t.value === "" ? "" : +t.value) : t.value); touch(); return; }
    if (t.dataset.list) { const parts = t.dataset.sep === "line" ? t.value.split("\n") : t.value.split(","); setOrDel(t.dataset.list, parts.map(x => x.trim()).filter(Boolean)); touch(); return; }
    if (t.dataset.opt !== undefined) { body.opts[+t.dataset.opt] = t.value; touch(); return; }
    if (t.dataset.optsub !== undefined) { body.opts_sub[+t.dataset.optsub] = t.value; touch(); return; }
    if (t.dataset.src !== undefined) { setOrDel("src", t.value.split("\n").map(l => l.split("|").map(x => x.trim())).filter(x => x[0]).map(x => x[1] ? [x[0], x[1]] : [x[0]])); touch(); return; }
    if (t.dataset.bool) { body[t.dataset.bool] = t.checked; if (!t.checked) delete body[t.dataset.bool]; touch(); return; }
    if (t.name === "ox") { body.ox = t.value === "1"; touch(); return; }
    if (t.name === "ans") { body.ans = +t.value; touch(); rerenderForm(); return; }
    if (t.name === "kind") { kind = t.value; if (kind === "ox" && typeof body.ox !== "boolean") body.ox = true; if (kind === "mc" && !Number.isInteger(body.ans)) body.ans = 0; touch(); rerenderForm(); return; }
    if (t.id === "star") { star = t.checked; touch(); return; }
  }
  async function onClick(e) {
    const b = e.target.closest("button,[data-rep]"); if (!b) return;
    if (b.dataset.rep) { location.hash = "#/reports?id=" + b.dataset.rep; return; }
    if (b.dataset.addopt !== undefined) { body.opts.push(""); if (body.opts_sub) body.opts_sub.push(""); touch(); rerenderForm(); return; }
    if (b.dataset.rmopt !== undefined) {
      const i = +b.dataset.rmopt; body.opts.splice(i, 1); if (body.opts_sub) body.opts_sub.splice(i, 1);
      if (body.ans === i) body.ans = 0; else if (body.ans > i) body.ans--; touch(); rerenderForm(); return;
    }
    if (b.dataset.togsub !== undefined) { if (body.opts_sub) delete body.opts_sub; else body.opts_sub = body.opts.map(() => ""); touch(); rerenderForm(); return; }
    if (b.dataset.applyjson !== undefined) {
      try { const v = JSON.parse(main.querySelector("#rawJson").value); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; body = v; touch(); rerenderForm(); toast("JSON을 적용했어요"); }
      catch { toast("JSON 형식이 맞지 않아요"); }
      return;
    }
    if (b.dataset.loadv) { const v = P.versions.find(x => x.version === +b.dataset.loadv); fromVersion(v); touch(); rerenderForm(); main.querySelector("#note").value = `v${v.version} 내용으로 되돌림`; toast(`v${v.version} 내용을 불러왔어요. 저장해야 반영돼요`); return; }
    if (b.id === "saveBtn") {
      const note = main.querySelector("#note").value.trim();
      if (!note) { toast("바꾼 이유를 적어 주세요"); main.querySelector("#note").focus(); return; }
      const clean = { ...body }; for (const [k, keys] of Object.entries(ONLY)) if (k !== kind) keys.forEach(x => delete clean[x]);
      b.disabled = true;
      try {
        const r = await api("PUT", "/problems/" + P.id, { kind, star, body: clean, note });
        toast(`v${r.version}으로 저장했어요. 사용자 화면에 바로 반영돼요`);
        P = await api("GET", "/problems/" + id); fromVersion(P.versions[0]); dirty = false; render();
      } catch (err) { b.disabled = false; toast(err.message); }
    }
  }
  async function onChange(e) {
    if (e.target.id !== "pub") return;
    const on = e.target.checked;
    if (!on && !(await ask({ title: "이 문제를 숨길까요?", body: "사용자 화면에서 바로 사라져요. 지금까지의 기록과 통계는 남아요.", ok: "숨기기", danger: true }))) { e.target.checked = true; return; }
    try { await api("PATCH", "/problems/" + P.id, { status: on ? "published" : "hidden" }); P.status = on ? "published" : "hidden"; render(); toast(on ? "다시 보이게 했어요" : "숨겼어요"); }
    catch (err) { e.target.checked = !on; toast(err.message); }
  }
  const beforeUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
  addEventListener("beforeunload", beforeUnload);
  main.addEventListener("input", onInput); main.addEventListener("click", onClick); main.addEventListener("change", onChange);
  render();
  return {
    canLeave: () => !dirty || confirm("저장하지 않은 수정이 있어요. 나갈까요?"),
    destroy() { removeEventListener("beforeunload", beforeUnload); main.removeEventListener("input", onInput); main.removeEventListener("click", onClick); main.removeEventListener("change", onChange); },
  };
}
