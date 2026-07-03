import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { run } from "./process.js";
import type { TtsRenderResult } from "./tts.js";

async function probeDuration(path: string, sensitive: boolean): Promise<number> {
  const result = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path,
  ], { sensitive });
  const value = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid audio segment produced for ${basename(path)}`);
  return value;
}

function concatEscape(path: string): string {
  return path.replaceAll("'", "'\\''");
}

export async function assembleMp3(
  rendered: TtsRenderResult,
  outputPath: string,
  title: string,
  description: string,
  workDir: string,
  sensitive: boolean,
): Promise<number> {
  if (rendered.segmentPaths.length === 0 || rendered.segmentPaths.length !== rendered.turns.length) {
    throw new Error("Cannot assemble incomplete TTS output");
  }
  const paddedDir = join(workDir, "padded");
  await mkdir(paddedDir, { recursive: true, mode: 0o700 });
  const padded: string[] = [];
  for (const [index, segment] of rendered.segmentPaths.entries()) {
    const duration = await probeDuration(segment, sensitive);
    const pauseSeconds = rendered.turns[index]!.pauseAfterMs / 1000;
    const output = join(paddedDir, `${String(index).padStart(5, "0")}.wav`);
    const fadeOutStart = Math.max(0, duration - 0.005);
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", segment,
      "-af", `aresample=24000,afade=t=in:st=0:d=0.005,afade=t=out:st=${fadeOutStart}:d=0.005,apad=pad_dur=${pauseSeconds}`,
      "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", output,
    ], { sensitive });
    padded.push(output);
  }
  const concatPath = join(workDir, "segments.concat.txt");
  await writeFile(concatPath, padded.map((path) => `file '${concatEscape(resolve(path))}'`).join("\n") + "\n", { mode: 0o600 });
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryOutput = join(workDir, "final.mp3");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "concat", "-safe", "0", "-i", concatPath,
    "-af", "loudnorm=I=-19:TP=-1.5:LRA=7",
    "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "96k",
    "-metadata", `title=${title}`,
    "-metadata", `comment=${description}`,
    temporaryOutput,
  ], { sensitive });
  const { rename } = await import("node:fs/promises");
  await rename(temporaryOutput, outputPath);
  return await probeDuration(outputPath, sensitive);
}
