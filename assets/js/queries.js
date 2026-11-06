// The SPARQL that powers the site. Shared by the browser (assets/js/app.js)
// and by the deploy-time snapshot script (scripts/snapshot.mjs).

export const ENDPOINT = "https://query.semlab.io/proxy/wdqs/bigdata/namespace/wdq/sparql";
export const ITEM_URL = "https://base.semlab.io/wiki/Item:";
export const PROJECT_ITEM = "Q20719";

// One row per member of the Local 496 project (Q20719):
// name, instruments, the address the directory lists, coordinates and page.
export const MEMBERS_QUERY = `
PREFIX wd: <http://base.semlab.io/entity/>
PREFIX wdt: <http://base.semlab.io/prop/direct/>
PREFIX p: <http://base.semlab.io/prop/>
PREFIX ps: <http://base.semlab.io/prop/statement/>
PREFIX pq: <http://base.semlab.io/prop/qualifier/>
PREFIX pr: <http://base.semlab.io/prop/reference/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

SELECT ?item ?name
       (GROUP_CONCAT(DISTINCT ?instrument; separator="|") AS ?instruments)
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
       (SAMPLE(?address_) AS ?address)
       (SAMPLE(?city_) AS ?city)
       (SAMPLE(?coord_) AS ?coord)
       (SAMPLE(?page_) AS ?page)
       (SAMPLE(?thumb_) AS ?thumb)
       (SAMPLE(?wikidata_) AS ?wikidata)
WHERE {
  ?item wdt:P11 wd:${PROJECT_ITEM} ;      # part of project: Local 496
        wdt:P1 wd:Q1 ;                    # instance of: person
        rdfs:label ?name .
  FILTER(LANG(?name) = "en")
  OPTIONAL { ?item wdt:P57 ?ins . ?ins rdfs:label ?instrument . FILTER(LANG(?instrument) = "en") }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
  OPTIONAL {
    ?item p:P69 ?home .                                                   # lived in
    OPTIONAL { ?home ps:P69 ?c . ?c rdfs:label ?city_ . FILTER(LANG(?city_) = "en") }
    OPTIONAL { ?home pq:P152 ?address_ }                                  # street address
    OPTIONAL { ?home pq:P146 ?coord_ }                                    # coordinate location
    OPTIONAL { ?home prov:wasDerivedFrom ?ref . ?ref pr:P87 ?page_ }      # directory page
  }
  OPTIONAL { ?item wdt:P3 ?thumb_ }                                       # thumbnail URL
  OPTIONAL { ?item wdt:P8 ?wikidata_ }                                    # Wikidata QID
}
GROUP BY ?item ?name
ORDER BY ?name`;

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|2nd|3rd)$/i;

/** Family name used for sorting: drops quoted nicknames and Jr./Sr./3rd. */
export function familyName(name) {
  const parts = name.replace(/"[^"]*"/g, " ").replace(/,/g, " ").trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] || name;
}

/** Turn SPARQL JSON results into plain member objects. */
export function parseMembers(json) {
  const val = (row, key) => (row[key] ? row[key].value : "");
  return json.results.bindings.map((row) => {
    const name = val(row, "name");
    const point = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(val(row, "coord"));
    const address = val(row, "address");
    const thumb = val(row, "thumb");
    const page = parseInt(val(row, "page"), 10);
    return {
      id: val(row, "item").split("/").pop(),
      name,
      family: familyName(name),
      instruments: val(row, "instruments").split("|").filter(Boolean).sort(),
      aliases: val(row, "aliases").split("|").filter(Boolean),
      address,
      street: address.split(",")[0].trim(),
      city: val(row, "city").replace(/\s*\(.*\)\s*$/, ""),
      lon: point ? Number(point[1]) : null,
      lat: point ? Number(point[2]) : null,
      page: Number.isFinite(page) ? page : null,
      thumb: /^https:\/\//.test(thumb) ? thumb : "",
      wikidata: val(row, "wikidata"),
    };
  });
}
