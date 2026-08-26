"""Generate project-owned Balanced Premium 3D POS feedback WAV assets.

Every clip is synthesized locally from sine-based layers, shaped transients, short
micro-delayed stereo detail, and click-free amplitude envelopes. No recordings,
samples, runtime services, or third-party source material are used.
"""

from __future__ import annotations

import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 44_100
CHANNELS = 2
SAMPLE_WIDTH = 2
LIMITER_CEILING = 0.56
OUTPUT_DIRECTORY = Path(__file__).resolve().parents[1] / "public" / "sounds" / "pos"


@dataclass(frozen=True)
class Layer:
    """A compact synthesizer layer with subtle, mono-safe spatial placement."""

    start_ms: int
    duration_ms: int
    start_hz: float
    end_hz: float
    gain: float
    harmonic: float = 0.0
    pan: float = 0.0
    side_delay_ms: float = 0.0
    attack_ms: float = 3.0
    release_ms: float = 22.0


@dataclass(frozen=True)
class AssetSpec:
    filename: str
    duration_ms: int
    direction: str
    layers: tuple[Layer, ...]


# One identity: crisp digital transients, compact low-mid body, and only a very
# small channel offset for spatial depth. The core remains present in both channels
# so mono POS speakers retain the intended cue.
ASSETS: tuple[AssetSpec, ...] = (
    AssetSpec(
        "scan-success.wav",
        104,
        "Punchy Tech 3D",
        (
            Layer(0, 104, 820, 1_010, 0.255, 0.09, 0.00, 0.0, 2.0, 20.0),
            Layer(0, 38, 2_080, 1_620, 0.082, 0.16, -0.16, 0.85, 1.2, 11.0),
            Layer(8, 78, 540, 590, 0.082, 0.04, 0.15, 1.10, 3.0, 19.0),
        ),
    ),
    AssetSpec(
        "scan-not-found.wav",
        194,
        "Punchy Tech 3D — Double Note",
        (
            Layer(0, 76, 640, 590, 0.315, 0.07, -0.07, 0.80, 2.5, 19.0),
            Layer(104, 86, 535, 470, 0.335, 0.07, 0.07, 1.15, 2.5, 21.0),
            Layer(8, 62, 375, 350, 0.072, 0.02, 0.12, 1.60, 4.0, 18.0),
            Layer(112, 70, 330, 305, 0.076, 0.02, -0.12, 1.35, 4.0, 19.0),
        ),
    ),
    AssetSpec(
        "scan-error.wav",
        174,
        "Deep Spatial 3D",
        (
            Layer(0, 174, 470, 318, 0.285, 0.09, 0.00, 0.0, 2.8, 30.0),
            Layer(8, 152, 258, 198, 0.115, 0.03, -0.10, 1.30, 4.0, 29.0),
            Layer(0, 42, 970, 690, 0.042, 0.12, 0.13, 1.55, 1.4, 15.0),
        ),
    ),
    AssetSpec(
        "warning.wav",
        176,
        "Balanced Spatial Warning",
        (
            Layer(0, 72, 675, 635, 0.212, 0.06, -0.06, 0.90, 2.6, 19.0),
            Layer(98, 74, 610, 570, 0.218, 0.06, 0.06, 1.10, 2.6, 20.0),
            Layer(7, 58, 430, 410, 0.062, 0.02, 0.12, 1.45, 3.5, 17.0),
            Layer(105, 60, 390, 370, 0.065, 0.02, -0.12, 1.35, 3.5, 18.0),
        ),
    ),
    AssetSpec(
        "payment-success.wav",
        312,
        "Crisp Glass 3D + Punchy Tech",
        (
            Layer(0, 112, 720, 790, 0.225, 0.08, -0.02, 0.0, 2.0, 25.0),
            Layer(66, 246, 1_080, 1_310, 0.290, 0.13, 0.08, 1.15, 3.0, 36.0),
            Layer(72, 206, 1_740, 2_050, 0.092, 0.20, -0.16, 1.80, 2.6, 34.0),
            Layer(20, 150, 430, 470, 0.088, 0.03, 0.15, 1.40, 4.0, 31.0),
        ),
    ),
    AssetSpec(
        "payment-error.wav",
        256,
        "Deep Spatial 3D",
        (
            Layer(0, 112, 405, 348, 0.302, 0.10, -0.03, 0.0, 2.2, 27.0),
            Layer(128, 124, 338, 278, 0.314, 0.10, 0.04, 1.05, 2.4, 31.0),
            Layer(9, 236, 232, 190, 0.138, 0.03, -0.10, 1.45, 4.0, 38.0),
            Layer(0, 40, 860, 650, 0.046, 0.12, 0.14, 1.70, 1.5, 15.0),
        ),
    ),
)


def envelope(position: int, length: int, attack_ms: float, release_ms: float) -> float:
    """Cosine-shaped envelope prevents clicks without leaving audible reverb."""
    attack = max(1, round(SAMPLE_RATE * attack_ms / 1_000))
    release = max(1, round(SAMPLE_RATE * release_ms / 1_000))
    if position < attack:
        return math.sin((position / attack) * math.pi / 2) ** 1.25
    if position >= length - release:
        return math.sin(((length - position) / release) * math.pi / 2) ** 1.25
    return 1.0


def layer_value(layer: Layer, sample: int, channel: int) -> float:
    """Render a layer with a sub-2 ms far-channel delay and restrained pan."""
    start = round(layer.start_ms * SAMPLE_RATE / 1_000)
    length = max(1, round(layer.duration_ms * SAMPLE_RATE / 1_000))
    delay = round(layer.side_delay_ms * SAMPLE_RATE / 1_000)
    # Apply the micro-delay only to the farther channel, keeping the core coherent
    # on mono terminals and avoiding exaggerated stereo widening.
    if layer.pan > 0 and channel == 0:
        sample += delay
    elif layer.pan < 0 and channel == 1:
        sample += delay

    relative = sample - start
    if relative < 0 or relative >= length:
        return 0.0

    progress = relative / length
    frequency = layer.start_hz + (layer.end_hz - layer.start_hz) * progress
    phase = 2 * math.pi * frequency * (relative / SAMPLE_RATE)
    waveform = math.sin(phase) + (math.sin(phase * 2) * layer.harmonic)
    # Constant-power pan keeps the perceived level stable while retaining a full core.
    pan = max(-0.25, min(0.25, layer.pan))
    channel_gain = math.sqrt(0.5 * (1 - pan if channel == 0 else 1 + pan)) * math.sqrt(2)
    return waveform * layer.gain * channel_gain * envelope(relative, length, layer.attack_ms, layer.release_ms)


def render(spec: AssetSpec) -> bytes:
    length = round(spec.duration_ms * SAMPLE_RATE / 1_000)
    frames: list[bytes] = []
    for sample in range(length):
        frame = []
        for channel in range(CHANNELS):
            value = sum(layer_value(layer, sample, channel) for layer in spec.layers)
            # Soft saturation creates a compact hardware-like body without clipping.
            value = math.tanh(value / LIMITER_CEILING) * LIMITER_CEILING
            frame.append(max(-1.0, min(1.0, value)))
        frames.append(struct.pack("<hh", *(round(value * 32_767) for value in frame)))
    return b"".join(frames)


def write_asset(spec: AssetSpec) -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT_DIRECTORY / spec.filename), "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(SAMPLE_WIDTH)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(render(spec))


def main() -> None:
    for asset in ASSETS:
        write_asset(asset)
        print(f"generated {asset.filename}: {asset.duration_ms}ms · {asset.direction}")


if __name__ == "__main__":
    main()
