import { componentTextureSize } from "../domain/render-resolution.js";
import { VjMapper } from "../libraries/mapping-engine/mapping-engine/index.js";
import {
  defaultProjectSurfaceMapping,
} from "./render-geometry.js";
import { stableSurfaceRenderRequest } from "./surface-render-planner.js";
import { cornersRect } from "./component-render-layout.js";

// Owns Mapping lifecycle and synchronization. Surface rendering consumes the
// retained mapper and materialized Surface records directly; project state
// reconciliation and editor acknowledgement never enter the render plan.
export class OutputMappingRuntime {
  constructor(host, { sendMapping } = {}) {
    this.host = host;
    this.sendMapping = sendMapping;
    this.mapper = null;
    this.surfaces = new Map();
    this.mappingSignature = "";
    this.localMappingSignature = "";
    this.pendingMappingSignature = "";
    this.pendingMappingStartedAt = 0;
    this.mappingAckWarningSignature = "";
    this.surfaceRebuildPending = false;
  }

  create() {
    this.mapper = new VjMapper({
      onConfigChange: (mapping, meta = {}) => {
        this.emit(mapping, mappingStatusForReason(meta.reason), {
          live: meta.reason === "drag",
        });
      },
      onTransitionError: (error, kernel) => {
        const message = error?.message || String(error);
        console.error("[VJ1_TRANSITION_SHADER_FAILED]", {
          transitionId: kernel?.id || "",
          fallback: "vj1.transition.dissolve",
          message,
        });
        if (this.host.state?.ui) {
          this.host.state.ui.shaderStatus = "Transition fallback active";
          this.host.state.ui.shaderError = message;
        }
      },
    });
    this.host.transitionRuntime.retainActiveKernels();
    this.syncOverlayMode();
    this.rebuildSurfaces();
    this.applyProject();
    this.setCalibrate(this.shouldCalibrateFromState());
  }

  dispose() {
    this.surfaces.clear();
    this.mapper?.dispose?.();
    this.mapper = null;
  }

  captureState() {
    const host = this.host;
    return {
      // Mapping identity is semantic state. Different Mapping documents may
      // intentionally contain the same Surface IDs and equal (often empty)
      // calibration JSON, but their retained editor handles must never share
      // ownership.
      mappingId: String(host.state?.ui?.selectedMappingId || ""),
      surfaceIds: (host.state?.surfaces || []).map((surface) => surface.id).join(","),
      renderSize: host.state
        ? host.presentationGeometry.renderSizeSignature(host.state.render)
        : "",
      mappingSignature: this.mappingSignature,
      interactionActive: !!this.mapper?.isActive?.(),
    };
  }

  reconcileState(previous = {}) {
    const host = this.host;
    const nextMappingId = String(host.state?.ui?.selectedMappingId || "");
    const nextSurfaceIds = (host.state?.surfaces || []).map((surface) => surface.id).join(",");
    const nextSize = host.presentationGeometry.renderSizeSignature(host.state.render);
    const nextMappingSignature = this.currentSignature();
    const mappingChanged = previous.mappingId !== nextMappingId;
    if (mappingChanged) {
      // Local pointer ownership belongs to the Mapping that emitted it. It
      // cannot protect or seed the next Mapping, even when both documents use
      // identical Surface IDs.
      this.pendingMappingSignature = "";
      this.pendingMappingStartedAt = 0;
      this.mappingAckWarningSignature = "";
      this.surfaceRebuildPending = false;
    }
    // An echo acknowledges local ownership even while VjMapper still reports
    // the pointer gesture active.
    if (
      this.pendingMappingSignature &&
      nextMappingSignature === this.pendingMappingSignature
    ) {
      this.shouldIgnoreIncoming(nextMappingSignature);
    }
    if (previous.renderSize && previous.renderSize !== nextSize) {
      host.resourceRuntime.createBuffers();
    }
    const surfacesChanged =
      mappingChanged ||
      previous.surfaceIds !== nextSurfaceIds ||
      previous.renderSize !== nextSize;
    if (surfacesChanged) {
      if (previous.interactionActive && !mappingChanged) this.surfaceRebuildPending = true;
      else {
        this.surfaceRebuildPending = false;
        this.rebuildSurfaces({
          preferExistingMapping: !mappingChanged && !!this.pendingMappingSignature,
        });
      }
    }
    const ignoreIncoming =
      !previous.interactionActive && this.pendingMappingSignature
        ? this.shouldIgnoreIncoming(nextMappingSignature)
        : false;
    if (
      (surfacesChanged ||
        previous.mappingSignature !== nextMappingSignature) &&
      (!previous.interactionActive || mappingChanged) &&
      !ignoreIncoming
    ) {
      this.applyProject(nextMappingSignature);
    }
    this.setCalibrate(this.shouldCalibrateFromState());
    this.syncOverlayMode();
  }

  rebuildSurfaces({ preferExistingMapping = false } = {}) {
    const host = this.host;
    if (!this.mapper) return;
    const existingCorners = new Map(
      (this.mapper.surfaces || []).map((surface) => [
        surface.id || surface.name,
        Array.isArray(surface.corners)
          ? surface.corners.map((corner) => ({ x: corner.x, y: corner.y }))
          : null,
      ]),
    );
    this.mapper.clearSurfaces();
    this.surfaces.clear();
    const mappedSurfaces = host.state.surfaces.filter(
      (surface) => surface.destination?.type !== "direct",
    );
    const projectRender = host.presentationGeometry.mappingProjectRender();
    const defaultMappingById = new Map(
      defaultProjectSurfaceMapping(projectRender, mappedSurfaces).map(
        (surface) => [surface.id || surface.name, surface],
      ),
    );
    const texture = componentTextureSize(host.state.render);
    for (const surface of host.state.surfaces) {
      if (surface.destination?.type !== "direct") continue;
      const corners = host.presentationGeometry.directSurfaceCorners(surface);
      if (!corners) continue;
      const rect = cornersRect(corners);
      this.surfaces.set(surface.id, {
        direct: true,
        directRect: rect,
        mapperSurface: {
          id: surface.id,
          name: surface.id,
          w: rect.width,
          h: rect.height,
          corners,
          renderCache: null,
        },
        renderRequest: stableSurfaceRenderRequest(host.state.render, {
          surfaceId: surface.id,
        }),
      });
    }
    for (const surface of mappedSurfaces) {
      const preserved = existingCorners.get(surface.id);
      const persisted = host.presentationGeometry.projectSurfaceCorners(
        surface.id,
      );
      const fallback = defaultMappingById.get(surface.id)?.corners;
      const existingProjectCorners =
        preserved?.length === 4
          ? host.mode === "output"
            ? preserved.map((corner) =>
                host.presentationGeometry.displayPointToWorld(corner),
              )
            : preserved
          : null;
      const projectCorners =
        preferExistingMapping && existingProjectCorners?.length === 4
          ? existingProjectCorners
          : persisted?.length === 4
            ? persisted
            : existingProjectCorners?.length === 4
              ? existingProjectCorners
              : fallback;
      if (!Array.isArray(projectCorners) || projectCorners.length !== 4) {
        continue;
      }
      const corners = projectCorners.map((corner) =>
        host.presentationGeometry.worldPointToDisplay(corner),
      );
      const mapperSurface = this.mapper.addSurface({
        id: surface.id,
        name: surface.id,
        width: texture.width,
        height: texture.height,
        corners,
      });
      this.surfaces.set(surface.id, {
        mapperSurface,
        renderRequest: stableSurfaceRenderRequest(host.state.render, {
          surfaceId: surface.id,
        }),
      });
    }
  }

  syncOverlayMode() {
    this.mapper?.setOverlayMode?.(
      this.host.state?.global?.mappingHandleMode || "always",
    );
  }

  shouldCalibrateFromState() {
    if (this.host.mode === "output") return false;
    return (
      this.host.mode === "preview" &&
      !!this.host.state?.global?.calibrating
    );
  }

  setCalibrate(on) {
    const enabled = this.host.mode !== "output" && !!on;
    if (this.host.state?.global) this.host.state.global.calibrating = enabled;
    this.mapper?.setCalibrate(enabled);
  }

  isCalibrating() {
    return (
      this.host.mode !== "output" &&
      !!this.mapper?.isCalibrating?.()
    );
  }

  currentSignature() {
    try {
      return JSON.stringify(this.host.state?.mappingCalibration || null);
    } catch (error) {
      console.warn("[VJ1_MAPPING_SIGNATURE_FAILED]", {
        fallback: "mapping acknowledgement disabled for invalid state",
        message: error?.message || String(error),
      });
      return "";
    }
  }

  applyProject(signature = this.currentSignature()) {
    const mapping = this.host.state?.mappingCalibration;
    if (mapping?.surfaces?.length) {
      this.mapper?.importConfig?.(
        this.host.presentationGeometry.mappingForMode(mapping),
        { replace: false, silent: true },
      );
    }
    this.mappingSignature = signature;
  }

  markLocal(
    mapping = this.host.presentationGeometry.mappingFromMode(
      this.mapper?.exportData?.(),
    ),
  ) {
    this.localMappingSignature = mappingSignature(mapping);
    this.pendingMappingSignature = this.localMappingSignature;
    this.pendingMappingStartedAt = performance.now();
    this.mappingAckWarningSignature = "";
    this.mappingSignature = this.localMappingSignature;
  }

  shouldIgnoreIncoming(signature) {
    if (!this.pendingMappingSignature) return false;
    if (signature === this.pendingMappingSignature) {
      this.pendingMappingSignature = "";
      this.pendingMappingStartedAt = 0;
      this.mappingAckWarningSignature = "";
      return false;
    }
    if (performance.now() - this.pendingMappingStartedAt < 5000) return true;
    if (this.mappingAckWarningSignature !== this.pendingMappingSignature) {
      this.mappingAckWarningSignature = this.pendingMappingSignature;
      console.warn("[VJ1_MAPPING_ACK_TIMEOUT]", {
        pendingSignature: this.pendingMappingSignature,
        incomingSignature: signature,
        message:
          "Local surface mapping was not acknowledged within 5 seconds; accepting the latest project mapping",
      });
    }
    this.pendingMappingSignature = "";
    this.pendingMappingStartedAt = 0;
    return false;
  }

  emit(
    mapping = this.mapper?.exportData?.(),
    status = "Mapping updated",
    meta = {},
  ) {
    const projectMapping =
      this.host.presentationGeometry.mappingFromMode(mapping || {});
    this.markLocal(projectMapping);
    this.sendMapping?.("local", projectMapping, status, meta);
  }

  finishInteraction(wasActive) {
    if (!wasActive || !this.surfaceRebuildPending) return;
    this.surfaceRebuildPending = false;
    this.rebuildSurfaces({ preferExistingMapping: true });
    const signature = this.currentSignature();
    if (!this.shouldIgnoreIncoming(signature)) this.applyProject(signature);
  }

  save() {
    this.emit(this.mapper?.exportData?.() || {}, "Mapping saved");
  }

  load() {
    this.applyProject();
  }

  reset(surfaceId = "") {
    if (surfaceId) {
      this.mapper?.resetSurface?.(surfaceId);
      this.emit(
        this.mapper?.exportData?.() || {},
        "Surface mapping reset",
      );
      return;
    }
    this.mapper?.resetAll();
    this.emit(this.mapper?.exportData?.() || {}, "Mapping reset");
  }

  export() {
    downloadJson(
      this.host.presentationGeometry.mappingFromMode(
        this.mapper?.exportData?.() || {},
      ),
      "vj1-mapping.json",
    );
  }

  resize() {
    if (this.mapper?.isActive?.()) {
      this.surfaceRebuildPending = true;
      return;
    }
    this.rebuildSurfaces({
      preferExistingMapping: !!this.pendingMappingSignature,
    });
    const signature = this.currentSignature();
    if (!this.shouldIgnoreIncoming(signature)) this.applyProject(signature);
  }
}

function mappingStatusForReason(reason = "") {
  if (reason === "autosave") return "Mapping updated";
  if (reason === "reset") return "Mapping reset";
  if (reason === "save" || reason === "save-all") return "Mapping saved";
  return "Mapping updated";
}

function mappingSignature(mapping) {
  try {
    return JSON.stringify(mapping || null);
  } catch (error) {
    console.warn("[VJ1_MAPPING_SIGNATURE_FAILED]", {
      fallback: "empty mapping signature",
      message: error?.message || String(error),
    });
    return "";
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
