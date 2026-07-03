#!/usr/bin/env python3
"""Render a validated doc2pod manifest with one persistent Orpheus model."""

import json
import os
import re
import sys
import wave
from pathlib import Path

# Keep the small audio decoder off the 10 GiB RTX 3080 so vLLM has enough
# headroom for model weights and its KV cache. This must be set before Orpheus
# imports its decoder module.
os.environ.setdefault("SNAC_DEVICE", "cpu")

from orpheus_tts import OrpheusModel

VOICES = {"tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"}
TAGS = {"laugh", "chuckle", "sigh", "cough", "sniffle", "groan", "yawn", "gasp"}
TAG_RE = re.compile(r"<([^>]+)>")
MAX_GENERATION_TOKENS = 3200
# Seven Orpheus tokens decode to 2,048 samples at 24 kHz. Allowing for the
# decoder's initial lookback, a max-token response is about 39 seconds long.
# Treat audio near that boundary as truncated and retry it in smaller pieces.
BYTES_PER_SECOND = 24000 * 2
MAX_GENERATION_SECONDS = ((MAX_GENERATION_TOKENS // 7) - 3) * 2048 / 24000
TRUNCATION_SECONDS = MAX_GENERATION_SECONDS - 0.5
MIN_SECONDS_PER_WORD = 0.14
MIN_WORDS_FOR_DURATION_CHECK = 6
MAX_SPLIT_DEPTH = 3


def fail(message: str) -> None:
    print(f"tts-worker: {message}", file=sys.stderr)
    raise SystemExit(1)


def validate_turn(turn: object, index: int) -> dict:
    if not isinstance(turn, dict):
        fail(f"turn {index} is not an object")
    voice = turn.get("voice")
    prompt = turn.get("prompt")
    pause = turn.get("pauseAfterMs")
    if voice not in VOICES:
        fail(f"turn {index} has invalid voice")
    if not isinstance(prompt, str) or not prompt.strip():
        fail(f"turn {index} has no prompt")
    if any(tag not in TAGS for tag in TAG_RE.findall(prompt)):
        fail(f"turn {index} contains an unsupported tag")
    if not isinstance(pause, int) or not 0 <= pause <= 3000:
        fail(f"turn {index} has an invalid pause")
    return turn


def generate_audio(model: OrpheusModel, prompt: str, voice: str, request_id: str) -> bytes:
    chunks = model.generate_speech(
        prompt=prompt,
        voice=voice,
        request_id=request_id,
        max_tokens=MAX_GENERATION_TOKENS,
    )
    return b"".join(chunks)


def split_prompt(prompt: str) -> tuple[str, str] | None:
    words = prompt.split()
    if len(words) < 2:
        return None
    midpoint = len(words) // 2
    return " ".join(words[:midpoint]), " ".join(words[midpoint:])


def spoken_word_count(prompt: str) -> int:
    without_tags = TAG_RE.sub(" ", prompt)
    return len(re.findall(r"[\w]+(?:['\u2019.-][\w]+)*", without_tags, flags=re.UNICODE))


def render_complete_audio(
    model: OrpheusModel,
    prompt: str,
    voice: str,
    request_id: str,
    depth: int = 0,
) -> bytes:
    audio = generate_audio(model, prompt, voice, request_id)
    if not audio:
        fail(f"{request_id} produced no audio")
    duration = len(audio) / BYTES_PER_SECOND
    words = spoken_word_count(prompt)
    reached_limit = duration >= TRUNCATION_SECONDS
    implausibly_short = (
        words >= MIN_WORDS_FOR_DURATION_CHECK
        and duration < words * MIN_SECONDS_PER_WORD
    )
    if not reached_limit and not implausibly_short:
        return audio

    parts = split_prompt(prompt)
    if parts is None or depth >= MAX_SPLIT_DEPTH:
        fail(f"{request_id} reached the TTS generation limit and could not be split further")
    print(
        f"tts-worker: {request_id} produced suspicious {duration:.1f}s audio; "
        "retrying as smaller requests",
        file=sys.stderr,
    )
    left, right = parts
    return b"".join((
        render_complete_audio(model, left, voice, f"{request_id}-a", depth + 1),
        render_complete_audio(model, right, voice, f"{request_id}-b", depth + 1),
    ))


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: worker.py MANIFEST OUTPUT_DIR")
    manifest_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    turns = manifest.get("turns")
    if manifest.get("version") != 1 or not isinstance(turns, list) or not turns:
        fail("invalid manifest")
    turns = [validate_turn(turn, index) for index, turn in enumerate(turns)]
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    model_name = os.environ.get("ORPHEUS_MODEL", "canopylabs/orpheus-3b-0.1-ft")
    model = OrpheusModel(
        model_name=model_name,
        tokenizer=model_name,
        max_model_len=4096,
        max_num_seqs=1,
        gpu_memory_utilization=0.85,
        enforce_eager=True,
    )
    for index, turn in enumerate(turns):
        path = output_dir / f"{index:05d}.wav"
        audio = render_complete_audio(
            model,
            turn["prompt"],
            turn["voice"],
            f"turn-{index}",
        )
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(audio)


if __name__ == "__main__":
    main()
