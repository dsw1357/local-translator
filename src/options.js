const controls = [...document.querySelectorAll("fieldset")];
const wordHighlight = document.querySelector("[name=hoverWordHighlight]");
const status = document.querySelector("#status");

async function loadOptions() {
  const { displayMode, hoverWordHighlight } = await chrome.storage.local.get({
    displayMode: "page", hoverWordHighlight: true
  });
  document.querySelector(`[name="displayMode"][value="${displayMode === "tab" ? "tab" : "page"}"]`).checked = true;
  wordHighlight.checked = hoverWordHighlight !== false;
  for (const field of controls) field.disabled = false;
}

document.querySelector("main").addEventListener("change", async event => {
  for (const field of controls) field.disabled = true;
  try {
    await chrome.storage.local.set(event.target === wordHighlight
      ? { hoverWordHighlight: wordHighlight.checked }
      : { displayMode: event.target.value });
    status.textContent = "저장했습니다.";
  } catch {
    status.textContent = "설정을 저장하지 못했습니다.";
  }
  await loadOptions().catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
});

void loadOptions().catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
