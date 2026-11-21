import { engineContext } from "./engine.js";
import { CONTEXT_OPTIONS, DEFAULT_CONTEXT, DEFAULT_PAGE_LIMIT, MAX_MODEL_CONTEXT,
  MAX_PAGE_LIMIT, getTranslationSettings } from "./settings.js";

const controls = [...document.querySelectorAll("fieldset")];
const wordHighlight = document.querySelector("[name=hoverWordHighlight]");
const pageLimit = document.querySelector("[name=pageLimit]");
const contextTokens = document.querySelector("[name=contextTokens]");
const activeContext = document.querySelector("#engine-context");
const command = document.querySelector("#start-command");
const status = document.querySelector("#status");
const format = new Intl.NumberFormat("ko-KR");

pageLimit.min = DEFAULT_PAGE_LIMIT;
pageLimit.max = MAX_PAGE_LIMIT;
pageLimit.required = true;
document.querySelector("#max-context").textContent = format.format(MAX_MODEL_CONTEXT);
for (const value of CONTEXT_OPTIONS) {
  const label = value === DEFAULT_CONTEXT
    ? `${format.format(value)} 토큰 (기본값, 2슬롯)`
    : `${format.format(value)} 토큰 (1슬롯)`;
  contextTokens.add(new Option(label, value));
}

async function loadOptions() {
  const [{ displayMode, hoverWordHighlight }, settings] = await Promise.all([
    chrome.storage.local.get({ displayMode: "page", hoverWordHighlight: true }),
    getTranslationSettings()
  ]);
  document.querySelector(`[name="displayMode"][value="${displayMode === "tab" ? "tab" : "page"}"]`).checked = true;
  wordHighlight.checked = hoverWordHighlight !== false;
  pageLimit.value = settings.pageLimit;
  contextTokens.value = settings.contextTokens;
  command.textContent = settings.contextTokens === DEFAULT_CONTEXT
    ? "START.cmd" : `START.cmd -ContextTokens ${settings.contextTokens}`;
  for (const field of controls) field.disabled = false;
}

async function refreshEngineContext() {
  try {
    const { slotTokens, slots } = await engineContext();
    activeContext.textContent = `실행 중인 엔진은 요청당 ${format.format(slotTokens)} 토큰을 사용합니다.`;
    const selected = Number(contextTokens.value);
    if (selected === DEFAULT_CONTEXT ? slotTokens !== DEFAULT_CONTEXT / 2 || slots !== 2 : slotTokens !== selected) {
      activeContext.textContent += " 선택한 값으로 바꾸려면 엔진을 다시 시작하세요.";
    }
  } catch {
    activeContext.textContent = "실행 중인 엔진의 컨텍스트를 확인할 수 없습니다.";
  }
}

document.querySelector("main").addEventListener("change", async event => {
  const { target } = event;
  let update;
  if (target === wordHighlight) update = { hoverWordHighlight: target.checked };
  else if (target === contextTokens) update = { contextTokens: Number(target.value) };
  else if (target === pageLimit) {
    if (!pageLimit.checkValidity()) {
      status.textContent = `${format.format(DEFAULT_PAGE_LIMIT)}~${format.format(MAX_PAGE_LIMIT)}자 사이의 정수를 입력하세요.`;
      pageLimit.reportValidity();
      return;
    }
    update = { pageLimit: pageLimit.valueAsNumber };
  } else if (target.name === "displayMode") update = { displayMode: target.value };
  if (!update) return;
  for (const field of controls) field.disabled = true;
  try {
    await chrome.storage.local.set(update);
    status.textContent = "저장했습니다.";
  } catch {
    status.textContent = "설정을 저장하지 못했습니다.";
  }
  await loadOptions().catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
  if (target === contextTokens) void refreshEngineContext();
});

document.querySelector("#copy-command").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(command.textContent);
    status.textContent = "시작 명령을 복사했습니다.";
  } catch {
    status.textContent = "명령을 복사하지 못했습니다.";
  }
});
window.addEventListener("focus", () => { void refreshEngineContext(); });
void loadOptions().then(refreshEngineContext)
  .catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
