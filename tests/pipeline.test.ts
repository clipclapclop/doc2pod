import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { CodexRunner } from "../src/codex.js";
import { buildPodcast } from "../src/pipeline.js";
import { BUILTIN_PROFILES } from "../src/profiles.js";
import { MockTtsRenderer } from "../src/tts.js";
import type { EpisodeDraft, ReviewResult } from "../src/types.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

function episode(): EpisodeDraft {
  return {
    title: "A Report Explained",
    description: "Two hosts explain a report.",
    blueprint: {
      sourceSummary: "The report contains one finding.",
      targetScriptWords: 100,
      budgetRationale: "A short source needs a short episode.",
      coverage: [{ id: "finding", topic: "The finding", importance: "essential" }],
    },
    turns: [
      { id: "t1", speaker: "host_a", parts: [{ kind: "speech", text: "What is the main finding?" }], delivery: { tone: "curious", pace: "normal", pauseAfterMs: 50 } },
      { id: "t2", speaker: "host_b", parts: [{ kind: "speech", text: "The source reports a measured improvement." }], delivery: { tone: "neutral", pace: "normal", pauseAfterMs: 50 } },
    ],
  };
}

class FakeCodex implements CodexRunner {
  repairs = 0;
  reviews = 0;
  constructor(private readonly unresolved = false) {}
  async generate(): Promise<EpisodeDraft> { return episode(); }
  async review(): Promise<ReviewResult> {
    this.reviews += 1;
    if (this.unresolved || this.repairs < 2) {
      return { passed: false, issues: [{ code: "incomplete_coverage", severity: "error", message: "Coverage issue", turnIds: ["t2"] }] };
    }
    return { passed: true, issues: [] };
  }
  async repair(): Promise<EpisodeDraft> { this.repairs += 1; return episode(); }
}

describe("pipeline", () => {
  test("performs at most two repairs and produces an MP3", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2p-test-"));
    dirs.push(dir);
    const input = join(dir, "input.md");
    const output = join(dir, "episode.mp3");
    await writeFile(input, "# Report\n\nThe source reports a measured improvement.");
    const codex = new FakeCodex();
    const result = await buildPodcast({
      inputPath: input, outputPath: output, detail: "balanced", profile: BUILTIN_PROFILES["expert-curious"]!,
      maxScriptWords: 1000, sensitive: false, keepWork: false, force: false,
      createCodex: () => codex, tts: new MockTtsRenderer(),
    });
    expect(codex.repairs).toBe(2);
    expect(codex.reviews).toBe(3);
    expect(result.review.passed).toBe(true);
    expect(result.durationSeconds).toBeGreaterThan(0);
    await expect(access(output)).resolves.toBeUndefined();
  }, 30_000);

  test("renders a quality notice after unresolved editorial errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2p-test-"));
    dirs.push(dir);
    const input = join(dir, "input.txt");
    const output = join(dir, "episode.mp3");
    await writeFile(input, "The source reports a measured improvement.");
    const codex = new FakeCodex(true);
    const result = await buildPodcast({
      inputPath: input, outputPath: output, detail: "concise", profile: BUILTIN_PROFILES["expert-curious"]!,
      maxScriptWords: 1000, sensitive: false, keepWork: true, force: false,
      createCodex: () => codex, tts: new MockTtsRenderer(),
    });
    expect(result.review.passed).toBe(false);
    expect(result.review.issueCodes).toContain("incomplete_coverage");
    expect(result.workDir).toBeTruthy();
    const manifest = JSON.parse(await readFile(join(result.workDir!, "tts-manifest.json"), "utf8")) as { turns: Array<{ id: string }> };
    expect(manifest.turns[0]!.id).toBe("quality_notice");
    await rm(result.workDir!, { recursive: true, force: true });
  }, 30_000);
});
