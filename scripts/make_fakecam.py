#!/usr/bin/env python3
"""Build a Y4M video from the kid photo so Chromium can use it as a fake webcam.

    python3 scripts/make_fakecam.py [out=/tmp/fakecam.y4m] [seconds=6]

Playwright's Chromium cannot read still images as fake capture input, so this
letterboxes the fixture into 960x540 and repeats it into a Y4M stream.
"""
import os
import sys

import numpy as np
from PIL import Image

W, H = 960, 540
FPS = 30
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tests", "fixtures", "kid-kick.jpg")


def fit(frame: Image.Image) -> Image.Image:
    scale = min(W / frame.width, H / frame.height)
    size = (round(frame.width * scale), round(frame.height * scale))
    resized = frame.resize(size, Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), (24, 28, 34))
    canvas.paste(resized, ((W - size[0]) // 2, (H - size[1]) // 2))
    return canvas


def to_yuv420(frame: Image.Image) -> bytes:
    rgb = np.asarray(frame, dtype=np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.169 * r - 0.331 * g + 0.5 * b + 128
    v = 0.5 * r - 0.419 * g - 0.081 * b + 128
    y = np.clip(y, 0, 255).astype(np.uint8)
    u = np.clip(u, 0, 255).astype(np.uint8)
    v = np.clip(v, 0, 255).astype(np.uint8)
    y = y.reshape(H, W)
    u = u.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    v = v.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
    return y.tobytes() + u.tobytes() + v.tobytes()


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fakecam.y4m"
    seconds = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    payload = to_yuv420(fit(Image.open(SRC).convert("RGB")))
    header = f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode()
    with open(out, "wb") as fh:
        fh.write(header)
        for _ in range(FPS * seconds):
            fh.write(b"FRAME\n")
            fh.write(payload)
    print(f"wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB, {seconds}s)")


if __name__ == "__main__":
    main()
