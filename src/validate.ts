import {
  CUES,
  PACES,
  REVIEW_CODES,
  TONES,
  type EpisodeDraft,
  type ReviewResult,
  type ShowProfile,
} from "./types.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

export function countWords(text: string): number {
  return text.trim() ? (text.trim().match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length : 0;
}

export function scriptText(draft: EpisodeDraft): string {
  return draft.turns.flatMap((turn) => turn.parts.filter((part) => part.kind === "speech").map((part) => part.text)).join(" ");
}

export function validateEpisode(value: unknown, profile: ShowProfile, maxWords: number): EpisodeDraft {
  const root = record(value, "Episode");
  const title = string(root.title, "title");
  const description = string(root.description, "description");
  if (title.length > 120) throw new Error("title must not exceed 120 characters");
  if (description.length > 500) throw new Error("description must not exceed 500 characters");
  const blueprintRaw = record(root.blueprint, "blueprint");
  const coverageRaw = blueprintRaw.coverage;
  if (!Array.isArray(coverageRaw) || coverageRaw.length === 0) throw new Error("blueprint.coverage must not be empty");
  const coverage = coverageRaw.map((item, index) => {
    const value = record(item, `coverage[${index}]`);
    const importance = string(value.importance, `coverage[${index}].importance`);
    if (!["essential", "major", "supporting"].includes(importance)) throw new Error(`Invalid coverage importance '${importance}'`);
    return {
      id: string(value.id, `coverage[${index}].id`),
      topic: string(value.topic, `coverage[${index}].topic`),
      importance: importance as "essential" | "major" | "supporting",
    };
  });
  const targetScriptWords = blueprintRaw.targetScriptWords;
  if (!Number.isInteger(targetScriptWords) || (targetScriptWords as number) < 1 || (targetScriptWords as number) > maxWords) {
    throw new Error(`targetScriptWords must be between 1 and ${maxWords}`);
  }
  if (!Array.isArray(root.turns) || root.turns.length < 2) throw new Error("Episode must contain at least two turns");
  const ids = new Set<string>();
  const turns = root.turns.map((item, index) => {
    const value = record(item, `turns[${index}]`);
    const id = string(value.id, `turns[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate turn id '${id}'`);
    ids.add(id);
    const speaker = string(value.speaker, `turns[${index}].speaker`);
    if (speaker !== "host_a" && speaker !== "host_b") throw new Error(`Invalid speaker '${speaker}'`);
    if (!Array.isArray(value.parts) || value.parts.length === 0) throw new Error(`turns[${index}].parts must not be empty`);
    const parts = value.parts.map((itemPart, partIndex) => {
      const part = record(itemPart, `turns[${index}].parts[${partIndex}]`);
      if (part.kind === "speech") {
        if (part.cue !== "none") throw new Error(`Speech part in turn '${id}' must use cue='none'`);
        const text = string(part.text, `turns[${index}].parts[${partIndex}].text`).trim();
        if (/<[^>]+>/.test(text)) throw new Error(`Raw control tags are not allowed in speech for turn '${id}'`);
        if (countWords(text) > 350) throw new Error(`Speech part in turn '${id}' exceeds 350 words`);
        return { kind: "speech" as const, text };
      }
      if (part.kind === "cue") {
        if (part.text !== "") throw new Error(`Cue part in turn '${id}' must use empty text`);
        const cue = string(part.cue, `turns[${index}].parts[${partIndex}].cue`);
        if (!CUES.includes(cue as never) || !profile.allowedCues.includes(cue as never)) throw new Error(`Cue '${cue}' is not allowed by profile '${profile.id}'`);
        return { kind: "cue" as const, cue: cue as (typeof CUES)[number] };
      }
      throw new Error(`Invalid part kind in turn '${id}'`);
    });
    if (!parts.some((part) => part.kind === "speech")) throw new Error(`Turn '${id}' has no speech`);
    const delivery = record(value.delivery, `turns[${index}].delivery`);
    const tone = string(delivery.tone, `turns[${index}].delivery.tone`);
    const pace = string(delivery.pace, `turns[${index}].delivery.pace`);
    if (!TONES.includes(tone as never)) throw new Error(`Invalid tone '${tone}'`);
    if (!PACES.includes(pace as never)) throw new Error(`Invalid pace '${pace}'`);
    const pauseAfterMs = delivery.pauseAfterMs;
    if (!Number.isInteger(pauseAfterMs) || (pauseAfterMs as number) < 0 || (pauseAfterMs as number) > 3000) {
      throw new Error(`Invalid pauseAfterMs for turn '${id}'`);
    }
    return { id, speaker, parts, delivery: { tone, pace, pauseAfterMs } } as EpisodeDraft["turns"][number];
  });
  const episode: EpisodeDraft = {
    title,
    description,
    blueprint: {
      sourceSummary: string(blueprintRaw.sourceSummary, "blueprint.sourceSummary"),
      targetScriptWords: targetScriptWords as number,
      budgetRationale: string(blueprintRaw.budgetRationale, "blueprint.budgetRationale"),
      coverage,
    },
    turns,
  };
  const actualWords = countWords(scriptText(episode));
  if (actualWords > maxWords) throw new Error(`Script contains ${actualWords} words, exceeding --max-script-words ${maxWords}`);
  const wordsBySpeaker = { host_a: 0, host_b: 0 };
  for (const turn of episode.turns) {
    const words = turn.parts
      .filter((part) => part.kind === "speech")
      .reduce((total, part) => total + countWords(part.text), 0);
    wordsBySpeaker[turn.speaker] += words;
  }
  if (wordsBySpeaker.host_a === 0 || wordsBySpeaker.host_b === 0) {
    throw new Error("Episode must contain spoken dialogue from both host_a and host_b");
  }
  if (actualWords >= 100) {
    const smallerShare = Math.min(wordsBySpeaker.host_a, wordsBySpeaker.host_b) / actualWords;
    if (smallerShare < 0.15) throw new Error("Each host must contribute at least 15% of the spoken script");
  }
  return episode;
}

export function validateReview(value: unknown): ReviewResult {
  const root = record(value, "Review");
  if (typeof root.passed !== "boolean") throw new Error("Review passed must be boolean");
  if (!Array.isArray(root.issues)) throw new Error("Review issues must be an array");
  const issues = root.issues.map((item, index) => {
    const issue = record(item, `issues[${index}]`);
    const code = string(issue.code, `issues[${index}].code`);
    const severity = string(issue.severity, `issues[${index}].severity`);
    if (!REVIEW_CODES.includes(code as never)) throw new Error(`Invalid review code '${code}'`);
    if (severity !== "warning" && severity !== "error") throw new Error(`Invalid review severity '${severity}'`);
    if (!Array.isArray(issue.turnIds) || issue.turnIds.some((id) => typeof id !== "string")) throw new Error("Review turnIds must be strings");
    return { code, severity, message: string(issue.message, `issues[${index}].message`), turnIds: issue.turnIds } as ReviewResult["issues"][number];
  });
  if (root.passed && issues.some((issue) => issue.severity === "error")) throw new Error("Review cannot pass while containing error issues");
  return { passed: root.passed, issues };
}
