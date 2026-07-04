  # Document-to-Podcast CLI

  ## Summary

  Build a TypeScript CLI that converts UTF-8 text or Markdown into a two-host MP3:

  1. Generate a structured conversation through the locally authenticated Codex CLI.
  2. Review and repair it up to two times for fidelity and quality.
  3. Render each speaker through a containerized Orpheus worker using named voices.
  4. Assemble and loudness-normalize the episode with FFmpeg.
  5. Print machine-readable episode metadata to stdout.

  Intermediate artifacts are temporary by default. No Codex skill is required; prompts, schemas, and profiles
  remain versioned application code.

  ## CLI and Interfaces

  - Primary command:

    doc2pod build INPUT --output EPISODE.mp3 \
      --format expert-skeptic \
      --detail balanced \
      [--voice-a tara] [--voice-b zac] \
      [--sensitive] [--max-script-words 12000] \
      [--keep-work] [--force]

  - Add doc2pod doctor to report Codex installation/authentication, FFmpeg/MP3 support, Docker access, NVIDIA
    driver status, CUDA container runtime, and disk-space problems. It never installs or modifies the system.

  - Add doc2pod profiles to list formats, roles, and valid Orpheus voices.
  - Built-in formats:
      - expert-curious
      - expert-skeptic
      - friendly-rivals
      - coenthusiasts
      - clinical-results
      - medical-research

  - Support --profile custom.yaml instead of --format. Validate exactly two roles, coherent style instructions,
    distinct supported voices, and allowed delivery cues.

  - Detail levels mean coverage, not duration:
      - concise: central conclusions and strongest evidence.
      - balanced: all major claims and representative evidence.
      - thorough: nearly all substantive detail and uncertainty.

  - The LLM chooses a reasoned word budget. Record the output/input ratio as telemetry; for inputs of at least 500
    words, ratios below 0.15 or above 2.0 trigger review warnings but do not independently fail. The configurable
    absolute word limit is the hard safety control.

  - Emit one JSON object on stdout containing title, description, output path, duration, source SHA-256, source/
    script word counts, ratio, format, detail, review outcome, and warning codes. Do not create a sidecar file.

  - Refuse to overwrite output unless --force is supplied. MP3 is the only final format in v1.

  - Permit concurrent CLI processes, but serialize GPU-backed TTS across them with an automatically released
    cross-process lock. A waiting process remains active, reports wait/resume progress on stderr, and continues
    without caller intervention. Document for agents that GPU waiting is not a failure and must not trigger a
    retry or replacement build.

  ## Generation and Audio Pipeline

  - Invoke codex exec using saved ChatGPT authentication, --ephemeral, read-only sandboxing, an empty temporary
    working directory, ignored user configuration/rules, disabled web search, and an output JSON Schema. Treat the
    source as delimited untrusted data and prohibit external facts or source-embedded instructions.

  - The generation response contains:
      - Episode title and description.
      - Coverage blueprint with content mode, listener goal, throughline, and adaptive word-budget rationale.
      - Two host definitions and engine voice names.
      - Ordered turns containing speaker ID, speech/cue parts, tone, pace, and pauses.

  - Validate schema, speaker references, cue types, empty/oversized turns, word limit, unsupported tags, and
    profile constraints programmatically.

  - Run semantic review against the source for coverage, unsupported claims, distorted uncertainty, duplication,
    role adherence, unsafe medical inference, content-mode fit, avoidable meta narration, explanatory clarity, and
    needless linguistic complexity. Repair and re-review up to twice.

  - If final editorial issues remain, still render the episode and prepend a fixed code-generated spoken warning
    summarizing safe categories such as incomplete coverage or possibly unsupported claims. Invalid structure or
    failed audio generation remains a fatal error.

  - clinical-results adds no general spoken disclaimer, but must not invent diagnoses, treatment, prognosis, or
    reassurance and must preserve values, units, reference ranges, and source uncertainty.

  - Implement Orpheus behind a TTS adapter. The containerized Python worker loads the model once, uses named
    English voices such as tara and leo, renders every turn, and returns WAV segments. Pin the model source commit
    and Python/CUDA dependencies rather than tracking latest versions.

  - Map Orpheus-supported cues such as laugh, chuckle, sigh, cough, sniffle, groan, yawn, and gasp. Apply pauses
    exactly; tone and pace remain best-effort guidance expressed through wording and punctuation.

  - Assemble segments with short edge fades and silence, normalize mono output to approximately -19 LUFS and -1.5
    dBTP, then encode a 96 kbps MP3 with embedded title and description.

  - Use owner-only temporary directories. Normal runs delete them on success unless --keep-work; sensitive runs
    always delete them on success or failure, redact source text from diagnostics, and reject --keep-work.

  ## Test Plan

  - Unit-test CLI validation, built-in/custom profiles, adaptive budget handling, schema validation, warning
    templates, source hashing, sensitive cleanup, and JSON stdout.

  - Use fake Codex and TTS executables to test passing review, two repair cycles, residual-warning audio, malformed
    responses, subprocess failures, and prompt-injection text.

  - Integration-test FFmpeg assembly with synthetic segments; verify codec, mono channel layout, duration,
    ordering, loudness tolerance, and warning placement using ffprobe.

  - Add container contract tests for manifests, voices, cues, and partial-render cleanup without loading the full
    model.

  - Add an opt-in CUDA smoke test that renders both voices on the RTX 3080.
  - Acceptance fixtures cover short and multi-section documents across all detail levels, medical-result fidelity,
    adversarial source instructions, and sensitive-mode failure cleanup.

  ## Assumptions

  - This is a personal, trusted local tool; RSS publication remains downstream.
  - Real Orpheus rendering in v1 requires repairing the NVIDIA driver, Docker socket access, and NVIDIA container
    runtime. CPU Orpheus rendering is deferred.

  - ChatGPT subscription usage is accessed through the authenticated Codex CLI, not the separately billed general
    API. Codex supports saved ChatGPT authentication and schema-constrained noninteractive output; API billing
    remains separate. Codex authentication (https://developers.openai.com/codex/auth/), noninteractive mode
    (https://developers.openai.com/codex/noninteractive/), API billing separation
    (https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api)

  - Orpheus is selected because its official implementation provides named voices and supported emotive tags.
    Orpheus TTS (https://github.com/canopyai/Orpheus-TTS)
