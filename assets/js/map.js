// A small self-contained canvas map of New Orleans.
// The basemap (streets and water) ships with the site in assets/data/basemap.json,
// so no tile server or mapping library is needed.

const UNITS = 1e4;          // world units per degree of latitude (1 unit is about 11 m)
const MAX_K = 10;           // closest zoom, in CSS pixels per world unit
const HIT_RADIUS = 12;      // CSS pixels

// Water labels sit at points inside the water; the river label follows its reach past Algiers.
const LABELS = [
  { text: "Lake Pontchartrain", lon: -90.075, lat: 30.0372, angle: 0 },
  { text: "Mississippi River", lon: -90.029, lat: 29.9538, angle: 0.39 },
];

export function createMap(root, basemap, { onSelect } = {}) {
  const canvas = root.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const hint = root.querySelector(".map-hint");

  const [W, S, E, N] = basemap.bbox;
  const cos0 = Math.cos((((S + N) / 2) * Math.PI) / 180);
  const worldW = (E - W) * cos0 * UNITS;
  const worldH = (N - S) * UNITS;
  const project = (lon, lat) => [(lon - W) * cos0 * UNITS, (N - lat) * UNITS];

  // Decode the delta-encoded integer lines into canvas paths, once.
  const fx = (cos0 * UNITS) / basemap.scale;
  const fy = UNITS / basemap.scale;
  function toPath(lines, close) {
    const path = new Path2D();
    for (const line of lines) {
      let x = line[0];
      let y = line[1];
      path.moveTo(x * fx, worldH - y * fy);
      for (let i = 2; i < line.length; i += 2) {
        x += line[i];
        y += line[i + 1];
        path.lineTo(x * fx, worldH - y * fy);
      }
      if (close) path.closePath();
    }
    return path;
  }
  const water = basemap.water.map((rings) => toPath(rings, true));
  const roads = {
    minor: toPath(basemap.roads.minor),
    mid: toPath(basemap.roads.mid),
    major: toPath(basemap.roads.major),
  };

  let points = [];            // {id, x, y, key, member}
  let visible = null;         // Set of ids, or null for all
  let selectedKey = null;
  let outline = null;         // Path2D of the highlighted area, in world units
  let outlineBounds = null;
  let cssW = 0, cssH = 0, dpr = 1;
  let k = 1, tx = 0, ty = 0, minK = 1;
  let frame = 0, tween = 0, sized = false;

  // ---- view -------------------------------------------------------------

  function clampView() {
    k = Math.min(MAX_K, Math.max(minK, k));
    tx = Math.min(0, Math.max(cssW - worldW * k, tx));
    ty = Math.min(0, Math.max(cssH - worldH * k, ty));
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function zoomAt(px, py, factor) {
    const wx = (px - tx) / k;
    const wy = (py - ty) / k;
    k *= factor;
    k = Math.min(MAX_K, Math.max(minK, k));
    tx = px - wx * k;
    ty = py - wy * k;
    clampView();
    requestDraw();
  }

  function viewFor(bounds, padding) {
    const w = Math.max(bounds.x1 - bounds.x0, 1);
    const h = Math.max(bounds.y1 - bounds.y0, 1);
    const scale = Math.min((cssW - 2 * padding) / w, (cssH - 2 * padding) / h, MAX_K, minK * 9);
    const kk = Math.max(minK, scale);
    return {
      k: kk,
      tx: cssW / 2 - ((bounds.x0 + bounds.x1) / 2) * kk,
      ty: cssH / 2 - ((bounds.y0 + bounds.y1) / 2) * kk,
    };
  }

  function pointBounds() {
    const shown = points.filter((p) => !visible || visible.has(p.id));
    const list = shown.length ? shown : points;
    if (!list.length) return { x0: 0, y0: 0, x1: worldW, y1: worldH };
    // Trim the outermost 1% on each side so one stray address does not zoom the map out.
    const xs = list.map((p) => p.x).sort((a, b) => a - b);
    const ys = list.map((p) => p.y).sort((a, b) => a - b);
    const cut = list.length > 60 ? Math.floor(list.length * 0.01) : 0;
    return { x0: xs[cut], x1: xs[xs.length - 1 - cut], y0: ys[cut], y1: ys[ys.length - 1 - cut] };
  }

  function setView(view, animate) {
    cancelAnimationFrame(tween);
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      ({ k, tx, ty } = view);
      clampView();
      requestDraw();
      return;
    }
    const from = { k, tx, ty };
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 450);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Interpolate the centre in world space so the motion stays straight while zooming.
      const c0x = (cssW / 2 - from.tx) / from.k, c0y = (cssH / 2 - from.ty) / from.k;
      const c1x = (cssW / 2 - view.tx) / view.k, c1y = (cssH / 2 - view.ty) / view.k;
      k = from.k * Math.pow(view.k / from.k, e);
      tx = cssW / 2 - (c0x + (c1x - c0x) * e) * k;
      ty = cssH / 2 - (c0y + (c1y - c0y) * e) * k;
      clampView();
      requestDraw();
      if (t < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const centre = sized ? [(cssW / 2 - tx) / k, (cssH / 2 - ty) / k] : null;
    cssW = rect.width;
    cssH = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    minK = Math.max(cssW / worldW, cssH / worldH);
    if (centre) {
      tx = cssW / 2 - centre[0] * k;
      ty = cssH / 2 - centre[1] * k;
      clampView();
    } else {
      ({ k, tx, ty } = viewFor(pointBounds(), 36));
      clampView();
      sized = true;
    }
    requestDraw();
  }

  // ---- drawing ----------------------------------------------------------

  function draw() {
    frame = 0;
    if (!cssW) return;
    const zoom = k / minK;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    ctx.fillStyle = "#ececec";
    for (const shape of water) ctx.fill(shape, "evenodd");

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const grow = Math.max(1, Math.sqrt(zoom) * 0.75);
    const line = (path, colour, px) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = (px * grow) / k;
      ctx.stroke(path);
    };
    line(roads.minor, "#dedede", 0.6);
    line(roads.mid, "#cdcdcd", 0.9);
    line(roads.major, "#b4b4b4", 1.3);

    if (outline) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fill(outline, "evenodd");
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.5 / k;
      ctx.stroke(outline);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = "#8c8c8c";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = 'italic 13px Georgia, "Times New Roman", serif';
    for (const label of LABELS) {
      const [wx, wy] = project(label.lon, label.lat);
      const sx = wx * k + tx;
      const sy = wy * k + ty;
      if (sx > -120 && sx < cssW + 120 && sy > -60 && sy < cssH + 60) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(label.angle);
        ctx.fillText(label.text.toUpperCase().split("").join(" "), 0, 0);
        ctx.restore();
      }
    }

    const radius = Math.min(5.5, 3.2 + zoom * 0.25);
    const dot = (p, r, fill, stroke) => {
      const sx = p.x * k + tx;
      const sy = p.y * k + ty;
      if (sx < -10 || sy < -10 || sx > cssW + 10 || sy > cssH + 10) return;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };
    if (visible) for (const p of points) if (!visible.has(p.id)) dot(p, 1.6, "#c6c6c6");
    for (const p of points) if (!visible || visible.has(p.id)) dot(p, radius, "#111", "#fff");

    const picked = points.find((p) => p.key === selectedKey);
    if (picked) {
      const sx = picked.x * k + tx;
      const sy = picked.y * k + ty;
      ctx.beginPath();
      ctx.arc(sx, sy, radius + 6, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#111";
      ctx.stroke();
    }
  }

  // ---- picking ----------------------------------------------------------

  function pointAt(px, py) {
    let best = null;
    let bestD = HIT_RADIUS * HIT_RADIUS;
    for (const p of points) {
      if (visible && !visible.has(p.id)) continue;
      const dx = p.x * k + tx - px;
      const dy = p.y * k + ty - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function choose(key, notify = true) {
    selectedKey = key;
    requestDraw();
    if (notify && onSelect) {
      onSelect(key ? points.filter((p) => p.key === key).map((p) => p.member) : []);
    }
  }

  // ---- interaction ------------------------------------------------------

  const pointers = new Map();
  let moved = 0;
  let pinch = 0;

  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelAnimationFrame(tween);
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) moved = 0;
    pinch = 0;
  });

  canvas.addEventListener("pointermove", (event) => {
    const now = local(event);
    const before = pointers.get(event.pointerId);
    if (!before) {
      canvas.style.cursor = pointAt(now[0], now[1]) ? "pointer" : "grab";
      return;
    }
    pointers.set(event.pointerId, now);
    if (pointers.size === 1) {
      tx += now[0] - before[0];
      ty += now[1] - before[1];
      moved += Math.abs(now[0] - before[0]) + Math.abs(now[1] - before[1]);
      canvas.style.cursor = "grabbing";
      clampView();
      requestDraw();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      if (pinch) zoomAt(mx, my, distance / pinch);
      pinch = distance;
      moved += 10;
    }
  });

  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    const at = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    pinch = 0;
    canvas.style.cursor = "grab";
    if (event.type === "pointerup" && pointers.size === 0 && moved < 6) {
      const hit = pointAt(at[0], at[1]);
      choose(hit ? hit.key : null);
    }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("dblclick", (event) => {
    const [px, py] = local(event);
    zoomAt(px, py, 1.8);
  });

  let hintTimer = 0;
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        // Let the page scroll; remind the reader how to zoom.
        if (hint) {
          hint.hidden = false;
          clearTimeout(hintTimer);
          hintTimer = setTimeout(() => (hint.hidden = true), 1400);
        }
        return;
      }
      event.preventDefault();
      const [px, py] = local(event);
      zoomAt(px, py, Math.exp(-event.deltaY * (event.ctrlKey && !event.metaKey ? 0.012 : 0.003)));
    },
    { passive: false },
  );

  canvas.addEventListener("keydown", (event) => {
    const step = 60;
    const keys = {
      ArrowLeft: () => (tx += step),
      ArrowRight: () => (tx -= step),
      ArrowUp: () => (ty += step),
      ArrowDown: () => (ty -= step),
      "+": () => zoomAt(cssW / 2, cssH / 2, 1.5),
      "=": () => zoomAt(cssW / 2, cssH / 2, 1.5),
      "-": () => zoomAt(cssW / 2, cssH / 2, 1 / 1.5),
      Escape: () => choose(null),
    };
    if (!keys[event.key]) return;
    event.preventDefault();
    keys[event.key]();
    clampView();
    requestDraw();
  });

  root.querySelector('[data-map="in"]')?.addEventListener("click", () => zoomAt(cssW / 2, cssH / 2, 1.6));
  root.querySelector('[data-map="out"]')?.addEventListener("click", () => zoomAt(cssW / 2, cssH / 2, 1 / 1.6));
  root.querySelector('[data-map="reset"]')?.addEventListener("click", () => {
    choose(null);
    setView(viewFor(pointBounds(), 36), true);
  });

  new ResizeObserver(resize).observe(canvas);

  // ---- public API -------------------------------------------------------

  return {
    /** Members with coordinates that fall inside the basemap. Returns how many were placed. */
    setMembers(members) {
      points = [];
      for (const member of members) {
        if (member.lat == null || member.lon == null) continue;
        if (member.lon < W || member.lon > E || member.lat < S || member.lat > N) continue;
        const [x, y] = project(member.lon, member.lat);
        points.push({ id: member.id, x, y, member, key: `${member.lon.toFixed(5)},${member.lat.toFixed(5)}` });
      }
      sized = false;
      resize();
      return points.length;
    },
    has(id) {
      return points.some((p) => p.id === id);
    },
    /** Limit the dots to a Set of member ids; null shows everyone. */
    setVisible(ids) {
      visible = ids;
      const stillShown = points.some((p) => p.key === selectedKey && (!visible || visible.has(p.id)));
      if (selectedKey && !stillShown) choose(null);
      requestDraw();
    },
    /** Select a member's address and move the map to it. */
    focus(id) {
      const point = points.find((p) => p.id === id);
      if (!point) return false;
      choose(point.key);
      const kk = Math.max(k, Math.min(MAX_K, minK * 9));
      setView({ k: kk, tx: cssW / 2 - point.x * kk, ty: cssH / 2 - point.y * kk }, true);
      return true;
    },
    clear() {
      choose(null);
    },
    /** Outline an area given as rings of [lon, lat]; null removes the outline. */
    setOutline(rings) {
      outline = null;
      outlineBounds = null;
      if (rings) {
        outline = new Path2D();
        const b = (outlineBounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        for (const ring of rings) {
          ring.forEach(([lon, lat], i) => {
            const [x, y] = project(lon, lat);
            b.x0 = Math.min(b.x0, x);
            b.x1 = Math.max(b.x1, x);
            b.y0 = Math.min(b.y0, y);
            b.y1 = Math.max(b.y1, y);
            if (i) outline.lineTo(x, y);
            else outline.moveTo(x, y);
          });
          outline.closePath();
        }
      }
      requestDraw();
    },
    /** Move the map to show the outlined area, or every visible dot when nothing is outlined. */
    fit() {
      if (cssW) setView(viewFor(outlineBounds || pointBounds(), outlineBounds ? 28 : 40), true);
    },
  };
}
