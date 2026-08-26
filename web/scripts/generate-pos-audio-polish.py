#!/usr/bin/env python3
"""Generate project-owned, minimal POS feedback WAV assets.

The clips are synthesized from sine-based partials and smooth amplitude envelopes;
they contain no third-party recordings, samples, or external source material.
"""

from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 22_050
MAX_AMPLITUDE = 0.38
OUTPUT_DIRECTORY = Path(__file__).resolve().parents[1] / "public" / "sounds" / "pos"


@dataclass(frozen=True)
class Tone:
    start_ms: int
    duration_ms: int
    start_hz: float
    end_hz: float
    gain: float
    harmonic: float = 0.10


@dataclass(frozen=True)
class AssetSpec:
    filename: str
    duration_ms: int
    tones: tuple[Tone, ...]


ASSETS: tuple[AssetSpec, ...] = (
    AssetSpec(
        "scan-success.wav",
        96,
        (Tone(0, 96, 780, 1_030, 0.26, 0.06),),
    ),
    AssetSpec(
        "scan-not-found.wav",
        182,
        (
            Tone(0, 72, 530, 490, 0.23, 0.07),
            Tone(102, 80, 455, 420, 0.22, 0.07),
        ),
    ),
    AssetSpec(
        "scan-error.wav",
        168,
        (
            Tone(0, 168, 400, 300, 0.28, 0.08),
            Tone(12, 148, 260, 220, 0.06, 0.03),
        ),
    ),
    AssetSpec(
        "warning.wav",
        156,
        (
            Tone(0, 70, 620, 590, 0.20, 0.06),
            Tone(86, 70, 620, 590, 0.20, 0.06),
        ),
    ),
    AssetSpec(
        "payment-success.wav",
        274,
        (
            Tone(0, 104, 660, 735, 0.20, 0.06),
            Tone(74, 200, 870, 960, 0.27, 0.07),
        ),
    ),
    AssetSpec(
        "payment-error.wav",
        236,
        (
            Tone(0, 96, 390, 350, 0.25, 0.07),
            Tone(126, 110, 320, 270, 0.26, 0.07),
        ),
    ),
)


def envelope(position: float, length: int) -> float:
    """Smooth 4 ms attack and 28 ms release, with no hard click or long tail."""
    attack = max(1, int(SAMPLE_RATE * 0.004))
    release = max(1, int(SAMPLE_RATE * 0.028))
    if position < attack:
        return math.sin((position / attack) * math.pi / 2) ** 1.4
    if position >= length - release:
        return math.sin(((length - position) / release) * math.pi / 2) ** 1.4
    return 1.0


def tone_value(tone: Tone, sample: int) -> float:
    tone_start = round(tone.start_ms * SAMPLE_RATE / 1_000)
    tone_length = max(1, round(tone.duration_ms * SAMPLE_RATE / 1_000))
    relative = sample - tone_start
    if relative < 0 or relative >= tone_length:
        return 0.0

    progress = relative / tone_length
    frequency = tone.start_hz + ((tone.end_hz - tone.start_hz) * progress)
    time = relative / SAMPLE_RATE
    phase = 2 * math.pi * frequency * time
    fundamental = math.sin(phase)
    partial = math.sin(phase * 2) * tone.harmonic
    return (fundamental + partial) * tone.gain * envelope(relative, tone_length)


def render(spec: AssetSpec) -> bytes:
    length = round(spec.duration_ms * SAMPLE_RATE / 1_000)
    samples = []
    for sample in range(length):
        value = sum(tone_value(tone, sample) for tone in spec.tones)
        # A conservative limiter preserves a consistent, controlled loudness.
        value = math.tanh(value / MAX_AMPLITUDE) * MAX_AMPLITUDE
        samples.append(struct.pack("<h", round(value * 32_767)))
    return b"".join(samples)


def write_asset(spec: AssetSpec) -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT_DIRECTORY / spec.filename), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(render(spec))


def main() -> None:
    for asset in ASSETS:
        write_asset(asset)
        print(f"generated {asset.filename}: {asset.duration_ms}ms")


if __name__ == "__main__":
    main()
