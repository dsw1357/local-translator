(() => {
  function attachOriginalPreview(locate) {
    let host;
    let content;
    let markers;
    let pendingFrame = 0;
    let point;
    let highlight = true;
    let activeWord;
    const cache = new Map();
    const words = globalThis.localTranslatorWords;
    const requestPort = globalThis.localTranslatorRequestPort;

    function clearWord() {
      if (!activeWord) return;
      clearTimeout(activeWord.timer);
      activeWord.controller.abort();
      if (content) content.textContent = activeWord.original;
      markers?.replaceChildren();
      activeWord = undefined;
    }

    function updateSetting(value) {
      highlight = value !== false;
      if (!highlight) clearWord();
    }

    void chrome.storage.local.get({ hoverWordHighlight: true })
      .then(settings => updateSetting(settings.hoverWordHighlight)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.hoverWordHighlight) {
        updateSetting(changes.hoverWordHighlight.newValue);
      }
    });

    function hide() {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      clearWord();
      if (host) host.style.setProperty("display", "none", "important");
    }

    function show({ original, rect }, x) {
      if (!host?.isConnected) {
        host = document.createElement("div");
        host.setAttribute("data-local-translation-original", "");
        host.style.setProperty("all", "initial", "important");
        host.style.setProperty("position", "fixed", "important");
        host.style.setProperty("z-index", "2147483647", "important");
        host.style.setProperty("pointer-events", "none", "important");
        host.setAttribute("aria-hidden", "true");
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
          .bubble { box-sizing: border-box; width: max-content; max-width: min(34rem, calc(100vw - 16px));
            max-height: calc(100vh - 16px); overflow: hidden; padding: 8px 12px; border-radius: 7px;
            background: #18332f; color: #f4fbf8; border: 1px solid #53766c;
            box-shadow: 0 6px 20px #0003; font: 13px/1.55 system-ui, sans-serif; }
          .label { display: block; color: #b5dfcf; font-size: 11px; font-weight: 650; }
          p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
          mark { color: #322914; background: #ffd77b; border-radius: 2px; }
          .marker { position: fixed; border-radius: 2px; background: #f4b43655;
            box-shadow: inset 0 -1px #b47722b0; }
        `;
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = "원문";
        content = document.createElement("p");
        content.dir = "auto";
        bubble.append(label, content);
        markers = document.createElement("div");
        markers.className = "markers";
        shadow.append(style, markers, bubble);
        document.documentElement.append(host);
      }
      if (content.textContent !== original) content.textContent = original;
      host.style.setProperty("display", "block", "important");
      const bubble = host.getBoundingClientRect();
      const left = Math.max(8, Math.min(x - bubble.width / 2, innerWidth - bubble.width - 8));
      const above = rect.top - bubble.height - 7;
      const below = rect.bottom + 7;
      const top = above >= 8 ? above : Math.max(8, Math.min(below, innerHeight - bubble.height - 8));
      host.style.setProperty("left", `${left}px`, "important");
      host.style.setProperty("top", `${top}px`, "important");
    }

    function markOriginal(original, alignment) {
      if (!alignment || alignment.start < 0 || alignment.end > original.length ||
          alignment.end <= alignment.start) return;
      const mark = document.createElement("mark");
      mark.textContent = original.slice(alignment.start, alignment.end);
      content.replaceChildren(original.slice(0, alignment.start), mark, original.slice(alignment.end));
    }

    function markWord(match, x, y) {
      const { node, start, end, offset, original, targetLanguage, sourceLanguage, languageHint } = match;
      if (!highlight) return;
      const translated = node.data.slice(start, end);
      const range = document.createRange();
      const word = words(translated, targetLanguage).find(({ start: from, end: to }) => {
        if (offset < start + from || offset > start + to) return false;
        range.setStart(node, start + from);
        range.setEnd(node, start + to);
        return textRect(range, x, y);
      });
      if (!word) {
        clearWord();
        return;
      }

      const key = JSON.stringify([original, translated, word.start, word.end, targetLanguage, sourceLanguage, languageHint]);
      if (activeWord?.key === key && activeWord.node === node && activeWord.start === start) return;
      clearWord();
      const request = { key, node, start, original, controller: new AbortController() };
      activeWord = request;
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const marker = document.createElement("span");
        marker.className = "marker";
        for (const property of ["left", "top", "width", "height"]) {
          marker.style.setProperty(property, `${rect[property]}px`);
        }
        markers.append(marker);
      }
      if (cache.has(key)) {
        markOriginal(original, cache.get(key));
        return;
      }
      request.timer = setTimeout(async () => {
        try {
          const { alignment } = await requestPort("align-translation-word", {
            original, translated, start: word.start, end: word.end, targetLanguage, sourceLanguage, languageHint
          }, request.controller.signal);
          if (activeWord !== request) return;
          if (cache.size >= 128) cache.delete(cache.keys().next().value);
          cache.set(key, alignment);
          markOriginal(original, alignment);
        } catch {
          // The translated word stays marked when the local engine cannot align the original.
        }
      }, 110);
    }

    document.addEventListener("pointermove", event => {
      if (event.pointerType === "touch") return;
      point = event;
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        const match = locate(point);
        if (!match) {
          hide();
          return;
        }
        if (activeWord && activeWord.original !== match.original) clearWord();
        show(match, point.clientX);
        markWord(match, point.clientX, point.clientY);
      });
    }, { capture: true, passive: true });
    document.addEventListener("pointerout", event => {
      if (!event.relatedTarget) hide();
    }, { capture: true, passive: true });
    document.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
    return hide;
  }

  function textRect(range, x, y) {
    return Array.from(range.getClientRects()).find(rect =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  function pointerCaret(x, y) {
    const caret = document.caretPositionFromPoint?.(x, y) ?? document.caretRangeFromPoint?.(x, y);
    return { node: caret?.offsetNode ?? caret?.startContainer, offset: caret?.offset ?? caret?.startOffset };
  }

  function previewElements(originals) {
    return attachOriginalPreview(event => {
      const match = event.target instanceof Element && event.target.closest("[data-original-unit]");
      const passage = match && originals.get(match);
      if (!passage) return;
      const { node, offset } = pointerCaret(event.clientX, event.clientY);
      if (node !== match.firstChild) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = textRect(range, event.clientX, event.clientY);
      if (rect) return { ...passage, rect, node, offset, start: 0, end: node.length };
    });
  }

  globalThis.localTranslatorHover = { attachOriginalPreview, previewElements, textRect, pointerCaret };
})();
