// Neighborhood boundaries (assets/data/neighborhoods.json) and a point-in-polygon test.
// The Wikibase stores a coordinate for each address; the neighborhood is worked out
// here by checking which boundary that coordinate falls inside.

/** Decode the delta-encoded integer rings into [lon, lat] pairs. */
export function decodeAreas(json) {
  const [west, south] = json.origin;
  return json.areas.map((area) => ({
    name: area.name,
    rings: area.rings.map((line) => {
      let x = line[0];
      let y = line[1];
      const ring = [[west + x / json.scale, south + y / json.scale]];
      for (let i = 2; i < line.length; i += 2) {
        x += line[i];
        y += line[i + 1];
        ring.push([west + x / json.scale, south + y / json.scale]);
      }
      return ring;
    }),
  }));
}

function contains(rings, lon, lat) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[j];
      if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
    }
  }
  return inside;
}

/** Name of the area containing the point, or "" when it is outside all of them. */
export function locate(areas, lon, lat) {
  for (const area of areas) if (contains(area.rings, lon, lat)) return area.name;
  return "";
}
