import { translate } from "./engine.js";
import { alignOriginalWord } from "./alignment.js";

const SELECTION = "translate-selection";
const PAGE = "translate-page";
const DOCUMENTS = ["https://*/*", "http://*/*"];
const MAX_TEXT = 40_000;
const ACTION_TITLE = "로컬 번역 열기";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: SELECTION,
      title: "선택한 텍스트를 한국어로 번역",
      contexts: ["selection"],
      documentUrlPatterns: DOCUMENTS
    });
    chrome.contextMenus.create({
      id: PAGE,
      title: "페이지를 한국어로 번역",
      contexts: ["page", "selection", "link", "image"],
      documentUrlPatterns: DOCUMENTS
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleMenuClick(info, tab).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "translate-active-tab" || sender.url !== chrome.runtime.getURL("popup.html")) return;
  translateActiveTab(message.tabId).then(reply, error => reply({ error: error.message }));
  return true;
});

async function translateActiveTab(tabId) {
  if (!Number.isInteger(tabId)) return { error: "번역할 페이지를 선택하세요." };
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) return { error: "번역할 페이지를 다시 선택하세요." };
  return (await startTranslation(tab)) ?? {};
}

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.remove(`result:${tabId}`).catch(console.error);
});

async function handleMenuClick(info, tab) {
  if (info.menuItemId === SELECTION) {
    await startTranslation(tab, { selection: info.selectionText ?? "", frameId: info.frameId ?? 0 });
  } else if (info.menuItemId === PAGE) {
    await startTranslation(tab);
  }
}

async function startTranslation(tab, { selection, frameId = 0 } = {}) {
  if (tab?.id == null) return;
  const tabId = tab.id;
  await chrome.action.setBadgeText({ tabId, text: "" });
  await chrome.action.setTitle({ tabId, title: ACTION_TITLE });
  const { displayMode } = await chrome.storage.local.get({ displayMode: "page" });
  if (displayMode === "tab") {
    await openResultTab(tab, selection);
    return;
  }

  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["hover.js", "text.js", "page.js"]
    });
    await chrome.tabs.sendMessage(tabId, {
      type: "translate-in-page", selection: selection !== undefined
    }, { documentId: frame.documentId });
  } catch {
    const error = "이 문서의 페이지 내 번역을 실행할 수 없습니다.";
    await chrome.action.setTitle({ tabId, title: error });
    await chrome.action.setBadgeText({ tabId, text: "!" });
    return { error };
  }
}

chrome.runtime.onConnect.addListener(port => {
  const isAlignment = port.name === "align-translation-word";
  const isPageTranslation = port.name === "translate-page-text" && Boolean(port.sender?.tab);
  if ((!isAlignment && !isPageTranslation) || port.sender?.id !== chrome.runtime.id) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async input => {
    let response;
    try {
      if (isAlignment) {
        response = { alignment: await alignOriginalWord(input, controller.signal) };
      } else {
        if (typeof input !== "string" || !input.trim() || input.length > 640) throw new Error("번역할 문장을 읽을 수 없습니다.");
        response = { translated: await translate(input, controller.signal, { timeout: 25_000 }) };
      }
    } catch (error) {
      response = { error: error.message };
    }
    if (!controller.signal.aborted) port.postMessage(response);
  });
});

async function openResultTab(tab, selection) {
  let result;
  try {
    let text = selection;
    if (text === undefined) {
      const [capture] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: limit => {
          const pageText = (document.body?.innerText ?? "").trim();
          return pageText.slice(0, limit + 1);
        },
        args: [MAX_TEXT]
      });
      text = capture?.result ?? "";
    }
    text = text.trim();
    const limited = text.slice(0, MAX_TEXT).replace(/[\uD800-\uDBFF]$/u, "");
    result = {
      title: tab.title || "웹페이지",
      selection: selection !== undefined,
      text: limited,
      truncated: text.length > MAX_TEXT
    };
  } catch {
    result = { error: "이 탭의 텍스트를 읽을 수 없습니다. 일반 웹페이지에서 실행하세요." };
  }

  const pendingTab = await chrome.tabs.create({ url: "about:blank", active: true });
  const key = `result:${pendingTab.id}`;
  try {
    await chrome.storage.session.set({ [key]: result });
    await chrome.tabs.update(pendingTab.id, { url: chrome.runtime.getURL("result.html") });
  } catch {
    await chrome.storage.session.remove(key);
    await chrome.tabs.update(pendingTab.id, { url: chrome.runtime.getURL("result.html#storage") }).catch(() => {});
  }
}
