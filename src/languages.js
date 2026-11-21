const codes = [
  "ar", "az", "be", "bg", "bn", "ca", "ceb", "de", "en", "es", "et", "eu", "fa",
  "fr", "gu", "he", "hi", "hr", "hu", "hy", "id", "it", "ja", "jv", "ka", "kk",
  "km", "ko", "lt", "lv", "ml", "mr", "ms", "my", "ne", "nl", "pa", "pl", "ru",
  "si", "sk", "sl", "sr", "sw", "ta", "te", "th", "tl", "ur", "uz", "vi",
  "zh-hans", "zh-hant"
];

const supported = new Set(codes);
const names = new Intl.DisplayNames("ko", { type: "language" });
const labels = { "zh-hans": "중국어 (간체)", "zh-hant": "중국어 (번체)", tl: "타갈로그어" };
const englishCues = new Set([
  "the", "you", "your", "yours", "her", "his", "our", "their", "they", "them", "hers",
  "are", "was", "were", "have", "has", "had", "does", "did", "will", "would",
  "should", "could", "what", "which", "where", "when", "whether", "whose", "how"
]);

export function languageName(code) {
  return labels[code] ?? names.of(code);
}

export const languages = codes.map(code => ({ code, name: languageName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, "ko"));

export function isSupportedLanguage(code) {
  return supported.has(code);
}

export function normalizeLanguage(code) {
  if (typeof code !== "string") return undefined;
  const [base, ...subtags] = code.toLowerCase().split("-");
  if (base === "zh") {
    return subtags.some(part => ["hant", "hk", "mo", "tw"].includes(part)) ? "zh-hant" : "zh-hans";
  }
  const aliases = { iw: "he", in: "id", jw: "jv", fil: "tl" };
  const normalized = aliases[base] ?? base;
  return supported.has(normalized) ? normalized : undefined;
}

export async function detectSourceLanguage(text) {
  const sample = text.slice(0, 4000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters > 0) {
    const kana = sample.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    const hangul = sample.match(/\p{Script=Hangul}/gu)?.length ?? 0;
    if (kana > letters / 4) return "ja";
    if (hangul > letters / 2) return "ko";
  }
  const result = await chrome.i18n.detectLanguage(sample).catch(() => undefined);
  const first = result?.languages?.[0];
  const detected = first?.percentage >= 55 ? normalizeLanguage(first.language) : undefined;
  if (detected && result.isReliable) return detected;
  if (!/\p{L}/u.test(sample.replace(/\p{Script=Latin}/gu, ""))) {
    const tokens = sample.toLowerCase().match(/[a-z]+/gu) ?? [];
    if (new Set(tokens.filter(word => englishCues.has(word))).size >= 2) return "en";
  }
  return detected;
}

export function automaticTargetLanguage(sourceLanguage, locale) {
  const preferred = normalizeLanguage(locale) ?? "ko";
  if (preferred !== sourceLanguage) return preferred;
  return sourceLanguage === "ko" ? "en" : "ko";
}
