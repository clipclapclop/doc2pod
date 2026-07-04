import { describe, expect, test } from "vitest";
import { BUILTIN_PROFILES } from "../src/profiles.js";
import { ProcessError, type RunResult } from "../src/process.js";
import { runWithGpuLock, splitTtsPrompt, toTtsTurns } from "../src/tts.js";
import type { EpisodeDraft } from "../src/types.js";

describe("TTS segmentation", () => {
  test("splits long text only at word boundaries", () => {
    const prompt = Array.from({ length: 68 }, (_, index) => `word${index + 1}`).join(" ") + ".";
    const chunks = splitTtsPrompt(prompt);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.split(/\s+/).length <= 30)).toBe(true);
    expect(chunks.join(" ")).toContain("word68.");
  });

  test("preserves speaker voices across split turns", () => {
    const longSpeech = Array.from({ length: 65 }, (_, index) => `detail${index + 1}`).join(" ") + ".";
    const draft: EpisodeDraft = {
      title: "Test",
      description: "Test",
      blueprint: {
        sourceSummary: "Test",
        contentMode: "report",
        listenerGoal: "Understand the test.",
        throughline: "Explain the test result.",
        targetScriptWords: 80,
        budgetRationale: "Test",
        coverage: [{ id: "c", topic: "Test", importance: "essential" }],
      },
      turns: [
        { id: "a", speaker: "host_a", parts: [{ kind: "speech", text: longSpeech }], delivery: { tone: "neutral", pace: "normal", pauseAfterMs: 400 } },
        { id: "b", speaker: "host_b", parts: [{ kind: "speech", text: "A contrasting response." }], delivery: { tone: "skeptical", pace: "normal", pauseAfterMs: 500 } },
      ],
    };
    const turns = toTtsTurns(draft, BUILTIN_PROFILES["expert-curious"]!);
    expect(turns.filter((turn) => turn.speaker === "host_a").map((turn) => turn.voice)).toEqual(["tara", "tara", "tara"]);
    expect(turns.at(-1)).toMatchObject({ speaker: "host_b", voice: "zac", pauseAfterMs: 500 });
    expect(turns[0]!.pauseAfterMs).toBe(40);
  });

  test("prefers clause punctuation when splitting oversized sentences", () => {
    const firstClause = Array.from({ length: 18 }, (_, index) => `first${index + 1}`).join(" ") + ",";
    const secondClause = Array.from({ length: 20 }, (_, index) => `second${index + 1}`).join(" ") + ".";
    expect(splitTtsPrompt(`${firstClause} ${secondClause}`)).toEqual([firstClause, secondClause]);
  });
});

describe("GPU locking", () => {
  test("waits behind an existing TTS job and reports when generation resumes", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const messages: string[] = [];
    const runner = async (command: string, args: string[]): Promise<RunResult> => {
      calls.push({ command, args });
      if (args[0] === "--nonblock") throw new ProcessError("busy", command, 1, "");
      return { stdout: "", stderr: "" };
    };

    await runWithGpuLock("docker", ["run", "image"], {
      flock: "flock-test",
      lockPath: "/tmp/test-gpu.lock",
      runner,
      report: (message) => messages.push(message),
    });

    expect(calls).toEqual([
      { command: "flock-test", args: ["--nonblock", "/tmp/test-gpu.lock", "true"] },
      { command: "flock-test", args: ["--exclusive", "/tmp/test-gpu.lock", "docker", "run", "image"] },
    ]);
    expect(messages).toEqual([
      "Another TTS job is using the GPU; waiting for it to finish...",
      "GPU is available; TTS generation resumed.",
    ]);
  });
});
