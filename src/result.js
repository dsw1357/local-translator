import { translate } from "./engine.js";
import "./text.js";
import "./hover.js";

const source = document.querySelector("#source");
const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const notice = document.querySelector("#notice");
const results = document.querySelector("#results");
const resume = document.querySelector("#resume");
const stop = document.querySelector("#stop");
const copy = document.querySelector("#copy");
const originals = new WeakMap();
globalThis.localTranslatorHover.previewElements(originals);

let chunks = [];
const translations = [];
let controller;

function appendResult(original, translated) {
  const item = document.createElement("article");
  const translation = document.createElement("p");
  translation.lang = "ko";
  translation.textContent = translated;
  translation.setAttribute("data-original-unit", "");
  originals.set(translation, { original, targetLanguage: "ko" });
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "원문 보기";
  const text = document.createElement("p");
  text.textContent = original;
  details.append(summary, text);
  item.append(translation, details);
  results.append(item);
}

async function run() {
  if (controller || !chunks.length) return;
  controller = new AbortController();
  const { signal } = controller;
  stop.disabled = false;
  resume.hidden = true;
  try {
    while (translations.length < chunks.length) {
      const index = translations.length;
      status.textContent = `${index + 1} / ${chunks.length} 번역 중…`;
      const original = chunks[index];
      const translated = await translate(original, signal);
      signal.throwIfAborted();
      translations.push(translated);
      appendResult(original, translated);
      progress.value = translations.length;
      copy.disabled = false;
    }
    status.textContent = `번역 완료 · ${chunks.length}개 구간`;
  } catch (error) {
    status.textContent = signal.aborted ? "번역을 멈췄습니다." : error.message;
    resume.textContent = translations.length ? "이어서 번역" : "다시 시도";
    resume.hidden = false;
  } finally {
    stop.disabled = true;
    controller = undefined;
  }
}

stop.addEventListener("click", () => controller?.abort());
resume.addEventListener("click", () => { void run(); });
copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(translations.join("\n\n"));
    copy.textContent = "복사됨";
  } catch {
    copy.textContent = "복사 실패";
  }
  setTimeout(() => { copy.textContent = "번역 복사"; }, 1400);
});

async function initialize() {
  const tab = await chrome.tabs.getCurrent();
  const key = `result:${tab.id}`;
  const result = (await chrome.storage.session.get(key))[key];
  if (!result || result.error) {
    status.textContent = result?.error ?? "번역할 웹페이지에서 우클릭 메뉴를 실행하세요.";
    return;
  }
  source.textContent = `${result.selection ? "선택한 텍스트" : "페이지 텍스트"} · ${result.title}`;
  if (!result.text) {
    status.textContent = "번역할 텍스트가 없습니다.";
    return;
  }
  if (result.truncated) {
    notice.textContent = "텍스트가 길어 처음 약 4만 자만 번역합니다.";
    notice.hidden = false;
  }
  chunks = globalThis.localTranslatorSentenceParts(result.text).map(part => part.text);
  progress.max = chunks.length;
  progress.hidden = false;
  await run();
}

void initialize().catch(error => { status.textContent = error.message; });
