// Run with: npx tsx src/services/contentFilter.test.ts
import { filterText, containsBlocked, filterNickname } from "./contentFilter.js";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  }
}

// --- obfuscation must not defeat it ---
check("plain", containsBlocked("fuck"), true);
check("spaced", containsBlocked("f u c k"), true);
check("hyphenated", containsBlocked("f-u-c-k"), true);
check("leet", containsBlocked("sh1t"), true);
check("stretched", containsBlocked("fuuuuck"), true);
check("mixed case", containsBlocked("FuCk"), true);

// --- innocent words must survive (the expensive failure) ---
for (const w of [
  "class", "assess", "passage", "Scunthorpe", "analysis", "bass",
  "hello", "chaotic", "hopeful", "Saturday", "assignment", "cockpit",
  "dictionary", "titanium", "shitake", // near-misses worth guarding
]) {
  check(`clean: ${w}`, containsBlocked(w), false);
}

// --- compounds and inflections ---
for (const w of ["fucks", "fucking", "motherfucker", "bitches", "shitty", "sh!t", "f.u.c.k"]) {
  check(`blocked: ${w}`, containsBlocked(w), true);
}

// --- a sentence of ordinary words must stay clean ---
check(
  "ordinary sentence",
  containsBlocked("The class analysis passed with a classic bass line"),
  false
);
// Short words that merely look suspicious in aggregate must not collapse-match.
check("short clean words", containsBlocked("I am on my way to it"), false);
check("initials", containsBlocked("J R R Tolkien"), false);

// --- modes ---
check("off passes through", filterText("fuck this", "off"), {
  text: "fuck this", flagged: false, rejected: false,
});
check("mask keeps shape", filterText("fuck this", "mask"), {
  text: "f*** this", flagged: true, rejected: false,
});
check("block rejects", filterText("fuck this", "block").rejected, true);
check("clean text untouched", filterText("great session", "mask"), {
  text: "great session", flagged: false, rejected: false,
});
check("nickname falls back", filterNickname("fucker"), "Anonymous");
check("clean nickname kept", filterNickname("Ayesha"), "Ayesha");

console.log(`\ncontentFilter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
