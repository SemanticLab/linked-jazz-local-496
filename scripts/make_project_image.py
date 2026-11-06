"""Make the animated project image: the site's map panning in a loop over New Orleans.

    node scripts/snapshot.mjs      # refresh data/members.json first
    uv run --no-project --with pillow python scripts/make_project_image.py assets/img/local-496-project-image.webp

Draws the same basemap and member dots as the site (assets/data/basemap.json and
data/members.json), follows a closed path through the neighborhoods where most
members lived, and writes a square animated WebP that loops seamlessly.
"""

import json
import math
import re
import sys

from PIL import Image, ImageDraw, ImageFont

SIZE = 300            # output pixels, square
SUPERSAMPLE = 3       # draw at 3x and scale down for smooth lines
KM_ACROSS = 4.6       # how much of the city the frame shows
FPS = 15
PX_PER_FRAME = 5.5    # pan speed in output pixels
QUALITY = 60

# The loop the camera follows, as lon/lat. It closes back on the first point.
ROUTE = [
    (-90.0880, 29.9400),  # Central City
    (-90.0740, 29.9650),  # Treme
    (-90.0590, 29.9735),  # Seventh Ward
    (-90.0560, 29.9545),  # the river at Algiers Point
]

WATER, MINOR, MID, MAJOR, LABEL = "#ececec", "#dedede", "#cdcdcd", "#b4b4b4", "#8c8c8c"
RIVER_LABEL = ("MISSISSIPPI RIVER", -90.029, 29.9538, -22.3)
FONT = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"

basemap = json.load(open("assets/data/basemap.json"))
W, S, E, N = basemap["bbox"]
COS0 = math.cos(math.radians((S + N) / 2))
UNITS = 1e4                                   # world units per degree of latitude
METRES_PER_UNIT = 111_320 / UNITS
K = SIZE / (KM_ACROSS * 1000 / METRES_PER_UNIT) * SUPERSAMPLE   # drawing pixels per world unit


def project(lon, lat):
    return (lon - W) * COS0 * UNITS, (N - lat) * UNITS


def decode(line):
    """Delta-encoded basemap line -> world coordinates."""
    fx, fy = COS0 * UNITS / basemap["scale"], UNITS / basemap["scale"]
    height = (N - S) * UNITS
    x, y = line[0], line[1]
    points = [(x * fx, height - y * fy)]
    for i in range(2, len(line), 2):
        x += line[i]
        y += line[i + 1]
        points.append((x * fx, height - y * fy))
    return points


def closed_spline(points, steps=60):
    """Catmull-Rom spline through the points and back to the start."""
    out, n = [], len(points)
    for i in range(n):
        p0, p1, p2, p3 = points[i - 1], points[i], points[(i + 1) % n], points[(i + 2) % n]
        for s in range(steps):
            t = s / steps
            out.append(tuple(
                0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t ** 3)
                for a, b, c, d in zip(p0, p1, p2, p3)
            ))
    return out


def even_steps(path, count):
    """Pick `count` points spaced evenly along a closed path."""
    loop = path + [path[0]]
    lengths = [0.0]
    for a, b in zip(loop, loop[1:]):
        lengths.append(lengths[-1] + math.dist(a, b))
    total, out, j = lengths[-1], [], 0
    for i in range(count):
        target = total * i / count
        while lengths[j + 1] < target:
            j += 1
        t = (target - lengths[j]) / ((lengths[j + 1] - lengths[j]) or 1)
        out.append(tuple(a + (b - a) * t for a, b in zip(loop[j], loop[j + 1])))
    return out, total


def area(ring):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def inside(point, ring):
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def main(out_path):
    route = closed_spline([project(lon, lat) for lon, lat in ROUTE])
    length_px = even_steps(route, 2)[1] * K / SUPERSAMPLE
    frames_wanted = max(2, round(length_px / PX_PER_FRAME))
    centres, _ = even_steps(route, frames_wanted)

    half = SIZE * SUPERSAMPLE / 2 / K          # half a frame, in world units
    x0 = min(x for x, _ in centres) - half - 2
    y0 = min(y for _, y in centres) - half - 2
    x1 = max(x for x, _ in centres) + half + 2
    y1 = max(y for _, y in centres) + half + 2
    to_px = lambda p: ((p[0] - x0) * K, (p[1] - y0) * K)
    canvas = Image.new("RGB", (math.ceil((x1 - x0) * K), math.ceil((y1 - y0) * K)), "#ffffff")
    draw = ImageDraw.Draw(canvas)

    def visible(points):
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        return max(xs) >= x0 and min(xs) <= x1 and max(ys) >= y0 and min(ys) <= y1

    # Water: the largest ring of each shape is its outline; rings inside it are islands.
    for shape in basemap["water"]:
        rings = sorted((decode(r) for r in shape), key=lambda r: -abs(area(r)))
        if not visible(rings[0]):
            continue
        draw.polygon([to_px(p) for p in rings[0]], fill=WATER)
        for ring in rings[1:]:
            draw.polygon([to_px(p) for p in ring], fill="#ffffff" if inside(ring[0], rings[0]) else WATER)

    zoom = (K / SUPERSAMPLE) / max(SIZE / ((E - W) * COS0 * UNITS), SIZE / ((N - S) * UNITS)) / 2.4
    grow = max(1.0, math.sqrt(zoom * 2.4) * 0.75)
    for name, colour, width in (("minor", MINOR, 0.6), ("mid", MID, 0.9), ("major", MAJOR, 1.3)):
        px = max(1, round(width * grow * SUPERSAMPLE))
        for line in basemap["roads"][name]:
            points = decode(line)
            if visible(points):
                draw.line([to_px(p) for p in points], fill=colour, width=px, joint="curve")

    # River name, set along the reach past Algiers as on the site.
    text, lon, lat, angle = RIVER_LABEL
    try:
        font = ImageFont.truetype(FONT, 13 * SUPERSAMPLE)
        tracking = 1.6 * SUPERSAMPLE
        width = sum(font.getlength(ch) + tracking for ch in text)
        tile = Image.new("RGBA", (int(width) + 20, 26 * SUPERSAMPLE), (0, 0, 0, 0))
        pen, cursor = ImageDraw.Draw(tile), 10
        for ch in text:
            pen.text((cursor, 4 * SUPERSAMPLE), ch, font=font, fill=LABEL)
            cursor += font.getlength(ch) + tracking
        tile = tile.rotate(angle, expand=True, resample=Image.BICUBIC)
        cx, cy = to_px(project(lon, lat))
        canvas.paste(tile, (int(cx - tile.width / 2), int(cy - tile.height / 2)), tile)
    except OSError:
        pass  # font not available; the icon works without the label

    members = json.load(open("data/members.json"))["results"]["bindings"]
    radius, ring = 3.9 * SUPERSAMPLE, 1.2 * SUPERSAMPLE
    dots = 0
    for row in members:
        match = re.search(r"Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)", row.get("coord", {}).get("value", ""))
        if not match:
            continue
        px, py = to_px(project(float(match.group(1)), float(match.group(2))))
        if -radius <= px <= canvas.width + radius and -radius <= py <= canvas.height + radius:
            draw.ellipse((px - radius - ring, py - radius - ring, px + radius + ring, py + radius + ring), fill="#ffffff")
            draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill="#111111")
            dots += 1

    side = SIZE * SUPERSAMPLE
    frames = []
    for centre in centres:
        px, py = to_px(centre)
        left, upper = round(px - side / 2), round(py - side / 2)
        frames.append(canvas.crop((left, upper, left + side, upper + side)).reduce(SUPERSAMPLE))

    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        quality=QUALITY,
        method=6,
    )
    print(f"{len(frames)} frames, {len(frames) / FPS:.1f} s loop, {dots} dots drawn, canvas {canvas.size} -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "assets/img/local-496-project-image.webp")
