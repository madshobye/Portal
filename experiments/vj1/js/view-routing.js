import { VIEWS, VJ1 } from "./constants.js";

export function getClientMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("output") === "1") return "output";
  if (params.get("composition") === "1") return "composition";
  if (params.get("preview") === "1") return "preview";
  return "control";
}

export function getInitialView() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("view") || sessionStorage.getItem(VJ1.localViewKey) || "studio";
  return VIEWS.some((view) => view.id === requested) ? requested : "studio";
}

export function getInitialWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("workspace") || sessionStorage.getItem(VJ1.localWorkspaceKey) || "scene";
  return ["compose", "scene", "live"].includes(requested) ? requested : "scene";
}

export function persistView(view) {
  if (!VIEWS.some((item) => item.id === view)) return;
  sessionStorage.setItem(VJ1.localViewKey, view);
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  window.history.replaceState({}, "", url);
}

export function persistWorkspace(workspace) {
  if (!["compose", "scene", "live"].includes(workspace)) return;
  sessionStorage.setItem(VJ1.localWorkspaceKey, workspace);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspace);
  window.history.replaceState({}, "", url);
}

export function buildOutputUrl(kind = "output") {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.delete("workspace");
  url.searchParams.delete("preview");
  url.searchParams.delete("output");
  url.searchParams.delete("composition");
  if (kind === "preview") url.searchParams.set("preview", "1");
  else if (kind === "composition") url.searchParams.set("composition", "1");
  else url.searchParams.set("output", "1");
  return url.toString();
}
