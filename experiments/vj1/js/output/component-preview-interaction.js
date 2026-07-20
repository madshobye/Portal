import { canvasFrameSize } from "../domain/render-settings.js?v=canvas-global-resolution-1";
import { getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js?v=node-catalog-1";
import {
  canvasFrameBorderHit,
  canvasRectCorners,
  componentReferencePlacement,
  distanceSquared,
  moveCanvasFrameRect,
  resizeCanvasFrameRect,
} from "./component-render-layout.js?v=canvas-global-resolution-1";
import {
  combineContentTransforms,
  findChainItemById,
  findChainItemTransformContext,
  groupLocalBounds,
  hitTestChainItems,
  isPhysicalChainItem,
  logicalPixelsPerCssPixel,
  normalizedContentTransform,
  pointInTransformedRect,
  resolveChainTransformDrag,
  screenToLayerLocal,
  transformHandleLayout,
  transformedRectCenter,
} from "./preview-interaction-geometry.js?v=transform-hit-contract-3";

// Owns editor-only hit testing and drag transactions. The renderer remains
// the drawing/data port, but no longer owns pointer gesture policy or state.
export class ComponentPreviewInteraction {
  constructor(renderer) {
    this.renderer = renderer;
    this.chainTransformDrag = null;
    this.canvasFrameDrag = null;
    this.pendingChainTransform = null;
    this.pendingCanvasFrame = null;
  }

  dispose() {
    this.chainTransformDrag = null;
    this.canvasFrameDrag = null;
    this.pendingChainTransform = null;
    this.pendingCanvasFrame = null;
  }

  renderComponentFrameOverlay(component, source = null) {
    const renderer = this.renderer;
    if (renderer.mode !== "component" || !component) return;
    const frame = renderer.componentPreviewRect(component, source);
    const inset = 1.5;
    resetShader();
    push();
    noFill();
    stroke(101, 224, 211, 235);
    strokeWeight(2);
    rectMode(CORNER);
    rect(
      frame.x - width * 0.5 + inset,
      frame.y - height * 0.5 + inset,
      Math.max(0, frame.width - inset * 2),
      Math.max(0, frame.height - inset * 2)
    );
    pop();
  }

  renderCanvasRecordingFrames(component, source = null) {
    if (this.renderer.mode !== "component" || component?.type !== "canvas") return;
    resetShader();
    push();
    noFill();
    stroke(255, 228, 94, 235);
    const uiScale = this.uiPixelScale();
    strokeWeight(2 * uiScale);
    rectMode(CORNER);
    for (const item of this.canvasRecordingFrameRects(component, source)) {
      rect(item.x - width * 0.5, item.y - height * 0.5, item.width, item.height);
      noStroke();
      fill(255, 228, 94, 245);
      for (const corner of canvasRectCorners(item)) {
        rect(corner.x - width * 0.5 - 5 * uiScale, corner.y - height * 0.5 - 5 * uiScale, 10 * uiScale, 10 * uiScale);
      }
      noFill();
      stroke(255, 228, 94, 235);
    }
    pop();
  }

  canvasRecordingFrameRects(component, source = null) {
    if (component?.type !== "canvas") return [];
    const renderer = this.renderer;
    const { width: canvasWidth, height: canvasHeight } = canvasFrameSize(renderer.state?.render);
    const preview = renderer.componentPreviewRect(component, source);
    return (renderer.state?.recordingFrames || []).map((frame) => ({
      frame,
      x: preview.x + (Math.max(0, Number(frame.x) || 0) / canvasWidth) * preview.width,
      y: preview.y + (Math.max(0, Number(frame.y) || 0) / canvasHeight) * preview.height,
      width: (Math.max(1, Number(frame.width) || 1) / canvasWidth) * preview.width,
      height: (Math.max(1, Number(frame.height) || 1) / canvasHeight) * preview.height,
    }));
  }

  renderSelectedChainTransformOverlay() {
    const renderer = this.renderer;
    if (renderer.mode !== "component") return;
    const item = this.selectedTransformableChainItem();
    if (!item) return;
    const component = renderer.state.components.find((entry) => entry.id === renderer.state.ui.selectedComponentId);
    const geometry = this.chainItemPreviewGeometry(component, item);
    if (!geometry) return;
    const { baseRect, transform, centerX, centerY } = geometry;
    resetShader();
    push();
    noFill();
    stroke(101, 224, 211, 230);
    const uiScale = this.uiPixelScale();
    strokeWeight(2 * uiScale);
    const cx = centerX - width * 0.5;
    const cy = centerY - height * 0.5;
    const rotation = Number(transform.rotation) || 0;
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    const { boxWidth, boxHeight, scaleHandleX, scaleHandleY, rotateHandleX, rotateHandleY } =
      transformHandleLayout(baseRect, scale, 52 * uiScale);

    translate(cx, cy, 3);
    rotate(rotation);
    rectMode(CENTER);
    stroke(101, 224, 211, 205);
    rect(0, 0, boxWidth, boxHeight);
    stroke(101, 224, 211, 170);
    line(0, 0, scaleHandleX, scaleHandleY);
    stroke(255, 228, 94, 180);
    line(0, 0, rotateHandleX, rotateHandleY);
    noStroke();
    fill(101, 224, 211, 230);
    circle(0, 0, 20 * uiScale);
    circle(scaleHandleX, scaleHandleY, 18 * uiScale);
    fill(255, 228, 94, 230);
    circle(rotateHandleX, rotateHandleY, 16 * uiScale);
    pop();
  }

  mousePressed(x, y) {
    const renderer = this.renderer;
    // The explicitly selected object's controls own their pointer area. A
    // recording-frame border may overlap them, but must not steal the gesture.
    if (renderer.mode === "component" && this.startChainTransformDrag(x, y, { handlesOnly: true })) return;
    if (renderer.mode === "component" && this.startCanvasFrameDrag(x, y)) return;
    if (renderer.mode === "component") {
      const hit = this.chainItemAtPoint(x, y);
      if (hit && this.selectedChildOwnsGroupDrag(hit, x, y) && this.startChainTransformDrag(x, y, { moveOnly: true })) return;
      const selected = this.selectChainItemAtPoint(x, y, hit);
      if (selected && this.startChainTransformDrag(x, y)) return;
      if (selected) return;
    }
    renderer.mapper?.mousePressed?.(x, y);
    const surfaceIndex = Number(renderer.mapper?._dragSurf);
    const surfaceName = Number.isInteger(surfaceIndex) && surfaceIndex >= 0
      ? renderer.mapper?.surfaces?.[surfaceIndex]?.name
      : "";
    if (surfaceName) renderer.onSurfaceSelect?.(surfaceName);
  }

  mouseDragged(x, y) {
    if (this.canvasFrameDrag) return this.updateCanvasFrameDrag(x, y);
    if (this.chainTransformDrag) return this.updateChainTransformDrag(x, y);
    this.renderer.mapper?.mouseDragged?.(x, y);
  }

  mouseReleased() {
    const renderer = this.renderer;
    if (this.canvasFrameDrag) {
      const drag = this.canvasFrameDrag;
      this.canvasFrameDrag = null;
      if (drag.lastRect) {
        this.pendingCanvasFrame = { frameId: drag.frameId, rect: drag.lastRect };
        renderer.sendCanvasFrame?.(drag.componentId, drag.frameId, drag.lastRect, { commit: true });
      }
      return;
    }
    if (this.chainTransformDrag) {
      const drag = this.chainTransformDrag;
      this.chainTransformDrag = null;
      if (drag.changed && drag.lastTransform) {
        this.pendingChainTransform = {
          componentId: drag.componentId,
          itemId: drag.itemId,
          transform: drag.lastTransform,
        };
        renderer.sendChainTransform?.(drag.componentId, drag.itemId, drag.lastTransform, { commit: true });
      }
      return;
    }
    renderer.mapper?.mouseReleased?.();
  }

  startCanvasFrameDrag(x, y) {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (component?.type !== "canvas") return false;
    const source = renderer.componentOutput.get(component.id);
    const rects = this.canvasRecordingFrameRects(component, source);
    for (let index = rects.length - 1; index >= 0; index--) {
      const item = rects[index];
      const corners = canvasRectCorners(item);
      const hitRadius = 15 * this.uiPixelScale();
      const corner = corners.find((entry) => distanceSquared(x, y, entry.x, entry.y) <= hitRadius * hitRadius);
      const border = canvasFrameBorderHit(item, x, y);
      if (!corner && !border) continue;
      const { width: canvasWidth, height: canvasHeight } = canvasFrameSize(renderer.state?.render);
      const frame = item.frame;
      this.canvasFrameDrag = {
        componentId: component.id,
        frameId: frame.id,
        mode: corner?.id || "move",
        startX: x,
        startY: y,
        previewWidth: Math.max(1, renderer.componentPreviewRect(component, source).width),
        previewHeight: Math.max(1, renderer.componentPreviewRect(component, source).height),
        canvasWidth,
        canvasHeight,
        rect: {
          x: Math.max(0, Number(frame.x) || 0),
          y: Math.max(0, Number(frame.y) || 0),
          width: Math.max(16, Number(frame.width) || 16),
          height: Math.max(16, Number(frame.height) || 16),
        },
        lastRect: null,
      };
      this.pendingCanvasFrame = null;
      return true;
    }
    return false;
  }

  updateCanvasFrameDrag(x, y) {
    const drag = this.canvasFrameDrag;
    if (!drag) return;
    const dx = (x - drag.startX) * drag.canvasWidth / drag.previewWidth;
    const dy = (y - drag.startY) * drag.canvasHeight / drag.previewHeight;
    const next = drag.mode === "move"
      ? moveCanvasFrameRect(drag.rect, dx, dy, drag.canvasWidth, drag.canvasHeight)
      : resizeCanvasFrameRect(drag.rect, drag.mode, dx, dy, drag.canvasWidth, drag.canvasHeight);
    drag.lastRect = next;
    this.applyLocalCanvasFrame(drag.frameId, next);
    this.renderer.sendCanvasFrame?.(drag.componentId, drag.frameId, next, { commit: false });
  }

  applyLocalCanvasFrame(frameId, rect) {
    const renderer = this.renderer;
    renderer.state = stateWithCanvasFrameRect(renderer.state, frameId, rect);
    renderer.refreshRecordingFrameLookup?.(frameId);
  }

  selectedTransformableChainItem() {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (!component?.chain?.length) return null;
    const selected = findChainItemById(component.chain, renderer.state.ui.selectedChainItemId)
      || (component.chain.length === 1 ? component.chain[0] : null);
    if (selected?.kind === "source" || selected?.kind === "group") return selected;
    const effectComponent = selected?.kind === "effect" ? getShaderComponent(selected.componentId) : null;
    return effectComponent?.spatial ? selected : null;
  }

  chainItemAtPoint(x, y) {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (!component?.chain?.length) return null;
    const frame = renderer.componentPreviewRect(component, renderer.componentOutput.get(component.id));
    // A list selection is an explicit targeting decision. Preserve it while
    // its rendered geometry contains the pointer instead of letting a later
    // full-frame source silently steal the drag.
    const selected = this.selectedTransformableChainItem();
    if (selected) {
      const geometry = this.chainItemPreviewGeometry(component, selected);
      if (geometry && pointInTransformedRect(x, y, geometry.frame, geometry.baseRect, geometry.transform)) {
        return selected;
      }
    }
    return hitTestChainItems({
      chain: component.chain,
      component,
      frame,
      x,
      y,
      baseRectForItem: (owner, item, previewFrame) => this.chainItemBaseRect(owner, item, previewFrame),
    });
  }

  selectChainItemAtPoint(x, y, knownHit = null) {
    const hit = knownHit || this.chainItemAtPoint(x, y);
    if (!hit) return null;
    const renderer = this.renderer;
    if (renderer.state?.ui) {
      renderer.state = {
        ...renderer.state,
        ui: { ...renderer.state.ui, selectedChainItemId: hit.id },
      };
    }
    renderer.onChainItemSelect?.(hit.id);
    return hit;
  }

  selectedChildOwnsGroupDrag(hit, x, y) {
    if (hit?.kind !== "group") return false;
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    const selected = findChainItemById(component?.chain, renderer.state?.ui?.selectedChainItemId);
    if (!selected || selected.id === hit.id || !findChainItemById(hit.chain, selected.id)) return false;
    if (selected.kind !== "group" && !isPhysicalChainItem(selected)) return false;
    const geometry = this.chainItemPreviewGeometry(component, selected);
    return !!geometry && pointInTransformedRect(x, y, geometry.frame, geometry.baseRect, geometry.transform);
  }

  chainItemBaseRect(component, item, frame) {
    const renderer = this.renderer;
    if (item?.kind === "group") {
      return groupLocalBounds({
        group: item,
        component,
        frame,
        baseRectForItem: (owner, child, childFrame) => this.chainItemLeafBaseRect(owner, child, childFrame),
      }) || { x: 0, y: 0, width: frame.width, height: frame.height };
    }
    return this.chainItemLeafBaseRect(component, item, frame);
  }

  chainItemLeafBaseRect(component, item, frame) {
    const renderer = this.renderer;
    if (item?.kind === "source" && item.source?.type === "component" && component?.type === "canvas") {
      const dependency = renderer.state?.components?.find((candidate) => candidate.id === item.source.componentId);
      if (dependency && dependency.type !== "canvas") {
        return componentReferencePlacement(
          component,
          dependency,
          renderer.state.render,
          { width: frame.width, height: frame.height },
          item.source.placement
        );
      }
    }
    return { x: 0, y: 0, width: frame.width, height: frame.height };
  }

  uiPixelScale() {
    const canvas = globalThis.drawingContext?.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    return logicalPixelsPerCssPixel(
      Number(globalThis.width) || Number(canvas?.width) || 1,
      Number(globalThis.height) || Number(canvas?.height) || 1,
      Number(rect?.width) || Number(canvas?.width) || 1,
      Number(rect?.height) || Number(canvas?.height) || 1
    );
  }

  chainItemPreviewGeometry(component, item) {
    if (!component || !item) return null;
    const renderer = this.renderer;
    const frame = renderer.componentPreviewRect(component, renderer.componentOutput.get(component.id));
    const baseRect = this.chainItemBaseRect(component, item, frame);
    const context = findChainItemTransformContext(component.chain, item.id);
    const localTransform = normalizedContentTransform(item.transform);
    const parentTransform = context?.parentTransform || normalizedContentTransform();
    const transform = context?.transform || combineContentTransforms(parentTransform, localTransform);
    const center = transformedRectCenter(frame, baseRect, transform);
    return { frame, baseRect, transform, localTransform, parentTransform, centerX: center.x, centerY: center.y };
  }

  startChainTransformDrag(x, y, { handlesOnly = false, moveOnly = false } = {}) {
    const renderer = this.renderer;
    const item = this.selectedTransformableChainItem();
    if (!item) return false;
    const component = renderer.state.components.find((entry) => entry.id === renderer.state.ui.selectedComponentId);
    const geometry = this.chainItemPreviewGeometry(component, item);
    if (!geometry) return false;
    const { frame, baseRect, transform, localTransform, parentTransform, centerX: cx, centerY: cy } = geometry;
    const scale = Math.max(0.01, Number(transform.scale) || 1);
    const rotation = Number(transform.rotation) || 0;
    const local = screenToLayerLocal(x, y, cx, cy, rotation);
    const uiScale = this.uiPixelScale();
    const { scaleHandleX, scaleHandleY, rotateHandleX, rotateHandleY } = transformHandleLayout(baseRect, scale, 52 * uiScale);
    const scaleDx = local.x - scaleHandleX;
    const scaleDy = local.y - scaleHandleY;
    const rotateDx = local.x - rotateHandleX;
    const rotateDy = local.y - rotateHandleY;
    const inside = pointInTransformedRect(x, y, frame, baseRect, transform);
    let mode = "";
    const handleRadius = 14 * uiScale;
    if (moveOnly) mode = inside ? "move" : "";
    else if (scaleDx * scaleDx + scaleDy * scaleDy <= handleRadius * handleRadius) mode = "scale";
    else if (rotateDx * rotateDx + rotateDy * rotateDy <= handleRadius * handleRadius) mode = "rotate";
    else if (!handlesOnly && inside) mode = "move";
    if (!mode) return false;
    renderer.onChainItemSelect?.(item.id);
    this.chainTransformDrag = {
      itemId: item.id,
      componentId: renderer.state.ui.selectedComponentId,
      mode,
      startX: x,
      startY: y,
      centerX: cx,
      centerY: cy,
      frameWidth: frame.width,
      frameHeight: frame.height,
      transform: { ...localTransform },
      parentTransform,
      startDistance: Math.max(1, Math.hypot(x - cx, y - cy)),
      startAngle: Math.atan2(y - cy, x - cx),
      changed: false,
      lastTransform: null,
    };
    this.pendingChainTransform = null;
    return true;
  }

  updateChainTransformDrag(x, y) {
    const drag = this.chainTransformDrag;
    if (!drag) return;
    const next = resolveChainTransformDrag(drag, x, y);
    this.applyLocalChainTransform(drag.componentId, drag.itemId, next);
    drag.changed = true;
    drag.lastTransform = next;
    this.renderer.sendChainTransform?.(drag.componentId, drag.itemId, next);
  }

  applyLocalChainTransform(componentId, itemId, transform) {
    const renderer = this.renderer;
    renderer.state = stateWithChainItemTransform(renderer.state, componentId, itemId, transform);
    renderer.refreshComponentLookup?.(componentId);
    const component = renderer.state?.components?.find((entry) => entry.id === componentId);
    const item = findChainItemById(component?.chain, itemId);
    // Compiled Component programs intentionally avoid traversing project node
    // metadata in the frame loop. During a preview drag, patch only the one
    // materialized chain item so the local pointer overlay remains immediate;
    // waiting for the RAF-coalesced store echo makes motion visibly stair-step.
    if (item) renderer.componentPrograms?.get?.(componentId)?.replaceChainItem?.(itemId, item);
  }

  reconcileIncomingState(nextState) {
    if (!nextState) return nextState;
    let reconciled = nextState;
    const chainOwner = this.chainTransformDrag?.lastTransform
      ? {
          componentId: this.chainTransformDrag.componentId,
          itemId: this.chainTransformDrag.itemId,
          transform: this.chainTransformDrag.lastTransform,
        }
      : this.pendingChainTransform;
    if (chainOwner) {
      const component = nextState.components?.find((item) => item.id === chainOwner.componentId);
      const item = findChainItemById(component?.chain, chainOwner.itemId);
      if (!item) this.pendingChainTransform = null;
      else if (!this.chainTransformDrag && recordIncludes(item.transform, chainOwner.transform)) {
        this.pendingChainTransform = null;
      } else {
        reconciled = stateWithChainItemTransform(
          reconciled,
          chainOwner.componentId,
          chainOwner.itemId,
          chainOwner.transform
        );
        if (reconciled.ui) reconciled = {
          ...reconciled,
          ui: { ...reconciled.ui, selectedChainItemId: chainOwner.itemId },
        };
      }
    }

    const frameOwner = this.canvasFrameDrag?.lastRect
      ? { frameId: this.canvasFrameDrag.frameId, rect: this.canvasFrameDrag.lastRect }
      : this.pendingCanvasFrame;
    if (frameOwner) {
      const frame = nextState.recordingFrames?.find((item) => item.id === frameOwner.frameId);
      if (!frame) this.pendingCanvasFrame = null;
      else if (!this.canvasFrameDrag && recordIncludes(frame, frameOwner.rect)) {
        this.pendingCanvasFrame = null;
      } else {
        reconciled = stateWithCanvasFrameRect(reconciled, frameOwner.frameId, frameOwner.rect);
      }
    }
    return reconciled;
  }
}

export function stateWithChainItemTransform(state, componentId, itemId, transform) {
  if (!state || !Array.isArray(state.components)) return state;
  let componentChanged = false;
  const components = state.components.map((component) => {
    if (component.id !== componentId) return component;
    const chain = chainWithItemTransform(component.chain, itemId, transform);
    if (chain === component.chain) return component;
    componentChanged = true;
    return { ...component, chain };
  });
  return componentChanged ? { ...state, components } : state;
}

export function stateWithCanvasFrameRect(state, frameId, rect) {
  if (!state || !Array.isArray(state.recordingFrames)) return state;
  let changed = false;
  const recordingFrames = state.recordingFrames.map((frame) => {
    if (frame.id !== frameId) return frame;
    changed = true;
    return { ...frame, ...rect };
  });
  return changed ? { ...state, recordingFrames } : state;
}

function chainWithItemTransform(chain, itemId, transform) {
  if (!Array.isArray(chain)) return chain;
  let changed = false;
  const next = chain.map((item) => {
    if (item.id === itemId) {
      changed = true;
      return { ...item, transform: { ...item.transform, ...transform } };
    }
    if (item.kind !== "group" || !Array.isArray(item.chain)) return item;
    const nested = chainWithItemTransform(item.chain, itemId, transform);
    if (nested === item.chain) return item;
    changed = true;
    return { ...item, chain: nested };
  });
  return changed ? next : chain;
}

function recordIncludes(actual, expected) {
  return Object.entries(expected || {}).every(([key, value]) => actual?.[key] === value);
}
