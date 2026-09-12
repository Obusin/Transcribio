/**
 * Post-processing guards for raw Whisper output. These only remove text that is
 * almost certainly not speech (repetition loops, outro hallucinations over
 * music); they never rewrite what was said.
 */

const HALLUCINATIONS = [
  /^(thank you|thanks)( (so much|very much|for watching|for listening))?[.!]*$/i,
  /(like|subscribe|comment).*(channel|video|subscribe)/i,
  /^(salamat( po)?( sa panonood)?|maraming salamat( po)?)[.!]*$/i,
  /^(please )?subscribe[.!]*$/i,
  /^\W*(music|applause|laughter|silence)\W*$/i,
  /^[\s♪♫.,!?…-]*$/,
  /subtitles? by|captions? by|amara\.org/i,
];

export function isLikelyHallucination(text: string): boolean {
  return HALLUCINATIONS.some((rx) => rx.test(text.trim()));
}

/** Collapse Whisper repetition loops ("salamat salamat salamat …" ×20). */
export function collapseRepeats(text: string): string {
  const words = text.split(/\s+/);
  for (let n = 1; n <= 6; n++) {
    for (let i = 0; i + n * 4 <= words.length; i++) {
      let reps = 1;
      while (i + (reps + 1) * n <= words.length && sameRun(words, i, i + reps * n, n)) reps++;
      if (reps >= 4) {
        words.splice(i + 2 * n, (reps - 2) * n); // keep two occurrences
      }
    }
  }
  return words.join(" ");
}

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function sameRun(w: string[], a: number, b: number, n: number) {
  for (let k = 0; k < n; k++) if (bare(w[a + k]) !== bare(w[b + k])) return false;
  return true;
}
