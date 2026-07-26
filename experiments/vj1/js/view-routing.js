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

export function persistLivePreference(state, storage = globalThis.localStorage) {
  return persistLiveSession(state, storage);
}

export function persistLiveSession(state, storage = globalThis.localStorage) {
  const projectKey = liveSceneProjectKey(state);
  if (!projectKey) return false;
  try {
    const preferences = parseLivePreferences(
      storage?.getItem?.(VJ1.localLivePreferenceKey),
    );
    preferences[projectKey] = createLiveSessionSnapshot(state);
    storage?.setItem?.(
      VJ1.localLivePreferenceKey,
      JSON.stringify(preferences),
    );
    return true;
  } catch (error) {
    console.warn("[VJ1_LIVE_SESSION_WRITE_FAILED]", {
      fallback: "current in-memory Live state",
      message: error?.message || String(error),
    });
    return false;
  }
}

export function preferredLivePreference(
  state,
  storage = globalThis.localStorage,
) {
  const session = preferredLiveSession(state, storage);
  return {
    sceneId: String(session?.live?.selectedSceneId || ""),
    previewSurfaceId: String(session?.live?.previewSurfaceId || ""),
  };
}

export function preferredLiveSession(
  state,
  storage = globalThis.localStorage,
) {
  const projectKey = liveSceneProjectKey(state);
  if (!projectKey) return null;
  try {
    const stored = parseLivePreferences(
      storage?.getItem?.(VJ1.localLivePreferenceKey),
    )[projectKey];
    if (!stored || typeof stored !== "object") return null;
    return normalizeLiveSessionSnapshot(state, stored);
  } catch (error) {
    console.warn("[VJ1_LIVE_SESSION_READ_FAILED]", {
      fallback: "project Live defaults",
      message: error?.message || String(error),
    });
    return null;
  }
}

function createLiveSessionSnapshot(state = {}) {
  const live = state.ui?.live || {};
  return {
    version: 1,
    selectedMappingId: String(state.ui?.selectedMappingId || ""),
    timeStretch: finiteNumber(state.global?.timeStretch, 0),
    live: {
      selectedSceneId: String(live.selectedSceneId || ""),
      selectedComponentId: String(live.selectedComponentId || ""),
      overallSourceCleared: live.overallSourceCleared === true,
      sceneMappingVisible: live.sceneMappingVisible !== false,
      previewSurfaceId: String(live.previewSurfaceId || "__mapping__"),
      surfacePatches: safeJsonObject(live.surfacePatches),
      surfaceVisibility: safeJsonObject(live.surfaceVisibility),
      componentOverrides: safeJsonObject(live.componentOverrides),
      sceneOverrides: safeJsonObject(live.sceneOverrides),
      transitionId: String(live.transitionId || "vj1.transition.dissolve"),
      transitionParameters: safeJsonObject(live.transitionParameters),
      transitionDuration: finiteNumber(live.transitionDuration, 0),
      paramFadeDuration: finiteNumber(live.paramFadeDuration, 0),
    },
  };
}

function normalizeLiveSessionSnapshot(state = {}, stored = {}) {
  if (stored.live && Number(stored.version) !== 1) return null;
  const legacy = !stored.live
    ? {
        selectedMappingId: String(state.ui?.selectedMappingId || ""),
        live: {
          selectedSceneId: stored.sceneId,
          selectedComponentId: stored.sceneId,
          previewSurfaceId: stored.previewSurfaceId,
        },
      }
    : stored;
  const componentById = new Map(
    (state.components || [])
      .filter((component) => !component.systemRole)
      .map((component) => [String(component.id), component]),
  );
  const requestedMappingId = String(legacy.selectedMappingId || "");
  const mapping = (state.mappings || []).find(
    (item) => String(item.id) === requestedMappingId,
  ) || (state.mappings || []).find(
    (item) => String(item.id) === String(state.ui?.selectedMappingId || ""),
  ) || state.mappings?.[0];
  if (!mapping) return null;
  const surfaceIds = new Set(
    (mapping.surfaces || []).map((surface) => String(surface.id || "")),
  );
  const live = legacy.live && typeof legacy.live === "object" ? legacy.live : {};
  const requestedSceneId = String(live.selectedSceneId || "");
  const selectedSceneId = componentById.get(requestedSceneId)?.type === "scene"
    ? requestedSceneId
    : "";
  const requestedTargetId = String(live.selectedComponentId || "");
  const selectedComponentId = componentById.has(requestedTargetId)
    ? requestedTargetId
    : selectedSceneId;
  const overallSourceCleared = live.overallSourceCleared === true;
  const previewSurfaceId = String(live.previewSurfaceId || "");
  const validPreviewSurfaceId = previewSurfaceId === "__mapping__"
    ? previewSurfaceId
    : surfaceIds.has(previewSurfaceId) ? previewSurfaceId : "";
  const surfacePatches = Object.fromEntries(
    Object.entries(safeJsonObject(live.surfacePatches)).filter(
      ([surfaceId, targetId]) =>
        surfaceIds.has(String(surfaceId)) &&
        componentById.has(String(targetId)),
    ).map(([surfaceId, targetId]) => [String(surfaceId), String(targetId)]),
  );
  const surfaceVisibility = Object.fromEntries(
    Object.entries(safeJsonObject(live.surfaceVisibility)).filter(
      ([surfaceId, visible]) =>
        surfaceIds.has(String(surfaceId)) && typeof visible === "boolean",
    ),
  );
  const normalizeOverrideBank = (bank) => Object.fromEntries(
    Object.entries(safeJsonObject(bank)).filter(
      ([componentId, override]) =>
        componentById.has(String(componentId)) &&
        override && typeof override === "object" && !Array.isArray(override),
    ),
  );
  const sceneOverrides = Object.fromEntries(
    Object.entries(safeJsonObject(live.sceneOverrides)).filter(
      ([targetId, overrides]) =>
        componentById.has(String(targetId)) &&
        overrides && typeof overrides === "object" && !Array.isArray(overrides),
    ).map(([targetId, overrides]) => [
      String(targetId),
      normalizeOverrideBank(overrides),
    ]),
  );
  const activeOverrides = normalizeOverrideBank(live.componentOverrides);
  if (selectedComponentId && Object.keys(activeOverrides).length) {
    sceneOverrides[selectedComponentId] = activeOverrides;
  }
  return {
    version: 1,
    selectedMappingId: String(mapping.id || ""),
    timeStretch: finiteNumber(legacy.timeStretch, state.global?.timeStretch || 0),
    live: {
      selectedSceneId: overallSourceCleared ? "" : selectedSceneId,
      selectedComponentId: overallSourceCleared ? "" : selectedComponentId,
      overallSourceCleared,
      sceneMappingVisible: typeof live.sceneMappingVisible === "boolean"
        ? live.sceneMappingVisible
        : state.ui?.live?.sceneMappingInLive !== false,
      previewSurfaceId: validPreviewSurfaceId,
      surfacePatches,
      surfaceVisibility,
      componentOverrides: selectedComponentId
        ? normalizeOverrideBank(sceneOverrides[selectedComponentId])
        : {},
      sceneOverrides,
      transitionId: String(
        live.transitionId || state.ui?.live?.transitionId || "vj1.transition.dissolve",
      ),
      transitionParameters: safeJsonObject(
        live.transitionParameters || state.ui?.live?.transitionParameters,
      ),
      transitionDuration: finiteNumber(
        live.transitionDuration,
        state.ui?.live?.transitionDuration || 0,
      ),
      paramFadeDuration: finiteNumber(
        live.paramFadeDuration,
        state.ui?.live?.paramFadeDuration || 0,
      ),
    },
  };
}

function liveSceneProjectKey(state = {}) {
  const folderName = String(state.project?.folderName || "").trim();
  const projectName = String(state.project?.name || "").trim();
  const name = folderName || projectName;
  return name ? `project:${name}` : "";
}

function parseLivePreferences(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeJsonObject(value) {
  const safe = safeJsonValue(value, 0);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
}

function safeJsonValue(value, depth) {
  if (depth > 48 || value === null) return value === null ? null : undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (Array.isArray(value)) {
    return value.map((item) => safeJsonValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const safe = safeJsonValue(item, depth + 1);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback) || 0;
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
