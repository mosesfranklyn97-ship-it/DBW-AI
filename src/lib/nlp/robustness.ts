/**
 * Robustness helpers for the offline ("ZeroBox engine") schema builder.
 *
 * The LLM path in `lib/ai/provider` is what actually gives free-form
 * interpretation. This module exists so the rule-based fallback degrades
 * gracefully instead of failing hard on the way people really talk: typos from
 * voice dictation, filler words, colloquial synonyms, and — most importantly —
 * requests to *exclude* things, which the keyword matcher would otherwise
 * happily add back in.
 */

/* ------------------------------------------------------------------ */
/* Fuzzy matching                                                      */
/* ------------------------------------------------------------------ */

/**
 * Damerau-Levenshtein (optimal string alignment) with an early bail-out.
 * Handles the adjacent transposition that plain Levenshtein misses, which is
 * the single most common human typo ("teh", "recieve", "adn").
 */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > max) return max + 1;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  // d[i][j] = distance between a.slice(0, i) and b.slice(0, j)
  let prevPrev: number[] = [];
  let prev: number[] = new Array(lenB + 1);
  let curr: number[] = new Array(lenB + 1);

  for (let j = 0; j <= lenB; j += 1) prev[j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // transposition: "teh" -> "the"
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = curr;
    curr = new Array(lenB + 1);
  }
  return prev[lenB];
}

/**
 * How many typos we tolerate for a term. Short words get none: "cat" is one
 * edit from a dozen unrelated words, so fuzzy-matching it invents tables.
 */
export function toleranceFor(term: string): number {
  if (term.length <= 4) return 0;
  if (term.length <= 6) return 1;
  return 2;
}

/**
 * Vocabulary lookup that tolerates spelling mistakes. Built once from the
 * dictionary so the dictionary stays the single source of truth.
 */
export class FuzzyIndex {
  private readonly terms: string[];
  private readonly maxLength: number;

  constructor(terms: string[]) {
    // Longest first so an exact-ish match on a specific term beats a shorter
    // term that happens to be within tolerance of the same typo.
    this.terms = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
    this.maxLength = this.terms.reduce((max, term) => Math.max(max, term.length), 0);
  }

  /** Exact match only — used when we must not guess. */
  has(term: string): boolean {
    return this.terms.includes(term);
  }

  /** Returns the best matching vocabulary term, or null. */
  lookup(word: string, maxDistance = 2): string | null {
    if (!word || word.length > this.maxLength + maxDistance) return null;
    const exact = this.terms.find((term) => term === word);
    if (exact) return exact;

    let best: string | null = null;
    let bestScore = maxDistance + 1;
    for (const term of this.terms) {
      const allowed = Math.min(maxDistance, toleranceFor(term));
      if (allowed === 0) continue;
      if (Math.abs(term.length - word.length) > allowed) continue;
      const score = editDistance(word, term, allowed);
      if (score < bestScore) {
        bestScore = score;
        best = term;
        if (score === 1) break;
      }
    }
    return bestScore <= maxDistance ? best : null;
  }
}

/* ------------------------------------------------------------------ */
/* Utterance cleanup                                                   */
/* ------------------------------------------------------------------ */

const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bdon['’]?t\b/g, "do not"],
  [/\bdoesn['’]?t\b/g, "does not"],
  [/\bdidn['’]?t\b/g, "did not"],
  [/\bwon['’]?t\b/g, "will not"],
  [/\bcan['’]?t\b/g, "can not"],
  [/\bcannot\b/g, "can not"],
  [/\bisn['’]?t\b/g, "is not"],
  [/\baren['’]?t\b/g, "are not"],
  [/\bwasn['’]?t\b/g, "was not"],
  [/\bweren['’]?t\b/g, "were not"],
  [/\bi['’]?m\b/g, "i am"],
  [/\bi['’]?ve\b/g, "i have"],
  [/\bi['’]?ll\b/g, "i will"],
  [/\bwanna\b/g, "want to"],
  [/\bgonna\b/g, "going to"],
  [/\blemme\b/g, "let me"],
  [/\bgimme\b/g, "give me"],
  [/\bcuz\b|\bcuz\b/g, "because"],
  [/\bu\b/g, "you"],
  [/\bur\b/g, "your"],
  [/\bpls\b|\bplz\b/g, "please"],
];

/** Filler that carries no schema meaning. */
const FILLER = new Set([
  "um",
  "uh",
  "erm",
  "ah",
  "hmm",
  "like",
  "just",
  "really",
  "actually",
  "basically",
  "literally",
  "kind",
  "sort",
  "well",
  "so",
  "yeah",
  "ok",
  "okay",
  "please",
  "want",
  "need",
  "make",
  "build",
  "create",
  "generate",
  "give",
  "let",
  "lets",
  "something",
  "stuff",
  "thing",
  "things",
  "bit",
  "little",
  "maybe",
  "perhaps",
  "possibly",
  "probably",
  "think",
  "know",
  "want",
]);

/**
 * Lowercase, expand contractions and strip filler so both the typed and
 * dictated forms of the same request reduce to the same text.
 */
export function normalizeUtterance(prompt: string): string {
  let text = ` ${prompt.toLowerCase()} `;

  for (const [pattern, replacement] of CONTRACTIONS) text = text.replace(pattern, replacement);

  // Keep letters/digits plus the punctuation we actually parse on.
  text = text.replace(/[^a-z0-9_.,\->\s]/g, " ");

  // Collapse "app_ointment" style stutter and repeated words.
  text = text.replace(/\b(\w+)_\1\b/g, "$1");
  text = text.replace(/\b(\w+)\s+\1\b/g, "$1");

  // Drop filler, but never drop a word that could be a real entity by itself;
  // callers filter those against the dictionary.
  text = text
    .split(/\s+/)
    .filter((word) => {
      const bare = word.replace(/[^a-z0-9_]/g, "");
      if (!bare) return false;
      if (FILLER.has(bare)) return false;
      return true;
    })
    .join(" ");

  return ` ${text.replace(/\s+/g, " ").trim()} `;
}

/* ------------------------------------------------------------------ */
/* Exclusions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Cues that introduce something the user does *not* want. "without payments"
 * must not cause a payments table — before this the keyword matcher added it,
 * which is worse than not understanding at all.
 */
const NEGATION_CUES =
  /\b(?:without|excluding?|except(?: for)?|no|not|skip|omit|leave out|drop|minus|ignore|dont want|do not want|do not need|does not need|never mind|forget)\b/;

/** Stop the excluded span at a clause boundary so we don't swallow the schema. */
const SCOPE_BREAK = /\b(?:but|and|also|plus|however|though|because|so that|then|also need|make sure)\b|[,.;!?]|\band\b/;

export interface ExclusionSpan {
  /** Raw text of the excluded fragment. */
  text: string;
  /** Word index in the normalised text where the span starts. */
  index: number;
}

/**
 * Finds fragments introduced by a negation cue. Works on the normalised
 * utterance so "don't" has already become "do not".
 */
export function findExclusions(normalized: string): ExclusionSpan[] {
  const spans: ExclusionSpan[] = [];
  const lower = normalized.toLowerCase();

  for (const match of lower.matchAll(new RegExp(NEGATION_CUES.source, "g"))) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = lower.slice(start);
    const breakMatch = rest.match(SCOPE_BREAK);
    const end = breakMatch?.index ?? rest.length;
    const fragment = rest.slice(0, end).trim();
    if (fragment.length > 0) {
      spans.push({ text: fragment, index: start });
    }
  }
  return spans;
}

/**
 * Words that signal the excluded span is over. Prevents "no payments needed
 * for customers" from also excluding customers.
 */
const SOFT_ENDERS = new Set([
  "needed",
  "need",
  "required",
  "please",
  "thanks",
  "thank",
  "for",
  "just",
  "only",
  "atall",
  "anymore",
]);

export function isHardExclusion(fragment: string): boolean {
  const words = fragment.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  // "no" alone before a break is not a meaningful exclusion.
  if (words.length === 1 && words[0].length < 3) return false;
  // Strip trailing politeness/verb filler before deciding.
  while (words.length > 1 && SOFT_ENDERS.has(words[words.length - 1])) words.pop();
  return words.length > 0;
}
