"""Build assets/data/neighborhoods.json from the City of New Orleans
"Neighborhood Statistical Area" boundaries.

One-off helper; the output is committed to the repo.

    curl -o nsa.geojson 'https://data.nola.gov/resource/exvn-jeh2.geojson?$limit=500'
    uv run --no-project python scripts/build_neighborhoods.py nsa.geojson assets/data/neighborhoods.json

Coordinates use the same compact encoding as the basemap: integer offsets from
the basemap's south-west corner in units of 1e-5 degrees, delta-encoded.
"""

import json
import sys

from build_basemap import SCALE, S, W, encode, simplify

TOLERANCE = 0.00004  # about 4 m

SPECIAL = {"McDONOGH": "McDonogh", "U.S. NAVAL BASE": "U.S. Naval Base", "TREME - LAFITTE": "Tremé - Lafitte"}
SMALL = {"de", "and"}


def title(name):
    name = " ".join(name.split())
    if name in SPECIAL:
        return SPECIAL[name]
    words = []
    for word in name.split(" "):
        low = word.lower()
        words.append(low if low in SMALL and words else "-".join(part.capitalize() for part in low.split("-")))
    return " ".join(words).replace("B. w.", "B. W.").replace("Lest", "L'Est")


def main(src, out_path):
    areas = []
    for feature in json.load(open(src))["features"]:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        rings = []
        for polygon in polygons:
            for ring in polygon:
                line = encode(simplify([(p[0], p[1]) for p in ring], TOLERANCE))
                if len(line) >= 8:
                    rings.append(line)
        areas.append({"name": title(feature["properties"]["gnocdc_lab"]), "rings": rings})
    areas.sort(key=lambda a: a["name"])
    out = {
        "source": "City of New Orleans, Neighborhood Statistical Areas (data.nola.gov)",
        "origin": [W, S],
        "scale": SCALE,
        "areas": areas,
    }
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(len(areas), "neighborhoods:", ", ".join(a["name"] for a in areas))


if __name__ == "__main__":
    main(*sys.argv[1:3])
