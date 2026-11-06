# Local 496 Project

A one-page site for the Semantic Lab's Local 496 Project: the membership
directory of American Federation of Musicians Local 496, New Orleans, shown as
a map and a searchable directory.

The page has no build step and no dependencies. It is plain HTML, CSS and
JavaScript modules.

## Where the data comes from

- **Members, instruments, addresses, coordinates.** Read live in the browser
  with one SPARQL query against the Semantic Lab Wikibase
  (`https://query.semlab.io`). The query is in
  [`assets/js/queries.js`](assets/js/queries.js). Edit the Wikibase and the
  site changes on the next page load.
- **Fallback copy.** At deploy time, `scripts/snapshot.mjs` runs the same query
  and saves the result to `data/members.json`. The page uses it only when the
  live query fails.
- **Map.** Streets and water are bundled in `assets/data/basemap.json`, drawn
  on a canvas by [`assets/js/map.js`](assets/js/map.js). No tile server is
  used. Map data © OpenStreetMap contributors, ODbL.
- **Neighborhoods.** `assets/data/neighborhoods.json` holds the City of New
  Orleans Neighborhood Statistical Area boundaries (data.nola.gov). The page
  places each address in a neighborhood by its coordinates
  ([`assets/js/areas.js`](assets/js/areas.js)). These are present-day planning
  boundaries. Rebuild with `scripts/build_neighborhoods.py`.
- **Presentations.** Files in `presentations/`, listed in
  `presentations/presentations.json`. To add one, drop the file in that
  folder, add a thumbnail under `presentations/thumbs/`, and add an entry to
  the JSON file.

## Preview locally

```sh
uv run python -m http.server 8000
# then open http://localhost:8000
```

Optional, to create the fallback copy locally:

```sh
node scripts/snapshot.mjs
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which publishes
`index.html`, `assets/`, `presentations/` and the data snapshot to GitHub
Pages. Nothing else in the repository is published.

One-time setup: in the repository settings, under **Pages**, set **Source** to
**GitHub Actions**.

## Rebuilding the basemap

Only needed if the map area changes. Save the responses to these two
[Overpass API](https://overpass-api.de/) queries as `roads.json` and
`water.json`:

```
[out:json][timeout:180][bbox:29.885,-90.215,30.055,-89.905];
way[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link)$"];
out tags geom qt;
```

```
[out:json][timeout:180][bbox:29.885,-90.215,30.055,-89.905];
( way[natural=water]; relation[natural=water]; way[waterway=riverbank]; relation[waterway=riverbank]; );
out geom;
```

Then run:

```sh
uv run --no-project python scripts/build_basemap.py roads.json water.json assets/data/basemap.json
```

## Credits and licenses

- Code: MIT, see [LICENSE](LICENSE).
- Directory data: Semantic Lab Wikibase, from the Local 496 Membership
  Directory held by the Hogan Jazz Archive, Tulane University.
- Photograph: Russell, W. (n.d.). *Musician’s Union Office Club (American
  Federation of Musicians, Local 496*. Tulane University.
  <https://library.search.tulane.edu/permalink/01TUL_INST/4h6sc4/alma9945513844606326>
- Map data: © OpenStreetMap contributors, ODbL.
- The photograph and the presentations are not covered by the MIT license.
