# doc2pod

`doc2pod` converts a UTF-8 text or Markdown document into a source-faithful, two-host MP3. It uses the locally authenticated Codex CLI for script generation and review, a GPU-backed Orpheus container for named voices, and FFmpeg for audio assembly.

## Quick start

The minimal command is:

```sh
doc2pod report.md
```

With no additional options, the CLI:

- writes `report.mp3` beside `report.md`;
- uses the general-purpose `expert-curious` format;
- uses `balanced` detail;
- refuses to replace an existing MP3.

Common overrides:

```sh
doc2pod report.md --detail concise
doc2pod study.md --format expert-skeptic --detail thorough
doc2pod notes.md --output ~/Podcasts/notes.mp3
doc2pod results.txt --format clinical-results --sensitive
```

`doc2pod build report.md` remains available as the explicit form.

## Using it through an agent

A shell-capable agent can be given a generic instruction such as:

> Use the local doc2pod CLI to turn `/path/to/report.md` into a podcast.

The agent should run `doc2pod --help` when it needs the interface. It should accept the defaults unless the request or document clearly calls for a specialized presentation:

| Material or requested presentation | Format |
| --- | --- |
| General report or unspecified | `expert-curious` |
| Evidence critique or constructive challenge | `expert-skeptic` |
| Sports, gaming, or playful opposition | `friendly-rivals` |
| Technology, cars, fishing, or shared hobbies | `coenthusiasts` |
| Personal medical results | `clinical-results --sensitive` |
| Medical studies or scientific findings | `medical-research` |

The agent should choose `concise`, `balanced`, or `thorough` only when the request implies a coverage preference; otherwise it should retain `balanced`. Run `doc2pod profiles` for complete machine-readable profile and voice definitions.

Successful builds print exactly one JSON object to stdout. Progress goes to stderr. Important result fields are:

- `outputPath`, `title`, `description`, and `durationSeconds`;
- `sourceWords`, `scriptWords`, and `outputInputRatio`;
- `format`, `detail`, review status, repairs, and warning codes;
- `workDir` only when `--keep-work` is used.

An agent should report `outputPath` and any warnings when the command finishes. It should run `doc2pod doctor` if dependency or GPU initialization fails.

### Concurrent builds

Multiple `doc2pod` processes may run at the same time. Script generation and review proceed independently, but GPU-backed TTS is automatically serialized because only one Orpheus container can render reliably at a time.

When another build owns the GPU, the CLI remains running and writes this progress message to stderr:

```text
Another TTS job is using the GPU; waiting for it to finish...
```

The waiting build resumes without intervention and later writes `GPU is available; TTS generation resumed.` This is normal progress, not an error. Agents should continue waiting for the process, should not retry the command, and should not start a replacement build. Only the final exit status and stdout JSON indicate success or failure.

## Show formats and voices

```sh
doc2pod profiles
```

Override the two engine voices when needed:

```sh
doc2pod report.md --voice-a tara --voice-b zac
```

Use a fully custom profile:

```sh
doc2pod report.txt \
  --profile examples/custom-profile.yaml \
  --detail thorough
```

## Requirements

- Node.js 22 or newer
- Codex CLI, authenticated with `codex login`
- FFmpeg and FFprobe with `libmp3lame`
- util-linux (`flock`) for coordinating GPU jobs
- Docker and the Docker Buildx plugin
- NVIDIA driver and NVIDIA Container Toolkit
- An NVIDIA GPU suitable for Orpheus; the bundled configuration targets a 10 GiB RTX 3080

The CLI never installs system dependencies. `doc2pod doctor` provides concise machine-readable diagnostics and remediation guidance.

## Initial setup

On Manjaro, the additional container packages are:

```sh
sudo pacman -S docker docker-buildx nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl enable --now docker.service containerd.service
sudo systemctl restart docker
```

Install and build the project:

```sh
npm install
npm run build
npm link
```

Accept the access conditions for `canopylabs/orpheus-3b-0.1-ft` on Hugging Face and create a read-only token. Then build the offline image without storing the token in an image layer:

```zsh
read -s "HF_TOKEN?Hugging Face token: "
export HF_TOKEN
echo

docker buildx build \
  --load \
  --progress=plain \
  --secret id=hf_token,env=HF_TOKEN \
  -t doc2pod-orpheus:local \
  tts-worker

unset HF_TOKEN
doc2pod doctor
```

The image embeds pinned Orpheus and SNAC model revisions. Runtime networking is disabled for TTS.

## Rebuilding after changes

After changing the TypeScript source, prompts, profiles, or schemas, verify and rebuild the CLI:

```sh
npm run check
npm run build
```

An existing `npm link` uses the rebuilt `dist/` files automatically. Run `npm link` again only if the link was removed or the project was moved.

Prompt and profile changes do not require rebuilding the TTS Docker image. Rebuild that image with the `docker buildx build` command from Initial setup only after changing `tts-worker/` or its model dependencies.

## Sensitive documents

`--sensitive` uses owner-only temporary storage, removes staging data on success and failure, suppresses subprocess details that could contain source material, and rejects `--keep-work`.

The document is still sent to OpenAI through the authenticated Codex CLI. Sensitive mode reduces local retention; it does not make script generation local.

## Debugging

Use `--keep-work` to retain the generated script, reviews, TTS manifest, and audio segments. Do not use it with sensitive documents.

Set `DOC2POD_MOCK_TTS=1` to exercise the pipeline using synthetic tones instead of speech. Set `DOC2POD_TTS_IMAGE` to select another image and `DOC2POD_CODEX` to use a compatible Codex wrapper.

Orpheus rendering is serialized across concurrent `doc2pod` processes because the GPU can run only one TTS container reliably. A build that reaches TTS while another is rendering prints a waiting message, then resumes automatically when the GPU is free. Script generation and review can still run concurrently. Set `DOC2POD_GPU_LOCK` only if the default per-user lock file in the system temporary directory is unsuitable.

## Pipeline behavior

Codex first identifies the material's content mode, listener goal, throughline, and coverage needs, then generates a structured script. Procedural material is organized as usable ordered instructions; scientific material follows the question, methods, findings, interpretation, limitations, and implications supported by the source. Other material is organized as an argument, narrative, reference, report, or coherent mixture.

The episode covers the subject directly instead of continually narrating the source as an artifact. It retains necessary technical terminology but uses the simplest vocabulary that preserves precision. Codex reviews the script for those presentation requirements as well as source fidelity. Error-level editorial findings trigger up to two repair-and-review cycles. Remaining editorial errors produce a spoken quality notice; invalid structured output or audio failures stop the build.

Both hosts must speak, and neither may be reduced to a token role. Long turns are split into bounded sentence-level TTS requests to avoid mid-sentence truncation. If Orpheus still reaches its acoustic-token limit, the worker automatically retries that text as smaller requests. Audio segments are assembled and normalized into a mono MP3.

Input documents are treated as untrusted content. Codex runs ephemerally in a read-only temporary workspace with user rules and web search disabled. Application prompts, schemas, and show profiles are versioned with this project.

## Using output via ssh

ssh user@<ip> 'cat "/path/to/file.mp3"' | ffplay -af "atempo=1.75" -
