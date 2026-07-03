# doc2podcast

`doc2podcast` converts a UTF-8 text or Markdown report into a source-faithful, two-host MP3. It uses the locally authenticated Codex CLI for script generation and review, a GPU-backed Orpheus container for named voices, and FFmpeg for assembly and podcast loudness normalization.

## Current requirements

- Node.js 22 or newer
- Codex CLI, logged in with `codex login`
- FFmpeg and FFprobe with `libmp3lame`
- Docker with access for the current user
- NVIDIA driver and NVIDIA Container Toolkit
- An NVIDIA GPU suitable for Orpheus; the initial implementation targets the local RTX 3080

The CLI never installs these dependencies. Run `doc2podcast doctor` for machine-readable diagnostics and remediation guidance.

## Setup

```sh
npm install
npm run build
export HF_TOKEN=your_read_only_hugging_face_token
docker build --secret id=hf_token,env=HF_TOKEN -t doc2podcast-orpheus:local tts-worker
npm link
doc2podcast doctor
```

Before building, accept the access conditions for `canopylabs/orpheus-3b-0.1-ft` on Hugging Face and create a read-only token. BuildKit mounts the token as a secret; it is not stored in an image layer. The image is large because its build embeds an immutable model revision. Runtime networking is disabled so rendered script content stays inside the local container.

## Usage

```sh
doc2podcast build report.md \
  --output report.mp3 \
  --format expert-skeptic \
  --detail balanced
```

Available formats and voices:

```sh
doc2podcast profiles
```

Use a custom profile:

```sh
doc2podcast build report.txt \
  --output report.mp3 \
  --profile examples/custom-profile.yaml \
  --detail thorough
```

Successful builds print one JSON object to stdout. Progress and errors go to stderr. Existing outputs are protected unless `--force` is supplied.

### Sensitive documents

`--sensitive` uses owner-only temporary storage, removes staging data on success and failure, suppresses subprocess details that could contain source material, and rejects `--keep-work`.

The document is still sent to OpenAI through the authenticated Codex CLI. Sensitive mode reduces local retention; it does not make script generation local.

### Debugging without Orpheus

Set `DOC2PODCAST_MOCK_TTS=1` to exercise the complete pipeline with synthetic tones. This is intended for development and does not produce speech.

Set `DOC2PODCAST_TTS_IMAGE` to use a differently tagged Orpheus image. Set `DOC2PODCAST_CODEX` to use a compatible Codex test wrapper.

## Pipeline behavior

Codex generates a coverage blueprint and structured script, then reviews the script against the source. Error-level editorial findings trigger up to two repair-and-review cycles. If findings remain, the MP3 is still produced with a fixed spoken quality notice prepended. Mechanical failures such as invalid structured output, missing audio, or failed assembly stop the build.

Input documents are treated as untrusted content. Codex runs ephemerally in a read-only temporary workspace with user rules and web search disabled. No reusable Codex skill is required; prompts, schemas, and show profiles are versioned with this application.
# doc2podcast
