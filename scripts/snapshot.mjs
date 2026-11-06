// Save a copy of the directory data so the site still works when the SPARQL
// endpoint cannot be reached from a visitor's browser.
//
//   node scripts/snapshot.mjs
//
// Runs the same query the page runs (assets/js/queries.js) and writes the raw
// SPARQL JSON, plus the time it was fetched, to data/members.json.

import { mkdir, writeFile } from "node:fs/promises";
import { ENDPOINT, MEMBERS_QUERY, parseMembers } from "../assets/js/queries.js";

const out = new URL("../data/members.json", import.meta.url);

const response = await fetch(`${ENDPOINT}?query=${encodeURIComponent(MEMBERS_QUERY)}`, {
  headers: {
    Accept: "application/sparql-results+json",
    "User-Agent": "semlab-data-process (linked-jazz-local-496 site build)",
  },
});
if (!response.ok) {
  console.error(`SPARQL endpoint answered ${response.status} ${response.statusText}`);
  process.exit(1);
}

const json = await response.json();
const members = parseMembers(json);
if (members.length === 0) {
  console.error("The query returned no members; not writing a snapshot.");
  process.exit(1);
}

json.fetched = new Date().toISOString();
await mkdir(new URL("./", out), { recursive: true });
await writeFile(out, JSON.stringify(json));
console.log(`Saved ${members.length} members (${members.filter((m) => m.lat != null).length} with coordinates) to data/members.json`);
