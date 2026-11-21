import { translate } from "./engine.js";
import { detectSourceLanguage, isSupportedLanguage, normalizeLanguage } from "./languages.js";
import "./text.js";

const words = globalThis.localTranslatorWords;
const articles = {
  en: ["a", "an", "the"],
  es: ["el", "la", "los", "las", "un", "una"],
  fr: ["le", "la", "les", "un", "une"],
  de: ["der", "die", "das", "ein", "eine"]
};
const digits = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const englishFunctionWords = new Set([
  "a", "an", "the", "i", "he", "she", "it", "we", "you", "they", "me", "him", "her",
  "us", "them", "my", "your", "his", "its", "our", "their", "this", "that", "these",
  "those", "is", "am", "are", "was", "were", "be", "been", "being", "do", "does",
  "did", "would", "could", "should", "will", "can", "may", "might", "to", "of",
  "in", "on", "at", "for", "from", "by", "with", "as", "and", "or", "some"
]);

function fold(text, language) {
  const value = text.normalize("NFKC").toLowerCase().replaceAll("’", "'");
  if (language !== "en") return value;
  const index = digits.indexOf(value);
  return index < 0 ? value : String(index);
}

function tokenize(text, language) {
  return words(text, language).map(word => ({ ...word, folded: fold(word.text, language) }));
}

function rangeFrom(tokens, start, count) {
  return { start: tokens[start].start, end: tokens[start + count - 1].end };
}

function sameEnglishForm(left, right) {
  if (left === right) return true;
  const [base, plural] = left.length < right.length ? [left, right] : [right, left];
  if (!/^[a-z]{4,}$/u.test(base)) return false;
  if (/[^aeiou]y$/u.test(base)) return plural === base.slice(0, -1) + "ies";
  if (/(?:s|x|z|sh|ch)$/u.test(base)) return plural === base + "es";
  return plural === base + "s";
}

function findUnique(tokens, phrase, equivalent = (left, right) => left === right) {
  if (!phrase.length) return null;
  let match = null;
  for (let index = 0; index <= tokens.length - phrase.length; index++) {
    if (!phrase.every((word, offset) => equivalent(word.folded, tokens[index + offset].folded))) continue;
    if (match) return null;
    match = rangeFrom(tokens, index, phrase.length);
  }
  return match;
}

function findPhrase(tokens, text, language) {
  const phrase = tokenize(text, language);
  if (phrase.length > 1 && articles[language]?.includes(phrase[0].folded)) phrase.shift();
  const exact = findUnique(tokens, phrase)
    ?? (language === "en" ? findUnique(tokens, phrase, sameEnglishForm) : null);
  if (exact) return exact;
  const numbers = phrase.filter(word => /^\p{N}+$/u.test(word.folded));
  return numbers.length === 1 ? findUnique(tokens, numbers) : null;
}

function findBetween(tokens, before, after, language) {
  const left = tokenize(before, language).at(-1)?.folded;
  const right = tokenize(after, language)[0]?.folded;
  if (!left || !right) return null;
  let match = null;
  for (let start = 0; start < tokens.length - 2; start++) {
    if (tokens[start].folded !== left) continue;
    for (let end = start + 2; end < Math.min(start + 5, tokens.length); end++) {
      if (tokens[end].folded !== right) continue;
      if (match) return null;
      match = rangeFrom(tokens, start + 1, end - start - 1);
    }
  }
  return match;
}

function markRange(text, start, end) {
  return text.slice(0, start) + "【" + text.slice(start, end) + "】" + text.slice(end);
}

function readMark(text) {
  const marks = Array.from(text.matchAll(/【([^【】]+)】/gu));
  if (marks.length !== 1) return null;
  const [mark, candidate] = marks[0];
  const start = marks[0].index;
  return { candidate, before: text.slice(0, start), after: text.slice(start + mark.length) };
}

function singleEnglishContentWord(text) {
  const terms = tokenize(text, "en").filter(word => !englishFunctionWords.has(word.folded));
  return terms.length === 1 ? terms[0] : null;
}

async function matchNearbyPhrase(tokens, request, options, signal) {
  const { translated, start, end, targetLanguage } = request;
  const units = words(translated, targetLanguage);
  const index = units.findIndex(unit => unit.start === start && unit.end === end);
  if (index < 0) return null;

  for (const neighbor of [units[index + 1], units[index - 1]]) {
    if (!neighbor) continue;
    const gap = neighbor.start >= end ? translated.slice(end, neighbor.start) : translated.slice(neighbor.end, start);
    if (gap.trim()) continue;
    const first = Math.min(start, neighbor.start);
    const last = Math.max(end, neighbor.end);
    if (last - first > 120) continue;
    const marked = readMark(await translate(markRange(translated, first, last), signal, options));
    if (!marked) continue;

    const phrase = translated.slice(first, last);
    const direct = await translate(phrase, signal, options);
    const contextualMatch = findPhrase(tokens, marked.candidate, options.targetLanguage);
    const directMatch = findPhrase(tokens, direct, options.targetLanguage);
    let match = contextualMatch && directMatch &&
      contextualMatch.start === directMatch.start && contextualMatch.end === directMatch.end
      ? contextualMatch : null;
    if (!match && options.targetLanguage === "en") {
      const contextWord = singleEnglishContentWord(marked.candidate);
      const directWord = singleEnglishContentWord(direct);
      if (contextWord && directWord && sameEnglishForm(contextWord.folded, directWord.folded)) {
        match = findUnique(tokens, [contextWord], sameEnglishForm);
      }
    }
    if (!match) continue;
    const neighborOnly = await translate(neighbor.text, signal, options);
    const neighborMatch = findPhrase(tokens, neighborOnly, options.targetLanguage);
    if (neighborMatch && match.start >= neighborMatch.start && match.end <= neighborMatch.end) continue;
    return match;
  }
  return null;
}

async function matchMarkedWord(tokens, request, options, signal) {
  const { original, translated, start, end, targetLanguage } = request;
  const input = options.targetLanguage;
  const marked = readMark(await translate(markRange(translated, start, end), signal, options));
  if (!marked) return null;
  const exact = findPhrase(tokens, marked.candidate, input);
  if (exact) return exact;
  const between = findBetween(tokens, marked.before, marked.after, input);
  if (!between || /[【】]/u.test(original)) return null;

  const reaffirmed = readMark(await translate(markRange(original, between.start, between.end), signal, {
    sourceLanguage: input, targetLanguage, timeout: options.timeout
  }));
  if (!reaffirmed) return null;
  const match = fold(reaffirmed.candidate.trim(), targetLanguage);
  const expected = fold(translated.slice(start, end), targetLanguage);
  const koreanStem = targetLanguage === "ko" && /\p{Script=Hangul}{2}/u.test(match) && expected.startsWith(match);
  return match === expected || koreanStem ? between : null;
}

export async function alignOriginalWord(request, signal) {
  const { original, translated, start, end, sourceLanguage, targetLanguage, languageHint } = request ?? {};
  if (typeof original !== "string" || original.length > 640 ||
      typeof translated !== "string" || translated.length > 4096 ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end <= start || end > translated.length || end - start > 120 ||
      !isSupportedLanguage(targetLanguage)) return null;

  if (original === translated) return { start, end };
  const input = isSupportedLanguage(sourceLanguage)
    ? sourceLanguage
    : (await detectSourceLanguage(original)) ?? normalizeLanguage(languageHint);
  signal.throwIfAborted();
  if (!input) return null;

  const tokens = tokenize(original, input);
  const word = translated.slice(start, end);
  const options = { sourceLanguage: targetLanguage, targetLanguage: input, timeout: 10_000 };
  const literal = findPhrase(tokens, await translate(word, signal, options), input);
  if (literal) return literal;
  if (translated.length >= 1200 || /[【】]/u.test(translated)) return null;

  return await matchMarkedWord(tokens, request, options, signal)
    ?? await matchNearbyPhrase(tokens, request, options, AbortSignal.any([signal, AbortSignal.timeout(3500)]));
}
