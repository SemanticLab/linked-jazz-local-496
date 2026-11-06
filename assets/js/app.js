import { ENDPOINT, ITEM_URL, MEMBERS_QUERY, parseMembers } from "./queries.js";
import { createMap } from "./map.js";
import { decodeAreas, locate } from "./areas.js";

const PAGE_SIZE = 24;
const $ = (selector) => document.querySelector(selector);

/** Tiny DOM builder: h("a", {href}, "text", child, ...) */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// ---- data -----------------------------------------------------------------

async function getJSON(url, options = {}, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the Wikibase live; fall back to the copy saved when the site was deployed. */
async function loadMembers() {
  try {
    const url = `${ENDPOINT}?query=${encodeURIComponent(MEMBERS_QUERY)}`;
    const json = await getJSON(url, { headers: { Accept: "application/sparql-results+json" } });
    const members = parseMembers(json);
    if (!members.length) throw new Error("empty result");
    return { members, source: "live" };
  } catch (liveError) {
    console.warn("Live SPARQL query failed, using the saved copy.", liveError);
    const saved = await getJSON("data/members.json");
    return { members: parseMembers(saved), source: "saved", fetched: saved.fetched };
  }
}

// ---- directory ------------------------------------------------------------

const state = { query: "", instrument: "", neighborhood: "", sort: "family", page: 1 };
let members = [];
let areas = [];
let map = null;

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const byFamily = (a, b) => collator.compare(a.family, b.family) || collator.compare(a.name, b.name);
const SORTS = {
  family: byFamily,
  "family-desc": (a, b) => byFamily(b, a),
  instrument: (a, b) => collator.compare(a.instruments[0] || "￿", b.instruments[0] || "￿") || byFamily(a, b),
  neighborhood: (a, b) => collator.compare(a.neighborhood || "\uffff", b.neighborhood || "\uffff") || byFamily(a, b),
  page: (a, b) => (a.page ?? 999) - (b.page ?? 999) || byFamily(a, b),
};

function matches(member) {
  if (state.instrument && !member.instruments.includes(state.instrument)) return false;
  if (state.neighborhood && member.neighborhood !== state.neighborhood) return false;
  if (!state.query) return true;
  const haystack = [member.name, ...member.aliases, ...member.instruments, member.address, member.city, member.neighborhood]
    .join(" ")
    .toLowerCase();
  return state.query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function initials(member) {
  const first = member.name.replace(/"[^"]*"/g, " ").trim()[0] || "";
  return (first + (member.family[0] || "")).toUpperCase();
}

function avatar(member) {
  const fallback = h("span", { class: "avatar", "aria-hidden": "true" }, initials(member));
  if (!member.thumb) return fallback;
  const image = h("img", { src: member.thumb, alt: "", loading: "lazy", decoding: "async" });
  image.addEventListener("error", () => image.replaceWith(document.createTextNode(initials(member))));
  return h("span", { class: "avatar", "aria-hidden": "true" }, image);
}

/** Google Street View at the coordinates the Wikibase holds for an address. */
function streetViewLink(member, label) {
  if (member.lat == null || member.lon == null) return null;
  const href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${member.lat.toFixed(6)},${member.lon.toFixed(6)}`;
  return h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer" }, label);
}

function showOnMap(member) {
  if (!map || !map.focus(member.id)) return;
  $("#map").scrollIntoView({ behavior: "smooth", block: "start" });
}

function memberCard(member) {
  const street = [member.street, member.city && member.city !== "New Orleans" ? member.city : ""].filter(Boolean).join(", ");
  const where = [street, member.neighborhood].filter(Boolean).join(" \u00b7 ");
  return h(
    "li",
    { class: "member" },
    avatar(member),
    h(
      "div",
      { class: "member-text" },
      h("a", { class: "member-name", href: ITEM_URL + member.id, title: "Open this record in the Semantic Lab Wikibase" }, member.name),
      h("div", { class: "member-meta" }, member.instruments.join(", ") || "instrument not listed"),
      where && h("div", { class: "member-meta" }, where),
      h(
        "div",
        { class: "member-links" },
        map && map.has(member.id) && h("button", { class: "link", type: "button", onclick: () => showOnMap(member) }, "Show on map"),
        streetViewLink(member, "Street View ↗"),
      ),
    ),
  );
}

function pager(pages) {
  const nav = $("#pager");
  nav.replaceChildren();
  if (pages < 2) return;
  const go = (page) => () => {
    state.page = page;
    render();
    $("#directory").scrollIntoView({ block: "start" });
  };
  const button = (label, page, { current = false, disabled = false, name } = {}) =>
    h("button", { type: "button", class: current ? "current" : "", disabled, "aria-current": current ? "page" : null, "aria-label": name, onclick: go(page) }, label);

  nav.append(button("←", state.page - 1, { disabled: state.page === 1, name: "Previous page" }));
  const shown = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter((n) => n >= 1 && n <= pages));
  let previous = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - previous > 1) nav.append(h("span", { class: "gap" }, "…"));
    nav.append(button(String(n), n, { current: n === state.page, name: `Page ${n}` }));
    previous = n;
  }
  nav.append(button("→", state.page + 1, { disabled: state.page === pages, name: "Next page" }));
}

function render() {
  const filtered = members.filter(matches).sort(SORTS[state.sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;

  const list = $("#members");
  list.replaceChildren(...filtered.slice(start, start + PAGE_SIZE).map(memberCard));
  $("#empty").hidden = filtered.length > 0;

  const filtering = Boolean(state.query || state.instrument || state.neighborhood);
  $("#count").textContent = filtering
    ? `${filtered.length} of ${members.length} members`
    : `${members.length} members`;
  pager(pages);

  if (map) {
    map.setVisible(filtering ? new Set(filtered.map((m) => m.id)) : null);
    $("#map-filter-note").hidden = !filtering;
  }
}

function wireControls() {
  const instruments = [...new Set(members.flatMap((m) => m.instruments))].sort(collator.compare);
  const select = $("#instrument");
  for (const name of instruments) select.append(h("option", { value: name }, name));

  let timer = 0;
  $("#search").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = event.target.value.trim();
      state.page = 1;
      render();
    }, 120);
  });
  select.addEventListener("change", (event) => {
    state.instrument = event.target.value;
    state.page = 1;
    render();
  });

  // Neighborhoods that have at least one member, with how many.
  const tally = new Map();
  for (const member of members) {
    if (member.neighborhood) tally.set(member.neighborhood, (tally.get(member.neighborhood) || 0) + 1);
  }
  const hood = $("#neighborhood");
  for (const name of [...tally.keys()].sort(collator.compare)) {
    hood.append(h("option", { value: name }, `${name} (${tally.get(name)})`));
  }
  hood.closest("label").hidden = tally.size === 0;
  hood.addEventListener("change", (event) => {
    state.neighborhood = event.target.value;
    state.page = 1;
    render();
    if (map) {
      const area = areas.find((a) => a.name === state.neighborhood);
      map.clear();
      map.setOutline(area ? area.rings : null);
      map.fit();
    }
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.page = 1;
    render();
  });
}

// ---- map card -------------------------------------------------------------

function showPlace(people) {
  const card = $("#map-card");
  if (!people.length) {
    card.hidden = true;
    return;
  }
  const first = people[0];
  card.replaceChildren(
    h("button", { class: "close", type: "button", "aria-label": "Close", onclick: () => map.clear() }, "×"),
    h("p", { class: "card-address" }, first.street || first.address, h("br"), h("span", {}, [first.city, first.neighborhood].filter(Boolean).join(" \u00b7 "))),
    h(
      "ul",
      {},
      people.map((person) =>
        h("li", {}, h("a", { href: ITEM_URL + person.id }, person.name), h("span", {}, person.instruments.join(", "))),
      ),
    ),
    first.page != null && h("p", { class: "card-source" }, `Membership directory, page ${first.page}`),
    first.lat != null && h("p", { class: "card-source" }, streetViewLink(first, "Open in Google Street View ↗")),
  );
  card.hidden = false;
}

// ---- presentations --------------------------------------------------------

async function loadPresentations() {
  const list = $("#presentation-list");
  try {
    const items = await getJSON("presentations/presentations.json");
    list.replaceChildren(
      ...items.map((item) => {
        const href = "presentations/" + item.file.split("/").map(encodeURIComponent).join("/");
        return h(
          "li",
          { class: "presentation" },
          h(
            "a",
            { href, class: "presentation-thumb", tabindex: "-1", "aria-hidden": "true" },
            h("img", { src: "presentations/" + item.thumb, alt: "", loading: "lazy" }),
          ),
          h("a", { href, class: "presentation-title" }, item.title),
          h("div", { class: "member-meta" }, [item.kind, item.venue, item.date].filter(Boolean).join(" · ")),
          h("div", { class: "member-meta" }, item.format),
        );
      }),
    );
  } catch (error) {
    console.warn("Could not load the presentations list.", error);
    list.replaceChildren(h("li", {}, "The presentations could not be loaded."));
  }
}

// ---- start ----------------------------------------------------------------

async function start() {
  loadPresentations();
  const status = $("#status");
  const basemapReady = getJSON("assets/data/basemap.json").catch((error) => {
    console.warn("Could not load the basemap.", error);
    return null;
  });
  const areasReady = getJSON("assets/data/neighborhoods.json").catch((error) => {
    console.warn("Could not load the neighborhood boundaries.", error);
    return null;
  });

  let result;
  try {
    result = await loadMembers();
  } catch (error) {
    console.error(error);
    status.textContent = "The directory could not be loaded from the Semantic Lab Wikibase. Please try again later.";
    status.classList.add("error");
    $("#map-status").textContent = "The map could not be loaded.";
    return;
  }
  members = result.members;

  // Place each address in a neighborhood by its coordinates.
  const areaData = await areasReady;
  areas = areaData ? decodeAreas(areaData) : [];
  for (const member of members) {
    member.neighborhood = member.lat == null ? "" : locate(areas, member.lon, member.lat);
  }

  const basemap = await basemapReady;
  if (basemap) {
    map = createMap($("#map-frame"), basemap, { onSelect: showPlace });
    const placed = map.setMembers(members);
    const elsewhere = members.length - placed;
    $("#map-status").textContent =
      `${placed} members at their directory addresses. ` +
      (elsewhere ? `${elsewhere} more lived outside this area or have no street address on file.` : "");
  } else {
    $("#map-status").textContent = "The map could not be loaded.";
  }

  status.textContent =
    result.source === "live"
      ? "Live from the Semantic Lab Wikibase."
      : `Saved copy of the Wikibase data${result.fetched ? " from " + new Date(result.fetched).toLocaleDateString("en-US", { dateStyle: "long" }) : ""}.`;
  wireControls();
  render();
}

start();
