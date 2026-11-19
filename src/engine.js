import { apiKey } from "./config.js";

const endpoint = "http://127.0.0.1:39781/v1/completions";
const model = "plamo-3-translate-0.8b";

export async function translate(text, signal, timeout = 120_000) {
  const source = text.replace(/<(?=\|plamo:)/gu, "<\u200b");
  const prompt = "<|plamo:tag|>dataset<|plamo:msg|>translation" +
    "<|plamo:tag|>input<|plamo:msg|>" + source +
    "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ko<|plamo:msg|>";
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      body: JSON.stringify({
        model,
        prompt,
        temperature: 0,
        max_tokens: 1536,
        stop: ["<|plamo:tag|>", "<|plamo:bos|>"]
      })
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error.name === "TimeoutError") throw new Error("번역 시간이 초과됐습니다. 다시 시도하세요.");
    throw new Error("로컬 GPU 엔진에 연결할 수 없습니다. START.cmd를 실행하세요.");
  }
  if (response.status === 503) throw new Error("로컬 모델을 불러오는 중입니다. 준비되면 다시 시도하세요.");
  if (response.status === 401) throw new Error("연결 키가 다릅니다. 이 확장을 빌드한 폴더의 START.cmd를 실행하세요.");
  if (!response.ok) throw new Error(`로컬 엔진 오류 (HTTP ${response.status}).`);
  const result = await response.json();
  if (result.model !== model) throw new Error("이전 번역 엔진을 종료한 후 이 버전의 START.cmd를 실행하세요.");
  const completion = result.choices?.[0];
  const translated = completion?.text?.trim();
  if (completion?.finish_reason === "length") throw new Error("번역 응답이 최대 길이에 도달했습니다.");
  if (!translated) throw new Error("모델이 번역문을 반환하지 않았습니다.");
  return translated;
}
