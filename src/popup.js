import { translate } from "./engine.js";
import { automaticTargetLanguage, detectSourceLanguage, isSupportedLanguage, languageName, languages } from "./languages.js";
import "./hover.js";
import "./text.js";

const form = document.querySelector("form");
const source = document.querySelector("#source");
const sourceLanguage = document.querySelector("#source-language");
const targetLanguage = document.querySelector("#target-language");
const detected = document.querySelector("#detected");
const output = document.querySelector("#output");
const status = document.querySelector("#status");
const submit = document.querySelector("#translate");
const copy = document.querySelector("#copy");
const page = document.querySelector("#translate-page");
const languageControls = [
  { select: sourceLanguage, pin: document.querySelector("#pin-source"), preference: "popupSourceLanguage",
    pinsKey: "popupPinnedSourceLanguages", fallback: "auto", autoLabel: "자동 감지" },
  { select: targetLanguage, pin: document.querySelector("#pin-target"), preference: "popupTargetLanguage",
    pinsKey: "popupPinnedTargetLanguages", fallback: "ko", autoLabel: "자동 선택" }
];
const originals = new WeakMap();
const hidePreview = globalThis.localTranslatorHover.previewElements(originals);
let tabId;
let controller;

function setStatus(message, error = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", error);
}

function clearOutput() {
  hidePreview();
  copy.disabled = true;
  output.removeAttribute("lang");
  const placeholder = document.createElement("span");
  placeholder.className = "placeholder";
  placeholder.textContent = "번역 결과가 여기에 표시됩니다.";
  output.replaceChildren(placeholder);
}

function reset() {
  controller?.abort();
  detected.textContent = "";
  clearOutput();
  setStatus("");
  submit.disabled = !source.value.trim();
}

async function run() {
  if (controller) {
    controller.abort();
    return;
  }
  const text = source.value.trim();
  if (!text || sourceLanguage.disabled || targetLanguage.disabled) return;
  const choice = { source: sourceLanguage.value, target: targetLanguage.value };
  controller = new AbortController();
  const { signal } = controller;
  submit.textContent = "중지";
  clearOutput();
  setStatus("번역 중…");
  try {
    const input = choice.source === "auto" ? await detectSourceLanguage(text) : choice.source;
    signal.throwIfAborted();
    if (choice.source === "auto") {
      detected.textContent = input ? `${languageName(input)} 감지` : "모델이 원문 언어를 판단합니다.";
    }
    const target = choice.target === "auto"
      ? automaticTargetLanguage(input, chrome.i18n.getUILanguage())
      : choice.target;
    output.lang = target;
    output.replaceChildren();
    const parts = globalThis.localTranslatorSentenceParts(text);
    const sameLanguage = choice.source !== "auto" && input === target;
    let lastEnd = 0;
    for (const [index, part] of parts.entries()) {
      setStatus(parts.length > 1 ? `${index + 1} / ${parts.length} 번역 중…` : "번역 중…");
      const translated = sameLanguage || !/\p{L}/u.test(part.text)
        ? part.text
        : await translate(part.text, signal, { sourceLanguage: choice.source === "auto" ? undefined : input, targetLanguage: target });
      signal.throwIfAborted();
      const unit = document.createElement("span");
      unit.setAttribute("data-original-unit", "");
      unit.textContent = translated;
      originals.set(unit, {
        original: part.text,
        sourceLanguage: choice.source === "auto" ? undefined : input,
        targetLanguage: target,
        languageHint: input
      });
      output.append(text.slice(lastEnd, part.start), unit);
      lastEnd = part.end;
      copy.disabled = false;
    }
    output.append(text.slice(lastEnd));
    setStatus(`${languageName(target)} · 번역 완료`);
  } catch (error) {
    if (!output.textContent) clearOutput();
    const sameInput = text === source.value.trim() && choice.source === sourceLanguage.value && choice.target === targetLanguage.value;
    if (sameInput) {
      setStatus(signal.aborted ? "번역을 멈췄습니다." : error.message, !signal.aborted);
    }
  } finally {
    controller = undefined;
    submit.textContent = "번역";
    submit.disabled = !source.value.trim();
  }
}

form.addEventListener("submit", event => {
  event.preventDefault();
  void run();
});
source.addEventListener("input", reset);
source.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
    event.preventDefault();
    void run();
  }
});
function renderLanguages(control, selected) {
  const { select, pinned, autoLabel } = control;
  select.replaceChildren();
  if (pinned.length) {
    const group = document.createElement("optgroup");
    group.label = "상단 고정";
    group.append(...pinned.map(code => new Option(languageName(code), code)));
    select.append(group);
  }
  select.append(new Option(autoLabel, "auto"));
  select.append(...languages.filter(({ code }) => !pinned.includes(code))
    .map(({ code, name }) => new Option(name, code)));
  select.value = selected;
  updatePin(control);
}

function updatePin({ pin, select, pinned, saving }) {
  const active = pinned.includes(select.value);
  pin.disabled = Boolean(saving) || !isSupportedLanguage(select.value);
  pin.textContent = active ? "고정 해제" : "고정";
  pin.title = active ? "이 언어의 상단 고정 해제" : "이 언어를 목록 상단에 고정";
  pin.setAttribute("aria-pressed", String(active));
}

for (const control of languageControls) {
  const { select, pin, preference, pinsKey } = control;
  select.addEventListener("change", () => {
    reset();
    updatePin(control);
    void chrome.storage.local.set({ [preference]: select.value }).catch(console.error);
  });
  pin.addEventListener("click", async () => {
    const code = select.value;
    if (control.saving || !isSupportedLanguage(code)) return;
    control.saving = true;
    updatePin(control);
    const pinned = control.pinned.includes(code)
      ? control.pinned.filter(value => value !== code)
      : [code, ...control.pinned];
    try {
      await chrome.storage.local.set({ [pinsKey]: pinned });
      control.pinned = pinned;
      renderLanguages(control, select.value);
    } catch {
      setStatus("언어 고정을 저장하지 못했습니다.", true);
    } finally {
      control.saving = false;
      updatePin(control);
    }
  });
}
copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    setStatus("번역한 글을 복사했습니다.");
  } catch {
    setStatus("복사할 수 없습니다. 번역한 글을 선택해 복사하세요.", true);
  }
});
page.addEventListener("click", async () => {
  page.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "translate-active-tab", tabId });
    if (response?.error) throw new Error(response.error);
    window.close();
  } catch (error) {
    setStatus(error.message, true);
    page.disabled = false;
  }
});
document.querySelector("#options").addEventListener("click", () => void chrome.runtime.openOptionsPage());

async function initialize() {
  const [stored, tabs] = await Promise.all([
    chrome.storage.local.get(Object.fromEntries(languageControls.flatMap(
      control => [[control.preference, control.fallback], [control.pinsKey, []]]
    ))),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  for (const control of languageControls) {
    const saved = stored[control.preference];
    const pinned = stored[control.pinsKey];
    control.pinned = Array.isArray(pinned) ? [...new Set(pinned.filter(isSupportedLanguage))] : [];
    renderLanguages(control, saved === "auto" || isSupportedLanguage(saved) ? saved : control.fallback);
    control.select.disabled = false;
  }
  const tab = tabs[0];
  tabId = tab?.id;
  page.disabled = !Number.isInteger(tabId) || !/^https?:/iu.test(tab.url ?? "");
}

void initialize().catch(error => setStatus(error.message, true));
