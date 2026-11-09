// Content filtering for anything a participant types that can reach the
// projected screen: word-cloud words, open-ended answers, Q&A text, nicknames.
//
// Q&A already has human moderation. Word clouds and open-ended feeds do NOT —
// they go from a stranger's phone to a wall in front of a room, which is the
// single highest-exposure path in the product.
//
// This is a blocklist, and blocklists are not a solved problem: it will miss
// novel spellings and it will occasionally catch an innocent word. It is a
// speed bump for casual abuse, not a guarantee — hence `strict` mode, which
// holds everything for review rather than trying to be clever.

export type FilterMode = "off" | "mask" | "block";

export interface FilterResult {
  /** Text to store/display. Masked when mode is "mask". */
  text: string;
  /** True when the input tripped the filter. */
  flagged: boolean;
  /** Set when mode is "block" and the input should be rejected outright. */
  rejected: boolean;
}

// Deliberately short and English-only. A large imported wordlist produces more
// false positives than it prevents abuse, and the honest answer for a hostile
// room is human moderation, not a bigger list.
const BLOCKED = [
  "fuck", "shit", "cunt", "bitch", "bastard", "dick", "cock", "pussy",
  "asshole", "whore", "slut", "fag", "faggot", "nigger", "nigga", "retard",
  "rape", "nazi", "kys",
];

// Leet/obfuscation folding. Someone writing "f u c k" or "sh1t" is not
// defeated by a literal match, and that is the common case rather than an
// exotic one.
const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
};

function fold(input: string): string {
  const lowered = input.toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (LEET[ch]) out += LEET[ch];
    else if (/[a-z]/.test(ch)) out += ch;
    // everything else (spaces, punctuation, separators) is dropped, so
    // "f-u-c-k" and "f u c k" both collapse to "fuck"
  }
  // Collapse runs of a repeated letter: "fuuuuck" -> "fuck".
  return out.replace(/(.)\1{2,}/g, "$1$1").replace(/(.)\1+/g, "$1");
}

// Each blocked term is also folded, so the comparison is like-for-like.
const FOLDED = BLOCKED.map(fold).filter((w) => w.length >= 4);

// Inflections a blocked root legitimately takes. Matching root+inflection
// (rather than bare substring) is what separates "fucking" from "cockpit" —
// both contain a root, only one is the word being used.
const INFLECTIONS = ["", "s", "es", "ed", "ing", "er", "ers", "y", "ies", "in"];

// The irreducible cost of a blocklist: ordinary words that contain a root.
// This list is short on purpose — every entry is a word a real person has
// actually been blocked for typing (the "Scunthorpe problem"). It patches a
// technique that cannot be made exact; it is not a solution.
const ALLOWED = new Set(
  [
    "scunthorpe", "peacock", "cockpit", "cocktail", "cockroach", "cocker",
    "hancock", "woodcock", "shiitake", "shitake", "assassin", "assassinate",
    "class", "classic", "bass", "grass", "pass", "mass", "analysis",
    "dickens", "dickinson", "penistone", "sussex", "essex", "middlesex",
    "therapist", "assumption", "assist", "cassette",
  ].map(fold)
);

/** Does one folded token read as a use of a blocked root? */
function tokenIsBlocked(foldedToken: string): boolean {
  if (!foldedToken || ALLOWED.has(foldedToken)) return false;
  for (const root of FOLDED) {
    for (const suffix of INFLECTIONS) {
      const form = root + suffix;
      if (foldedToken === form) return true;
      // A compound ending in the root ("motherfucker"), but not a root buried
      // mid-word ("cockpit", "shitake") — that is where false positives live.
      if (foldedToken.endsWith(form) && foldedToken.length > form.length) return true;
    }
  }
  return false;
}

/**
 * Whole-text check.
 *
 * Two passes, because the evasions have opposite shapes. Normal text is
 * checked token by token, so a root buried inside a longer word does not trip
 * it. Separator evasion ("f u c k", "f-u-c-k") is checked only when the text
 * is mostly single characters — collapsing every text would reintroduce
 * exactly the false positives the token pass avoids.
 */
export function containsBlocked(input: string): boolean {
  const tokens = input.split(/\s+/).filter(Boolean);
  if (tokens.some((t) => tokenIsBlocked(fold(t)))) return true;

  const letterish = tokens.filter((t) => fold(t).length > 0);
  const mostlySingles =
    letterish.length >= 3 &&
    letterish.filter((t) => fold(t).length <= 2).length / letterish.length >= 0.6;
  if (mostlySingles) {
    const collapsed = fold(input);
    if (FOLDED.some((root) => collapsed.includes(root))) return true;
  }
  return false;
}

function maskWord(word: string): string {
  if (word.length <= 2) return "*".repeat(word.length);
  return word[0] + "*".repeat(word.length - 1);
}

/**
 * Apply the filter. `mask` replaces offending WORDS and keeps the rest, which
 * suits a word cloud; `block` rejects the whole submission, which suits a
 * question that a host would otherwise have to clean up.
 */
export function filterText(input: string, mode: FilterMode): FilterResult {
  if (mode === "off") return { text: input, flagged: false, rejected: false };

  // Split on whitespace but keep the original tokens, so masking preserves
  // the author's spacing and punctuation.
  const tokens = input.split(/(\s+)/);
  let flagged = false;
  const masked = tokens.map((t) => {
    if (!t.trim()) return t;
    if (containsBlocked(t)) {
      flagged = true;
      return maskWord(t);
    }
    return t;
  });

  // A phrase can trip the filter while no single token does, once separators
  // are folded away ("f u c k"). Catch that too.
  if (!flagged && containsBlocked(input)) {
    flagged = true;
    if (mode === "block") return { text: input, flagged: true, rejected: true };
    return { text: "*".repeat(Math.min(input.trim().length, 12)), flagged: true, rejected: false };
  }

  if (mode === "block" && flagged) return { text: input, flagged: true, rejected: true };
  return { text: masked.join(""), flagged, rejected: false };
}

/** Nicknames are always held to the strictest treatment — they persist all session. */
export function filterNickname(name: string): string {
  const res = filterText(name, "mask");
  return res.flagged ? "Anonymous" : name;
}
