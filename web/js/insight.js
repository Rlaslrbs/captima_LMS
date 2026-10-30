// 학습 리포트 화면 (/course/:cid/INSIGHT). course.js가 이 화면을 열 때만 불러 쓴다 (import()).
// - 문제 카드(article.card)를 쓰지 않는다 → 집중 모드·problem_shown·lazyMath가 끼어들지 않는다
// - 리포트는 [리포트 뽑기]를 눌렀을 때만 만든다 (결정 7). 열 때는 저장한 것(GET, 계산 없음)만 보여 준다
// - 지난번에 받은 것(LS "ins:<cid>", 같은 기기 것만)을 먼저 그리고, 밀린 기록을 보낸 뒤 서버 것으로 바꾼다
// - 진단 종류(type)는 이름표 표로만 그린다 → 서버가 새 종류를 보내도 화면을 고칠 필요가 없다
// - 개발용 예시: INSIGHT_DEV=1로 켠 서버에서만 ?insightFixture=1 (ready|hyp|thin|locked|none|no_consent|error)
import { esc, LS, KIND, LETTERS, barHTML } from "./util.js";

const TYPE = { misc: "오개념", confusion: "혼동", gap: "개념 공백", unclear: "원인 확인 중", habit: "풀이 습관", relearn: "고친 문제 확인",
  fluency: "속도", hasty: "서두름", fatigue: "집중력", fb_skip: "해설 건너뜀", format: "문제 형식", relative: "상대적 약점" };
const TONE = { misc: "red", confusion: "hl", gap: "fill", habit: "acc", relearn: "ok", fluency: "acc", hasty: "hl", fatigue: "acc", fb_skip: "fill",
  format: "acc", relative: "fill" };   // 모르는 종류 = mute
const CONF = { sure: "확실", likely: "유력", hyp: "가설" };
const LABEL = { weak: "약함", watch: "낮은 편", ok: "보통", solid: "탄탄", pending: "판단 보류" };
const MARK = { fixed: "고쳐짐", slipping: "흔들림" };
const SPEED = { fast: "빠른 편이에요", slow: "신중한 편이에요" };
const CAVEAT = {   // 서버가 데이터로 정한 주의 문장 (SPEC §6). 모르는 코드는 건너뛴다
  relative_only: () => "다른 학습자 자료가 쌓이기 전이라 내 평균 대비로 판단했어요.",
  imported_history: d => `예전 앱에서 옮겨 온 기록${d.basis && d.basis.legacy ? " " + d.basis.legacy + "문제" : ""}는 고른 답·시간이 없어 약하게 반영했어요.`,
  no_mc: () => "이 과목은 객관식이 없어 O/X·서술형으로만 진단해요.",
  untagged: () => "개념 태그가 아직 일부라 장 단위로 먼저 보여 드려요.",
  few_timed: () => "시간이 기록된 풀이가 아직 적어 풀이 속도는 참고로만 봐 주세요.",
  list_time: () => "목록 모드로 푼 문제는 풀이 시간을 정확히 알 수 없어 시간 분석은 참고로만 봐 주세요.",
};
CAVEAT.no_mc_course = CAVEAT.no_mc;
const FIXTURE = "/js/fixtures/insight-sample.json";
const QMAX = 12;                                       // Q: 묶음은 12문제까지 (기록·이어 풀기 주소가 길어지지 않게)

// v2 세부 포인트 진단 (ALGORITHM §8, REPORT_UX §2–§3). 이름표만 여기 두고 문장은 서버의 text.*를 그대로 쓴다
const LVN = { L1: "정의", L2: "적용", L3: "구별", L4: "조건" };   // 사용자가 정한 순서·이름 (DECISIONS 4)
const LVS = ["L1", "L2", "L3", "L4"];
const STN = { ok: "맞힘", miss: "틀림", mixed: "일부 틀림", none: "안 풀어 봄" };
const REASON = { illusion_or_slip: "착각인지 한 번의 실수인지 가려 줄 문제", depth_unknown: "적용·구별 수준을 확인할 문제", confirm_solid: "확실히 아는지 확인할 문제" };
const WHY = {
  few_items: n => n ? `아직 ${n}문제만 풀었어요` : "아직 문제가 적어요",
  one_format: () => "O/X로만(또는 객관식으로만) 풀어 봤어요. 다른 형식도 풀어 보면 정확해져요",
  no_variant: () => "같은 모양 문제만 풀었어요. 바꿔 낸 문제를 풀면 깊이를 알 수 있어요",
  untagged: () => "이 포인트는 아직 문제 분류 중이에요",
  rapid_only: () => "빠르게 넘긴 답이 많아 판단을 미뤘어요",
};
/** 제목·짧은 표·색 (firm = 채운 배지, hedged = 테두리 배지). "알고 있다고 착각하고 있어요"는 firm 착각에만 */
function ptHead(p) {
  const firm = p.tier === "firm";
  if (p.state === "illusion") return firm ? { h: "알고 있다고 착각하고 있어요", b: "착각", t: "red", firm } : { h: "확인해 볼 부분", b: "확인", t: "red", firm };
  if (p.state === "solid") return firm ? { h: "확실히 알고 있어요", b: "확실", t: "ok", firm } : { h: "잘 아는 것 같아요", b: "거의 앎", t: "ok", firm };
  if (p.state === "weak") return { h: "더 다져 볼 부분", b: "다지기", t: p.sub === "gap" ? "fill" : "hl", firm: false };
  return { h: "판단 보류", b: "보류", t: "mute", firm: true };
}
const BEHAVIOR = new Set(["habit", "fluency", "hasty", "fatigue", "fb_skip", "format"]);   // 학습 습관·시간 (지식 진단이 아님) → 맨 아래 접힌 메모
const v2 = d => Array.isArray(d.points) && d.points.length > 0 && !(d.v2 && d.v2.on === false);
const v2off = d => (d.v2 && d.v2.on === false) || d.v2_ready === false;   // 분류가 안 끝난 과목: v1 + 안내 한 줄

const valid = r => !!r && (r.v === 1 || r.v === 2) && ["ready", "locked", "none", "no_consent"].includes(r.state);
/** 잘린 글 끝에 닫히지 않은 수식(\( … 또는 \[ …)이 남으면 그 앞에서 자른다 */
function tex(s) {
  s = String(s ?? "");
  for (const [a, b] of [["\\(", "\\)"], ["\\[", "\\]"]]) { const o = s.lastIndexOf(a); if (o > s.lastIndexOf(b)) s = s.slice(0, o).trimEnd() + "…"; }
  return s;
}
const fmt = s => (s && !/<(p|ol|ul|table|div|br|section)\b/i.test(s) ? String(s).replace(/\n/g, "<br>") : s || "");
/** "2026-10-25T09:20:…Z" → "10월 25일 18:20에 뽑음" (이 기기 시각) */
function madeText(iso) {
  const t = new Date(iso || ""); if (isNaN(t)) return "";
  return `${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}에 뽑음`;
}
const pctOf = a => a && a.n ? Math.round((a.c / a.n) * 100) : null;

export function mount(main, ctx) {
  const { C, cid } = ctx;
  const BYID = {}; C.problems.forEach(p => { BYID[p.id] = p; });
  const key = "ins:" + cid, did = (ctx.did && ctx.did()) || "";
  let aiT = 0, aiN = 0;
  let doc = null, err = false, stale = false, busy = false, at = 0, seq = 0, dead = false, making = false, makeErr = "";
  const typeset = el => ctx.typeset(el, C.math);
  const no = pid => (BYID[pid] && (BYID[pid].no || BYID[pid].ext_id)) || "";
  const idsOf = sc => String(sc || "").replace(/^Q:/, "").split(".").map(Number).filter(id => BYID[id]).slice(0, QMAX);   // 게시된 문제만, 12개까지
  const qOf = ids => "Q:" + ids.slice(0, QMAX).join(".");
  const concept = ch => { const c = C.concepts && C.concepts[ch]; return (c && (typeof c === "string" ? c : c.html)) || ""; };
  const chTitle = ch => (C.chapters.find(c => c.key === ch) || {}).title || ch;
  const keepLocal = r => LS.set(key, { ...r, _did: did });

  // ───────── 근거 칩 · 진단 카드 ─────────
  const secOf = e => e.sec != null && isFinite(+e.sec) ? `${Math.round(+e.sec)}초` : "";
  // 저장한 뒤 기록이 바뀌었으면(stale) 어느 문제를 지웠는지 모르니, 새로 뽑을 때까지 정답 쪽 글(함정·설명)을 모두 숨긴다
  const isStale = () => !!(doc && doc.stale);
  const chipHTML = (f, e) => `<button class="ins-chip${e.hidden || isStale() ? " hid" : ""}${e.role === "avoided" ? " av" : ""}" data-ins-ev="${esc(f.id)}|${esc(e.id)}" aria-expanded="false"${e.hidden ? ` title="아직 못 맞혔어요 · 정답은 다시 풀 때까지 숨겨요"` : ""}><b>${esc(no(e.pid) || e.ext)}</b>${esc(e.label)}${secOf(e) ? `<small class="ins-cs">${secOf(e)}</small>` : ""}</button>`;
  function evdHTML(e) {   // 칩을 누르면: 문제 앞부분, 내가 고른 답, (다시 맞힌 문제만) 함정 문장
    const meta = [KIND[e.kind], e.day, e.fast && "빨리 답함", secOf(e) && (e.rel ? `${secOf(e)} · 평소의 ${(+e.rel).toFixed(1)}배` : secOf(e)), e.hidden && "아직 못 맞힘"].filter(Boolean);
    const hide = e.hidden || isStale();
    const go = BYID[e.pid] ? `<button class="ins-go sm" data-ins-open="${e.pid}" data-ins-hid="${hide ? 1 : 0}">${e.hidden ? "다시 풀어 보기 ›" : "문제 보기 ›"}</button>` : "";
    // 수식 과목: 서버가 자른 글 대신 과목 자료의 원문을 그대로 (수식이 [수식]·잘림 없이 그려지게)
    const p = C.math && BYID[e.pid], q = p && (p.q || p.stem);
    const stem = q ? `<div class="ins-stem ins-qx">${fmt(q)}</div>` : e.stem ? `<p class="ins-stem">${esc(tex(e.stem))}</p>` : "";
    const li = p && e.kind === "mc" && e.chosen_text ? LETTERS.indexOf(e.chosen) : -1;
    const mine = li >= 0 && p.opts && p.opts[li] != null ? `<p class="ins-mine"><span>내 답</span><span>${esc(e.chosen)}. ${fmt(p.opts[li])}</span></p>`
      : e.chosen_text ? `<p class="ins-mine"><span>내 답</span><span>${esc(tex(e.chosen_text))}</span></p>` : "";
    return `<div class="ins-evm"><b>${esc(no(e.pid) || e.ext)}</b><span>${esc(meta.join(" · "))}</span></div>${stem}${mine}
      ${e.trap && !hide ? `<p class="ins-trap"><span>함정</span><span>${esc(tex(e.trap))}</span></p>` : ""}${go}`;
  }
  function stepHTML(st) {   // 계획 단계 버튼 (+ 먼저 읽기)
    const ids = idsOf(st.scope), n = ids.length, t = st.title || "추천 문제";
    const lab = (/\d/.test(t) ? t : `${t} · ${n}문제`) + (st.target_s && !/초/.test(t) ? ` · 한 문제 ${Math.round(st.target_s)}초 안에` : "");
    const r = st.read || {};
    const readBtn = r.pid && BYID[r.pid] ? `<button class="ins-go ghost" data-ins-open="${r.pid}" data-ins-hid="0">먼저 읽기 · ${esc(no(r.pid))} 풀이 ›</button>` : "";
    const readBox = !readBtn && r.chapter && concept(r.chapter)
      ? `<details class="ins-read" data-ch="${esc(r.chapter)}"><summary>먼저 읽기 · ${esc(chTitle(r.chapter))} 핵심 정리</summary><div class="ins-cx"></div></details>` : "";
    return readBox + (readBtn || n ? `<div class="ins-acts">${readBtn}${n ? `<button class="ins-go" data-ins-q="${esc(qOf(ids))}" data-ins-from="${esc(st.id)}">${esc(lab)} ›</button>` : ""}</div>` : "");
  }
  function cardHTML(f, steps) {
    const t = f.text || {}, ev = f.evidence || [], st = f.plan && steps.find(s => s.id === f.plan);
    const unit = f.unit ? `<h3 class="ins-u">${esc(f.unit.name)}${f.with ? ` <span class="ins-x">↔</span> ${esc(f.with.name)}` : ""}</h3>` : "";
    const why = !f.hidden_truth && !isStale() && (t.truth || t.contrast)   // 아직 틀린 문제가 남아 있으면 설명(정답 쪽 이야기)을 숨긴다
      ? `<details class="ins-why"><summary>설명 보기</summary>${t.truth ? `<p>${esc(t.truth)}</p>` : ""}${t.contrast ? `<p class="ins-ctr">${esc(t.contrast)}</p>` : ""}</details>` : "";
    return `<div class="ins-card" data-f="${esc(f.id)}">
      <div class="ins-meta"><span class="ins-b ${TONE[f.type] || "mute"}">${esc(TYPE[f.type] || "참고")}</span>${CONF[f.conf] ? `<span class="ins-cf">${CONF[f.conf]}</span>` : ""}${f.n_items ? `<span class="ins-n">근거 ${f.n_items}문제</span>` : ""}</div>
      ${unit}${t.diag ? `<p class="ins-d">${esc(t.diag)}</p>` : ""}${t.signals ? `<p class="ins-sg">${esc(t.signals)}</p>` : ""}
      ${ev.length || f.avoided ? `<div class="ins-ev" role="group" aria-label="근거 문제">${ev.map(e => chipHTML(f, e)).join("")}${f.avoided ? `<span class="ins-av">피한 함정 ${f.avoided}</span>` : ""}</div><div class="ins-evd" hidden></div>` : ""}
      ${t.cue ? `<p class="ins-cue"><b>풀 때</b><span>${esc(t.cue)}</span></p>` : ""}${why}${st ? stepHTML(st) : ""}
    </div>`;
  }

  // ───────── v2: 세부 포인트 카드 · 깊이 사다리 · 근거 사슬 · 확인 문제 ─────────
  const EXT = {}; C.problems.forEach(p => { if (p.ext_id) EXT[p.ext_id] = p.id; });
  /** 근거 id("E3") 또는 객체 → {pid, ext, ok}. id는 det의 ev 표나 findings의 evidence에서 찾는다 */
  function evOf(x) {
    if (x && typeof x === "object") return { ...x, pid: x.pid || EXT[x.ext] };
    const m = doc && doc.ev && doc.ev[x];
    const e = m || (doc && (doc.findings || []).flatMap(f => f.evidence || []).find(e => e.id === x));
    return e ? { ...e, pid: e.pid || EXT[e.ext] } : null;
  }
  const ptName = p => (p.path && p.path[p.path.length - 1]) || p.statement || p.code;
  const ptPath = p => (p.path || []).filter(Boolean).join(" › ");
  function ladHTML(p) {   // 네 칸: 채움(맞힘·틀림) · 반(일부) · 빈 고리(안 풀어 봄). 색만으로 뜻을 전하지 않게 모양도 다르다
    const L = {}; (p.ladder || []).forEach(l => { L[l.lv] = l; });
    const lab = LVS.map(lv => `${LVN[lv]} ${STN[(L[lv] || {}).st || "none"]}`).join(", ");
    return `<span class="ins-lad" role="img" aria-label="${esc(lab)}">${LVS.map(lv => `<i class="${esc((L[lv] || {}).st || "none")}"></i>`).join("")}</span>`;
  }
  /** 사다리 사실 한 줄: "정의 문제 2개 맞힘 · 조건 문제 1개 틀림" (얕게 앎/모름 구분이 약해서 사실을 함께 보여 준다) */
  const factOf = p => (p.ladder || []).filter(l => l.st && l.st !== "none")
    .map(l => `${LVN[l.lv] || l.lv} 문제 ${(l.items || []).length || ""}${(l.items || []).length ? "개 " : ""}${STN[l.st]}`).join(" · ");
  const depthOf = p => p.depth && LVN[p.depth] ? `${LVN[p.depth]}까지` : "—";
  function ptChip(x, i) {
    const e = evOf(x); if (!e) return "";
    const id = e.pid && BYID[e.pid] ? e.pid : 0, lab = no(id) || e.ext || "";
    return id ? `<button class="ins-chip${e.ok === false ? " hid" : ""}" data-ins-open="${id}" data-ins-hid="${e.ok === false ? 1 : 0}"><b>${esc(lab)}</b>${e.ok === false ? "틀림" : e.ok ? "맞힘" : ""}</button>`
      : `<span class="ins-chip"><b>${esc(lab || "#" + (i + 1))}</b></span>`;
  }
  function ldtHTML(p) {   // 단계별 문제 (사다리 칸을 펼친 것)
    const rows = (p.ladder || []).filter(l => (l.items || []).length);
    return rows.length ? `<details class="ins-ldt"><summary>단계별 문제 보기</summary><ul>${rows.map(l =>
      `<li><span class="ins-ldk">${esc(LVN[l.lv] || l.lv)}</span><span class="ins-ldv">${esc(STN[l.st] || "")}</span><span class="ins-ev">${l.items.map(ptChip).join("")}</span></li>`).join("")}</ul></details>` : "";
  }
  /** 근거 사슬: 맞힘(base) → 바뀐 점(delta) → 틀림(variant) → 같은 생각으로 또(repeat) */
  function chainHTML(f, p) {
    const ch = (f && f.chain) || []; if (!ch.length) return "";
    const kind = f.kind || p.kind;
    const rows = ch.map((c, i) => {
      const e = evOf(c.e || { ext: c.ext, pid: c.pid }) || { ext: c.ext }, id = (c.pid || e.pid) && BYID[c.pid || e.pid] ? (c.pid || e.pid) : 0;
      const ok = c.ok === true || c.role === "base";
      const step = i === 0 ? "" : c.change ? `<li class="ins-step"><span aria-hidden="true">↓</span>바뀐 점: ${esc(tex(c.change))}</li>`
        : c.role === "repeat" ? `<li class="ins-step"><span aria-hidden="true">↓</span>${kind === "familiar" ? "같은 형태로 또" : "같은 생각으로 또"}</li>` : `<li class="ins-step"><span aria-hidden="true">↓</span></li>`;
      const lab = no(id) || c.ext || e.ext || "";
      const chip = id ? `<button class="ins-chip${ok ? "" : " hid"}" data-ins-open="${id}" data-ins-hid="${ok ? 0 : 1}"><b>${esc(lab)}</b>${c.lv && LVN[c.lv] ? `<small class="ins-cs">${LVN[c.lv]}</small>` : ""}</button>` : `<span class="ins-chip"><b>${esc(lab)}</b></span>`;
      const ans = ok ? "맞힘" : c.chosen ? `${esc(c.chosen)}${c.text ? ` · ${esc(tex(c.text))}` : ""}` : "틀림";
      return `${step}<li class="ins-cr ${ok ? "ok" : "no"}"><span class="ins-crk">${ok ? "맞힘" : "틀림"}</span>${chip}<span class="ins-cra">${ok ? "" : "고른 답 "}${ans}</span>${!ok && c.why ? `<span class="ins-crw">${esc(tex(c.why))}</span>` : ""}</li>`;
    });
    return `<ol class="ins-chain" aria-label="근거 문제">${rows.join("")}</ol>`;
  }
  /** 확인 문제 줄: det.probes(scope) 우선, 없으면 point.probes. 문제가 없으면 준비 중 문구 */
  function probeHTML(p, solid) {
    const pr = (doc.probes || []).find(x => x.point === p.code);
    const ids = idsOf(pr && pr.scope ? pr.scope : qOf((pr && pr.pids) || (p.probes || []).map(x => x.pid)));
    const reason = (pr && pr.reason) || ((p.probes || [])[0] || {}).reason;
    if (ids.length) return `<button class="ins-go${solid ? " ghost" : ""}" data-ins-q="${esc(qOf(ids))}" data-ins-from="probe">${esc(REASON[reason] || "확인 문제")} · ${ids.length} ›</button>`;
    return p.need_variant ? `<span class="ins-pv">확인할 문제를 준비하고 있어요</span>` : "";
  }
  function ptBody(p, f, steps) {   // 카드 안쪽 (목록 줄을 펼쳤을 때도 같은 것)
    const t = (f && f.text) || {}, m = p.mis || {}, hd = ptHead(p);
    const fact = p.state === "weak" || p.state === "pending" ? factOf(p) : "";
    const why = p.state === "pending" && WHY[p.why] ? WHY[p.why](p.n_items) : "";
    const cue = t.cue || m.cue, truth = t.truth || m.truth, lock = p.hidden_truth || isStale();
    const tr = truth ? (lock ? `<p class="ins-lockt">바르게 보면 · 다시 풀어 맞히면 열려요</p>`
      : `<details class="ins-why"><summary>바르게 보면</summary><p>${esc(tex(truth))}</p>${t.contrast ? `<p class="ins-ctr">${esc(tex(t.contrast))}</p>` : ""}</details>`) : "";
    const st = f && typeof f.plan === "string" && steps.find(s => s.id === f.plan);
    const pp = f && f.plan && typeof f.plan === "object" ? idsOf(qOf(f.plan.pids || [])) : [];   // v2 카드의 연습 묶음 {pids}
    const ppLab = p.state === "illusion" ? (p.kind === "misc" && t.contrast ? "섞어서 풀기" : "같은 함정, 다른 문제") : p.state === "weak" ? (p.sub === "shallow" ? "다음 단계 문제로 넓히기" : "이 포인트 문제") : "연습 문제";
    const ppBtn = pp.length && (hd.firm || p.state === "weak") ? `<button class="ins-go${p.tier === "hedged" ? " ghost" : ""}" data-ins-q="${esc(qOf(pp))}" data-ins-from="point">${ppLab} · ${pp.length} ›</button>` : "";
    const probe = p.tier === "hedged" || p.state === "pending" ? probeHTML(p) : "";
    return `${t.diag ? `<p class="ins-d">${esc(tex(t.diag))}</p>` : why ? `<p class="ins-d">${esc(why)}</p>` : ""}
      <div class="ins-lr">${ladHTML(p)}<span>${esc(fact || LVS.map(lv => { const l = (p.ladder || []).find(x => x.lv === lv); return `${LVN[lv]} ${l && l.st !== "none" ? STN[l.st] : "아직"}`; }).join(" · "))}</span></div>
      ${chainHTML(f, p)}${ldtHTML(p)}
      ${cue ? `<p class="ins-cue"><b>풀 때</b><span>${esc(tex(cue))}</span></p>` : ""}${tr}
      ${probe || ppBtn ? `<div class="ins-acts">${probe}${ppBtn}</div>` : ""}${st && hd.firm ? stepHTML(st) : st && p.state === "weak" ? stepHTML(st) : ""}`;
  }
  function ptCardHTML(p, f, steps) {
    const hd = ptHead(p), title = (f && f.text && f.text.title) || hd.h;
    return `<div class="ins-card ins-pt" data-pt="${esc(p.code)}">
      <div class="ins-meta"><span class="ins-b ${hd.t}${hd.firm ? "" : " ol"}">${esc(hd.b)}</span>${p.n_items ? `<span class="ins-n">근거 ${p.n_items}문제</span>` : ""}</div>
      <h3 class="ins-u">${esc(title)}</h3><p class="ins-path">${esc(ptPath(p))}</p>${ptBody(p, f, steps)}</div>`;
  }
  function ptRowHTML(p, F, steps) {   // 목록 한 줄 → 누르면 그 자리에서 작은 카드로 펼침
    const hd = ptHead(p), f = F.find(x => x.point === p.code);
    return `<li><details class="ins-pr"><summary><span class="ins-prn">${esc(ptName(p))}</span>${ladHTML(p)}<span class="ins-prd">${esc(depthOf(p))}</span><span class="ins-b ${hd.t}${hd.firm ? "" : " ol"}">${esc(hd.b)}</span></summary>
      <div class="ins-prb"><p class="ins-path">${esc(ptPath(p))}</p>${ptBody(p, f, steps)}</div></details></li>`;
  }
  function ptListHTML(d, steps) {
    const P = d.points || [], F = d.findings || [], on = P.filter(p => p.state !== "pending"), pd = P.filter(p => p.state === "pending"), r = [];
    if (on.length) r.push(`<details class="ins-row ins-dt"><summary><span class="ins-k">세부 포인트별 깊이</span><span class="ins-v">${on.length}개 · 정의 · 적용 · 구별 · 조건</span></summary><ul class="ins-pl2">${on.map(p => ptRowHTML(p, F, steps)).join("")}</ul>
      <p class="ins-lg">칸: 정의 · 적용 · 구별 · 조건 &nbsp;·&nbsp; 채움 맞힘/틀림 · 반 일부 틀림 · 빈 고리 아직 안 풀어 봄 &nbsp;·&nbsp; 테두리 배지는 아직 조심스러운 진단이에요</p></details>`);
    if (pd.length) r.push(`<details class="ins-row ins-dt"><summary><span class="ins-k">판단 보류</span><span class="ins-v">${pd.length}개 포인트</span></summary><ul class="ins-pl2">${pd.map(p => ptRowHTML(p, F, steps)).join("")}</ul></details>`);
    return r.join("");
  }

  // ───────── 아래 목록 (고친 문제 · 잘 되는 것 · 풀이 속도 · 판단 보류 · 모든 개념) ─────────
  function unitHTML(u) {   // 숫자 = 실제 첫 풀이 정답률(acc), 가는 막대 = 그 정답률이 있을 법한 80% 범위(band, 문제 수가 적을수록 넓다)
    const [lo, hi] = (u.band || [0, 0]).map(x => Math.max(0, Math.min(1, +x || 0)));
    const c = u.counts || {}, w = Math.max(2, (hi - lo) * 100), left = Math.min(lo * 100, 100 - w), a = pctOf(u.acc);
    const tip = `${u.n || 0}문제${u.acc && u.acc.n ? ` · 첫 풀이 ${u.acc.c}/${u.acc.n}` : ""} · 맞힘 ${c.c || 0} · 틀림 ${c.w || 0}${c.idk ? " · 모르겠어요 " + c.idk : ""} · 정답률 80% 범위 ${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
    const sp = u.speed === "slow" ? "오래 걸림" : u.speed === "fast" ? "빠름" : "", lab = u.label === "ok" && u.watch ? "watch" : u.label;   // watch: 보통이지만 상대적으로 낮음
    return `<li class="ins-ur" title="${esc(tip)}"><span class="ins-dot ${esc(lab)}"></span>
      <span class="ins-un">${esc(u.name)}${MARK[u.mark] ? `<small class="ins-mk ${esc(u.mark)}">${MARK[u.mark]}</small>` : ""}${sp ? `<small class="ins-sp">${sp}</small>` : ""}</span>
      <span class="ins-ac">${a == null ? "–" : a + "%"}</span>
      <span class="ins-band" role="img" aria-label="정답률 80% 범위 ${Math.round(lo * 100)}–${Math.round(hi * 100)}%"><i style="left:${left.toFixed(1)}%;width:${w.toFixed(1)}%"></i></span><span class="ins-lb">${LABEL[lab] || ""}</span></li>`;
  }
  function unitsHTML(U) {
    const g = [["개념", U.filter(u => u.kind !== "chapter")], ["단원", U.filter(u => u.kind === "chapter")]].filter(x => x[1].length);
    return g.map(([t, l]) => `${g.length > 1 ? `<p class="ins-ug">${t}</p>` : ""}<ul class="ins-ul">${l.map(unitHTML).join("")}</ul>`).join("")
      + `<p class="ins-lg">숫자: 첫 풀이 정답률 &nbsp;·&nbsp; 막대: 첫 풀이 정답률이 있을 법한 범위 (80%, 문제가 적으면 넓어요) &nbsp;·&nbsp; 점: 탄탄 · 보통 · 약함 · 판단 보류</p>`;
  }
  const pendHTML = pd => `<ul class="ins-pl">${pd.map(p => `<li>${esc(p.name)}<span> — 판단하기엔 근거가 아직 적어요 · ${+p.n || 0}문제</span></li>`).join("")}</ul>`;
  function listHTML(d, F) {
    const r = [], rl = d.relearn || {}, due = idsOf(qOf(rl.due || [])), tm = d.time || {}, pd = d.pending || [], U = d.units || [];
    if (rl.resolved) r.push(`<div class="ins-row"><span class="ins-k">고친 문제 확인</span><span class="ins-v">다른 날 다시 맞힌 것 <b>${rl.confirmed || 0}</b> / ${rl.resolved}</span>${due.length ? `<button class="ins-go" data-ins-q="${esc(qOf(due))}" data-ins-from="relearn">오늘 확인할 ${due.length}문제 ›</button>` : ""}</div>`);
    if (v2(d)) r.push(ptListHTML(d, (d.plan || {}).steps || []));
    if ((d.strong || []).length) r.push(`<div class="ins-row"><span class="ins-k">잘 되는 것</span><span class="ins-v">${d.strong.map(s => `<b>${esc(s.name)}</b>`).join(" · ")}</span></div>`);
    else if ((d.good || []).length) r.push(`<div class="ins-row"><span class="ins-k">잘 맞히는 곳</span><span class="ins-v">${d.good.map(s => `<b>${esc(s.name)}</b> ${s.c}/${s.n}`).join(" · ")}</span></div>`);
    if ((tm.notes || []).length) r.push(`<div class="ins-row"><span class="ins-k">풀이 속도</span><span class="ins-v">${[SPEED[tm.speed], ...tm.notes].filter(Boolean).map(esc).join("<br>")}</span></div>`);
    if (pd.length && F.length && !v2(d)) r.push(`<details class="ins-row ins-dt"><summary><span class="ins-k">판단 보류</span><span class="ins-v">${pd.length}개 개념</span></summary>${pendHTML(pd)}</details>`);
    if (U.length) r.push(`<details class="ins-row ins-dt"><summary><span class="ins-k">모든 개념 보기</span><span class="ins-v">${U.length}개</span></summary>${unitsHTML(U)}</details>`);
    return r.length ? `<div class="ins-list">${r.join("")}</div>` : "";
  }
  function exHTML(d) {   // 빼고 센 답 (너무 빠른 답 · 연달아 누른 답)
    const x = d.excluded || {}, a = [+x.rapid > 0 && `너무 빠른 답 ${+x.rapid}번`, +x.burst > 0 && `연달아 누른 답 ${+x.burst}번`].filter(Boolean);
    return a.length ? `<li>${a.join(" · ")}은 빼고 판단했어요.</li>` : "";
  }
  function howHTML(d) {   // 만든 방법 + 데이터에서 정해진 주의 문장
    const cv = (d.caveats || []).map(c => CAVEAT[c] && CAVEAT[c](d)).filter(Boolean);
    return `<details class="ins-how"><summary>이 리포트는 이렇게 만들었어요</summary><ul>
      <li>[리포트 뽑기]를 누른 그때까지의 기록으로 만들어요. 새로 풀면 다시 뽑을 수 있어요.</li>
      <li>첫 시도를 중심으로 봐요. 너무 빨리 고른 답과 해설을 본 뒤 고른 답은 빼요.</li>
      <li>최근 풀이를 더 크게, 오래된 풀이는 조금 작게 반영해요.</li>${exHTML(d)}${v2(d) ? `<li>세부 포인트마다 정의 · 적용 · 구별 · 조건 네 단계로 나눠 봐요. 근거가 충분하면 단정하고, 아직 적으면 "~일 수 있어요"라고 말한 뒤 확인 문제를 골라 드려요.</li>` : ""}${cv.map(s => `<li>${esc(s)}</li>`).join("")}</ul></details>`;
  }
  const staleHTML = () => stale ? `<p class="ins-stale">최신 상태를 불러오지 못했어요 · <button class="linkish" data-ins-retry="1">다시 시도</button></p>` : "";
  /** 뽑기 줄: 뽑은 때 + [새로 뽑기 · 새 기록 n개] / 새 기록이 없어요. 만드는 중이면 조용한 표시만 */
  function snapHTML(d) {
    const errP = makeErr ? `<p class="ins-stale" role="alert">${esc(makeErr)} · <button class="linkish" data-ins-make="1">다시 시도</button></p>` : "";
    if (making) return `<div class="ins-snap"><span class="ins-asof">${esc(madeText(d.made_at))}</span><span class="ins-run" role="status"><span class="spin"></span>새로 뽑는 중이에요…</span></div>`;
    const n = (d.since && +d.since.answers) || 0;
    const act = ctx.dev ? "" : n > 0 ? `<button class="ins-go sm" data-ins-make="1">새로 뽑기 · 새 기록 ${n}개</button>`
      : d.stale ? `<button class="ins-go sm" data-ins-make="1">새로 뽑기 · 기록이 바뀌었어요</button>` : `<button class="ins-go sm ghost" disabled>새 기록이 없어요</button>`;
    return `<div class="ins-snap"><span class="ins-asof">${esc(madeText(d.made_at) || "학습 리포트")}</span>${act}</div>${errP}`;
  }

  // ───────── 상태별 화면 ─────────
  /** AI 오답 진단 카드 (det.ai.findings, 서버가 검증한 것만). 없거나 pending·실패면 아무것도 그리지 않는다 */
  function aiHTML(d) {
    const A = d.ai && d.ai.state === "ready" && Array.isArray(d.ai.findings) ? d.ai.findings.filter(a => a && a.belief).slice(0, 3) : [];
    return A.map(a => {
      const c = a.concept || {}, id = a.pid && BYID[a.pid] ? a.pid : 0, hide = isStale();
      const row = (k, v) => v ? `<p class="ins-ai3"><b>${k}</b><span>${esc(tex(v))}</span></p>` : "";
      return `<div class="ins-card ins-ai"><div class="ins-meta"><span class="ins-b hl ol">AI 추정</span>${a.confidence === "high" ? `<span class="ins-cf">근거가 뚜렷해요</span>` : ""}</div>
        <h3 class="ins-u">${c.name ? esc(c.name) + "에서 " : ""}이렇게 헷갈리고 있을 수 있어요</h3>
        ${row("생각", a.belief)}${hide ? "" : row("실제로는", a.truth)}${row("고른 답", a.chosen)}${row("풀 때", a.cue)}
        ${id ? `<div class="ins-acts"><button class="ins-go" data-ins-open="${id}" data-ins-hid="0">${esc(no(id) || a.ext || "")} 문제 보기 ›</button></div>` : ""}</div>`;
    }).join("");
  }
  /** 학습 습관 및 시간 메모: 서버의 det.habits(없으면 예전 리포트의 findings 중 습관 종류)를 맨 아래에 접어 둔다 */
  const habitsOf = d => Array.isArray(d.habits) ? d.habits : (d.findings || []).filter(f => BEHAVIOR.has(f.type));
  function habitsHTML(d, steps) {
    const H = habitsOf(d); if (!H.length) return "";
    return `<details class="ins-row ins-dt ins-hab"><summary><span class="ins-k">학습 습관 및 시간 메모</span><span class="ins-v">${H.length}개 · 성적과 별개로 참고만 해 주세요</span></summary>${H.map(f => cardHTML(f, steps)).join("")}</details>`;
  }
  function readyHTML(d) {
    const F = (d.findings || []).filter(f => !BEHAVIOR.has(f.type)), pl = d.plan || {}, steps = pl.steps || [], tp = idsOf(qOf((pl.today && pl.today.pids) || [])), b = d.basis || {};
    const basis = [b.first && `새 앱 첫 풀이 ${b.first}`, b.choice && `고른 답 기록 ${b.choice}`, b.legacy && `예전 앱 기록 ${b.legacy}문제(약하게 반영)`].filter(Boolean).join(" · ");
    const head = d.headline || (F.length ? "" : "아직 뚜렷한 약점은 보이지 않아요.");
    const PB = {}; (d.points || []).forEach(p => { PB[p.code] = p; });
    const PF = F.filter(f => f.point && PB[f.point] && f.type !== "solid").slice(0, 3), F1 = F.filter(f => !f.point);   // v2 카드는 3개까지
    const cards = PF.map(f => ptCardHTML(PB[f.point], f, steps)).join("") + F1.map(f => cardHTML(f, steps)).join("");
    const ai = aiHTML(d);
    const body = ai || PF.length || F1.length ? `<h2 class="ins-h">짚어 볼 것</h2>${ai}${cards}`
      : `<div class="ins-card ins-empty"><p class="ins-d">판단 보류인 개념을 조금 더 풀면 더 정확해져요.</p>${(d.pending || []).length ? pendHTML(d.pending) : ""}</div>`;
    return `<section class="ins">
      <header class="ins-top">${snapHTML(d)}${head ? `<p class="ins-hl">${esc(head)}</p>` : ""}
        ${basis ? `<p class="ins-basis">근거 · ${esc(basis)}</p>` : ""}${!v2(d) && v2off(d) ? `<p class="ins-note">세부 포인트별 진단은 이 과목 문제 분류가 끝나면 열려요.</p>` : ""}${staleHTML()}
        ${tp.length ? `<button class="btn pri lg ins-start" data-ins-q="${esc(qOf(tp))}" data-ins-from="today">오늘의 복습 시작 · ${tp.length}문제 · 약 ${Math.max(1, Math.round(pl.today.minutes || 0))}분</button>` : ""}</header>
      ${body}${listHTML(d, F)}${habitsHTML(d, steps)}${howHTML(d)}</section>`;
  }
  /** 아직 열리지 않음: 저장한 잠긴 리포트(next 있음) 또는 뽑기 전(none, 서버가 어림한 have/need) */
  function lockedHTML(d) {
    const hv = d.have || {}, nd = d.need || { n_eff: 30, events: 15, chapters: 3 }, none = d.state === "none";
    const ok = d.state === "locked" && d.can_make && ((d.since && +d.since.answers) > 0 || d.stale);   // 저장한 뒤 더 풀어서 이제 열릴 만큼 됨
    const left = ok ? 0 : Math.max(0, Math.ceil((nd.n_eff || 0) - (hv.n_eff || 0)), (nd.events || 0) - (hv.events || 0));
    const chLeft = !ok && (nd.chapters || 0) > (hv.chapters || 0);
    const frac = ok ? 1 : Math.min(1, ...[[hv.n_eff, nd.n_eff], [hv.events, nd.events]].filter(x => x[1]).map(([a, z]) => (+a || 0) / z));
    const nx = idsOf(qOf((d.next && d.next.pids) || []));
    const top = none ? `<p class="ins-asof">학습 리포트</p>` : snapHTML(d);
    const ask = none && !ctx.dev ? (making ? `<p class="ins-run" role="status"><span class="spin"></span>고르는 중이에요…</p>`
      : `<div class="ins-acts"><button class="ins-go ghost" data-ins-make="1">지금 풀면 좋은 문제 고르기 ›</button></div>${makeErr ? `<p class="ins-stale" role="alert">${esc(makeErr)}</p>` : ""}`) : "";
    return `<section class="ins">
      <header class="ins-top">${top}<p class="ins-hl">${ok ? "이제 리포트를 뽑을 수 있어요" : left ? `첫 리포트까지 ${left}문제` : "다른 단원도 조금 풀면 열려요"}</p>
        <p class="ins-basis">집중 모드에서 객관식·O/X를 풀면 가장 빨리 열려요${chLeft ? ` · 문제를 3개 이상 푼 단원이 ${nd.chapters}곳은 되어야 해요` : ""}</p>
        <div class="ins-lk">${barHTML({ c: Math.round(frac * 100), r: 0, w: 0, all: 100 })}<span>${Math.round(frac * 100)}%</span></div>${staleHTML()}${ask}</header>
      ${nx.length ? `<div class="ins-list"><div class="ins-row"><span class="ins-k">지금 풀면 좋은 문제</span><span class="ins-v">리포트가 열리는 데 필요한 만큼, 진단에 도움이 되는 문제로 골랐어요</span><button class="ins-go" data-ins-q="${esc(qOf(nx))}" data-ins-from="next">${nx.length}문제 풀기 ›</button></div></div>` : ""}
    </section>`;
  }
  /** 뽑기 전 (뽑을 만큼 풀었음): 큰 [리포트 뽑기] 하나 */
  function noneHTML(d) {
    return `<section class="ins"><header class="ins-top"><p class="ins-asof">학습 리포트</p><p class="ins-hl">지금까지 푼 기록으로 리포트를 뽑을 수 있어요</p>
      <p class="ins-basis">약한 개념, 헷갈리는 것, 풀이 습관을 짚고 오늘 풀 문제를 골라 줘요. 뽑은 리포트는 새로 뽑을 때까지 그대로 남아요.</p>${staleHTML()}
      ${making ? `<p class="ins-run lg" role="status"><span class="spin"></span>리포트를 만드는 중이에요…</p>` : ctx.dev ? "" : `<button class="btn pri lg ins-start" data-ins-make="1">리포트 뽑기</button>`}
      ${makeErr ? `<p class="ins-stale" role="alert">${esc(makeErr)} · <button class="linkish" data-ins-make="1">다시 시도</button></p>` : ""}</header></section>`;
  }
  const ncHTML = () => `<section class="ins"><header class="ins-top"><p class="ins-asof">학습 리포트</p><p class="ins-hl">기록 저장을 켜면 리포트를 볼 수 있어요</p>
    <p class="ins-basis">학습 리포트는 풀이 기록이 있어야 만들 수 있어요. 기록은 익명 기기 ID로만 저장돼요.</p>
    <a class="btn pri ins-start" href="/me" data-link>기록 저장 켜기 ›</a></header></section>`;
  const errHTML = () => `<div class="empty ins-err">리포트를 불러오지 못했어요 · <button class="linkish" data-ins-retry="1">다시 시도</button></div>`;

  function paint() {
    if (dead) return;
    ctx.clearMath(main);                                // 예전 수식을 MathJax 기억에서 지운 뒤 다시 그린다
    main.innerHTML = !doc ? (err ? errHTML() : `<div class="loading"><span class="spin"></span>리포트를 불러오는 중…</div>`)
      : doc.state === "no_consent" ? ncHTML() : doc.state === "none" ? (doc.can_make ? noneHTML(doc) : lockedHTML(doc))
      : doc.state === "locked" ? lockedHTML(doc) : readyHTML(doc);
    typeset(main);
  }
  /** AI 진단이 만들어지는 중(pending)이면 5초마다 최대 3번 다시 받아 본다 (계산 없는 GET). 실패하면 조용히 멈춘다 */
  function pollAi() {
    clearTimeout(aiT);
    if (dead || ctx.dev || !doc || !doc.ai || doc.ai.state !== "pending" || aiN >= 3) return;
    aiT = setTimeout(async () => {
      aiN++;
      try { const r = await ctx.api("GET", "/api/me/insight/" + cid); if (!dead && !making && valid(r)) { if (take(r)) paint(); } } catch { }
      pollAi();
    }, 5000);
  }
  function take(r) {                                    // 서버(또는 예시)에서 받은 것으로 바꾼다
    if (!valid(r)) throw new Error("리포트 형식이 아니에요");
    const same = !!doc && !stale && JSON.stringify(doc) === JSON.stringify(r);
    doc = r; err = false; stale = false; at = Date.now(); if (!r._fx) keepLocal(r);
    return !same;
  }

  // ───────── 불러오기: 밀린 기록 보내기 → 저장한 리포트 (계산 없음). 개발용 예시면 예시 파일 ─────────
  async function load() {
    const my = ++seq; busy = true;
    try {
      let r;
      if (ctx.dev) {
        if (ctx.dev === "error") throw new Error("개발용: 불러오기 실패 흉내");
        const all = await (await fetch(FIXTURE, { cache: "no-store" })).json();
        r = { ...(all[ctx.dev] || all.ready), _fx: 1 };
      } else {
        try { await ctx.flush(); await ctx.sendEvents(); } catch { }   // 방금 푼 기록까지 세게 (못 보내도 저장한 리포트는 보여 준다)
        r = await ctx.api("GET", "/api/me/insight/" + cid);
      }
      if (my !== seq || dead) return;
      if (take(r)) paint();
      pollAi();
    } catch (e) {
      if (my !== seq || dead) return;
      if (doc) stale = true; else err = true;           // 지난번 것이 있으면 그대로 두고 알림만
      paint();
    } finally { if (my === seq) busy = false; }
  }
  /** [리포트 뽑기]: 밀린 기록을 모두 보낸 뒤 서버가 새로 만든다 (기록이 그대로면 같은 리포트) */
  async function make() {
    if (making || ctx.dev) return;
    const my = ++seq; making = true; makeErr = ""; busy = true; paint();
    ctx.track("insight_make", { cid, since: (doc && doc.since && doc.since.answers) || 0 });
    try {
      await ctx.flush(); await ctx.sendEvents();
      const r = await ctx.api("POST", "/api/me/insight/" + cid);
      if (my !== seq || dead) return;
      making = false; aiN = 0; take(r); paint(); scrollTo(0, 0); pollAi();
    } catch (e) {
      if (my !== seq || dead) return;
      making = false;
      makeErr = e && e.status === 429 ? "오늘은 리포트를 많이 뽑았어요. 내일 다시 뽑아 주세요" : e && e.status ? "리포트를 만들지 못했어요" : "서버에 연결하지 못했어요";
      paint();
    } finally { if (my === seq) busy = false; }
  }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !main.contains(b)) return;
    const d = b.dataset;
    if (d.insMake) { make(); return; }
    if (d.insQ) {                                       // 계획의 문제 묶음 → Q: 범위 (집중 모드·채점·이어 풀기 그대로)
      const n = idsOf(d.insQ).length;
      ctx.track("insight_start", d.insFrom === "today" ? { cid, n } : { cid, n, from: d.insFrom });
      ctx.go(d.insQ); return;
    }
    if (d.insOpen) { const id = +d.insOpen; if (d.insHid === "1") ctx.go("Q:" + id); else ctx.show(id); return; }   // 아직 틀린 문제는 답을 숨긴 채 그 문제만
    if (d.insEv) {
      const card = b.closest(".ins-card"), box = card && card.querySelector(".ins-evd"); if (!box) return;
      const on = b.getAttribute("aria-expanded") !== "true";
      card.querySelectorAll(".ins-chip").forEach(c => c.setAttribute("aria-expanded", "false"));
      ctx.clearMath(box); box.innerHTML = ""; box.hidden = true;
      if (!on) return;
      const [fid, eid] = d.insEv.split("|"); const f = (doc.findings || []).find(x => x.id === fid); const ev = f && (f.evidence || []).find(x => x.id === eid);
      if (!ev) return;
      b.setAttribute("aria-expanded", "true"); box.innerHTML = evdHTML(ev); box.hidden = false; typeset(box);
      return;
    }
    if (d.insRetry) { if (!doc) { err = false; paint(); } load(); }
  }
  function onToggle(e) {   // "먼저 읽기" 핵심 정리는 펼칠 때 넣고 그때 수식을 그린다
    const dt = e.target; if (!dt.matches || !dt.matches("details.ins-read") || !dt.open) return;
    const box = dt.querySelector(".ins-cx"); if (!box || box.dataset.on) return;
    box.dataset.on = "1"; box.innerHTML = concept(dt.dataset.ch); typeset(box);
  }
  main.addEventListener("click", onClick); main.addEventListener("toggle", onToggle, true);

  const cached = LS.get(key, null);                     // 같은 기기가 받은 것만 (기기를 옮기면 지난 기기 리포트를 그리지 않는다)
  if (!ctx.dev && valid(cached) && cached.cid === cid && did && cached._did === did) { doc = { ...cached }; delete doc._did; }
  const local = !ctx.dev && !ctx.consent();             // 기록 동의를 안 한 기기: 서버에 기록이 없으니 묻지 않는다
  if (local) doc = { v: 1, cid, state: "no_consent" };
  paint();
  ctx.track("insight_open", { cid });
  if (!local) load();

  return {
    update() { if (!busy && !local && Date.now() - at > 5000) load(); },   // 다시 열면 새 기록 수만 조용히 새로 받기 (계산 없음)
    destroy() { dead = true; seq++; clearTimeout(aiT); main.removeEventListener("click", onClick); main.removeEventListener("toggle", onToggle, true); ctx.clearMath(main); },
  };
}
