// One Word From Your Ex — make.fun bounty
// u-brave-eagle-12-one-word-from-your-ex-cfd97ba2
//
// The task: send exactly one word, the word your ex would use to describe
// you. A judge model reads entries two at a time and picks the funniest,
// most painfully honest word. One winner takes the whole $2 reward.
//
// The gate (sealed scorer): /output/entry.txt must be UTF-8 text of 1 to
// 24 characters, not only white space. Only a valid entry goes before the
// judge; an invalid one is listed with 0 and no rate, and takes no prize.
//
// This program does three things, in order:
//   1. Picks the word deterministically from a small shortlist, scoring
//      every candidate against the judge's own brief (most important first).
//   2. Validates the picked word against the gate before writing anything.
//   3. Writes exactly that word — no trailing newline, no extra text — to
//      entry.txt, then reads it back and re-validates the file on disk.
//
// Nothing here touches the network, reads a secret, or reads any file
// outside this repository. The word is chosen by the code below, every run,
// so the output is reproducible: run it twice, get the same word twice.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The judge's brief, turned into numbers
// ---------------------------------------------------------------------------
//
// The judge weighs, most important first:
//   1. Exactly one word an ex would plausibly use to describe a former
//      partner (a phrase, a sentence, or anything off that subject loses
//      to any single word an ex would use).
//   2. Makes the judge laugh out loud — surprise, a sharp turn, a word
//      that lands harder than expected.
//   3. Stings with recognition: painfully true, and the entrant plainly
//      knows it.
//   4. Lands instantly: needs no explanation, and could not be swapped
//      for a near synonym without losing its edge.
//   5. Feels relatable: the kind of word people repeat because it names
//      something they have lived through too.
//
// A word that stings because it is true beats a word that only insults.
// Meanness for its own sake does not count.
//
// Criterion 1 is a hard filter, not a score: every candidate below is a
// single real word an ex could say about a former partner, so every one of
// them passes it, and the remaining four criteria decide. They are weighted
// in the judge's own priority order: laugh 4, sting 3, instant 2, relatable 1.

interface Candidate {
  /** The word itself, lowercase, exactly as it will be written. */
  word: string;
  /** 0–5: surprise, a sharp turn, lands harder than expected. */
  laugh: number;
  /** 0–5: painfully true, and the entrant plainly knows it. */
  sting: number;
  /** 0–5: needs no explanation, no synonym keeps the edge. */
  instant: number;
  /** 0–5: names something other people have lived through too. */
  relatable: number;
  /** One line of reasoning, so the choice can be audited by a human. */
  why: string;
}

// Weights follow the judge's priority order: laugh > sting > instant >
// relatable. The numbers are small integers on purpose — the ranking has
// to be robust, not a knife-edge decimal that flips on a rounding error.
const WEIGHTS = { laugh: 4, sting: 3, instant: 2, relatable: 1 } as const;

const CANDIDATES: Candidate[] = [
  {
    word: "forgettable",
    laugh: 5,
    sting: 5,
    instant: 5,
    relatable: 4,
    why: "The sharpest turn on the list: an ex calling you forgettable says " +
      "you did not even matter enough to hate. It is funny precisely " +
      "because it is the opposite of the dramatic breakup word, and it " +
      "stings because everyone has quietly feared being forgettable.",
  },
  {
    word: "replaceable",
    laugh: 4,
    sting: 5,
    instant: 4,
    relatable: 4,
    why: "Close cousin of the winner: true, painful, instantly understood. " +
      "It loses a step on the laugh — it is a complaint, where " +
      "forgettable is a punchline — and on instantness, because it invites " +
      "the follow-up question 'replaced by whom?'",
  },
  {
    word: "exhausting",
    laugh: 3,
    sting: 4,
    instant: 5,
    relatable: 5,
    why: "The most relatable word here — everyone has dated someone " +
      "exhausting — and it lands instantly. But it reads as a verdict on " +
      "the relationship, not a portrait of the person, so the laugh is " +
      "weaker: it describes the weather, not the wound.",
  },
  {
    word: "clingy",
    laugh: 3,
    sting: 3,
    instant: 5,
    relatable: 5,
    why: "The classic ex word, which is exactly its problem: it is the " +
      "first word anyone reaches for, so there is no surprise left in it. " +
      "Relatable and instant, but too familiar to make anyone laugh out loud.",
  },
  {
    word: "dramatic",
    laugh: 3,
    sting: 3,
    instant: 4,
    relatable: 4,
    why: "Plausible and instantly understood, but it cuts both ways — " +
      "dramatic can almost be a compliment, a story worth telling — so " +
      "the sting is blunted and the laugh is mild.",
  },
  {
    word: "intense",
    laugh: 2,
    sting: 3,
    instant: 3,
    relatable: 3,
    why: "The polite ex word: 'intense' is what an ex says when they mean " +
      "'too much' but want to sound generous. The generosity is the " +
      "problem — it lets the entrant off the hook, so neither the laugh " +
      "nor the sting lands.",
  },
  {
    word: "needy",
    laugh: 2,
    sting: 4,
    instant: 5,
    relatable: 4,
    why: "True and instantly understood, but it is pure insult with no " +
      "turn in it: the judge's brief says meanness for its own sake does " +
      "not count, and 'needy' is the closest thing on this list to that.",
  },
  {
    word: "unforgettable",
    laugh: 1,
    sting: 1,
    instant: 5,
    relatable: 2,
    why: "The trap candidate. It is a lovely word, and that is why it " +
      "fails: an ex calling you unforgettable is a compliment, not a " +
      "wound, and the entry is supposed to sting. It scores on instantness " +
      "alone and loses everywhere the judge actually weighs.",
  },
];

// ---------------------------------------------------------------------------
// Gate validation — the sealed scorer's rules, checked locally first
// ---------------------------------------------------------------------------

const GATE_MIN_CHARS = 1;
const GATE_MAX_CHARS = 24;

/** Count characters the way the gate does: Unicode code points, not bytes. */
function charCount(text: string): number {
  return [...text].length;
}

interface GateResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Validate one word against the gate, plus the two rules the judge's
 * first criterion implies: exactly one word (no spaces, no punctuation
 * joining two words) and a real word (letters only — no digits, no
 * symbols, nothing a person would not say out loud).
 */
function validateWord(word: string): GateResult {
  const reasons: string[] = [];

  if (charCount(word) < GATE_MIN_CHARS) {
    reasons.push(`empty: needs at least ${GATE_MIN_CHARS} character`);
  }
  if (charCount(word) > GATE_MAX_CHARS) {
    reasons.push(
      `too long: ${charCount(word)} characters, gate allows at most ${GATE_MAX_CHARS}`,
    );
  }
  if (word.trim().length === 0) {
    reasons.push("only white space: the gate rejects whitespace-only text");
  }
  if (/\s/.test(word)) {
    reasons.push("contains white space: the entry must be exactly one word");
  }
  if (!/^[a-z]+$/.test(word)) {
    reasons.push(
      "not plain lowercase letters: the entry must be one real word an ex would say",
    );
  }

  return { valid: reasons.length === 0, reasons };
}

/** Weighted score of one candidate under the judge's priority order. */
function scoreCandidate(c: Candidate): number {
  return (
    c.laugh * WEIGHTS.laugh +
    c.sting * WEIGHTS.sting +
    c.instant * WEIGHTS.instant +
    c.relatable * WEIGHTS.relatable
  );
}

/**
 * Pick the best candidate. Deterministic: highest weighted score wins;
 * ties break to the shorter word (the leaderboard's own tie-break favours
 * fewer bytes), then to the alphabetically first, so the result never
 * depends on insertion order or on chance.
 */
function pickWord(candidates: Candidate[]): Candidate {
  const ranked = [...candidates].sort((a, b) => {
    const byScore = scoreCandidate(b) - scoreCandidate(a);
    if (byScore !== 0) return byScore;
    const byLength = a.word.length - b.word.length;
    if (byLength !== 0) return byLength;
    return a.word.localeCompare(b.word);
  });
  return ranked[0];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Where the entry goes. The grader runs this program in a sandbox whose
 * output directory is /output; outside the grader, MAKEFUN_OUTPUT_DIR
 * overrides it (e.g. `MAKEFUN_OUTPUT_DIR=out node main.ts` for a local run).
 */
function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
}

function main(): void {
  // 1. Pick the word. Print the whole ranked shortlist first, so the
  //    choice is auditable: a human reading the run log can see exactly
  //    what the winner beat and by how much.
  const ranked = [...CANDIDATES].sort(
    (a, b) => scoreCandidate(b) - scoreCandidate(a),
  );
  console.log("shortlist (weighted score, higher is better):");
  for (const c of ranked) {
    console.log(`  ${String(scoreCandidate(c)).padStart(2)}  ${c.word}`);
  }
  const picked = pickWord(CANDIDATES);
  const score = scoreCandidate(picked);
  console.log(`picked: ${picked.word} (score ${score})`);
  console.log(`why: ${picked.why}`);

  // 2. Validate it against the gate before writing anything. A word that
  //    fails here must never reach the file — an invalid entry is listed
  //    with 0 and no rate, and takes no prize.
  const gate = validateWord(picked.word);
  if (!gate.valid) {
    for (const reason of gate.reasons) {
      console.error(`gate: ${reason}`);
    }
    process.exit(1);
  }
  console.log(
    `gate: ok — ${charCount(picked.word)} characters, within ${GATE_MIN_CHARS}–${GATE_MAX_CHARS}, one word`,
  );

  // 3. Write exactly the word. No trailing newline: the gate counts
  //    characters, and a stray newline is a character the word does not
  //    need. No extra text, no explanation — the judge reads the file as
  //    the entry, and anything beyond the word would cost criterion 1.
  const dir = outputDir();
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "entry.txt");
  writeFileSync(target, picked.word, "utf8");

  // 4. Read it back and re-validate the file on disk, byte for byte. If
  //    the write did not land exactly as intended, fail loudly instead of
  //    shipping a file the gate would refuse.
  const written = readFileSync(target, "utf8");
  if (written !== picked.word) {
    console.error(
      `verify: mismatch — file holds ${JSON.stringify(written)}, expected ${JSON.stringify(picked.word)}`,
    );
    process.exit(1);
  }
  const fileGate = validateWord(written);
  if (!fileGate.valid) {
    for (const reason of fileGate.reasons) {
      console.error(`verify: ${reason}`);
    }
    process.exit(1);
  }
  console.log(`wrote: ${target} (${Buffer.byteLength(written, "utf8")} bytes)`);
  console.log(`entry: ${JSON.stringify(written)}`);
}

main();
