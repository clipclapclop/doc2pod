import { describe, expect, test } from "vitest";
import { generationPrompt, repairPrompt, reviewPrompt } from "../src/prompts.js";
import { BUILTIN_PROFILES } from "../src/profiles.js";

const profile = BUILTIN_PROFILES["expert-curious"]!;

describe("editorial prompts", () => {
  test("generation emphasizes listener outcomes and object-level coverage", () => {
    const prompt = generationPrompt(profile, "balanced", 2000);
    expect(prompt).toContain("what the listener should understand or be able to do afterward");
    expect(prompt).toContain("Cover the subject itself");
    expect(prompt).toContain("For procedural material, give complete ordered instructions");
    expect(prompt).toContain("For scientific material, establish the question");
    expect(prompt).toContain("Use the simplest vocabulary that preserves technical precision but no simpler");
    expect(prompt).toContain("each must contribute at least 15%");
    expect(prompt).not.toContain("each must contribute at least 25%");
  });

  test("review audits meta narration, structure, clarity, and complexity", () => {
    const prompt = reviewPrompt(profile, "thorough");
    expect(prompt).toContain("directly covers the subject");
    expect(prompt).toContain("complete ordered directions for procedural material");
    expect(prompt).toContain("without already knowing the document");
    expect(prompt).toContain("Use genre_mismatch");
    expect(prompt).toContain("meta_narration");
    expect(prompt).toContain("unclear_explanation");
    expect(prompt).toContain("needless_complexity");
  });

  test("repair preserves the same presentation standard", () => {
    const prompt = repairPrompt(profile, "concise");
    expect(prompt).toContain("Correct the blueprint");
    expect(prompt).toContain("Cover the subject itself");
    expect(prompt).toContain("Use the simplest vocabulary that preserves technical precision but no simpler");
    expect(prompt).toContain("each must contribute at least 15%");
  });
});
