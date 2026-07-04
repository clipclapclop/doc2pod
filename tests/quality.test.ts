import { describe, expect, test } from "vitest";
import { prependQualityNotice, warningText } from "../src/quality.js";
import type { EpisodeDraft } from "../src/types.js";

const draft: EpisodeDraft = {
  title: "Test",
  description: "Test",
  blueprint: {
    sourceSummary: "Test",
    contentMode: "report",
    listenerGoal: "Understand the test.",
    throughline: "Explain the test result.",
    targetScriptWords: 10,
    budgetRationale: "Test",
    coverage: [{ id: "c", topic: "Test", importance: "essential" }],
  },
  turns: [
    { id: "t1", speaker: "host_a", parts: [{ kind: "speech", text: "Hello there." }], delivery: { tone: "warm", pace: "normal", pauseAfterMs: 100 } },
    { id: "t2", speaker: "host_b", parts: [{ kind: "speech", text: "Hello back." }], delivery: { tone: "warm", pace: "normal", pauseAfterMs: 100 } },
  ],
};

test("creates a safe fixed warning without review messages", () => {
  const text = warningText(["incomplete_coverage", "unsupported_claim", "needless_complexity"]);
  expect(text).toContain("source details may be incomplete");
  expect(text).toContain("more complicated than the subject requires");
  expect(text).not.toContain("turn");
  expect(prependQualityNotice(draft, ["unsupported_claim"]).turns[0]!.id).toBe("quality_notice");
});
