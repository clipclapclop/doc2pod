import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./process.js";
import { generationPrompt, repairPrompt, reviewPrompt } from "./prompts.js";
import { episodeSchema, reviewSchema } from "./schemas.js";
import type { Detail, EpisodeDraft, ReviewResult, ShowProfile } from "./types.js";
import { validateEpisode, validateReview } from "./validate.js";

export interface CodexRunner {
  generate(document: string, profile: ShowProfile, detail: Detail, maxWords: number): Promise<EpisodeDraft>;
  review(document: string, draft: EpisodeDraft, profile: ShowProfile, detail: Detail): Promise<ReviewResult>;
  repair(document: string, draft: EpisodeDraft, review: ReviewResult, profile: ShowProfile, detail: Detail, maxWords: number): Promise<EpisodeDraft>;
  dispose?(): Promise<void>;
}

export class CodexExecRunner implements CodexRunner {
  private sequence = 0;
  private readonly isolatedCodexHome: string;
  private initialized = false;

  constructor(
    private readonly workDir: string,
    private readonly sensitive: boolean,
    private readonly executable = process.env.DOC2POD_CODEX ?? "codex",
  ) {
    this.isolatedCodexHome = join(workDir, ".codex-runtime");
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.isolatedCodexHome, { recursive: true, mode: 0o700 });
    await chmod(this.isolatedCodexHome, 0o700);
    const sourceHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    try {
      await copyFile(join(sourceHome, "auth.json"), join(this.isolatedCodexHome, "auth.json"));
      await chmod(join(this.isolatedCodexHome, "auth.json"), 0o600);
    } catch {
      throw new Error("Could not copy saved Codex authentication. Run `codex login` and verify CODEX_HOME/auth.json is readable.");
    }
    this.initialized = true;
  }

  private async invoke(prompt: string, input: unknown, schema: object, label: string): Promise<unknown> {
    await this.initialize();
    const id = `${String(this.sequence++).padStart(2, "0")}-${label}`;
    const schemaPath = join(this.workDir, `${id}.schema.json`);
    const outputPath = join(this.workDir, `${id}.output.json`);
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--cd",
      this.workDir,
      "--config",
      'web_search="disabled"',
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      prompt,
    ];
    await run(this.executable, args, {
      cwd: this.workDir,
      input: JSON.stringify(input),
      sensitive: this.sensitive,
      env: { ...process.env, CODEX_HOME: this.isolatedCodexHome },
    });
    const raw = await readFile(outputPath, "utf8");
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(this.sensitive ? `Codex returned invalid JSON during ${label}` : `Codex returned invalid JSON during ${label}: ${raw.slice(0, 500)}`);
    }
  }

  async generate(document: string, profile: ShowProfile, detail: Detail, maxWords: number): Promise<EpisodeDraft> {
    const value = await this.invoke(generationPrompt(profile, detail, maxWords), { document }, episodeSchema, "generate");
    return validateEpisode(value, profile, maxWords);
  }

  async review(document: string, draft: EpisodeDraft, profile: ShowProfile, detail: Detail): Promise<ReviewResult> {
    const value = await this.invoke(reviewPrompt(profile, detail), { document, draft }, reviewSchema, "review");
    return validateReview(value);
  }

  async repair(document: string, draft: EpisodeDraft, review: ReviewResult, profile: ShowProfile, detail: Detail, maxWords: number): Promise<EpisodeDraft> {
    const value = await this.invoke(repairPrompt(profile, detail), { document, draft, review, maxScriptWords: maxWords }, episodeSchema, "repair");
    return validateEpisode(value, profile, maxWords);
  }

  async dispose(): Promise<void> {
    await rm(this.isolatedCodexHome, { recursive: true, force: true });
  }
}
