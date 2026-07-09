export function createHtmlCache() {
  const renderedHtml = new WeakMap();
  return function replaceHtmlIfChanged(node, html) {
    if (!node) return false;
    const next = String(html ?? "");
    if (renderedHtml.get(node) === next) return false;
    node.innerHTML = next;
    renderedHtml.set(node, next);
    return true;
  };
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
  return !!node?.closest?.("input, select, textarea, button, label, [contenteditable='true'], [data-update], [data-action]");
}

export function isTextEditingNode(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(node.type);
}
