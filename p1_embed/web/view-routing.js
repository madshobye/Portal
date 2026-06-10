export function createViewRouting({
  activeViewKey,
  defaultView = "chat",
} = {}) {
  function requestedView() {
    const params = new URLSearchParams(window.location.search);
    const mode = String(params.get("mode") || "").toLowerCase();
    if (params.get("ui") === "1" || mode === "ui" || mode === "ui-link") return "ui";
    return params.get("view") || params.get("tab") || "";
  }

  function initialView() {
    return requestedView() || localStorage.getItem(activeViewKey) || defaultView;
  }

  function storeActiveView(name) {
    localStorage.setItem(activeViewKey, name);
  }

  function updateUrlParam(name) {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", name);
    window.history.replaceState(null, "", url.toString());
  }

  return {
    initialView,
    storeActiveView,
    updateUrlParam,
  };
}
