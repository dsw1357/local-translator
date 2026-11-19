const controls = document.querySelector("fieldset");
const status = document.querySelector("#status");

async function loadOptions() {
  const { displayMode } = await chrome.storage.local.get({ displayMode: "page" });
  controls.querySelector(`[value="${displayMode === "tab" ? "tab" : "page"}"]`).checked = true;
  controls.disabled = false;
}

controls.addEventListener("change", async event => {
  controls.disabled = true;
  try {
    await chrome.storage.local.set({ displayMode: event.target.value });
    status.textContent = "저장했습니다.";
  } catch {
    status.textContent = "설정을 저장하지 못했습니다.";
  }
  await loadOptions().catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
});

void loadOptions().catch(() => { status.textContent = "설정을 불러오지 못했습니다."; });
