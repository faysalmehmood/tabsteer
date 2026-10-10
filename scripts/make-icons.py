#!/usr/bin/env python3
"""Draws the Tab Steer icon (a steering wheel on a blue tile) with no dependencies."""
import math, os, struct, zlib

BLUE = (37, 99, 235)
WHITE = (255, 255, 255)
SS = 4  # supersampling factor


def inside_tile(x, y, r=0.22):
    # Rounded square covering the unit box.
    dx = max(abs(x - 0.5) - (0.5 - r), 0)
    dy = max(abs(y - 0.5) - (0.5 - r), 0)
    return dx * dx + dy * dy <= r * r


def inside_wheel(x, y):
    dx, dy = x - 0.5, y - 0.5
    d = math.hypot(dx, dy)
    if 0.25 <= d <= 0.345:  # rim
        return True
    if d <= 0.085:  # hub
        return True
    if d < 0.25:  # three spokes: left, right, down
        if abs(dy) <= 0.042 or (abs(dx) <= 0.042 and dy > 0):
            return True
    return False


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            tile = wheel = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px + (sx + 0.5) / SS) / size
                    y = (py + (sy + 0.5) / SS) / size
                    if inside_tile(x, y):
                        tile += 1
                        if inside_wheel(x, y):
                            wheel += 1
            n = SS * SS
            if tile == 0:
                row += bytes((0, 0, 0, 0))
                continue
            w = wheel / tile
            rgb = [round(BLUE[i] * (1 - w) + WHITE[i] * w) for i in range(3)]
            row += bytes(rgb + [round(255 * tile / n)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


out = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 128):
    with open(os.path.join(out, f"icon{size}.png"), "wb") as f:
        f.write(render(size))
    print(f"icon{size}.png")
