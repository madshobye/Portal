const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const SVG_NS = "http://www.w3.org/2000/svg";

const ui = {
  fileInput: $("#file-input"), loadButtons: [$("#load-button"), $("#empty-load-button")],
  empty: $("#empty-state"), workspace: $("#workspace"), datasetMeta: $("#dataset-meta"),
  search: $("#search"), sizeBy: $("#size-by"), recordType: $("#record-type"), access: $("#access-filter"),
  verified: $("#verified-only"), hideSingle: $("#hide-single-authors"), topicFilters: $("#topic-filters"),
  allTopics: $("#all-topics"), topicCount: $("#topic-count"), clearFilters: $("#clear-filters"),
  svg: $("#network"), viewport: $("#viewport"), links: $("#links"), nodes: $("#nodes"), labels: $("#labels"),
  visibleSummary: $("#visible-summary"), layoutDescription: $("#layout-description"), tooltip: $("#graph-tooltip"),
  details: $("#details"), timeStart: $("#time-start"), timeEnd: $("#time-end"), timeLabel: $("#time-label"), histogram: $("#histogram"),
  resultCount: $("#result-count"), resultSort: $("#result-sort"), paperResults: $("#paper-results"),
  dropOverlay: $("#drop-overlay"), error: $("#error-toast"),
};

const state = {
  system: null, fileName: "", layout: "clusters", sizeBy: "connections", search: "", selectedTopics: new Set(),
  timeStart: 0, timeEnd: 0, recordType: "", access: "", verifiedOnly: false, hideSingleAuthors: true,
  nodeTypes: new Set(["topic", "paper", "author"]), selectedId: null, hoveredId: null, resultSort: "newest",
  transform: { x: 0, y: 0, k: 1 }, dragging: null, currentGraph: null, nodeElements: new Map(), linkElements: [],
};

const LAYOUT_COPY = {
  clusters: "Papers orbit their topics; cross-topic authors become bridges.",
  bridges: "Multi-topic authors move inward to expose interdisciplinary connectors.",
  timeline: "Papers follow alert time horizontally and topics vertically.",
};

bindScholarEvents();

function bindScholarEvents() {
  ui.loadButtons.forEach((button) => button.addEventListener("click", () => ui.fileInput.click()));
  ui.fileInput.addEventListener("change", () => { if (ui.fileInput.files[0]) loadScholarJsonFile(ui.fileInput.files[0]); });
  let dragDepth = 0;
  window.addEventListener("dragenter", (event) => { event.preventDefault(); dragDepth += 1; ui.dropOverlay.hidden = false; });
  window.addEventListener("dragover", (event) => event.preventDefault());
  window.addEventListener("dragleave", (event) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) ui.dropOverlay.hidden = true; });
  window.addEventListener("drop", (event) => {
    event.preventDefault(); dragDepth = 0; ui.dropOverlay.hidden = true;
    const file = event.dataTransfer?.files?.[0]; if (file) loadScholarJsonFile(file);
  });
  ui.search.addEventListener("input", () => { state.search = ui.search.value.trim().toLowerCase(); renderScholarSystem(); });
  ui.sizeBy.addEventListener("change", () => { state.sizeBy = ui.sizeBy.value; renderScholarGraph(); });
  ui.recordType.addEventListener("change", () => { state.recordType = ui.recordType.value; renderScholarSystem(); });
  ui.access.addEventListener("change", () => { state.access = ui.access.value; renderScholarSystem(); });
  ui.verified.addEventListener("change", () => { state.verifiedOnly = ui.verified.checked; renderScholarSystem(); });
  ui.hideSingle.addEventListener("change", () => { state.hideSingleAuthors = ui.hideSingle.checked; renderScholarSystem(); });
  ui.resultSort.addEventListener("change", () => { state.resultSort = ui.resultSort.value; renderScholarResults(filteredScholarPapers()); });
  ui.allTopics.addEventListener("click", () => { state.selectedTopics.clear(); renderScholarSystem(); });
  ui.clearFilters.addEventListener("click", clearScholarFilters);
  $$('[data-layout]').forEach((button) => button.addEventListener("click", () => {
    state.layout = button.dataset.layout;
    $$('[data-layout]').forEach((item) => item.classList.toggle("is-active", item === button));
    fitScholarGraph(); renderScholarGraph();
  }));
  $$('[data-node-type]').forEach((input) => input.addEventListener("change", () => {
    if (input.checked) state.nodeTypes.add(input.dataset.nodeType); else state.nodeTypes.delete(input.dataset.nodeType);
    renderScholarGraph();
  }));
  ui.timeStart.addEventListener("input", updateScholarTimeRange);
  ui.timeEnd.addEventListener("input", updateScholarTimeRange);
  $("#fit-button").addEventListener("click", fitScholarGraph);
  $("#zoom-in").addEventListener("click", () => zoomScholarGraph(1.22));
  $("#zoom-out").addEventListener("click", () => zoomScholarGraph(.82));
  ui.svg.addEventListener("wheel", onScholarWheel, { passive: false });
  ui.svg.addEventListener("pointerdown", onScholarPointerDown);
  window.addEventListener("pointermove", onScholarPointerMove);
  window.addEventListener("pointerup", onScholarPointerUp);
  ui.svg.addEventListener("click", (event) => { if (event.target === ui.svg) selectScholarNode(null); });
  window.addEventListener("keydown", (event) => { if (event.key.toLowerCase() === "f" && !/input|select/i.test(document.activeElement.tagName)) fitScholarGraph(); });
}

async function loadScholarJsonFile(file) {
  try {
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") throw new Error("Please choose a JSON file.");
    const raw = JSON.parse(await file.text());
    state.system = buildScholarSystem(raw); state.fileName = file.name; state.timeStart = state.system.minMonth; state.timeEnd = state.system.maxMonth;
    state.selectedTopics.clear(); state.selectedId = null; state.hoveredId = null; state.search = ""; ui.search.value = "";
    configureScholarControls(); fitScholarGraph(false); ui.empty.hidden = true; ui.workspace.hidden = false;
    ui.datasetMeta.textContent = `${file.name} · ${state.system.papers.length} papers · ${state.system.authorList.length} authors · ${state.system.topicList.length} topics`;
    renderScholarSystem();
  } catch (error) { showScholarError(error?.message || String(error)); }
  finally { ui.fileInput.value = ""; }
}

function configureScholarControls() {
  const system = state.system;
  ui.recordType.replaceChildren(el("option", { value: "", text: "All types" }), ...system.recordTypes.map((type) => el("option", { value: type, text: type })));
  const span = system.maxMonth - system.minMonth;
  [ui.timeStart, ui.timeEnd].forEach((input) => { input.min = "0"; input.max = String(span); });
  ui.timeStart.value = "0"; ui.timeEnd.value = String(span);
  renderScholarTopicFilters(); renderScholarHistogram();
}

function renderScholarSystem() {
  if (!state.system) return;
  const papers = filteredScholarPapers();
  renderScholarTopicFilters(); renderScholarHistogram(); renderScholarTimeLabel(); renderScholarGraph(papers); renderScholarResults(papers);
  if (state.selectedId) renderScholarDetails(state.selectedId); else renderScholarDetails(null);
}

function filteredScholarPapers({ ignoreTime = false, ignoreTopics = false } = {}) {
  const queryParts = state.search.split(/\s+/).filter(Boolean);
  return state.system.papers.filter((paper) => {
    const month = scholarMonthIndex(paper.time);
    return (!queryParts.length || queryParts.every((part) => paper.searchText.includes(part)))
      && (ignoreTopics || !state.selectedTopics.size || paper.topics.some((topic) => state.selectedTopics.has(topic)))
      && (ignoreTime || (month >= state.timeStart && month <= state.timeEnd))
      && (!state.recordType || paper.recordType === state.recordType)
      && (!state.access || paper.openAccess)
      && (!state.verifiedOnly || paper.verified);
  });
}

function renderScholarTopicFilters() {
  const counts = new Map(state.system.topicList.map((topic) => [topic.label, 0]));
  filteredScholarPapers({ ignoreTime: true, ignoreTopics: true }).forEach((paper) => paper.topics.forEach((topic) => counts.set(topic, (counts.get(topic) || 0) + 1)));
  ui.topicFilters.replaceChildren(...state.system.topicList.map((topic) => {
    const button = el("button", { className: `topic-chip${state.selectedTopics.has(topic.label) ? " is-active" : ""}`, type: "button", text: `${topic.label} · ${counts.get(topic.label) || 0}` });
    button.style.setProperty("--topic-color", topic.color);
    button.addEventListener("click", (event) => {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && !state.selectedTopics.has(topic.label)) state.selectedTopics.clear();
      if (state.selectedTopics.has(topic.label)) state.selectedTopics.delete(topic.label); else state.selectedTopics.add(topic.label);
      renderScholarSystem();
    });
    return button;
  }));
  ui.allTopics.classList.toggle("is-active", !state.selectedTopics.size);
  ui.topicCount.textContent = state.selectedTopics.size ? `${state.selectedTopics.size} selected` : `${state.system.topicList.length} total`;
}

function updateScholarTimeRange(event) {
  let start = Number(ui.timeStart.value), end = Number(ui.timeEnd.value);
  if (start > end) { if (event.target === ui.timeStart) end = start; else start = end; }
  ui.timeStart.value = String(start); ui.timeEnd.value = String(end);
  state.timeStart = state.system.minMonth + start; state.timeEnd = state.system.minMonth + end;
  renderScholarSystem();
}

function renderScholarTimeLabel() {
  ui.timeLabel.textContent = `${formatScholarMonth(state.timeStart)} — ${formatScholarMonth(state.timeEnd)}`;
}

function renderScholarHistogram() {
  const span = state.system.maxMonth - state.system.minMonth;
  const counts = Array(span + 1).fill(0);
  filteredScholarPapers({ ignoreTime: true }).forEach((paper) => { const index = scholarMonthIndex(paper.time) - state.system.minMonth; if (index >= 0 && index < counts.length) counts[index] += 1; });
  const maxCount = Math.max(1, ...counts);
  ui.histogram.replaceChildren(...counts.map((count, index) => {
    const bar = el("span"); bar.style.height = `${Math.max(3, count / maxCount * 100)}%`;
    bar.classList.toggle("is-outside", state.system.minMonth + index < state.timeStart || state.system.minMonth + index > state.timeEnd);
    bar.title = `${formatScholarMonth(state.system.minMonth + index)}: ${count} papers`; return bar;
  }));
}

function renderScholarGraph(papers = filteredScholarPapers()) {
  const graph = buildVisibleScholarGraph(papers); state.currentGraph = graph;
  const positions = scholarLayoutPositions(graph); graph.positions = positions;
  ui.links.replaceChildren(); ui.nodes.replaceChildren(); ui.labels.replaceChildren(); state.nodeElements.clear(); state.linkElements = [];
  const linkFragment = document.createDocumentFragment();
  graph.links.forEach((link) => {
    const source = positions.get(link.source), target = positions.get(link.target); if (!source || !target) return;
    const line = svgEl("line", { x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: `network-link ${link.kind}` });
    line.dataset.source = link.source; line.dataset.target = link.target; linkFragment.appendChild(line); state.linkElements.push(line);
  });
  ui.links.appendChild(linkFragment);
  const nodeFragment = document.createDocumentFragment();
  graph.nodes.forEach((node) => {
    const point = positions.get(node.id); if (!point) return;
    const circle = svgEl("circle", { cx: point.x, cy: point.y, r: scholarNodeRadius(node, graph), class: `network-node ${node.kind}`, tabindex: "0", role: "button", "aria-label": `${node.kind}: ${node.label}` });
    if (node.kind !== "author") circle.setAttribute("fill", node.color || "#68736f");
    circle.dataset.id = node.id;
    circle.addEventListener("pointerenter", (event) => hoverScholarNode(node.id, event));
    circle.addEventListener("pointermove", moveScholarTooltip);
    circle.addEventListener("pointerleave", () => hoverScholarNode(null));
    circle.addEventListener("focus", () => hoverScholarNode(node.id));
    circle.addEventListener("blur", () => hoverScholarNode(null));
    circle.addEventListener("click", (event) => { event.stopPropagation(); selectScholarNode(node.id); });
    circle.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectScholarNode(node.id); } });
    nodeFragment.appendChild(circle); state.nodeElements.set(node.id, circle);
  });
  ui.nodes.appendChild(nodeFragment);
  renderScholarLabels(); updateScholarHighlight(); applyScholarTransform();
  ui.visibleSummary.textContent = `${papers.length} papers · ${graph.counts.authors} authors · ${graph.counts.topics} topics`;
  ui.layoutDescription.textContent = LAYOUT_COPY[state.layout];
}

function buildVisibleScholarGraph(papers) {
  const paperSet = new Set(papers.map((paper) => paper.id));
  const topicCounts = new Map(), authorCounts = new Map();
  papers.forEach((paper) => {
    paper.topics.forEach((topic) => topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1));
    paper.authorIds.forEach((id) => authorCounts.set(id, (authorCounts.get(id) || 0) + 1));
  });
  const nodes = [], links = [], byId = new Map(), neighbors = new Map();
  const addNode = (node) => { if (!byId.has(node.id)) { nodes.push(node); byId.set(node.id, node); neighbors.set(node.id, new Set()); } };
  if (state.nodeTypes.has("topic")) state.system.topicList.filter((topic) => topicCounts.has(topic.label)).forEach((topic) => addNode({ ...topic, count: topicCounts.get(topic.label) }));
  if (state.nodeTypes.has("paper")) papers.forEach((paper) => addNode({ id: `paper:${paper.id}`, kind: "paper", label: paper.title, paper, color: paper.primaryTopic?.color }));
  if (state.nodeTypes.has("author")) state.system.authorList.filter((author) => {
    const count = authorCounts.get(author.id) || 0; return count && (!state.hideSingleAuthors || count > 1);
  }).forEach((author) => addNode({ ...author, count: authorCounts.get(author.id) }));
  const addLink = (source, target, kind) => {
    if (!byId.has(source) || !byId.has(target)) return; links.push({ source, target, kind }); neighbors.get(source).add(target); neighbors.get(target).add(source);
  };
  papers.forEach((paper) => {
    const paperId = `paper:${paper.id}`;
    paper.topics.forEach((label) => addLink(`topic:${slugScholar(label)}`, paperId, "topic-paper"));
    paper.authorIds.forEach((authorId) => addLink(paperId, authorId, "paper-author"));
    if (!state.nodeTypes.has("paper")) paper.topics.forEach((label) => paper.authorIds.forEach((authorId) => addLink(`topic:${slugScholar(label)}`, authorId, "topic-author")));
  });
  return { papers, paperSet, nodes, links, byId, neighbors, topicCounts, authorCounts, counts: {
    papers: papers.length, topics: topicCounts.size, authors: Array.from(authorCounts.values()).filter((count) => !state.hideSingleAuthors || count > 1).length,
  } };
}

function scholarLayoutPositions(graph) {
  if (state.layout === "timeline") return scholarTimelineLayout(graph);
  if (state.layout === "bridges") return scholarBridgeLayout(graph);
  return scholarClusterLayout(graph);
}

function scholarTopicCenters(graph, radiusX = 360, radiusY = 255) {
  const topics = state.system.topicList.filter((topic) => graph.topicCounts.has(topic.label));
  const result = new Map();
  topics.forEach((topic, index) => {
    const angle = -Math.PI / 2 + index / Math.max(1, topics.length) * Math.PI * 2;
    result.set(topic.label, { x: 500 + Math.cos(angle) * radiusX, y: 350 + Math.sin(angle) * radiusY });
  });
  return result;
}

function scholarClusterLayout(graph) {
  const positions = new Map(), centers = scholarTopicCenters(graph);
  state.system.topicList.forEach((topic) => { const point = centers.get(topic.label); if (point) positions.set(topic.id, point); });
  graph.papers.forEach((paper) => {
    const topicPoints = paper.topics.map((topic) => centers.get(topic)).filter(Boolean); const center = averageScholarPoints(topicPoints) || { x: 500, y: 350 };
    const seed = hashScholar(paper.id), angle = seed / 4294967295 * Math.PI * 2, radius = 34 + ((seed >>> 9) % 100) / 100 * 68;
    positions.set(`paper:${paper.id}`, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
  });
  positionScholarAuthors(graph, positions, 28); return positions;
}

function scholarBridgeLayout(graph) {
  const positions = new Map(), centers = scholarTopicCenters(graph, 390, 275);
  state.system.topicList.forEach((topic) => { const point = centers.get(topic.label); if (point) positions.set(topic.id, point); });
  const authorPositions = new Map();
  state.system.authorList.forEach((author) => {
    const activeTopics = Array.from(author.topicIds).map((id) => state.system.topics.get(id)).filter((topic) => topic && graph.topicCounts.has(topic.label));
    const average = averageScholarPoints(activeTopics.map((topic) => centers.get(topic.label)).filter(Boolean)) || { x: 500, y: 350 };
    const bridge = Math.min(.72, Math.max(.18, (activeTopics.length - 1) * .2)); const seed = hashScholar(author.id), jitter = 18 + seed % 24;
    authorPositions.set(author.id, { x: average.x * (1 - bridge) + 500 * bridge + Math.cos(seed) * jitter, y: average.y * (1 - bridge) + 350 * bridge + Math.sin(seed) * jitter });
  });
  graph.papers.forEach((paper) => {
    const topicPoint = averageScholarPoints(paper.topics.map((topic) => centers.get(topic)).filter(Boolean)) || { x: 500, y: 350 };
    const authorPoint = averageScholarPoints(paper.authorIds.map((id) => authorPositions.get(id)).filter(Boolean)) || topicPoint;
    const seed = hashScholar(paper.id); positions.set(`paper:${paper.id}`, { x: topicPoint.x * .52 + authorPoint.x * .48 + Math.cos(seed) * 14, y: topicPoint.y * .52 + authorPoint.y * .48 + Math.sin(seed) * 14 });
  });
  authorPositions.forEach((point, id) => positions.set(id, point)); return positions;
}

function scholarTimelineLayout(graph) {
  const positions = new Map();
  const topics = state.system.topicList.filter((topic) => graph.topicCounts.has(topic.label));
  const rowByTopic = new Map(topics.map((topic, index) => [topic.label, 65 + index / Math.max(1, topics.length - 1) * 570]));
  topics.forEach((topic) => positions.set(topic.id, { x: 48, y: rowByTopic.get(topic.label) }));
  const span = Math.max(1, state.timeEnd - state.timeStart);
  graph.papers.forEach((paper) => {
    const month = scholarMonthIndex(paper.time), x = 105 + (month - state.timeStart) / span * 835;
    const rows = paper.topics.map((topic) => rowByTopic.get(topic)).filter(Number.isFinite); const seed = hashScholar(paper.id);
    positions.set(`paper:${paper.id}`, { x, y: (rows.reduce((sum, value) => sum + value, 0) / Math.max(1, rows.length) || 350) + ((seed % 19) - 9) });
  });
  positionScholarAuthors(graph, positions, 17); return positions;
}

function positionScholarAuthors(graph, positions, jitterMax) {
  state.system.authorList.forEach((author) => {
    const points = Array.from(author.paperIds).filter((id) => graph.paperSet.has(id)).map((id) => positions.get(`paper:${id}`)).filter(Boolean);
    if (!points.length) return; const average = averageScholarPoints(points), seed = hashScholar(author.id), angle = seed / 4294967295 * Math.PI * 2;
    positions.set(author.id, { x: average.x + Math.cos(angle) * (8 + seed % jitterMax), y: average.y + Math.sin(angle) * (8 + seed % jitterMax) });
  });
}

function scholarNodeRadius(node, graph) {
  const base = node.kind === "topic" ? 9 : node.kind === "paper" ? 4.3 : 3.2;
  if (state.sizeBy === "uniform") return base + (node.kind === "topic" ? 4 : 1.5);
  if (state.sizeBy === "recency") {
    const dates = nodeScholarPapers(node).map((paper) => scholarMonthIndex(paper.time)); const newest = dates.length ? Math.max(...dates) : state.system.minMonth;
    return base + Math.max(1, (newest - state.system.minMonth) / Math.max(1, state.system.maxMonth - state.system.minMonth) * 9);
  }
  if (state.sizeBy === "citations") {
    const citations = nodeScholarPapers(node).reduce((sum, paper) => sum + (paper.citationCount || 0), 0);
    return base + Math.min(18, Math.sqrt(citations) * 1.6);
  }
  const degree = graph.neighbors.get(node.id)?.size || node.count || 1;
  return base + Math.min(node.kind === "topic" ? 20 : 12, Math.sqrt(degree) * (node.kind === "topic" ? 1.5 : 1.15));
}

function nodeScholarPapers(node) {
  if (node.kind === "paper") return [node.paper];
  return Array.from(node.paperIds || []).map((id) => state.system.paperById.get(id)).filter(Boolean);
}

function renderScholarLabels() {
  if (!state.currentGraph?.positions) return;
  const ids = new Set(state.currentGraph.nodes.filter((node) => node.kind === "topic").map((node) => node.id));
  const focus = state.hoveredId || state.selectedId;
  if (focus) { ids.add(focus); (state.currentGraph.neighbors.get(focus) || []).forEach((id) => ids.add(id)); }
  const fragment = document.createDocumentFragment();
  ids.forEach((id) => {
    const node = state.currentGraph.byId.get(id), point = state.currentGraph.positions.get(id); if (!node || !point) return;
    const label = svgEl("text", { x: point.x + scholarNodeRadius(node, state.currentGraph) + 5, y: point.y + 3, class: `network-label${node.kind === "topic" ? "" : " secondary"}` });
    label.textContent = truncateScholar(node.label, node.kind === "paper" ? 38 : 26); fragment.appendChild(label);
  });
  ui.labels.replaceChildren(fragment);
}

function hoverScholarNode(id, event) {
  state.hoveredId = id; updateScholarHighlight(); renderScholarLabels();
  if (!id) { ui.tooltip.hidden = true; return; }
  const node = state.currentGraph.byId.get(id); renderScholarTooltip(node); if (event) moveScholarTooltip(event);
}

function updateScholarHighlight() {
  const focus = state.hoveredId || state.selectedId; const active = new Set(focus ? [focus, ...(state.currentGraph?.neighbors.get(focus) || [])] : []);
  state.nodeElements.forEach((element, id) => {
    element.classList.toggle("is-muted", !!focus && !active.has(id)); element.classList.toggle("is-selected", id === state.selectedId);
  });
  state.linkElements.forEach((line) => {
    const isActive = !!focus && (line.dataset.source === focus || line.dataset.target === focus);
    line.classList.toggle("is-active", isActive); line.classList.toggle("is-muted", !!focus && !isActive);
  });
}

function renderScholarTooltip(node) {
  ui.tooltip.replaceChildren(el("span", { text: node.kind }), el("strong", { text: node.label }), el("div", { text: scholarNodeSummary(node) })); ui.tooltip.hidden = false;
}

function scholarNodeSummary(node) {
  if (node.kind === "paper") return `${node.paper.authors.map((author) => author.name).join(", ")} · ${node.paper.topics.join(" · ")}`;
  if (node.kind === "author") return `${node.count || node.paperIds.size} visible papers · ${node.topicIds.size} topics`;
  return `${node.count || node.paperIds.size} visible papers · ${node.authorIds.size} connected authors`;
}

function moveScholarTooltip(event) {
  if (!event || ui.tooltip.hidden) return; const gap = 14, w = 260, h = ui.tooltip.offsetHeight || 80;
  ui.tooltip.style.left = `${Math.min(window.innerWidth - w - 8, event.clientX + gap)}px`;
  ui.tooltip.style.top = `${Math.min(window.innerHeight - h - 8, event.clientY + gap)}px`;
}

function selectScholarNode(id) {
  state.selectedId = id; renderScholarDetails(id); updateScholarHighlight(); renderScholarLabels();
}

function renderScholarDetails(id) {
  const node = id ? state.currentGraph?.byId.get(id) || canonicalScholarNode(id) : null;
  if (!node) { ui.details.replaceChildren(detailEmpty()); return; }
  if (node.kind === "paper") renderPaperDetails(node.paper); else if (node.kind === "author") renderAuthorDetails(node); else renderTopicDetails(node);
}

function renderPaperDetails(paper) {
  const content = [
    el("span", { className: "detail-type", text: "Paper" }), el("h2", { text: paper.title }),
    el("p", { className: "detail-meta", text: [paper.venue, paper.recordType, paper.publicationYear, paper.openAccess ? "Open access" : ""].filter(Boolean).join(" · ") }),
  ];
  if (paper.articleLink || paper.pdfLink) {
    const actions = el("div", { className: "external-actions" });
    if (paper.articleLink) actions.append(el("a", { text: "Open article ↗", href: paper.articleLink, target: "_blank", rel: "noopener" }));
    if (paper.pdfLink && paper.pdfLink !== paper.articleLink) actions.append(el("a", { text: "Open PDF ↗", href: paper.pdfLink, target: "_blank", rel: "noopener" }));
    content.push(actions);
  }
  if (paper.abstract) content.push(el("p", { className: "detail-abstract", text: paper.abstract }));
  content.push(detailTags("Topics", paper.topics, (topic) => filterToScholarTopic(topic)));
  content.push(detailButtons("Authors", paper.authorIds.map((id) => ({ id, label: state.system.authors.get(id)?.label || id })), (id) => selectCanonicalScholarNode(id)));
  if (paper.keywords.length) content.push(detailTags("Keywords", paper.keywords, (keyword) => searchScholarFor(keyword)));
  const attributes = [...paper.methods, ...paper.researchContexts, ...paper.technologies, ...paper.countries];
  if (attributes.length) content.push(detailTags("Research descriptors", attributes, (value) => searchScholarFor(value)));
  const dateText = paper.latestAlertDate ? `Alerted ${formatScholarDate(paper.latestAlertDate)}` : paper.publicationDate ? `Published ${formatScholarDate(paper.publicationDate)}` : "Date unavailable";
  content.push(detailSection("Identity & time", [paper.doi ? `DOI ${paper.doi}` : paper.id, dateText, `${paper.citationCount ?? "Unknown"} citations`].join(" · ")));
  if (paper.qualityNotes) content.push(el("p", { className: "quality-note", text: `${paper.verified ? "Verified" : "Needs verification"}: ${paper.qualityNotes}` }));
  ui.details.replaceChildren(...content);
}

function renderAuthorDetails(node) {
  const author = state.system.authors.get(node.id) || node;
  const papers = Array.from(author.paperIds).map((id) => state.system.paperById.get(id)).filter(Boolean).sort((a, b) => b.time - a.time);
  const topics = Array.from(author.topicIds).map((id) => state.system.topics.get(id)?.label).filter(Boolean);
  const content = [el("span", { className: "detail-type", text: "Author" }), el("h2", { text: author.label }), el("p", { className: "detail-meta", text: `${papers.length} papers · ${topics.length} topics${author.orcid ? ` · ORCID ${author.orcid}` : ""}` })];
  if (author.affiliations?.size) content.push(detailSection("Affiliations", Array.from(author.affiliations).join(" · ")));
  content.push(detailTags("Topics", topics, (topic) => filterToScholarTopic(topic)));
  content.push(detailButtons("Papers", papers.slice(0, 18).map((paper) => ({ id: `paper:${paper.id}`, label: paper.title })), (id) => selectCanonicalScholarNode(id)));
  ui.details.replaceChildren(...content);
}

function renderTopicDetails(node) {
  const topic = state.system.topics.get(node.id) || node;
  const papers = Array.from(topic.paperIds).map((id) => state.system.paperById.get(id)).filter(Boolean).sort((a, b) => b.time - a.time);
  const authors = Array.from(topic.authorIds).map((id) => state.system.authors.get(id)).filter(Boolean).sort((a, b) => b.paperIds.size - a.paperIds.size);
  const content = [el("span", { className: "detail-type", text: "Topic" }), el("h2", { text: topic.label }), el("p", { className: "detail-meta", text: `${papers.length} papers · ${authors.length} authors` })];
  const filterButton = el("button", { className: "button button-primary", type: "button", text: "Filter to this topic" }); filterButton.addEventListener("click", () => filterToScholarTopic(topic.label)); content.push(filterButton);
  content.push(detailButtons("Leading authors", authors.slice(0, 12).map((author) => ({ id: author.id, label: `${author.label} · ${intersectionScholarCount(author.paperIds, topic.paperIds)} papers` })), (id) => selectCanonicalScholarNode(id)));
  content.push(detailButtons("Newest papers", papers.slice(0, 12).map((paper) => ({ id: `paper:${paper.id}`, label: paper.title })), (id) => selectCanonicalScholarNode(id)));
  ui.details.replaceChildren(...content);
}

function selectCanonicalScholarNode(id) {
  if (!state.currentGraph?.byId.has(id)) {
    const node = canonicalScholarNode(id); if (!node) return;
    if (node.kind === "paper") searchScholarFor(node.paper.title); else searchScholarFor(node.label);
  }
  selectScholarNode(id);
}

function canonicalScholarNode(id) {
  if (id.startsWith("paper:")) { const paper = state.system.paperById.get(id.slice(6)); return paper ? { id, kind: "paper", label: paper.title, paper, color: paper.primaryTopic?.color } : null; }
  return state.system.authors.get(id) || state.system.topics.get(id) || null;
}

function renderScholarResults(papers) {
  const sorted = [...papers];
  if (state.resultSort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
  else if (state.resultSort === "authors") sorted.sort((a, b) => b.authors.length - a.authors.length || a.title.localeCompare(b.title));
  else if (state.resultSort === "topics") sorted.sort((a, b) => b.topics.length - a.topics.length || a.title.localeCompare(b.title));
  else sorted.sort((a, b) => b.time - a.time || a.title.localeCompare(b.title));
  ui.resultCount.textContent = `${papers.length} paper${papers.length === 1 ? "" : "s"}`;
  ui.paperResults.replaceChildren(...sorted.slice(0, 80).map((paper) => {
    const button = el("button", { className: "paper-card", type: "button" });
    const stripe = el("span", { className: "topic-stripe" }); stripe.style.background = paper.primaryTopic?.color || "#68736f";
    const copy = el("div", {}, el("strong", { text: paper.title }), el("p", { text: `${paper.authors.map((author) => author.name).join(", ")} · ${paper.topics.join(" · ")}` }));
    button.append(stripe, copy, el("time", { text: formatScholarDate(paper.latestAlertDate || paper.publicationDate || paper.time) }));
    button.addEventListener("click", () => selectCanonicalScholarNode(`paper:${paper.id}`)); return button;
  }));
}

function clearScholarFilters() {
  state.search = ""; ui.search.value = ""; state.selectedTopics.clear(); state.recordType = ""; ui.recordType.value = ""; state.access = ""; ui.access.value = "";
  state.verifiedOnly = false; ui.verified.checked = false; state.timeStart = state.system.minMonth; state.timeEnd = state.system.maxMonth;
  ui.timeStart.value = "0"; ui.timeEnd.value = String(state.system.maxMonth - state.system.minMonth); renderScholarSystem();
}

function filterToScholarTopic(topic) { state.selectedTopics = new Set([topic]); state.selectedId = null; renderScholarSystem(); }
function searchScholarFor(value) { state.search = String(value).toLowerCase(); ui.search.value = value; state.selectedId = null; renderScholarSystem(); }

function onScholarWheel(event) {
  event.preventDefault(); const rect = ui.svg.getBoundingClientRect(), point = { x: (event.clientX - rect.left) / rect.width * 1000, y: (event.clientY - rect.top) / rect.height * 700 };
  const next = Math.max(.45, Math.min(5, state.transform.k * (event.deltaY > 0 ? .9 : 1.1))); const ratio = next / state.transform.k;
  state.transform.x = point.x - (point.x - state.transform.x) * ratio; state.transform.y = point.y - (point.y - state.transform.y) * ratio; state.transform.k = next; applyScholarTransform();
}

function onScholarPointerDown(event) {
  if (event.target.closest(".network-node")) return; ui.svg.setPointerCapture?.(event.pointerId); ui.svg.classList.add("is-dragging");
  state.dragging = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
}
function onScholarPointerMove(event) {
  if (!state.dragging) return; const rect = ui.svg.getBoundingClientRect();
  state.transform.x = state.dragging.startX + (event.clientX - state.dragging.x) / rect.width * 1000;
  state.transform.y = state.dragging.startY + (event.clientY - state.dragging.y) / rect.height * 700; applyScholarTransform();
}
function onScholarPointerUp() { state.dragging = null; ui.svg.classList.remove("is-dragging"); }
function zoomScholarGraph(factor) { state.transform.k = Math.max(.45, Math.min(5, state.transform.k * factor)); applyScholarTransform(); }
function fitScholarGraph(render = true) { state.transform = { x: 0, y: 0, k: 1 }; applyScholarTransform(); if (render && state.system) renderScholarGraph(); }
function applyScholarTransform() { ui.viewport.setAttribute("transform", `translate(${state.transform.x} ${state.transform.y}) scale(${state.transform.k})`); }

function detailEmpty() { return el("div", { className: "detail-empty" }, el("p", { className: "eyebrow", text: "Inspect" }), el("h2", { text: "Select a node" }), el("p", { text: "Choose any circle to see its papers, authors, topics, metadata, and direct relationships." })); }
function detailSection(title, text) { return el("section", { className: "detail-section" }, el("h3", { text: title }), el("p", { className: "detail-meta", text })); }
function detailTags(title, values, onClick) {
  const tags = el("div", { className: "inline-tags" }); values.forEach((value) => { const button = el("button", { className: "inline-tag", type: "button", text: value }); button.addEventListener("click", () => onClick(value)); tags.append(button); });
  return el("section", { className: "detail-section" }, el("h3", { text: title }), tags);
}
function detailButtons(title, values, onClick) {
  const list = el("div", { className: "detail-list" }); values.forEach((item) => { const button = el("button", { className: "detail-link", type: "button", text: item.label }); button.addEventListener("click", () => onClick(item.id)); list.append(button); });
  return el("section", { className: "detail-section" }, el("h3", { text: title }), list);
}

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => { if (key === "className") node.className = value; else if (key === "text") node.textContent = value; else if (value != null) node.setAttribute(key, value); });
  children.filter(Boolean).forEach((child) => node.append(child)); return node;
}
function svgEl(tag, attributes = {}) { const node = document.createElementNS(SVG_NS, tag); Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value)); return node; }
function averageScholarPoints(points) { if (!points.length) return null; return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }; }
function formatScholarMonth(index) { return scholarMonthDate(index).toLocaleDateString("en-GB", { month: "short", year: "numeric" }); }
function formatScholarDate(value) { const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function truncateScholar(value, length) { const text = String(value || ""); return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
function intersectionScholarCount(a, b) { let count = 0; a.forEach((value) => { if (b.has(value)) count += 1; }); return count; }
function showScholarError(message) { ui.error.textContent = message; ui.error.hidden = false; clearTimeout(showScholarError.timeout); showScholarError.timeout = setTimeout(() => { ui.error.hidden = true; }, 7000); }
