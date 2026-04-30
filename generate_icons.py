"""
generate_icons.py
Generates PWA icons (192x192 and 512x512) without needing Pillow.
Uses only the Python standard library via SVG + base64 PNG trick.

Run: python generate_icons.py
Output: frontend/assets/icon-192.png and icon-512.png
"""
import os
import struct
import zlib
import base64

OUTPUT_DIR = os.path.join('frontend', 'assets')
os.makedirs(OUTPUT_DIR, exist_ok=True)


def make_png(size):
    """
    Generate a simple dark hexagon icon matching the FinHub aesthetic.
    Returns raw PNG bytes.
    """
    # Create a simple colored square PNG
    # Colors: dark bg (#0a0a0f) with green accent (#00e676) hexagon
    width = height = size

    # Build pixel data — RGBA
    pixels = []
    cx, cy = width / 2, height / 2
    r_outer = width * 0.42
    r_inner = width * 0.15

    for y in range(height):
        row = []
        for x in range(width):
            dx = x - cx
            dy = y - cy
            dist = (dx**2 + dy**2) ** 0.5

            # Background
            bg = (7, 7, 15, 255)  # #07070F

            # Hexagon outline
            import math
            angle = math.atan2(dy, dx)
            # Distance to hexagon edge
            hex_dist = r_outer * math.cos(math.pi / 6) / max(
                abs(math.cos(angle % (math.pi/3) - math.pi/6)), 0.001
            )

            if dist <= hex_dist and dist >= hex_dist * 0.82:
                # Hexagon outline — green
                px = (0, 230, 118, 255)  # #00e676
            elif dist <= r_inner:
                # Center dot — green
                px = (0, 230, 118, 230)
            else:
                px = bg

            row.extend(px)
        pixels.append(bytes(row))

    return _encode_png(width, height, pixels)


def _encode_png(width, height, rows):
    """Minimal PNG encoder — RGBA, no dependencies."""
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    sig    = b'\x89PNG\r\n\x1a\n'
    ihdr   = chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))

    raw = b''.join(b'\x00' + row for row in rows)
    idat   = chunk(b'IDAT', zlib.compress(raw, 9))
    iend   = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


for size in [96, 192, 512]:
    path = os.path.join(OUTPUT_DIR, f'icon-{size}.png')
    data = make_png(size)
    with open(path, 'wb') as f:
        f.write(data)
    print(f'✅ Generated {path} ({len(data)} bytes)')

print('\nDone. Icons are in frontend/assets/')
