import { VJ1, WORKSPACES } from "./constants.js";

export function getClientMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("output") === "1") return "output";
  if (params.get("component") === "1" || params.get("composition") === "1") return "component";
  if (params.get("preview") === "1") return "preview";
  return "control";
}

export function getInitialWorkspace() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("workspace") || sessionStorage.getItem(VJ1.localWorkspaceKey) || "scene";
  const normalized = requested === "compose" ? "component" : requested;
  return WORKSPACES.includes(normalized) ? normalized : "scene";
}

export function persistWorkspace(workspace) {
  if (!WORKSPACES.includes(workspace)) return;
  sessionStorage.setItem(VJ1.localWorkspaceKey, workspace);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", workspace);
  window.history.replaceState({}, "", url);
}

export function persistLiveScenePreference(state, storage = globalThis.localStorage) {
  const projectKey = liveSceneProjectKey(state);
  const sceneId = String(state?.ui?.live?.selectedSceneId || "");
  if (!projectKey || !sceneId || !state?.scenes?.some((scene) => String(scene.id) === sceneId)) return false;
  try {
    const preferences = parseLiveScenePreferences(storage?.getItem?.(VJ1.localLiveSceneKey));
    preferences[projectKey] = sceneId;
    storage?.setItem?.(VJ1.localLiveSceneKey, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function preferredLiveSceneId(state, storage = globalThis.localStorage) {
  const projectKey = liveSceneProjectKey(state);
  if (!projectKey) return "";
  try {
    const sceneId = String(parseLiveScenePreferences(storage?.getItem?.(VJ1.localLiveSceneKey))[projectKey] || "");
    return state?.scenes?.some((scene) => String(scene.id) === sceneId) ? sceneId : "";
  } catch {
    return "";
  }
}

function liveSceneProjectKey(state = {}) {
  const folderName = String(state.project?.folderName || "").trim();
  const projectName = String(state.project?.name || "").trim();
  const name = folderName || projectName;
  return name ? `project:${name}` : "";
}

function parseLiveScenePreferences(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildOutputUrl(kind = "output", { outputId = "" } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  url.searchParams.delete("workspace");
  url.searchParams.delete("preview");
  url.searchParams.delete("output");
  url.searchParams.delete("component");
  url.searchParams.delete("composition");
  if (kind === "preview") url.searchParams.set("preview", "1");
  else if (kind === "component") url.searchParams.set("component", "1");
  else url.searchParams.set("output", "1");
  url.searchParams.delete("initialSceneId");
  if (kind === "output" && outputId) url.searchParams.set("outputId", outputId);
  else url.searchParams.delete("outputId");
  return url.toString();
}
