(() => {
  const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const wordSegmenters = new Map();

  function sentenceParts(text, maxLength = 640) {
    const parts = [];
    for (const { segment, index } of sentenceSegmenter.segment(text)) {
      let offset = 0;
      while (offset < segment.length) {
        let end = Math.min(offset + maxLength, segment.length);
        if (end < segment.length) {
          const space = segment.lastIndexOf(" ", end - 1);
          if (space > offset + maxLength / 2) end = space + 1;
          if (/[\uD800-\uDBFF]/u.test(segment[end - 1])) end--;
        }
        const slice = segment.slice(offset, end);
        const trimmed = slice.trim();
        if (trimmed) {
          const start = index + offset + slice.length - slice.trimStart().length;
          parts.push({ text: trimmed, start, end: start + trimmed.length });
        }
        offset = end;
      }
    }
    return parts;
  }

  function words(text, language) {
    if (!wordSegmenters.has(language)) {
      wordSegmenters.set(language, new Intl.Segmenter(language, { granularity: "word" }));
    }
    return Array.from(wordSegmenters.get(language).segment(text))
      .filter(part => part.isWordLike)
      .map(({ segment, index }) => ({ text: segment, start: index, end: index + segment.length }));
  }

  function requestPort(name, payload, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name });
      function finish(error, response) {
        signal.removeEventListener("abort", abort);
        port.onDisconnect.removeListener(disconnected);
        port.disconnect();
        if (error) reject(error);
        else resolve(response);
      }
      function abort() { finish(signal.reason); }
      function disconnected() {
        void chrome.runtime.lastError;
        finish(new Error("번역 연결이 끊겼습니다. 다시 실행하세요."));
      }
      signal.addEventListener("abort", abort, { once: true });
      port.onDisconnect.addListener(disconnected);
      port.onMessage.addListener(response => finish(response.error ? new Error(response.error) : null, response));
      port.postMessage(payload);
    });
  }

  globalThis.localTranslatorSentenceParts = sentenceParts;
  globalThis.localTranslatorWords = words;
  globalThis.localTranslatorRequestPort = requestPort;
})();
