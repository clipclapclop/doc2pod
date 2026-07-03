import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { BUILTIN_PROFILES, loadProfile, overrideVoices } from "../src/profiles.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("profiles", () => {
  test("contains the six curated formats", () => {
    expect(Object.keys(BUILTIN_PROFILES)).toEqual([
      "expert-curious", "expert-skeptic", "friendly-rivals", "coenthusiasts", "clinical-results", "medical-research",
    ]);
    expect(Object.values(BUILTIN_PROFILES).every((item) => item.hosts[1].voice === "zac")).toBe(true);
  });

  test("loads and validates a custom YAML profile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "d2p-profile-"));
    dirs.push(dir);
    const path = join(dir, "profile.yaml");
    await writeFile(path, `
id: test
description: A test format
style: A sufficiently descriptive conversational style.
hosts:
  - { name: A, role: "A sufficiently descriptive first host role.", voice: tara }
  - { name: B, role: "A sufficiently descriptive second host role.", voice: leo }
allowedCues: [chuckle]
`);
    const profile = await loadProfile(undefined, path);
    expect(profile.id).toBe("test");
    expect(profile.hosts[1].voice).toBe("leo");
  });

  test("rejects duplicate voice overrides", async () => {
    const profile = await loadProfile("expert-curious");
    expect(() => overrideVoices(profile, "tara", "tara")).toThrow(/distinct voices/);
  });
});
