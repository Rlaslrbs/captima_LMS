// 가짜 Gemini 서버 (시험용). 진짜 Google을 부르지 않고 ai.js의 성공·실패 처리를 확인한다.
//   node server/insight/test/fake-gemini.mjs --port 4012
//   GEMINI_BASE=http://127.0.0.1:4012 GEMINI_API_KEY=fake-… 로 서버나 시험을 켠다
// 답하는 방식(mode)은 이 차례로 정한다: 요청 헤더 x-fake → 모델 이름 끝의 "fake-<mode>" → POST /_mode로 정한 값 → 환경 변수 FAKE_MODE → ok
//   ok          스키마에 맞는 JSON + usageMetadata (POST /_reply나 FAKE_REPLY=파일.json으로 준 답이 있으면 그것을 그대로)
//   503 500     붐빔
//   429min      분당 한도 (QuotaFailure …PerMinute… + RetryInfo 7s)
//   429day      하루 한도 (QuotaFailure …PerDay…, RetryInfo는 일부러 짧게)
//   400think    generationConfig에 thinkingConfig나 temperature가 있으면 400, 없으면 ok
//   400         그 밖의 400,  400key  키 오류 (받은 키를 일부러 돌려준다: ai.js가 로그·오류에서 지우는지 확인)
//   401 403 404 권한 없음 / 모델 없음
//   badjson     답 글이 JSON이 아님,  badbody  HTTP 본문 자체가 JSON이 아님
//   slow / slow<ms>  기다렸다가 ok (기본 3000ms)
// GET /_log → 받은 요청 목록 [{ model, mode, cfg, system, prompt, hasKey, keyInUrl }], POST /_reset → 목록·기본값 비우기
// 채점 스키마(points·feedback)면 프롬프트의 [채점 포인트] 수만큼 1부터 번호를 붙여 답한다:
//   답안에 "모름" → 모두 missing, "절반" → covered·missing 번갈아, 그 밖 → 모두 covered. verdict는 일부러 "partial" (ai.js가 다시 계산하는지)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const arg = process.argv.indexOf("--port");
if (arg < 0) { console.log("사용법: node fake-gemini.mjs --port 4012"); process.exit(0); }   // node --test가 이 파일을 시험으로 돌려도 바로 끝난다
const PORT = +process.argv[arg + 1] || 4012;
const USAGE = { promptTokenCount: 120, candidatesTokenCount: 45, thoughtsTokenCount: 7 };

let log = [], mode0 = null, reply0 = process.env.FAKE_REPLY ? JSON.parse(readFileSync(process.env.FAKE_REPLY, "utf8")) : null;

const send = (res, code, obj, raw) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(raw ?? JSON.stringify(obj)); };
const gErr = (code, status, message, details) => ({ error: { code, message, status, ...(details ? { details } : {}) } });
const quota = (model, per, delay) => gErr(429, "RESOURCE_EXHAUSTED", `You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, model: ${model}`, [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
    quotaId: `GenerateRequestsPer${per}PerProjectPerModel-FreeTier`, quotaDimensions: { location: "global", model }, quotaValue: per === "Day" ? "20" : "10" }] },
  { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more about Gemini API quotas", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: delay }]);

// 스키마를 따라 아무 값이나 채운다
function fill(s) {
  if (!s) return {};
  switch (String(s.type).toUpperCase()) {
    case "OBJECT": return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, fill(v)]));
    case "ARRAY": return [fill(s.items)];
    case "STRING": return s.enum ? s.enum[0] : "예시";
    case "INTEGER": return 1;
    case "NUMBER": return 0.5;
    case "BOOLEAN": return true;
    default: return null;
  }
}
function gradeReply(prompt) {
  const sec = (a, b) => { const i = prompt.indexOf(a), j = prompt.indexOf(b, i + 1); return i < 0 ? "" : prompt.slice(i + a.length, j < 0 ? undefined : j); };
  const n = sec("[채점 포인트]", "[학생 답안 시작]").split("\n").filter(l => /^\d+\. /.test(l)).length;
  const ans = sec("[학생 답안 시작]", "[학생 답안 끝]");
  const v = i => /모름/.test(ans) ? "missing" : /절반/.test(ans) ? (i % 2 ? "missing" : "covered") : "covered";
  return { points: Array.from({ length: n }, (_, i) => ({ i: i + 1, verdict: v(i), reason: `포인트 ${i + 1}을 봤어요.` })),
    verdict: "partial", feedback: "가짜 채점 피드백이에요." };
}
function ok(res, body, model) {
  const schema = body.generationConfig?.responseSchema, prompt = body.contents?.[0]?.parts?.[0]?.text || "";
  const out = reply0 ?? (schema?.properties?.points && schema?.properties?.feedback ? gradeReply(prompt) : fill(schema));
  send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(out) }] }, finishReason: "STOP" }],
    usageMetadata: { ...USAGE, totalTokenCount: USAGE.promptTokenCount + USAGE.candidatesTokenCount + USAGE.thoughtsTokenCount }, modelVersion: model });
}

const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8"); let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { }
  if (req.url === "/_log") return send(res, 200, log);
  if (req.url === "/_reset") { log = []; mode0 = null; reply0 = null; return send(res, 200, { ok: true }); }
  if (req.url === "/_mode") { mode0 = body.mode || null; return send(res, 200, { mode: mode0 }); }
  if (req.url === "/_reply") { reply0 = body.out ?? null; return send(res, 200, { ok: true }); }
  const m = req.url.match(/\/models\/([^/:?]+):generateContent/);
  if (!m || req.method !== "POST") return send(res, 404, gErr(404, "NOT_FOUND", "unknown path"));
  const model = decodeURIComponent(m[1]), key = String(req.headers["x-goog-api-key"] || "");
  const mode = String(req.headers["x-fake"] || model.match(/fake-([a-z0-9]+)$/)?.[1] || mode0 || process.env.FAKE_MODE || "ok");
  const cfg = body.generationConfig || {};
  log.push({ model, mode, cfg, system: body.systemInstruction?.parts?.[0]?.text || "", prompt: body.contents?.[0]?.parts?.[0]?.text || "",
    hasKey: !!key, keyInUrl: !!key && req.url.includes(key), at: Date.now() });

  if (mode === "ok") return ok(res, body, model);
  if (mode === "503" || mode === "500") return send(res, +mode, gErr(+mode, mode === "503" ? "UNAVAILABLE" : "INTERNAL", "The model is overloaded. Please try again later."));
  if (mode === "429min") return send(res, 429, quota(model, "Minute", "7s"));
  if (mode === "429day") return send(res, 429, quota(model, "Day", "23s"));
  if (mode === "400think") return cfg.thinkingConfig || "temperature" in cfg
    ? send(res, 400, gErr(400, "INVALID_ARGUMENT", "Unable to submit request because thinking_budget is not supported by this model. Learn more: https://ai.google.dev/gemini-api/docs/thinking"))
    : ok(res, body, model);
  if (mode === "400") return send(res, 400, gErr(400, "INVALID_ARGUMENT", "Invalid JSON payload received. Unknown name \"foo\": Cannot find field."));
  if (mode === "400key") return send(res, 400, gErr(400, "INVALID_ARGUMENT", `API key not valid. Please pass a valid API key. (received ${key})`));
  if (mode === "401" || mode === "403") return send(res, +mode, gErr(+mode, mode === "401" ? "UNAUTHENTICATED" : "PERMISSION_DENIED", "Permission denied."));
  if (mode === "404") return send(res, 404, gErr(404, "NOT_FOUND", `models/${model} is not found for API version v1beta, or is not supported for generateContent.`));
  if (mode === "badjson") return send(res, 200, { candidates: [{ content: { parts: [{ text: "{\"points\": [ 이건 JSON이 아니에요" }] } }], usageMetadata: USAGE });
  if (mode === "badbody") return send(res, 200, null, "<html>oops</html>");
  if (mode.startsWith("slow")) { await new Promise(r => setTimeout(r, +mode.slice(4) || 3000)); try { if (!req.socket.destroyed) ok(res, body, model); } catch { } return; }
  return send(res, 500, gErr(500, "INTERNAL", "unknown fake mode " + mode));
});
server.on("clientError", () => { });
server.listen(PORT, "127.0.0.1", () => console.log(`fake-gemini listening on ${PORT}`));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { server.close(); process.exit(0); });
