export function createHtmlCache() {
  const renderedHtml = new WeakMap();
  const scrollPositions = new Map();
  const viewControlStates = new Map();
  function replaceHtmlIfChanged(node, html, { scrollKey = null } = {}) {
    if (!node) return false;
    const next = String(html ?? "");
    const nextScrollKey = scrollKey === null ? node.dataset?.scrollKey || "" : String(scrollKey || "");
    const signature = `${nextScrollKey}\u0000${next}`;
    if (renderedHtml.get(node) === signature) return false;
    rememberScrollPositions(node, scrollPositions);
    rememberViewControlStates(node, viewControlStates);
    node.innerHTML = next;
    if (scrollKey !== null) {
      node.dataset.scrollRegion = "";
      node.dataset.scrollKey = nextScrollKey;
    }
    restoreScrollPositions(node, scrollPositions);
    restoreViewControlStates(node, viewControlStates);
    renderedHtml.set(node, signature);
    return true;
  }
  replaceHtmlIfChanged.restoreScrollRegions = (scope) => restoreScrollPositions(scope, scrollPositions);
  return replaceHtmlIfChanged;
}

export function rememberScrollPositions(scope, positions, limit = 512) {
  if (!scope || !positions) return;
  scrollMemoryNodes(scope).forEach((node) => {
    const key = node.dataset?.scrollKey;
    if (!key) return;
    if (!positions.has(key) && positions.size >= limit) positions.delete(positions.keys().next().value);
    positions.set(key, { top: node.scrollTop || 0, left: node.scrollLeft || 0 });
  });
}

export function restoreScrollPositions(scope, positions) {
  if (!scope || !positions) return;
  scrollMemoryNodes(scope).forEach((node) => {
    const position = positions.get(node.dataset?.scrollKey);
    if (!position) return;
    node.scrollTop = position.top;
    node.scrollLeft = position.left;
  });
}

// Opt-in control state belongs to the editor projection, not the authored
// project. Stable keys let transient controls such as catalog searches survive
// a surrounding template replacement without preserving ordinary parameter
// inputs whose values must continue to come from project state.
export function rememberViewControlStates(scope, states, limit = 512) {
  if (!scope || !states) return;
  viewControlMemoryNodes(scope).forEach((node) => {
    const key = node.dataset?.viewStateKey;
    if (!key) return;
    if (!states.has(key) && states.size >= limit) states.delete(states.keys().next().value);
    states.set(key, {
      value: String(node.value ?? ""),
      checked: Boolean(node.checked),
    });
  });
}

export function restoreViewControlStates(scope, states) {
  if (!scope || !states) return;
  viewControlMemoryNodes(scope).forEach((node) => {
    const state = states.get(node.dataset?.viewStateKey);
    if (!state) return;
    if ("value" in node) node.value = state.value;
    if ("checked" in node) node.checked = state.checked;
  });
}

function scrollMemoryNodes(scope) {
  const nodes = [];
  if (scope.matches?.("[data-scroll-region][data-scroll-key]")) nodes.push(scope);
  scope.querySelectorAll?.("[data-scroll-region][data-scroll-key]").forEach((node) => nodes.push(node));
  return nodes;
}

function viewControlMemoryNodes(scope) {
  const nodes = [];
  if (scope.matches?.("[data-view-state-key]")) nodes.push(scope);
  scope.querySelectorAll?.("[data-view-state-key]").forEach((node) => nodes.push(node));
  return nodes;
}

export function setText(node, text) {
  const next = String(text ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

export function setClass(node, className, on) {
  if (!node) return;
  const hasClass = node.classList.contains(className);
  if (on && !hasClass) node.classList.add(className);
  if (!on && hasClass) node.classList.remove(className);
}

export function isInteractiveNode(node) {
  return !!node?.closest?.("input, select, textarea, button, label, [contenteditable='true'], [data-update], [data-action], [role='button']");
}

export function isPointerInteractionNode(node) {
  return isInteractiveNode(node) || !!node?.closest?.("[data-embedded-preview-stage]");
}

export function isTextEditingNode(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(node.type);
}
