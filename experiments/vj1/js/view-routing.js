import { VIEWS, VJ1 } from "./constants.js";

export function getClientMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("output") === "1") return "output";
  if (params.get("preview") === "1") return "preview";
  return "control";
}

export function getInitialView() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("view") || localStorage.getItem(VJ1.localViewKey) || "studio";
  return VIEWS.some((view) => view.id === requested) ? requested : "studio";
}

export function persistView(view) {
  if (!VIEWS.some((item) => item.id === view)) return;
  localStorage.setItem(VJ1.localViewKey, view);
  const url = new URL(window.location.href);
  url.searchParams.set("view", view);
  window.history.replaceState({}, "", url);
}

export function buildOutputUrl(kind = "output") {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.delete("preview");
  url.searchParams.delete("output");
  if (kind === "preview") url.searchParams.set("preview", "1");
  else url.searchParams.set("output", "1");
  return url.toString();
}
