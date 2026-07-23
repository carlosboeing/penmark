export interface ReadingMetrics {
  words: number;
  minutes: number;
  label: string;
}

const WORDS_PER_MINUTE = 240;

/** Derive reading metadata from already-rendered visible text. */
export function readingMetrics(
  text: string,
  locales?: string | string[],
): ReadingMetrics {
  const trimmed = text.trim();
  const words = trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
  const minutes = words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  const formattedWords = new Intl.NumberFormat(locales).format(words);
  const wordLabel = words === 1 ? "word" : "words";

  return {
    words,
    minutes,
    label: `${formattedWords} ${wordLabel} · ${minutes} min read`,
  };
}
