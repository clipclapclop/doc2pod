#!/usr/bin/env node
import { parseArgs } from "node:util";
import { CodexExecRunner } from "./codex.js";
import { runDoctor } from "./doctor.js";
import { DEFAULT_DETAIL, DEFAULT_FORMAT, defaultOutputPath, isDocumentShorthand } from "./options.js";
import { buildPodcast } from "./pipeline.js";
import { BUILTIN_PROFILES, loadProfile, overrideVoices } from "./profiles.js";
import { DETAILS, VOICES, type Detail } from "./types.js";
import { MockTtsRenderer, OrpheusContainerRenderer } from "./tts.js";

const HELP = `doc2pod - convert a UTF-8 text or Markdown document into a two-host MP3

Usage:
  doc2pod INPUT [options]
  doc2pod build INPUT [options]
  doc2pod doctor
  doc2pod profiles

Build options:
  --output PATH             MP3 path (default: INPUT basename with .mp3)
  --format NAME             Built-in show format (default: expert-curious)
  --profile PATH            Custom YAML profile (mutually exclusive with --format)
  --detail LEVEL            concise, balanced, or thorough (default: balanced)
  --voice-a NAME            Override host A's Orpheus voice
  --voice-b NAME            Override host B's Orpheus voice
  --max-script-words N      Hard script limit (default: 12000)
  --sensitive               Minimize retention and redact subprocess errors
  --keep-work               Keep intermediate artifacts (not allowed with --sensitive)
  --force                   Replace an existing output file
  --help                    Show this help

Examples:
  doc2pod report.md
  doc2pod report.md --format expert-skeptic --detail thorough
  doc2pod results.txt --format clinical-results --sensitive
  doc2pod game-notes.md --format friendly-rivals --output episode.mp3

Format guidance:
  expert-curious   General default; clear expert and curious non-specialist
  expert-skeptic   Evidence, limitations, and constructive challenge
  friendly-rivals  Sports, gaming, or other playful opposing viewpoints
  coenthusiasts    Technology, cars, fishing, and shared-interest discussion
  clinical-results Personal medical results; normally pair with --sensitive
  medical-research Medical studies and scientific findings

Concurrency:
  Concurrent builds are supported. GPU-backed TTS runs one job at a time; a
  process may wait at the TTS stage and then resumes automatically. A GPU wait
  message on stderr is progress, not failure. Keep waiting for the process;
  do not retry or launch a replacement build.

For unspecified choices, use the defaults. Run 'doc2pod profiles' only when
the request or document implies a different presentation. Successful builds print one JSON
object to stdout; progress and diagnostics go to stderr.
`;

function fail(message: string): never {
  process.stderr.write(`doc2pod: ${message}\n`);
  process.exit(1);
}

async function build(argv: string[]): Promise<void> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string" },
      profile: { type: "string" },
      detail: { type: "string" },
      "voice-a": { type: "string" },
      "voice-b": { type: "string" },
      "max-script-words": { type: "string", default: "12000" },
      sensitive: { type: "boolean", default: false },
      "keep-work": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      "mock-tts": { type: "boolean", default: false },
    },
  });
  if (parsed.values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.positionals.length !== 1) fail("build requires exactly one input path");
  const inputPath = parsed.positionals[0]!;
  const outputPath = parsed.values.output ?? defaultOutputPath(inputPath);
  const detail = parsed.values.detail ?? DEFAULT_DETAIL;
  if (!DETAILS.includes(detail as Detail)) fail(`--detail must be one of: ${DETAILS.join(", ")}`);
  const maxWords = Number(parsed.values["max-script-words"]);
  const format = parsed.values.format ?? (parsed.values.profile ? undefined : DEFAULT_FORMAT);
  const loaded = await loadProfile(format, parsed.values.profile);
  const profile = overrideVoices(loaded, parsed.values["voice-a"], parsed.values["voice-b"]);
  process.stderr.write(`Generating '${profile.id}'/${detail} episode from ${inputPath} to ${outputPath}...\n`);
  const result = await buildPodcast({
    inputPath,
    outputPath,
    detail: detail as Detail,
    profile,
    maxScriptWords: maxWords,
    sensitive: parsed.values.sensitive,
    keepWork: parsed.values["keep-work"],
    force: parsed.values.force,
    createCodex: (workDir, sensitive) => new CodexExecRunner(workDir, sensitive),
    tts: parsed.values["mock-tts"] || process.env.DOC2POD_MOCK_TTS === "1" ? new MockTtsRenderer() : new OrpheusContainerRenderer(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "build") return await build(argv);
  if (isDocumentShorthand(command)) return await build([command, ...argv]);
  if (command === "doctor") {
    const checks = await runDoctor();
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
    if (checks.some((check) => check.status === "error")) process.exitCode = 1;
    return;
  }
  if (command === "profiles") {
    process.stdout.write(`${JSON.stringify({
      formats: Object.values(BUILTIN_PROFILES),
      voices: VOICES,
    }, null, 2)}\n`);
    return;
  }
  fail(`unknown command '${command}'\n\n${HELP}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
