"""Build assets/data/basemap.json from OpenStreetMap extracts.

One-off helper. The basemap it writes is committed to the repo, so this only
needs to be re-run if the map area changes.

    uv run --no-project python scripts/build_basemap.py roads.json water.json assets/data/basemap.json

roads.json and water.json are Overpass API responses (see README.md for the
two queries). Output is a compact JSON file: every coordinate is an integer
offset from the south-west corner in units of 1e-5 degrees, and each line or
ring is delta-encoded as [x0, y0, dx1, dy1, dx2, dy2, ...].

Map data (c) OpenStreetMap contributors, ODbL.
"""

import json
import math
import sys

# Area the site's map can show: west, south, east, north.
W, S, E, N = -90.20, 29.895, -89.92, 30.045
SCALE = 1e5
PAD = 0.004            # keep road vertices this far outside the box
SIMPLIFY = 0.000025    # ~2.5 m
MIN_WATER_M2 = 9000    # drop ponds and pools smaller than this

MAJOR = {"motorway", "trunk", "primary", "secondary", "motorway_link", "trunk_link", "primary_link"}
MID = {"tertiary"}


def simplify(pts, tol):
    """Douglas-Peucker on (lon, lat) tuples."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, idx = 0.0, None
        for i in range(a + 1, b):
            px, py = pts[i]
            if norm:
                d = abs(dy * (px - ax) - dx * (py - ay)) / norm
            else:  # closed ring: first and last point coincide
                d = math.hypot(px - ax, py - ay)
            if d > worst:
                worst, idx = d, i
        if idx is not None and worst > tol:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]


def encode(pts):
    out, px, py = [], 0, 0
    for i, (lon, lat) in enumerate(pts):
        x = round((lon - W) * SCALE)
        y = round((lat - S) * SCALE)
        if i and x == px and y == py:
            continue
        out += [x - px, y - py] if i else [x, y]
        px, py = x, y
    return out


def inside(p, pad=0.0):
    return W - pad <= p[0] <= E + pad and S - pad <= p[1] <= N + pad


def split_to_box(pts):
    """Yield the pieces of a polyline that fall inside the padded box."""
    run = []
    for i, p in enumerate(pts):
        if inside(p, PAD):
            if not run and i:
                run.append(pts[i - 1])
            run.append(p)
        elif run:
            run.append(p)
            yield run
            run = []
    if run:
        yield run


def clip_ring(ring):
    """Sutherland-Hodgman clip of a closed ring against the map box."""
    def clip(pts, keep, cut):
        out = []
        for i, cur in enumerate(pts):
            prev = pts[i - 1]
            if keep(cur):
                if not keep(prev):
                    out.append(cut(prev, cur))
                out.append(cur)
            elif keep(prev):
                out.append(cut(prev, cur))
        return out

    def at_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def at_y(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = ring[:-1] if ring[0] == ring[-1] else ring
    for keep, cut in (
        (lambda p: p[0] >= W, at_x(W)),
        (lambda p: p[0] <= E, at_x(E)),
        (lambda p: p[1] >= S, at_y(S)),
        (lambda p: p[1] <= N, at_y(N)),
    ):
        pts = clip(pts, keep, cut)
        if len(pts) < 3:
            return []
    return pts + [pts[0]]


def area_m2(ring):
    k = math.cos(math.radians((S + N) / 2)) * 111320
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        a += (x1 * k) * (y2 * 111320) - (x2 * k) * (y1 * 111320)
    return abs(a) / 2


def join_rings(ways):
    """Join member ways end to end into closed rings."""
    ways = [list(w) for w in ways if len(w) > 1]
    rings = []
    while ways:
        ring = ways.pop()
        grew = True
        while ring[0] != ring[-1] and grew:
            grew = False
            for i, w in enumerate(ways):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[-2::-1]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[:0:-1] + ring
                else:
                    continue
                ways.pop(i)
                grew = True
                break
        if ring[0] == ring[-1] and len(ring) > 3:
            rings.append(ring)
    return rings


def geom(el):
    return [(p["lon"], p["lat"]) for p in el.get("geometry") or [] if p]


def main(roads_path, water_path, out_path):
    roads = {"major": [], "mid": [], "minor": []}
    for el in json.load(open(roads_path))["elements"]:
        if el["type"] != "way":
            continue
        kind = el.get("tags", {}).get("highway")
        cls = "major" if kind in MAJOR else "mid" if kind in MID else "minor"
        for piece in split_to_box(geom(el)):
            line = encode(simplify(piece, SIMPLIFY))
            if len(line) >= 4:
                roads[cls].append(line)

    water = []
    for el in json.load(open(water_path))["elements"]:
        if el["type"] == "way":
            ring = geom(el)
            rings = [ring] if len(ring) > 3 and ring[0] == ring[-1] else []
        elif el["type"] == "relation":
            members = [geom(m) for m in el.get("members", []) if m.get("type") == "way"]
            rings = join_rings(members)
        else:
            continue
        clipped = [r for r in (clip_ring(r) for r in rings) if len(r) > 3]
        if not clipped or max(area_m2(r) for r in clipped) < MIN_WATER_M2:
            continue
        shape = [encode(simplify(r, SIMPLIFY)) for r in clipped]
        water.append([r for r in shape if len(r) >= 8])

    out = {
        "attribution": "Map data (c) OpenStreetMap contributors, ODbL",
        "bbox": [W, S, E, N],
        "scale": SCALE,
        "water": [w for w in water if w],
        "roads": roads,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print({k: len(v) for k, v in roads.items()}, "water shapes:", len(out["water"]))


if __name__ == "__main__":
    main(*sys.argv[1:4])
