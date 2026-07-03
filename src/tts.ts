import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ProcessError, run, type RunOptions, type RunResult } from "./process.js";
import type { EpisodeDraft, ShowProfile, TtsManifestTurn } from "./types.js";

export interface TtsRenderResult {
  segmentPaths: string[];
  turns: TtsManifestTurn[];
}

export interface TtsRenderer {
  render(draft: EpisodeDraft, profile: ShowProfile, workDir: string, sensitive: boolean): Promise<TtsRenderResult>;
}

type CommandRunner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

export interface GpuLockOptions {
  lockPath?: string;
  flock?: string;
  sensitive?: boolean;
  runner?: CommandRunner;
  report?: (message: string) => void;
}

function defaultGpuLockPath(): string {
  const user = typeof process.getuid === "function" ? process.getuid() : process.env.USER ?? "user";
  return join(tmpdir(), `doc2pod-${user}.gpu.lock`);
}

/** Run a command while holding the process-wide advisory lock for the GPU. */
export async function runWithGpuLock(command: string, args: string[], options: GpuLockOptions = {}): Promise<RunResult> {
  const runner = options.runner ?? run;
  const flock = options.flock ?? process.env.DOC2POD_FLOCK ?? "flock";
  const lockPath = options.lockPath ?? process.env.DOC2POD_GPU_LOCK ?? defaultGpuLockPath();
  const runOptions: RunOptions = options.sensitive === undefined ? {} : { sensitive: options.sensitive };
  let busy = false;
  try {
    await runner(flock, ["--nonblock", lockPath, "true"], runOptions);
  } catch (error) {
    if (!(error instanceof ProcessError) || error.command !== flock || error.exitCode !== 1) throw error;
    busy = true;
  }
  if (busy) options.report?.("Another TTS job is using the GPU; waiting for it to finish...");
  const result = await runner(flock, ["--exclusive", lockPath, command, ...args], runOptions);
  if (busy) options.report?.("GPU is available; TTS generation resumed.");
  return result;
}

// Keep requests comfortably below the worker's acoustic-token budget while
// avoiding excessive joins. Oversized sentences prefer clause punctuation.
const MAX_TTS_WORDS = 30;
const MIN_CLAUSE_WORDS = 12;

function spokenWordCount(text: string): number {
  const withoutCues = text.replace(/<[^>]+>/g, " ");
  return (withoutCues.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function splitOversizedSentence(sentence: string): string[] {
  if (spokenWordCount(sentence) <= MAX_TTS_WORDS) return [sentence.trim()];
  const words = sentence.trim().split(/\s+/);
  const chunks: string[] = [];
  for (let start = 0; start < words.length;) {
    const remaining = words.length - start;
    if (remaining <= MAX_TTS_WORDS) {
      chunks.push(words.slice(start).join(" "));
      break;
    }
    let end = start + MAX_TTS_WORDS;
    for (let candidate = end; candidate >= start + MIN_CLAUSE_WORDS; candidate -= 1) {
      if (/[,;:\u2014]$/.test(words[candidate - 1]!)) {
        end = candidate;
        break;
      }
    }
    let chunk = words.slice(start, end).join(" ");
    const isLast = end >= words.length;
    if (!isLast && !/[,:;.!?]$/.test(chunk)) chunk += ",";
    chunks.push(chunk);
    start = end;
  }
  return chunks;
}

export function splitTtsPrompt(prompt: string): string[] {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentences = [...segmenter.segment(normalized)].map(({ segment }) => segment.trim()).filter(Boolean);
  const pieces = sentences.flatMap(splitOversizedSentence);
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const combined = current ? `${current} ${piece}` : piece;
    if (current && spokenWordCount(combined) > MAX_TTS_WORDS) {
      chunks.push(current);
      current = piece;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function toTtsTurns(draft: EpisodeDraft, profile: ShowProfile): TtsManifestTurn[] {
  const voices = new Map(profile.hosts.map((host) => [host.id, host.voice]));
  return draft.turns.flatMap((turn) => {
    const prompt = turn.parts.map((part) => part.kind === "speech" ? part.text : `<${part.cue}>`).join(" ");
    const chunks = splitTtsPrompt(prompt);
    return chunks.map((chunk, index) => ({
      id: chunks.length === 1 ? turn.id : `${turn.id}.tts${String(index + 1).padStart(2, "0")}`,
      speaker: turn.speaker,
      voice: voices.get(turn.speaker)!,
      prompt: chunk,
      pauseAfterMs: index === chunks.length - 1 ? turn.delivery.pauseAfterMs : 40,
    }));
  });
}

export class OrpheusContainerRenderer implements TtsRenderer {
  constructor(
    private readonly image = process.env.DOC2POD_TTS_IMAGE ?? "doc2pod-orpheus:local",
    private readonly docker = process.env.DOC2POD_DOCKER ?? "docker",
  ) {}

  async render(draft: EpisodeDraft, profile: ShowProfile, workDir: string, sensitive: boolean): Promise<TtsRenderResult> {
    const turns = toTtsTurns(draft, profile);
    const segmentsDir = join(workDir, "segments");
    await mkdir(segmentsDir, { recursive: true, mode: 0o700 });
    const manifestPath = join(workDir, "tts-manifest.json");
    await writeFile(manifestPath, JSON.stringify({ version: 1, turns }), { mode: 0o600 });
    const mounted = resolve(workDir);
    const dockerArgs = [
      "run", "--rm", "--gpus", "all",
      "--network", "none",
      "--shm-size", "2g",
      "--mount", `type=bind,source=${mounted},target=/work`,
      this.image,
      "/work/tts-manifest.json",
      "/work/segments",
    ];
    await runWithGpuLock(this.docker, dockerArgs, {
      sensitive,
      report: (message) => process.stderr.write(`${message}\n`),
    });
    const names = (await readdir(segmentsDir)).filter((name) => name.endsWith(".wav")).sort();
    if (names.length !== turns.length) throw new Error(`TTS produced ${names.length} segments for ${turns.length} turns`);
    return { turns, segmentPaths: names.map((name) => join(segmentsDir, name)) };
  }
}

export class MockTtsRenderer implements TtsRenderer {
  async render(draft: EpisodeDraft, profile: ShowProfile, workDir: string, sensitive: boolean): Promise<TtsRenderResult> {
    const turns = toTtsTurns(draft, profile);
    const segmentsDir = join(workDir, "segments");
    await mkdir(segmentsDir, { recursive: true, mode: 0o700 });
    await writeFile(join(workDir, "tts-manifest.json"), JSON.stringify({ version: 1, turns }), { mode: 0o600 });
    const paths: string[] = [];
    for (const [index, turn] of turns.entries()) {
      const path = join(segmentsDir, `${String(index).padStart(5, "0")}.wav`);
      const words = turn.prompt.split(/\s+/).length;
      const duration = Math.max(0.35, Math.min(4, words / 150 * 60));
      const frequency = turn.speaker === "host_a" ? 440 : 554;
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=24000:duration=${duration}`,
        "-ac", "1", "-c:a", "pcm_s16le", path,
      ], { sensitive });
      paths.push(path);
    }
    return { turns, segmentPaths: paths };
  }
}
