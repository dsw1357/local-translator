(() => {
  if (globalThis.localTranslationPageLoaded) return;
  globalThis.localTranslationPageLoaded = true;

  const MAX_PAGE_TEXT = 40_000;
  const EXCLUDED = [
    "script", "style", "noscript", "template", "svg", "textarea", "input", "select",
    "button", "code", "pre", "[hidden]", "[aria-hidden=true]", "[translate=no]"
  ].join(",");
  const changes = new Map();
  const { attachOriginalPreview, textRect, pointerCaret } = globalThis.localTranslatorHover;
  const sentenceParts = globalThis.localTranslatorSentenceParts;
  const hidePreview = attachOriginalPreview(locateOriginal);
  let panel;
  let active;

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== "translate-in-page" || sender.id !== chrome.runtime.id) return;
    showPanel();
    if (!active) void run(message.selection);
    reply(true);
  });

  function showPanel() {
    if (panel?.host.isConnected) return;
    const host = document.createElement("div");
    host.setAttribute("data-local-translation-panel", "");
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("top", "12px", "important");
    host.style.setProperty("right", "12px", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    const shadow = host.attachShadow({ mode: "open" });
    const styles = document.createElement("style");
    styles.textContent = `
      section { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif;
        color: CanvasText; background: Canvas; width: min(19rem, calc(100vw - 3.5rem));
        padding: .8rem 1rem; border-radius: .55rem;
        border: 1px solid color-mix(in srgb, CanvasText 22%, Canvas);
        box-shadow: 0 .25rem 1.25rem #0003; }
      [hidden] { display: none; }
      p { margin: .35rem 0; }
      .buttons { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .55rem; }
      button { font: inherit; padding: .24rem .65rem; cursor: pointer; }
    `;
    const section = document.createElement("section");
    section.lang = "ko";
    section.setAttribute("aria-label", "로컬 페이지 번역");
    const name = document.createElement("strong");
    name.textContent = "로컬 페이지 번역";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const stop = makeButton("멈춤", () => active?.abort());
    const restore = makeButton("원문으로 복원", () => {
      active?.abort();
      hidePreview();
      for (const [node, { original, translated }] of changes) {
        if (node.isConnected && node.data === translated) node.data = original;
      }
      changes.clear();
      panel.status.textContent = "원문을 복원했습니다.";
      updateButtons();
    });
    const close = makeButton("닫기", () => host.remove());
    buttons.append(stop, restore, close);
    section.append(name, status, buttons);
    shadow.append(styles, section);
    shadow.addEventListener("click", event => event.stopPropagation());
    document.documentElement.append(host);
    panel = { host, status, stop, restore, close };
    updateButtons();
  }

  function makeButton(label, click) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", click);
    return button;
  }

  function updateButtons() {
    panel.stop.hidden = !active || active.signal.aborted;
    panel.restore.hidden = changes.size === 0;
    panel.close.hidden = Boolean(active) && !active.signal.aborted;
  }

  function collect(selection) {
    const tasks = [];
    const selected = selection ? window.getSelection() : null;
    if (selection && (!selected?.rangeCount || selected.isCollapsed)) return { tasks, truncated: false };
    const range = selected?.getRangeAt(0);
    const root = document.body;
    if (!root) return { tasks, truncated: false };

    for (const [node, { translated }] of changes) {
      if (!node.isConnected || node.data !== translated) changes.delete(node);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node === panel.host || node.matches(EXCLUDED) || node.isContentEditable ||
            (range && !range.intersectsNode(node)) || getComputedStyle(node).display === "none") {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    let remaining = MAX_PAGE_TEXT;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const original = node.data;
      if (!original.trim() || changes.has(node) || (range && !range.intersectsNode(node))) continue;
      const parent = node.parentElement;
      if (parent.isContentEditable || parent.closest("[translate=no]") ||
          getComputedStyle(parent).visibility !== "visible") continue;
      const from = range?.startContainer === node ? range.startOffset : 0;
      const to = range?.endContainer === node ? range.endOffset : original.length;
      const scoped = original.slice(from, to);
      const text = scoped.trim();
      if (!/\p{L}/u.test(text.replace(/\p{Script=Hangul}/gu, ""))) continue;
      const start = from + scoped.length - scoped.trimStart().length;
      if (remaining === 0) return { tasks, truncated: true };
      const input = text.slice(0, remaining).replace(/[\uD800-\uDBFF]$/u, "");
      if (input) tasks.push({ node, original, start, end: start + input.length, input });
      if (input.length < text.length) return { tasks, truncated: true };
      remaining -= input.length;
    }
    return { tasks, truncated: false };
  }

  function locateOriginal({ clientX, clientY }) {
    if (changes.size === 0) return;
    const { node, offset } = pointerCaret(clientX, clientY);
    const change = changes.get(node);
    if (!change || node.data !== change.translated) return;
    const range = document.createRange();
    for (const unit of change.units) {
      if (offset < unit.start || offset > unit.end) continue;
      range.setStart(node, unit.start);
      range.setEnd(node, unit.end);
      const rect = textRect(range, clientX, clientY);
      if (rect) return { ...unit, rect, node, offset, targetLanguage: "ko", languageHint: document.documentElement.lang };
    }
  }

  async function translateText(input, signal, cache) {
    const units = [];
    let output = "";
    let lastEnd = 0;
    for (const unit of sentenceParts(input)) {
      output += input.slice(lastEnd, unit.start);
      let translated = unit.text;
      if (/\p{L}/u.test(unit.text.replace(/\p{Script=Hangul}/gu, ""))) {
        if (cache.has(unit.text)) {
          translated = cache.get(unit.text);
        } else {
          ({ translated } = await globalThis.localTranslatorRequestPort("translate-page-text", unit.text, signal));
        }
        cache.set(unit.text, translated);
      }
      if (translated !== unit.text) {
        units.push({ original: unit.text, start: output.length, end: output.length + translated.length });
      }
      output += translated;
      lastEnd = unit.end;
    }
    return { output: output + input.slice(lastEnd), units };
  }

  async function run(selection) {
    active = new AbortController();
    const { signal } = active;
    updateButtons();
    panel.status.textContent = "번역할 글을 찾는 중…";
    try {
      const { tasks, truncated } = collect(selection);
      if (!tasks.length) {
        panel.status.textContent = changes.size
          ? "추가로 번역할 텍스트가 없습니다."
          : "번역할 외국어 텍스트가 없습니다.";
        return;
      }
      const cache = new Map();
      for (let i = 0; i < tasks.length; i++) {
        const { node, original, start, end, input } = tasks[i];
        panel.status.textContent = `${i + 1} / ${tasks.length} 번역 중…`;
        if (!node.isConnected || node.data !== original) continue;
        const { output, units } = await translateText(input, signal, cache);
        signal.throwIfAborted();
        if (output && node.isConnected && node.data === original) {
          const translated = original.slice(0, start) + output + original.slice(end);
          if (translated !== original) {
            changes.set(node, {
              original, translated,
              units: units.map(unit => ({ ...unit, start: start + unit.start, end: start + unit.end }))
            });
            node.data = translated;
            updateButtons();
          }
        }
      }
      panel.status.textContent = truncated ? "처음 약 4만 자 번역 완료" : "번역 완료";
    } catch (error) {
      if (!signal.aborted) panel.status.textContent = error.message;
      else if (panel.status.textContent !== "원문을 복원했습니다.") {
        panel.status.textContent = "번역을 멈췄습니다. 다시 실행하면 남은 글을 번역합니다.";
      }
    } finally {
      active = undefined;
      updateButtons();
    }
  }
})();
