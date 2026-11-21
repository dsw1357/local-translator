import { apiKey } from "./config.js";
import { isSupportedLanguage } from "./languages.js";
import { DEFAULT_CONTEXT, LENGTH_ERROR } from "./settings.js";

const endpoint = "http://127.0.0.1:39781";
const model = "plamo-3-translate-0.8b";

function lengthError() {
  return Object.assign(new Error(LENGTH_ERROR), { code: "translation-length" });
}

async function engineRequest(path, signal, body) {
  const response = await fetch(endpoint + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    redirect: "error",
    cache: "no-store",
    signal,
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 503) throw new Error("로컬 모델을 불러오는 중입니다. 준비되면 다시 시도하세요.");
  if (response.status === 401) throw new Error("연결 키가 다릅니다. 이 확장을 빌드한 폴더의 START.cmd를 실행하세요.");
  if (!response.ok) throw new Error(`로컬 엔진 오류 (HTTP ${response.status}).`);
  return response;
}

export async function engineContext(signal = AbortSignal.timeout(3_000)) {
  const { model_alias, total_slots, default_generation_settings } = await (await engineRequest("/props", signal)).json();
  if (model_alias !== model) throw new Error("이 버전의 START.cmd로 PLaMo 번역 엔진을 실행하세요.");
  const slotTokens = default_generation_settings?.n_ctx;
  if (!Number.isSafeInteger(slotTokens) || slotTokens <= 0) throw new Error("엔진 컨텍스트를 확인할 수 없습니다.");
  return { slotTokens, slots: total_slots };
}

async function readCompletionStream(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let text = "";
  let finishReason;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { text, finish_reason: finishReason };
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (event.error || event.model !== model) throw new Error("로컬 엔진의 번역 스트림이 중단됐습니다.");
        const choice = event.choices?.[0];
        text += choice?.text ?? "";
        finishReason = choice?.finish_reason ?? finishReason;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function translate(text, signal, {
  timeout = 120_000, sourceLanguage, targetLanguage = "ko", contextTokens = DEFAULT_CONTEXT
} = {}) {
  if (!isSupportedLanguage(targetLanguage) || (sourceLanguage && !isSupportedLanguage(sourceLanguage))) {
    throw new Error("지원하는 번역 언어를 선택하세요.");
  }
  const source = text.replace(/<(?=\|plamo:)/gu, "<\u200b");
  const language = code => code ? "<|plamo:key|>lang<|plamo:val|>" + code : "";
  const prompt = "<|plamo:tag|>dataset<|plamo:msg|>translation" +
    "<|plamo:tag|>input" + language(sourceLanguage) + "<|plamo:msg|>" + source +
    "<|plamo:tag|>output" + language(targetLanguage) + "<|plamo:msg|>";
  const extended = contextTokens !== DEFAULT_CONTEXT;
  const timeoutSignal = AbortSignal.timeout(timeout);
  const requestSignal = AbortSignal.any([signal, timeoutSignal]);
  let completion;
  try {
    let outputLimit = 1536;
    if (extended) {
      const { slotTokens } = await engineContext(requestSignal);
      if (slotTokens < contextTokens) {
        throw new Error(`엔진을 종료하고 START.cmd -ContextTokens ${contextTokens} 명령으로 다시 실행하세요.`);
      }
      const { tokens } = await (await engineRequest("/tokenize", requestSignal, {
        content: prompt, add_special: true, parse_special: true
      })).json();
      outputLimit = Math.min(contextTokens - tokens.length - 4, Math.max(1536, tokens.length * 3));
      if (outputLimit < tokens.length) throw lengthError();
    }
    const response = await engineRequest("/v1/completions", requestSignal, {
      model,
      prompt,
      temperature: 0,
      max_tokens: outputLimit,
      stream: extended,
      stop: ["<|plamo:tag|>", "<|plamo:bos|>"]
    });
    if (extended) {
      completion = await readCompletionStream(response);
      if (!completion.finish_reason) throw new Error("로컬 엔진의 번역 스트림이 중단됐습니다.");
    } else {
      const result = await response.json();
      if (result.model !== model) throw new Error("이전 번역 엔진을 종료한 후 이 버전의 START.cmd를 실행하세요.");
      completion = result.choices?.[0];
    }
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeoutSignal.aborted) throw new Error("번역 시간이 초과됐습니다. 다시 시도하세요.");
    if (error instanceof TypeError) throw new Error("로컬 GPU 엔진에 연결할 수 없습니다. START.cmd를 실행하세요.");
    throw error;
  }
  const translated = completion?.text?.trim();
  if (completion?.finish_reason === "length") throw lengthError();
  if (!translated) throw new Error("모델이 번역문을 반환하지 않았습니다.");
  return translated;
}
