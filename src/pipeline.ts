import { constants } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { assembleMp3 } from "./audio.js";
import type { CodexRunner } from "./codex.js";
import { prependQualityNotice, unresolvedErrorCodes } from "./quality.js";
import type { BuildResult, Detail, ReviewResult, ShowProfile } from "./types.js";
import type { TtsRenderer } from "./tts.js";
import { countWords, scriptText } from "./validate.js";

export interface BuildOptions {
  inputPath: string;
  outputPath: string;
  detail: Detail;
  profile: ShowProfile;
  maxScriptWords: number;
  sensitive: boolean;
  keepWork: boolean;
  force: boolean;
  createCodex: (workDir: string, sensitive: boolean) => CodexRunner;
  tts: TtsRenderer;
}

async function readDocument(path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (extension !== ".txt" && extension !== ".md") throw new Error("Input must be a UTF-8 .txt or .md file");
  const bytes = await readFile(path);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Input is not valid UTF-8");
  }
  if (!text.trim()) throw new Error("Input document is empty");
  return text;
}

export async function buildPodcast(options: BuildOptions): Promise<BuildResult> {
  if (extname(options.outputPath).toLowerCase() !== ".mp3") throw new Error("Output must use the .mp3 extension");
  if (!Number.isInteger(options.maxScriptWords) || options.maxScriptWords < 100) throw new Error("--max-script-words must be an integer of at least 100");
  if (options.sensitive && options.keepWork) throw new Error("--keep-work cannot be used with --sensitive");
  const outputPath = resolve(options.outputPath);
  if (!options.force) {
    try {
      await access(outputPath, constants.F_OK);
      throw new Error(`Output already exists: ${outputPath}. Use --force to replace it.`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Output already exists")) throw error;
    }
  }
  const inputPath = resolve(options.inputPath);
  const inputStat = await stat(inputPath);
  if (!inputStat.isFile()) throw new Error("Input path must be a regular file");
  const document = await readDocument(inputPath);
  const sourceWords = countWords(document);
  const sourceSha256 = createHash("sha256").update(document).digest("hex");
  const workDir = await mkdtemp(`${tmpdir()}/doc2pod-`);
  await chmod(workDir, 0o700);
  let succeeded = false;
  let codex: CodexRunner | undefined;
  try {
    codex = options.createCodex(workDir, options.sensitive);
    let draft = await codex.generate(document, options.profile, options.detail, options.maxScriptWords);
    let review: ReviewResult = { passed: false, issues: [] };
    let repairs = 0;
    for (;;) {
      review = await codex.review(document, draft, options.profile, options.detail);
      if (unresolvedErrorCodes(review).length === 0 || repairs >= 2) break;
      draft = await codex.repair(document, draft, review, options.profile, options.detail, options.maxScriptWords);
      repairs += 1;
    }
    const scriptWords = countWords(scriptText(draft));
    const ratio = sourceWords === 0 ? 0 : scriptWords / sourceWords;
    const warnings: string[] = review.issues.map((issue) => issue.code);
    if (sourceWords >= 500 && ratio < 0.15) warnings.push("unusually_short_script");
    if (sourceWords >= 500 && ratio > 2) warnings.push("unusually_long_script");
    const errorCodes = unresolvedErrorCodes(review);
    const rendered = await options.tts.render(prependQualityNotice(draft, errorCodes), options.profile, workDir, options.sensitive);
    const durationSeconds = await assembleMp3(rendered, outputPath, draft.title, draft.description, workDir, options.sensitive);
    succeeded = true;
    return {
      status: "ok",
      outputPath,
      title: draft.title,
      description: draft.description,
      durationSeconds,
      sourceSha256,
      sourceWords,
      scriptWords,
      outputInputRatio: Number(ratio.toFixed(4)),
      format: options.profile.id,
      detail: options.detail,
      review: { repairs, passed: errorCodes.length === 0, issueCodes: [...new Set(review.issues.map((issue) => issue.code))] },
      warnings: [...new Set(warnings)],
      ...(!options.sensitive && options.keepWork ? { workDir } : {}),
    };
  } finally {
    await codex?.dispose?.();
    if (options.sensitive || (succeeded && !options.keepWork)) await rm(workDir, { recursive: true, force: true });
    else if (!succeeded) process.stderr.write(`Work directory retained after failure: ${workDir}\n`);
  }
}
