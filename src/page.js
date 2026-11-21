(() => {
  if (globalThis.localTranslationPageLoaded) return;
  globalThis.localTranslationPageLoaded = true;

  const LENGTH_MESSAGE = "번역 응답이 최대 길이에 도달했습니다.";
  const RESTORED_MESSAGE = "원문을 복원했습니다.";
  const EXCLUDED = [
    "script", "style", "noscript", "template", "svg", "textarea", "input", "select",
    "button", "code", "pre", "[hidden]", "[aria-hidden=true]", "[translate=no]"
  ].join(",");
  const changes = new Map();
  const { attachOriginalPreview, textRect, pointerCaret } = globalThis.localTranslatorHover;
  const translationParts = globalThis.localTranslatorParts;
  const sentenceParts = globalThis.localTranslatorSentenceParts;
  const hidePreview = attachOriginalPreview(locateOriginal);
  let panel;
  let active;
  let continuation;

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== "translate-in-page" || sender.id !== chrome.runtime.id) return;
    showPanel();
    if (!active && !(continuation && !continuation.scope && !message.selection &&
        continuation.pageLimit === message.pageLimit && continuation.contextTokens === message.contextTokens)) {
      if (continuation) restoreChanges();
      continuation = undefined;
      const selection = message.selection ? window.getSelection() : null;
      let scope = message.selection ? {} : undefined;
      if (selection?.rangeCount && !selection.isCollapsed) {
        const { startContainer, startOffset, endContainer, endOffset } = selection.getRangeAt(0);
        scope = { startContainer, startOffset, endContainer, endOffset };
      }
      void run({ scope, pageLimit: message.pageLimit ?? 40_000,
        contextTokens: message.contextTokens ?? 8192, chunkLength: message.chunkLength ?? 640 });
    }
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
        color: CanvasText; background: Canvas; width: min(21rem, calc(100vw - 3.5rem));
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
    status.textContent = panel?.status.textContent ?? "";
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    const stop = makeButton("멈춤", () => active?.abort());
    const restore = makeButton("원문으로 복원", () => {
      active?.abort();
      continuation = undefined;
      restoreChanges();
      panel.status.textContent = RESTORED_MESSAGE;
      updateButtons();
    });
    const next = makeButton("남은 페이지 번역", resumeRemaining);
    const close = makeButton("닫기", () => host.remove());
    buttons.append(stop, restore, next, close);
    section.append(name, status, buttons);
    shadow.append(styles, section);
    shadow.addEventListener("click", event => event.stopPropagation());
    document.documentElement.append(host);
    panel = { host, status, stop, restore, next, close };
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
    panel.restore.hidden = changes.size === 0 && !continuation;
    panel.next.hidden = !continuation || Boolean(active);
    panel.close.hidden = Boolean(active) && !active.signal.aborted;
  }

  function restoreChanges() {
    hidePreview();
    for (const [node, { original, translated }] of changes) {
      if (node.isConnected && node.data === translated) node.data = original;
    }
    changes.clear();
  }

  function resumeRemaining() {
    if (active || !continuation) return;
    const next = continuation;
    const { node, original } = next.cursor;
    const change = changes.get(node);
    if (!document.body?.contains(node) || node.data !== (change?.translated ?? original)) {
      continuation = undefined;
      panel.status.textContent = "페이지 내용이 바뀌었습니다. 번역 메뉴를 다시 실행하세요.";
      updateButtons();
      return;
    }
    continuation = undefined;
    const previous = new Map(changes);
    restoreChanges();
    void run(next, previous);
  }

  function collect({ scope, cursor, pageLimit }) {
    const tasks = [];
    const root = document.body;
    if (!root) return { tasks };
    let range;
    if (scope) {
      if (!scope.startContainer?.isConnected || !scope.endContainer?.isConnected) return { tasks };
      range = document.createRange();
      range.setStart(scope.startContainer, scope.startOffset);
      range.setEnd(scope.endContainer, scope.endOffset);
      if (range.collapsed) return { tasks };
    }

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
    if (cursor) walker.currentNode = cursor.node;
    let remaining = pageLimit;
    for (let node = cursor?.node ?? walker.nextNode(); node; node = walker.nextNode()) {
      const original = node.data;
      if (!original.trim() || changes.has(node) || (range && !range.intersectsNode(node))) continue;
      const parent = node.parentElement;
      if (parent.isContentEditable || parent.closest("[translate=no]") ||
          getComputedStyle(parent).visibility !== "visible") continue;
      const from = Math.max(range?.startContainer === node ? range.startOffset : 0,
        cursor?.node === node ? cursor.offset : 0);
      const to = range?.endContainer === node ? range.endOffset : original.length;
      const scoped = original.slice(from, to);
      const text = scoped.trim();
      if (!needsTranslation(text)) continue;
      const start = from + scoped.length - scoped.trimStart().length;
      let input = text.slice(0, remaining).replace(/[\uD800-\uDBFF]$/u, "");
      if (input && input.length < text.length) {
        const tailStart = Math.max(0, input.length - 160);
        const boundaries = [...input.slice(tailStart).matchAll(/[.!?。！？](?=\s|$)/gu)];
        const sentenceEnd = boundaries.at(-1);
        if (sentenceEnd) input = input.slice(0, tailStart + sentenceEnd.index + 1);
        else if (!/\s/u.test(text[input.length]) && !/\s/u.test(input.at(-1))) {
          const wordEnd = input.lastIndexOf(" ");
          if (wordEnd > tailStart) input = input.slice(0, wordEnd);
        }
      }
      if (input) tasks.push({ node, original, start, input });
      if (input.length < text.length) return { tasks, next: { node, original, offset: start + input.length } };
      remaining -= input.length;
    }
    return { tasks };
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

  function needsTranslation(text) {
    return /\p{L}/u.test(text.replace(/\p{Script=Hangul}/gu, ""));
  }

  async function translateUnit(text, contextTokens, signal, cache, recoverLength, rejected) {
    signal.throwIfAborted();
    if (!needsTranslation(text)) return { translated: text, skipped: 0 };
    if (cache.has(text)) return cache.get(text);
    if (!rejected || !text.startsWith(rejected)) {
      try {
        const { translated } = await globalThis.localTranslatorRequestPort("translate-page-text",
          { text, contextTokens }, signal);
        const result = { translated, skipped: 0 };
        cache.set(text, result);
        return result;
      } catch (error) {
        if (error.code !== "translation-length" || !recoverLength) throw error;
      }
    }

    const parts = sentenceParts(text, Math.max(2, Math.floor(text.length / 2)));
    let result = { translated: text, skipped: 1 };
    if (parts.length > 1) {
      let translated = "";
      let offset = 0;
      let skipped = 0;
      for (const part of parts) {
        const next = await translateUnit(part.text, contextTokens, signal, cache, true);
        translated += text.slice(offset, part.start) + next.translated;
        offset = part.end;
        skipped += next.skipped;
      }
      result = { translated: translated + text.slice(offset), skipped };
    }
    cache.set(text, result);
    return result;
  }

  async function translateText(input, { contextTokens, chunkLength, cursor }, signal, cache, rejected) {
    const units = [];
    let output = "";
    let lastEnd = 0;
    let skipped = 0;
    for (const unit of translationParts(input, chunkLength)) {
      output += input.slice(lastEnd, unit.start);
      let result;
      try {
        result = await translateUnit(unit.text, contextTokens, signal, cache, Boolean(cursor), rejected);
      } catch (error) {
        if (error.code !== "translation-length") throw error;
        return { output, units, consumed: unit.start, rejected: unit.text, skipped };
      }
      rejected = undefined;
      if (result.translated !== unit.text) {
        units.push({ original: unit.text, start: output.length, end: output.length + result.translated.length });
      }
      output += result.translated;
      skipped += result.skipped;
      lastEnd = unit.end;
    }
    return { output: output + input.slice(lastEnd), units, consumed: input.length, skipped };
  }

  async function run(job, previous) {
    active = new AbortController();
    const { signal } = active;
    updateButtons();
    panel.status.textContent = "번역할 글을 찾는 중…";
    let retryCursor = job.cursor;
    let skipped = 0;
    try {
      const { tasks, next } = collect(job);
      if (!tasks.length) {
        panel.status.textContent = changes.size
          ? "추가로 번역할 텍스트가 없습니다."
          : "번역할 외국어 텍스트가 없습니다.";
        return;
      }
      const cache = new Map();
      for (let i = 0; i < tasks.length; i++) {
        const { node, original, start, input } = tasks[i];
        panel.status.textContent = `${i + 1} / ${tasks.length} 번역 중…`;
        if (!node.isConnected || node.data !== original) continue;
        const rejected = job.cursor?.node === node && start === job.cursor.offset ? job.rejected : undefined;
        retryCursor = { node, original, offset: start };
        const result = await translateText(input, job, signal, cache, rejected);
        signal.throwIfAborted();
        if (!node.isConnected || node.data !== original) continue;
        const { output, units, consumed, rejected: pendingText } = result;
        skipped += result.skipped;
        if (output) {
          const translated = original.slice(0, start) + output + original.slice(start + consumed);
          if (translated !== original) {
            changes.set(node, {
              original, translated,
              units: units.map(unit => ({ ...unit, start: start + unit.start, end: start + unit.end }))
            });
            node.data = translated;
            updateButtons();
          }
        }
        if (pendingText) {
          continuation = { ...job, cursor: { node, original, offset: start + consumed }, rejected: pendingText };
          panel.status.textContent = LENGTH_MESSAGE;
          return;
        }
      }
      if (next) continuation = { ...job, cursor: next, rejected: undefined };
      if (next && !job.cursor) {
        panel.status.textContent = LENGTH_MESSAGE;
      } else if (next) {
        panel.status.textContent = "다음 구간 처리 완료. 아직 처리할 글이 남아 있습니다.";
      } else if (job.cursor && changes.size === 0) {
        panel.status.textContent = "이번 구간에서 바뀐 번역이 없습니다.";
      } else {
        panel.status.textContent = "번역 완료";
      }
      if (skipped) panel.status.textContent += ` 길이 제한에 걸린 ${skipped}개 구간을 원문으로 남겼습니다.`;
    } catch (error) {
      if (panel.status.textContent !== RESTORED_MESSAGE) {
        if (job.cursor && retryCursor) {
          continuation = { ...job, cursor: retryCursor,
            rejected: retryCursor.node === job.cursor.node && retryCursor.offset === job.cursor.offset ? job.rejected : undefined };
        }
        panel.status.textContent = signal.aborted ? "번역을 멈췄습니다." : error.message;
      }
    } finally {
      if (previous && changes.size === 0 && panel.status.textContent !== RESTORED_MESSAGE) {
        for (const [node, change] of previous) {
          if (node.isConnected && node.data === change.original) {
            node.data = change.translated;
            changes.set(node, change);
          }
        }
      }
      active = undefined;
      updateButtons();
    }
  }
})();
