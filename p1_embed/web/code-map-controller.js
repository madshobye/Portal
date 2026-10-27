import { parseCodeMap, describeCodeNode } from "./code-map-model.js?v=0.1.87-ui762";
import { layoutCodeMap } from "./code-map-layout.js?v=0.1.87-ui762";

function el(tag, text = "", className = "") {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function svg(tag, attributes = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  node.textContent = text; return node;
}

export function createCodeMapController({ host, getCode, openCode } = {}) {
  let source = null, model, graph, canvas, world, selected, selectionLabel;
  let nodeElements = new Map(), edgeElements = [], sourceLines = [], showCalls = true;
  let camera = { x: 0, y: 0, scale: 1 }, zoomLabel, resizeObserver, focusSelect;

  function transform() {
    world.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    zoomLabel.textContent = `${Math.round(camera.scale * 100)}%`;
  }
  function zoom(factor, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
    const next = Math.max(.08, Math.min(2.5, camera.scale * factor));
    camera.x = x - (x - camera.x) * next / camera.scale;
    camera.y = y - (y - camera.y) * next / camera.scale;
    camera.scale = next; transform();
  }
  function fit() {
    focusSelect.value = "";
    if (!graph.nodes.length || !canvas.clientWidth || !canvas.clientHeight) return;
    const minX = Math.min(...graph.nodes.map(n => n.x)) - 80;
    const minY = Math.min(...graph.nodes.map(n => n.y)) - 80;
    const width = Math.max(...graph.nodes.map(n => n.x + n.width)) - minX + 100;
    const height = Math.max(...graph.nodes.map(n => n.y + n.height)) - minY + 80;
    const scale = Math.max(.08, Math.min(1, (canvas.clientWidth - 40) / width, (canvas.clientHeight - 40) / height));
    camera = { scale, x: (canvas.clientWidth - width * scale) / 2 - minX * scale, y: (canvas.clientHeight - height * scale) / 2 - minY * scale };
    transform();
  }
  function focusSection() {
    const group = graph.groups.find(g => g.entry === focusSelect.value);
    if (!group) { fit(); return; }
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const scale = Math.max(.65, Math.min(1, (canvas.clientWidth - 60) / group.width, (canvas.clientHeight - 60) / group.height));
    camera = { scale, x: (canvas.clientWidth - group.width * scale) / 2 - group.x * scale,
      y: Math.max(30, (canvas.clientHeight - group.height * scale) / 2) - group.y * scale };
    transform();
  }
  function select(node, reveal = false) {
    if (!node.source) return;
    selected = node.source;
    nodeElements.forEach((element, id) => element.setAttribute("aria-pressed", String(node.id === id)));
    edgeElements.forEach(({ edge, group }) => group.classList.toggle("is-related", edge.from === node.id || edge.to === node.id));
    sourceLines.forEach((line, i) => line.classList.toggle("is-selected", i + 1 >= selected.line && i + 1 <= selected.endLine));
    selectionLabel.textContent = `Source · lines ${selected.line}–${selected.endLine}`;
    if (reveal) {
      camera.scale = Math.max(camera.scale, 1);
      camera.x = canvas.clientWidth / 2 - (node.x + node.width / 2) * camera.scale;
      camera.y = canvas.clientHeight / 2 - (node.y + node.height / 2) * camera.scale;
      transform();
    } else sourceLines[selected.line - 1]?.scrollIntoView({ block: "nearest" });
  }
  function drawEdges() {
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    edgeElements.forEach(({ edge, path, label, group }, index) => {
      const a = nodes.get(edge.from), b = nodes.get(edge.to);
      let d, lx, ly;
      if (edge.kind === "call") {
        const right = b.x >= a.x;
        const ax = a.x + (right ? a.width : 0), bx = b.x + (right ? 0 : b.width);
        const ay = a.y + a.height / 2, by = b.y + b.height / 2;
        d = `M ${ax} ${ay} C ${ax + (right ? 80 : -80)} ${ay}, ${bx + (right ? -80 : 80)} ${by}, ${bx} ${by}`;
        lx = (ax + bx) / 2; ly = (ay + by) / 2 - 8;
      } else if (edge.kind === "back" || edge.kind === "exit" || b.y <= a.y) {
        const left = edge.kind === "exit";
        const ax = a.x + (left ? 0 : a.width), bx = b.x + (left ? 0 : b.width);
        const ay = a.y + a.height / 2, by = b.y + b.height / 2;
        const between = graph.nodes.filter(n => n.region === a.region && n.y + n.height >= Math.min(ay, by) && n.y <= Math.max(ay, by));
        const offset = 30 + index % 4 * 12;
        const channel = left ? Math.min(ax, bx, ...between.map(n => n.x)) - offset : Math.max(ax, bx, ...between.map(n => n.x + n.width)) + offset;
        d = `M ${ax} ${ay} H ${channel} V ${by} H ${bx}`;
        lx = channel + (left ? -8 : 8); ly = (ay + by) / 2;
      } else {
        const ax = a.x + a.width / 2, bx = b.x + b.width / 2;
        const ay = a.y + a.height, by = b.y, mid = ay + Math.min(36, (by - ay) / 2);
        d = `M ${ax} ${ay} V ${mid} H ${bx} V ${by}`;
        lx = (ax + bx) / 2 + 8; ly = mid - 8;
      }
      path.setAttribute("d", d); label.setAttribute("x", lx); label.setAttribute("y", ly);
      group.style.display = edge.kind === "call" && !showCalls ? "none" : "";
    });
  }

  function drawGraph() {
    world.replaceChildren(); nodeElements = new Map(); edgeElements = [];
    for (const group of graph.groups) {
      world.append(svg("rect", { x: group.x, y: group.y, width: group.width, height: group.height, rx: 20, class: "code-map-region" }),
        svg("text", { x: group.x + 20, y: group.y + 28, class: "code-map-region-title" }, group.name));
    }
    for (const edge of graph.edges) {
      const group = svg("g", { class: `code-map-edge code-map-edge-${edge.kind}` });
      const path = svg("path", { "marker-end": `url(#code-map-arrow${edge.kind === "call" ? "-call" : ""})` });
      const label = svg("text", {}, edge.label);
      group.append(path, label); world.append(group); edgeElements.push({ edge, group, path, label });
    }
    for (const node of graph.nodes) {
      const group = svg("g", { transform: `translate(${node.x} ${node.y})`, class: `code-map-graph-node code-map-kind-${node.kind}`, "data-node-id": node.id,
        tabindex: 0, role: "button", "aria-pressed": "false", "aria-label": node.label });
      const decision = ["if", "while", "for"].includes(node.kind);
      group.append(decision
        ? svg("polygon", { points: `20,0 ${node.width - 20},0 ${node.width},48 ${node.width - 20},96 20,96 0,48`, class: "code-map-node-shape" })
        : svg("rect", { width: node.width, height: node.height, rx: ["entry", "end"].includes(node.kind) ? 28 : 10, class: "code-map-node-shape" }));
      const description = node.source && !["entry", "update"].includes(node.kind) ? describeCodeNode(node.source).label
        : node.kind === "entry" ? "Function / entry" : node.kind === "end" ? "Exit" : node.kind === "join" ? "After loop" : "Update";
      group.append(svg("text", { x: 20, y: 23, class: "code-map-graph-label" }, description.length > 26 ? description.slice(0, 25) + "…" : description));
      const text = node.label.replace(/\s+/g, " ");
      const chunks = text.match(/.{1,25}(?:\s|$)|.{1,25}/g) || [""];
      chunks.slice(0, 3).forEach((chunk, i) => group.append(svg("text", { x: 20, y: 44 + i * 16, class: "code-map-graph-code" }, i === 2 && chunks.length > 3 ? chunk.slice(0, 23) + "…" : chunk.trim())));
      group.append(svg("circle", { cx: node.width / 2, cy: 0, r: 4, class: "code-map-port" }), svg("circle", { cx: node.width / 2, cy: node.height, r: 4, class: "code-map-port" }), svg("title", {}, node.label));
      group.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); select(node); }
      });
      world.append(group); nodeElements.set(node.id, group);
    }
    drawEdges(); transform();
  }

  function bindCanvas() {
    let drag = null;
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0 || drag) return;
      const target = event.target.closest("[data-node-id]");
      const node = target ? graph.nodes.find(n => n.id === target.dataset.nodeId) : null;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, node };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true; drag.x = event.clientX; drag.y = event.clientY;
      if (drag.node) {
        drag.node.x += dx / camera.scale; drag.node.y += dy / camera.scale;
        nodeElements.get(drag.node.id).setAttribute("transform", `translate(${drag.node.x} ${drag.node.y})`); drawEdges();
      } else { camera.x += dx; camera.y += dy; transform(); }
    });
    const finish = event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (event.type === "pointerup" && !drag.moved && drag.node) select(drag.node);
      drag = null; canvas.classList.remove("is-dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", finish); canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("wheel", event => {
      event.preventDefault(); const rect = canvas.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (["+", "=", "-", "0", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") fit();
        else if (["+", "="].includes(event.key)) zoom(1.2);
        else if (event.key === "-") zoom(1 / 1.2);
        else { camera.x += event.key === "ArrowLeft" ? 50 : event.key === "ArrowRight" ? -50 : 0;
          camera.y += event.key === "ArrowUp" ? 50 : event.key === "ArrowDown" ? -50 : 0; transform(); }
      }
    });
  }

  function render() {
    const current = getCode();
    if (source === current && canvas) return;
    resizeObserver?.disconnect();
    source = current; model = parseCodeMap(source); graph = layoutCodeMap(model); selected = null;
    host.replaceChildren();
    const toolbar = el("header", "", "code-map-toolbar");
    const title = el("div"); title.append(el("h1", "Code Map"), el("p", "Drag canvas to pan · scroll to zoom · drag nodes to arrange. Solid: flow. Dashed: calls."));
    toolbar.append(title);
    focusSelect = el("select", "", "code-map-focus"); focusSelect.setAttribute("aria-label", "Focus function");
    const overview = el("option", "All functions"); overview.value = ""; focusSelect.append(overview);
    graph.groups.forEach(group => { const option = el("option", group.name); option.value = group.entry; focusSelect.append(option); });
    focusSelect.value = (graph.groups.find(g => g.name === "loop") || graph.groups[0])?.entry || "";
    focusSelect.addEventListener("change", focusSection); toolbar.append(focusSelect);
    const action = (label, fn) => { const b = el("button", label, "button compact"); b.type = "button"; b.addEventListener("click", fn); toolbar.append(b); return b; };
    action("−", () => zoom(1 / 1.2)).setAttribute("aria-label", "Zoom out");
    zoomLabel = el("span", "100%", "code-map-zoom"); toolbar.append(zoomLabel);
    action("+", () => zoom(1.2)).setAttribute("aria-label", "Zoom in");
    action("Fit", fit);
    action("Auto layout", () => {
      graph = layoutCodeMap(model); drawGraph(); fit();
      const node = graph.nodes.find(n => n.source === selected);
      if (node) select(node);
    });
    const calls = action("Calls", () => { showCalls = !showCalls; calls.setAttribute("aria-pressed", String(showCalls)); drawEdges(); });
    calls.setAttribute("aria-pressed", String(showCalls));
    action("Open in Code", () => openCode(selected?.line || 1, selected?.endLine || 1));
    const workspace = el("div", "", "code-map-workspace");
    const surface = el("div", "", "code-map-surface");
    canvas = svg("svg", { class: "code-map-canvas", tabindex: 0, role: "group", "aria-label": "Code graph. Drag to pan. Plus and minus zoom, zero fits." });
    const defs = svg("defs");
    for (const suffix of ["", "-call"]) {
      const marker = svg("marker", { id: `code-map-arrow${suffix}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: "auto", markerUnits: "strokeWidth" });
      marker.append(svg("path", { d: "M0,0 L8,4 L0,8 Z", fill: suffix ? "#aa90de" : "#929ca4" })); defs.append(marker);
    }
    world = svg("g", { class: "code-map-world" }); canvas.append(defs, world); surface.append(canvas);
    if (model.error || !model.nodes.length) surface.append(el("p", model.error || "Write or open a sketch in Code to see its map.", "code-map-notice"));
    surface.append(el("span", "Read-only source map · not a live execution trace", "code-map-legend"));
    const side = el("aside", "", "code-map-source");
    selectionLabel = el("h2", "Source · select a node or line");
    const listing = el("div", "", "code-map-listing");
    sourceLines = source.split("\n").slice(0, 10000).map((text, index) => {
      const line = el("button", "", "code-map-source-line"); line.type = "button";
      line.append(el("span", String(index + 1)), el("code", text || " "));
      line.addEventListener("click", () => {
        const match = graph.nodes.filter(n => n.source && n.source.line <= index + 1 && n.source.endLine >= index + 1)
          .sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0];
        if (match) select(match, true);
      }); listing.append(line); return line;
    });
    side.append(selectionLabel, listing);
    if (source.split("\n").length > 10000) side.append(el("p", "Showing the first 10,000 lines. Open in Code for the full source."));
    workspace.append(surface, side); host.append(toolbar, workspace);
    bindCanvas(); drawGraph(); requestAnimationFrame(focusSection);
    resizeObserver = new ResizeObserver(focusSection);
    resizeObserver.observe(surface);
  }
  return { render };
}
