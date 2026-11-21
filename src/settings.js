export const DEFAULT_PAGE_LIMIT = 40_000;
export const MAX_PAGE_LIMIT = 200_000;
export const DEFAULT_CONTEXT = 8_192;
export const MAX_MODEL_CONTEXT = 32_768;
export const CONTEXT_OPTIONS = [DEFAULT_CONTEXT, 16_384, MAX_MODEL_CONTEXT];
export const LENGTH_ERROR = "번역 응답이 최대 길이에 도달했습니다.";

export function chunkLimit(contextTokens) {
  return contextTokens === DEFAULT_CONTEXT ? 640 : contextTokens / 4;
}

export async function getTranslationSettings() {
  const settings = await chrome.storage.local.get({
    pageLimit: DEFAULT_PAGE_LIMIT, contextTokens: DEFAULT_CONTEXT
  });
  return {
    pageLimit: Number.isInteger(settings.pageLimit) &&
      settings.pageLimit >= DEFAULT_PAGE_LIMIT && settings.pageLimit <= MAX_PAGE_LIMIT
      ? settings.pageLimit : DEFAULT_PAGE_LIMIT,
    contextTokens: CONTEXT_OPTIONS.includes(settings.contextTokens) ? settings.contextTokens : DEFAULT_CONTEXT
  };
}
