import { describe, expect, test } from "vitest";
import { BUILTIN_PROFILES } from "../src/profiles.js";
import { countWords, validateEpisode, validateReview } from "../src/validate.js";

const validEpisode = {
  title: "Example",
  description: "An example episode.",
  blueprint: {
    sourceSummary: "A compact source summary.",
    targetScriptWords: 100,
    budgetRationale: "The document is short and moderately dense.",
    coverage: [{ id: "c1", topic: "Main result", importance: "essential" }],
  },
  turns: [
    { id: "t1", speaker: "host_a", parts: [{ kind: "speech", text: "What did the report find?", cue: "none" }], delivery: { tone: "curious", pace: "normal", pauseAfterMs: 200 } },
    { id: "t2", speaker: "host_b", parts: [{ kind: "speech", text: "It found a carefully qualified result.", cue: "none" }], delivery: { tone: "neutral", pace: "normal", pauseAfterMs: 300 } },
  ],
};

describe("validation", () => {
  test("counts natural-language words", () => {
    expect(countWords("One well-qualified result isn't proof.")).toBe(5);
  });

  test("accepts a valid episode", () => {
    expect(validateEpisode(validEpisode, BUILTIN_PROFILES["expert-curious"]!, 1000).turns).toHaveLength(2);
  });

  test("rejects raw TTS tags in speech", () => {
    const invalid = structuredClone(validEpisode);
    invalid.turns[0]!.parts[0]!.text = "Hello <laugh>";
    expect(() => validateEpisode(invalid, BUILTIN_PROFILES["expert-curious"]!, 1000)).toThrow(/Raw control tags/);
  });

  test("rejects contradictory review output", () => {
    expect(() => validateReview({
      passed: true,
      issues: [{ code: "unsupported_claim", severity: "error", message: "Problem", turnIds: ["t2"] }],
    })).toThrow(/cannot pass/);
  });

  test("rejects a script spoken by only one host", () => {
    const invalid = structuredClone(validEpisode);
    invalid.turns[1]!.speaker = "host_a";
    expect(() => validateEpisode(invalid, BUILTIN_PROFILES["expert-curious"]!, 1000)).toThrow(/both host_a and host_b/);
  });
});
