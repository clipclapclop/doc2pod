import type { EpisodeDraft, ReviewCode, ReviewResult, ScriptTurn } from "./types.js";

const WARNING_PHRASES: Record<ReviewCode, string> = {
  incomplete_coverage: "some source details may be incomplete",
  unsupported_claim: "some statements may not be fully supported by the source",
  distorted_uncertainty: "some uncertainty may not be represented accurately",
  duplication: "the episode may contain unnecessary repetition",
  role_drift: "the conversation may not consistently follow the requested format",
  unsafe_medical_inference: "some medical interpretation may go beyond the source",
  poor_flow: "some parts of the conversation may be difficult to follow",
  genre_mismatch: "the presentation may not fit the source material",
  meta_narration: "the episode may discuss the source instead of directly covering its subject",
  unclear_explanation: "some important ideas may not be explained clearly",
  needless_complexity: "some language may be more complicated than the subject requires",
};

export function unresolvedErrorCodes(review: ReviewResult): ReviewCode[] {
  return [...new Set(review.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code))];
}

export function warningText(codes: ReviewCode[]): string {
  const phrases = codes.map((code) => WARNING_PHRASES[code]);
  if (phrases.length === 0) return "";
  const detail = phrases.length === 1 ? phrases[0] : `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
  return `Automated quality notice: ${detail}. Please compare important details with the original document.`;
}

export function prependQualityNotice(draft: EpisodeDraft, codes: ReviewCode[]): EpisodeDraft {
  const text = warningText(codes);
  if (!text) return draft;
  const notice: ScriptTurn = {
    id: "quality_notice",
    speaker: "host_a",
    parts: [{ kind: "speech", text }],
    delivery: { tone: "serious", pace: "slow", pauseAfterMs: 800 },
  };
  return { ...draft, turns: [notice, ...draft.turns] };
}
