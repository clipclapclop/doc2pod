import { CONTENT_MODES, CUES, PACES, REVIEW_CODES, TONES } from "./types.js";

const stringEnum = (values: readonly string[]) => ({ type: "string", enum: [...values] });

export const episodeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "blueprint", "turns"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 500 },
    blueprint: {
      type: "object",
      additionalProperties: false,
      required: ["sourceSummary", "contentMode", "listenerGoal", "throughline", "targetScriptWords", "budgetRationale", "coverage"],
      properties: {
        sourceSummary: { type: "string", minLength: 1 },
        contentMode: stringEnum(CONTENT_MODES),
        listenerGoal: { type: "string", minLength: 1 },
        throughline: { type: "string", minLength: 1 },
        targetScriptWords: { type: "integer", minimum: 1 },
        budgetRationale: { type: "string", minLength: 1 },
        coverage: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "topic", "importance"],
            properties: {
              id: { type: "string", minLength: 1 },
              topic: { type: "string", minLength: 1 },
              importance: stringEnum(["essential", "major", "supporting"]),
            },
          },
        },
      },
    },
    turns: {
      type: "array",
      minItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "speaker", "parts", "delivery"],
        properties: {
          id: { type: "string", minLength: 1 },
          speaker: stringEnum(["host_a", "host_b"]),
          parts: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "text", "cue"],
              properties: {
                kind: stringEnum(["speech", "cue"]),
                text: { type: "string", maxLength: 2500 },
                cue: stringEnum(["none", ...CUES]),
              },
            },
          },
          delivery: {
            type: "object",
            additionalProperties: false,
            required: ["tone", "pace", "pauseAfterMs"],
            properties: {
              tone: stringEnum(TONES),
              pace: stringEnum(PACES),
              pauseAfterMs: { type: "integer", minimum: 0, maximum: 3000 },
            },
          },
        },
      },
    },
  },
} as const;

export const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "issues"],
  properties: {
    passed: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message", "turnIds"],
        properties: {
          code: stringEnum(REVIEW_CODES),
          severity: stringEnum(["warning", "error"]),
          message: { type: "string", minLength: 1 },
          turnIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
