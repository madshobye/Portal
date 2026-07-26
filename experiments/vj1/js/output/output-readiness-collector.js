import { createMediaReadinessStatus, isReadyMediaItem } from "./component-render-state.js";

export function collectOutputReadiness({
  mode = "output",
  state = null,
  media = new Map(),
  programs = null,
  acquireMedia = null,
  controlSignals = null,
  resourceReadiness = null,
  capabilityReadiness = null,
} = {}) {
  const status = createMediaReadinessStatus();
  if (mode !== "output" || !state) return status;
  const componentsById = new Map((state.components || []).map((component) => [component.id, component]));
  for (const surface of state.surfaces || []) {
    if (surface.enabled === false || !surface.componentId) continue;
    collectComponentMediaReadiness(
      componentsById.get(surface.componentId),
      status,
      componentsById,
      media,
      programs,
      new Set(),
      acquireMedia,
      controlSignals,
      resourceReadiness,
      capabilityReadiness,
    );
  }
  return finalizeReadiness(status);
}

export function collectComponentReadiness({
  component = null,
  components = [],
  media = new Map(),
  programs = null,
  acquireMedia = null,
  controlSignals = null,
  resourceReadiness = null,
  capabilityReadiness = null,
} = {}) {
  const status = createMediaReadinessStatus();
  if (!component) return status;
  const componentsById = new Map(components.map((item) => [item.id, item]));
  if (component.id) componentsById.set(component.id, component);
  collectComponentMediaReadiness(
    component,
    status,
    componentsById,
    media,
    programs,
    new Set(),
    acquireMedia,
    controlSignals,
    resourceReadiness,
    capabilityReadiness,
  );
  return finalizeReadiness(status);
}

function collectComponentMediaReadiness(
  component,
  status,
  componentsById,
  media,
  programs,
  visited,
  acquireMedia,
  controlSignals,
  resourceReadiness,
  capabilityReadiness,
) {
  if (!component || !status || visited.has(component.id)) return;
  visited.add(component.id);
  const inspection = programs?.get?.(component.id)?.inspect?.();
  if (!inspection) {
    visited.delete(component.id);
    throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
  }
  for (const mediaId of inspection.mediaDemand.ids) collectMediaIdReadiness(mediaId, status, media, acquireMedia);
  for (const requirement of inspection.readiness?.requirements || []) {
    if (requirement.kind === "control-signal") {
      collectControlSignalReadiness(requirement, status, controlSignals);
    } else if (
      requirement.kind === "camera" ||
      requirement.kind === "screen-input"
    ) {
      collectResourceReadiness(
        requirement,
        status,
        resourceReadiness,
        { component, program: programs.get(component.id) },
      );
    } else if (requirement.kind === "capability") {
      collectCapabilityReadiness(
        requirement,
        status,
        capabilityReadiness,
        { component, program: programs.get(component.id) },
      );
    }
  }
  for (const dependencyId of inspection.dependencies.components) {
    collectComponentMediaReadiness(
      componentsById.get(dependencyId),
      status,
      componentsById,
      media,
      programs,
      visited,
      acquireMedia,
      controlSignals,
      resourceReadiness,
      capabilityReadiness,
    );
  }
  visited.delete(component.id);
}

function collectResourceReadiness(
  requirement,
  status,
  resolver,
  context,
) {
  const kind = String(requirement.kind || "");
  const resourceId = String(requirement.id || "");
  const id = `${kind}:${resourceId}`;
  if (status.resources.has(id)) return;
  const resolved = resolver?.(requirement, context) || {
    kind,
    id: resourceId,
    state: "error",
    error: `${kind} readiness capability is unavailable`,
  };
  recordResourceReadiness(status, id, resolved);
}

function collectCapabilityReadiness(
  requirement,
  status,
  resolver,
  context,
) {
  const capabilityId = String(requirement.id || "");
  const id = `capability:${capabilityId}:${context.component?.id || "unknown"}`;
  if (status.resources.has(id)) return;
  const resolved = resolver?.(requirement, context);
  // A declared retained capability may not gate presentation. Only a
  // capability owner that publishes an explicit status participates in
  // readiness; this keeps render-only native kernels out of loading policy.
  if (!resolved) return;
  recordResourceReadiness(status, id, resolved);
}

function recordResourceReadiness(status, id, resolved = {}) {
  const state = ["ready", "pending", "error"].includes(resolved.state)
    ? resolved.state
    : "error";
  const record = Object.freeze({
    id,
    kind: String(resolved.kind || ""),
    resourceId: String(resolved.id || ""),
    state,
    error: String(resolved.error || ""),
  });
  status.total++;
  status.resources.set(id, record);
  if (state === "pending") status.pendingResourceIds.add(id);
  if (state === "error") {
    status.errorResourceIds.add(id);
    status.errorIds.add(id);
  }
}

function finalizeReadiness(status) {
  status.blocked =
    status.loadingIds.size > 0 ||
    status.missingIds.size > 0 ||
    status.errorIds.size > 0 ||
    status.pendingResourceIds.size > 0 ||
    status.requiredControlSignalIds.size > 0;
  return status;
}

function collectControlSignalReadiness(requirement, status, controlSignals) {
  if (requirement?.kind !== "control-signal") return;
  const signalKind = String(requirement.signalKind || "");
  const address = String(requirement.address || "");
  const endpoint = String(requirement.endpoint || "");
  if (!signalKind || !address) return;
  const id = endpoint
    ? `${signalKind}:${endpoint}:${address}`
    : `${signalKind}:${address}`;
  if (status.controlSignals.has(id)) return;
  controlSignals?.activate?.(signalKind, requirement);
  const adapterStatus = controlSignals?.status?.(
    signalKind,
    address,
    requirement,
  ) || {
    state: "unsupported",
    error: "",
  };
  const record = Object.freeze({
    id,
    signalKind,
    address,
    ...(endpoint ? { endpoint } : {}),
    required: requirement.required === true,
    state: String(adapterStatus.state || "unsupported"),
    error: String(adapterStatus.error || ""),
    signalAvailable: adapterStatus.signalAvailable === true,
    inputCount: Math.max(0, Number(adapterStatus.inputCount) || 0),
  });
  status.controlSignals.set(id, record);
  if (record.state === "error") status.errorControlSignalIds.add(id);
  else if (record.state === "unsupported") {
    status.unsupportedControlSignalIds.add(id);
  } else if (record.state !== "ready") {
    status.pendingControlSignalIds.add(id);
  }
  if (
    record.required &&
    (record.state !== "ready" || record.signalAvailable !== true)
  ) {
    status.requiredControlSignalIds.add(id);
  }
}

function collectMediaIdReadiness(mediaId, status, media, acquireMedia) {
  if (status.mediaIds.has(mediaId)) return;
  status.total++;
  status.mediaIds.add(mediaId);
  const item = acquireMedia?.(mediaId) || media.get(mediaId);
  if (!item) {
    status.missingIds.add(mediaId);
    return;
  }
  if (item.loadError || item.imageError || item.modelError) {
    status.errorIds.add(mediaId);
    return;
  }
  if (!isReadyMediaItem(item)) status.loadingIds.add(mediaId);
}
