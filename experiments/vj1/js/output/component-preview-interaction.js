import { sceneFrameSize } from "../domain/render-settings.js?v=canvas-global-resolution-1";
import { visibleSceneSurfaceIds } from "../domain/scene-routing.js?v=surface-identity-1";
import { getEffectNodeComponent as getShaderComponent } from "../libraries/visual-nodes/index.js?v=compiled-semantic-specialized-compounds-26";
import { isFullNodeBoundary, nodeBoundaryUniformScale, nodeBoundaryWithUniformScale, normalizeNodeBoundary } from "../libraries/render-engine/roi/index.js";
import {
  sceneFrameBorderHit,
  sceneFrameRectCorners,
  componentReferencePlacement,
  distanceSquared,
  moveSceneFrameRect,
  resizeSceneFrameRect,
} from "./component-render-layout.js?v=frame-projection-aspect-1";
import {
  combineContentTransforms,
  findChainItemById,
  findChainItemTransformContext,
  groupLocalBounds,
  hitTestChainItems,
  isPhysicalChainItem,
  logicalPixelsPerCssPixel,
  normalizedContentTransform,
  pointInOrientedRect,
  pointInTransformedRect,
  screenToLayerLocal,
  transformHandleLayout,
  transformedRectCenter,
} from "./preview-interaction-geometry.js?v=transform-hit-contract-4";

// Owns editor-only hit testing and drag transactions. The renderer remains
// the drawing/data port, but no longer owns pointer gesture policy or state.
export class ComponentPreviewInteraction {
  constructor(renderer) {
    this.renderer = renderer;
    this.chainTransformDrag = null;
    this.sceneFrameDrag = null;
    this.pendingChainTransform = null;
    this.pendingChainBoundary = null;
    this.pendingSceneFrame = null;
  }

  dispose() {
    this.chainTransformDrag = null;
    this.sceneFrameDrag = null;
    this.pendingChainTransform = null;
    this.pendingChainBoundary = null;
    this.pendingSceneFrame = null;
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

  renderSceneFrames(component, source = null) {
    if (this.renderer.mode !== "component" || component?.type !== "scene") return;
    resetShader();
    push();
    noFill();
    const uiScale = this.uiPixelScale();
    rectMode(CORNER);
    for (const item of this.sceneFrameRects(component, source)) {
      noFill();
      const selected = String(item.frame.id || "") === String(this.renderer.state?.ui?.selectedSurfaceId || "")
        || String(item.frame.id || "") === String(this.sceneFrameDrag?.frameId || "");
      stroke(255, 228, 94, selected ? 235 : 72);
      strokeWeight((selected ? 2 : 1) * uiScale);
      rect(item.x - width * 0.5, item.y - height * 0.5, item.width, item.height);
      // calibrationLocked protects the physical quad in Mapping. It does not
      // lock the Surface's independent 2D rectangle in the Scene workspace.
      if (!selected) continue;
      noStroke();
      fill(255, 228, 94, 245);
      for (const corner of sceneFrameRectCorners(item)) {
        rect(corner.x - width * 0.5 - 6 * uiScale, corner.y - height * 0.5 - 6 * uiScale, 12 * uiScale, 12 * uiScale);
      }
      noFill();
    }
    pop();
  }

  sceneFrameRects(component, source = null) {
    if (component?.type !== "scene") return [];
    const renderer = this.renderer;
    const preview = renderer.componentPreviewRect(component, source);
    const mapping = renderer.state?.mappings?.find((item) =>
      String(item.id) === String(renderer.state?.ui?.selectedMappingId || "")
    ) || renderer.state?.mappings?.[0] || null;
    const visibleFrameIds = visibleSceneSurfaceIds(mapping?.surfaces || []);
    return (mapping?.surfaces || []).filter((frame) =>
      visibleFrameIds.has(String(frame.id || ""))
    ).map((frame) => ({
      frame,
      x: preview.x + Math.max(0, Number(frame.x) || 0) * preview.width,
      y: preview.y + Math.max(0, Number(frame.y) || 0) * preview.height,
      width: Math.max(0.005, Number(frame.width) || 0.005) * preview.width,
      height: Math.max(0.005, Number(frame.height) || 0.005) * preview.height,
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
    const { frame } = geometry;
    const boundary = this.chainItemBoundaryPreviewGeometry(component, item, geometry.frame);
    resetShader();
    push();
    noFill();
    const uiScale = this.uiPixelScale();
    strokeWeight(2 * uiScale);
    // One visible box, one conceptual container: all preview handles edit the
    // boundary. Content X/Y/Scale remains independent in the inspector.
    translate(boundary.centerX - width * 0.5, boundary.centerY - height * 0.5, 3);
    rotate(boundary.rotation);
    rectMode(CENTER);
    stroke(255, 228, 94, 220);
    rect(0, 0, boundary.width, boundary.height);
    const { scaleHandleX, scaleHandleY, rotateHandleX, rotateHandleY } =
      transformHandleLayout(boundary, 1, 52 * uiScale);
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

  chainItemBoundaryPreviewRect(frame, boundary = {}) {
    const x = Number(boundary?.x) || 0;
    const y = Number(boundary?.y) || 0;
    const widthScale = Math.max(0.005, Number(boundary?.width) || 1);
    const heightScale = Math.max(0.005, Number(boundary?.height) || 1);
    const boxWidth = frame.width * widthScale;
    const boxHeight = frame.height * heightScale;
    return {
      x: frame.x + frame.width * (0.5 + x * 0.5) - boxWidth * 0.5,
      y: frame.y + frame.height * (0.5 + y * 0.5) - boxHeight * 0.5,
      width: boxWidth,
      height: boxHeight,
      centerX: frame.x + frame.width * (0.5 + x * 0.5),
      centerY: frame.y + frame.height * (0.5 + y * 0.5),
      rotation: Number(boundary?.rotation) || 0,
    };
  }

  chainItemBoundaryPreviewGeometry(component, item, frame) {
    const path = findChainItemPath(component?.chain, item?.id);
    let context = {
      originX: Number(frame?.x) || 0,
      originY: Number(frame?.y) || 0,
      width: Math.max(1, Number(frame?.width) || 1),
      height: Math.max(1, Number(frame?.height) || 1),
      rotation: 0,
    };
    for (const entry of path || [item]) {
      const value = normalizeNodeBoundary(entry?.boundary);
      const boundaryWidth = context.width * value.width;
      const boundaryHeight = context.height * value.height;
      const localCenterX = context.width * (0.5 + value.x * 0.5);
      const localCenterY = context.height * (0.5 + value.y * 0.5);
      const center = rotatedContextPoint(context, localCenterX, localCenterY);
      const rotation = context.rotation + value.rotation;
      if (entry === item) return {
        x: center.x - boundaryWidth * 0.5,
        y: center.y - boundaryHeight * 0.5,
        centerX: center.x,
        centerY: center.y,
        width: boundaryWidth,
        height: boundaryHeight,
        rotation,
        parentRotation: context.rotation,
        parentWidth: context.width,
        parentHeight: context.height,
      };
      const cosine = Math.cos(rotation);
      const sine = Math.sin(rotation);
      context = {
        originX: center.x + (-boundaryWidth * 0.5) * cosine - (-boundaryHeight * 0.5) * sine,
        originY: center.y + (-boundaryWidth * 0.5) * sine + (-boundaryHeight * 0.5) * cosine,
        width: boundaryWidth,
        height: boundaryHeight,
        rotation,
      };
    }
    return this.chainItemBoundaryPreviewRect(frame, item?.boundary);
  }

  mousePressed(x, y) {
    const renderer = this.renderer;
    // The explicitly selected object's controls own their pointer area. A
    // Scene Surface border may overlap them, but must not steal the gesture.
    if (renderer.mode === "component" && this.startChainTransformDrag(x, y, { handlesOnly: true })) return;
    if (renderer.mode === "component" && this.startSceneFrameDrag(x, y)) return;
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
    if (this.sceneFrameDrag) return this.updateSceneFrameDrag(x, y);
    if (this.chainTransformDrag) return this.updateChainTransformDrag(x, y);
    this.renderer.mapper?.mouseDragged?.(x, y);
  }

  mouseReleased() {
    const renderer = this.renderer;
    if (this.sceneFrameDrag) {
      const drag = this.sceneFrameDrag;
      this.sceneFrameDrag = null;
      if (drag.lastRect) {
        this.pendingSceneFrame = { frameId: drag.frameId, rect: drag.lastRect };
        renderer.sendSceneFrame?.(drag.componentId, drag.frameId, drag.lastRect, { commit: true });
      }
      return;
    }
    if (this.chainTransformDrag) {
      const drag = this.chainTransformDrag;
      this.chainTransformDrag = null;
      if (drag.changed && drag.lastBoundary) {
        this.pendingChainBoundary = {
          componentId: drag.componentId,
          itemId: drag.itemId,
          boundary: drag.lastBoundary,
        };
        renderer.sendChainBoundary?.(drag.componentId, drag.itemId, drag.lastBoundary, { commit: true });
        return;
      }
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

  startSceneFrameDrag(x, y) {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (component?.type !== "scene") return false;
    const source = renderer.componentOutput.get(component.id);
    const rects = this.sceneFrameRects(component, source);
    for (let index = rects.length - 1; index >= 0; index--) {
      const item = rects[index];
      const corners = sceneFrameRectCorners(item);
      const hitRadius = 15 * this.uiPixelScale();
      const corner = corners.find((entry) => distanceSquared(x, y, entry.x, entry.y) <= hitRadius * hitRadius);
      const border = sceneFrameBorderHit(item, x, y, 12 * this.uiPixelScale());
      if (!corner && !border) continue;
      const frame = item.frame;
      renderer.onSceneFrameSelect?.(frame.id);
      this.sceneFrameDrag = {
        componentId: component.id,
        frameId: frame.id,
        mode: corner?.id || "move",
        startX: x,
        startY: y,
        previewWidth: Math.max(1, renderer.componentPreviewRect(component, source).width),
        previewHeight: Math.max(1, renderer.componentPreviewRect(component, source).height),
        sceneWidth: 1,
        sceneHeight: 1,
        rect: {
          x: Math.max(0, Number(frame.x) || 0),
          y: Math.max(0, Number(frame.y) || 0),
          width: Math.max(0.005, Number(frame.width) || 0.005),
          height: Math.max(0.005, Number(frame.height) || 0.005),
        },
        keepProportions: frame.keepProportions !== false,
        lastRect: null,
      };
      this.pendingSceneFrame = null;
      return true;
    }
    return false;
  }

  updateSceneFrameDrag(x, y) {
    const drag = this.sceneFrameDrag;
    if (!drag) return;
    const dx = (x - drag.startX) * drag.sceneWidth / drag.previewWidth;
    const dy = (y - drag.startY) * drag.sceneHeight / drag.previewHeight;
    const next = drag.mode === "move"
      ? moveSceneFrameRect(drag.rect, dx, dy, drag.sceneWidth, drag.sceneHeight)
      : resizeSceneFrameRect(drag.rect, drag.mode, dx, dy, drag.sceneWidth, drag.sceneHeight, {
        keepProportions: drag.keepProportions,
      });
    drag.lastRect = next;
    this.applyLocalSceneFrame(drag.frameId, next);
    this.renderer.sendSceneFrame?.(drag.componentId, drag.frameId, next, { commit: false });
  }

  applyLocalSceneFrame(frameId, rect) {
    const renderer = this.renderer;
    renderer.state = stateWithSceneFrameRect(renderer.state, frameId, rect);
  }

  selectedTransformableChainItem() {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (!component?.chain?.length) return null;
    const selected = findChainItemById(component.chain, renderer.state.ui.selectedChainItemId)
      || (component.chain.length === 1 ? component.chain[0] : null);
    if (!selected || selected.enabled === false || Number(selected.opacity ?? 1) <= 0.001) return null;
    if (selected?.kind === "source" || selected?.kind === "group") return selected;
    const effectComponent = selected?.kind === "effect" ? getShaderComponent(selected.componentId) : null;
    return effectComponent?.spatial ? selected : null;
  }

  chainItemAtPoint(x, y) {
    const renderer = this.renderer;
    const component = renderer.state?.components?.find((item) => item.id === renderer.state?.ui?.selectedComponentId);
    if (!component?.chain?.length) return null;
    const frame = renderer.componentPreviewRect(component, renderer.componentOutput.get(component.id));
    // Handles get an explicit first chance in mousePressed(). The body hit
    // itself must follow visual stacking order; giving the selected body
    // priority makes overlapping objects impossible to pick reliably.
    return hitTestChainItems({
      chain: component.chain,
      component,
      frame,
      x,
      y,
      baseRectForItem: (owner, item, previewFrame) => this.chainItemBaseRect(owner, item, previewFrame),
      containsItem: (owner, item, previewFrame, pointX, pointY) =>
        this.pointInChainItemHitArea(owner, item, previewFrame, pointX, pointY),
    });
  }

  pointInChainItemHitArea(component, item, frame, x, y) {
    // Scene Component references predate node boundaries and retain a small,
    // normalized placement footprint. A default/full boundary must not turn
    // that visible object into a Composition-wide invisible pointer catcher.
    // Once a real boundary is authored, the boundary is the interaction and
    // render contract like every other physical node.
    if (
      component?.type === "scene" &&
      item?.kind === "source" &&
      item.source?.type === "component" &&
      isFullNodeBoundary(item.boundary)
    ) {
      const geometry = this.chainItemPreviewGeometry(component, item);
      return !!geometry && pointInTransformedRect(
        x,
        y,
        geometry.frame,
        geometry.baseRect,
        geometry.transform
      );
    }
    const boundary = this.chainItemBoundaryPreviewGeometry(component, item, frame);
    return !!boundary && pointInOrientedRect(x, y, boundary);
  }

  selectChainItemAtPoint(x, y, knownHit = null) {
    const hit = knownHit || this.chainItemAtPoint(x, y);
    if (!hit) return null;
    const renderer = this.renderer;
    if (renderer.state?.ui) {
      renderer.state = {
        ...renderer.state,
        ui: {
          ...renderer.state.ui,
          selectedChainItemId: hit.id,
          ...(renderer.state.ui.workspace === "scene" ? { sceneInspectorTarget: "element" } : {}),
        },
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
    const frame = renderer.componentPreviewRect(component, renderer.componentOutput.get(component.id));
    return this.pointInChainItemHitArea(component, selected, frame, x, y);
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
    if (item?.kind === "source" && item.source?.type === "component" && component?.type === "scene") {
      const dependency = renderer.state?.components?.find((candidate) => candidate.id === item.source.componentId);
      if (dependency && dependency.type !== "scene") {
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
    const canvasScale = logicalPixelsPerCssPixel(
      Number(globalThis.width) || Number(canvas?.width) || 1,
      Number(globalThis.height) || Number(canvas?.height) || 1,
      Number(rect?.width) || Number(canvas?.width) || 1,
      Number(rect?.height) || Number(canvas?.height) || 1
    );
    // Handles live inside the final p5 viewport transform. Counter-scale their
    // geometry and hit radius so zoom changes the artwork, not the controls.
    const viewportZoom = Math.max(0.1, Number(this.renderer.previewViewportTransform?.().zoom) || 1);
    return canvasScale / viewportZoom;
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
    const boundary = this.chainItemBoundaryPreviewGeometry(component, item, frame);
    const boundaryCenterX = boundary.centerX;
    const boundaryCenterY = boundary.centerY;
    const local = screenToLayerLocal(x, y, boundaryCenterX, boundaryCenterY, boundary.rotation);
    const uiScale = this.uiPixelScale();
    const { scaleHandleX, scaleHandleY, rotateHandleX, rotateHandleY } =
      transformHandleLayout(boundary, 1, 52 * uiScale);
    const boundaryScaleDx = local.x - scaleHandleX;
    const boundaryScaleDy = local.y - scaleHandleY;
    const rotateDx = local.x - rotateHandleX;
    const rotateDy = local.y - rotateHandleY;
    const inside = pointInOrientedRect(x, y, boundary);
    let mode = "";
    const handleRadius = 14 * uiScale;
    if (moveOnly) mode = inside ? "boundary-move" : "";
    else if (boundaryScaleDx * boundaryScaleDx + boundaryScaleDy * boundaryScaleDy <= handleRadius * handleRadius) mode = "boundary-scale";
    else if (rotateDx * rotateDx + rotateDy * rotateDy <= handleRadius * handleRadius) mode = "boundary-rotate";
    else if (!handlesOnly && inside) mode = "boundary-move";
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
      boundary: normalizeNodeBoundary(item.boundary),
      parentTransform,
      startDistance: Math.max(1, Math.hypot(x - (mode === "boundary-scale" ? boundaryCenterX : cx), y - (mode === "boundary-scale" ? boundaryCenterY : cy))),
      boundaryCenterX,
      boundaryCenterY,
      boundaryParentRotation: boundary.parentRotation || 0,
      boundaryParentWidth: boundary.parentWidth || frame.width,
      boundaryParentHeight: boundary.parentHeight || frame.height,
      startAngle: Math.atan2(y - boundaryCenterY, x - boundaryCenterX),
      changed: false,
      lastTransform: null,
    };
    this.pendingChainTransform = null;
    this.pendingChainBoundary = null;
    return true;
  }

  updateChainTransformDrag(x, y) {
    const drag = this.chainTransformDrag;
    if (!drag) return;
    if (drag.mode === "boundary-scale") {
      const distance = Math.max(1, Math.hypot(x - drag.boundaryCenterX, y - drag.boundaryCenterY));
      const scale = nodeBoundaryUniformScale(drag.boundary) * Math.sqrt(distance / drag.startDistance);
      const nextBoundary = nodeBoundaryWithUniformScale(drag.boundary, scale);
      this.applyLocalChainBoundary(drag.componentId, drag.itemId, nextBoundary);
      drag.changed = true;
      drag.lastBoundary = nextBoundary;
      this.renderer.sendChainBoundary?.(drag.componentId, drag.itemId, nextBoundary, { commit: false });
      return;
    }
    const nextBoundary = { ...drag.boundary };
    if (drag.mode === "boundary-move") {
      const delta = screenToLayerLocal(x - drag.startX, y - drag.startY, 0, 0, drag.boundaryParentRotation);
      nextBoundary.x = drag.boundary.x + delta.x * 2 / Math.max(1, drag.boundaryParentWidth);
      nextBoundary.y = drag.boundary.y + delta.y * 2 / Math.max(1, drag.boundaryParentHeight);
    } else if (drag.mode === "boundary-rotate") {
      const angle = Math.atan2(y - drag.boundaryCenterY, x - drag.boundaryCenterX);
      nextBoundary.rotation = drag.boundary.rotation + angle - drag.startAngle;
    }
    this.applyLocalChainBoundary(drag.componentId, drag.itemId, nextBoundary);
    drag.changed = true;
    drag.lastBoundary = nextBoundary;
    this.renderer.sendChainBoundary?.(drag.componentId, drag.itemId, nextBoundary, { commit: false });
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

  applyLocalChainBoundary(componentId, itemId, boundary) {
    const renderer = this.renderer;
    renderer.state = stateWithChainItemBoundary(renderer.state, componentId, itemId, boundary);
    renderer.refreshComponentLookup?.(componentId);
    const component = renderer.state?.components?.find((entry) => entry.id === componentId);
    const item = findChainItemById(component?.chain, itemId);
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

    const boundaryOwner = this.chainTransformDrag?.lastBoundary
      ? {
          componentId: this.chainTransformDrag.componentId,
          itemId: this.chainTransformDrag.itemId,
          boundary: this.chainTransformDrag.lastBoundary,
        }
      : this.pendingChainBoundary;
    if (boundaryOwner) {
      const component = nextState.components?.find((item) => item.id === boundaryOwner.componentId);
      const item = findChainItemById(component?.chain, boundaryOwner.itemId);
      if (!item) this.pendingChainBoundary = null;
      else if (!this.chainTransformDrag && recordIncludes(item.boundary, boundaryOwner.boundary)) {
        this.pendingChainBoundary = null;
      } else {
        reconciled = stateWithChainItemBoundary(
          reconciled,
          boundaryOwner.componentId,
          boundaryOwner.itemId,
          boundaryOwner.boundary
        );
        if (reconciled.ui) reconciled = {
          ...reconciled,
          ui: { ...reconciled.ui, selectedChainItemId: boundaryOwner.itemId },
        };
      }
    }

    const frameOwner = this.sceneFrameDrag?.lastRect
      ? { frameId: this.sceneFrameDrag.frameId, rect: this.sceneFrameDrag.lastRect }
      : this.pendingSceneFrame;
    if (frameOwner) {
      const mapping = nextState.mappings?.find((item) => item.id === nextState.ui?.selectedMappingId) || nextState.mappings?.[0];
      const frame = mapping?.surfaces?.find((item) => item.id === frameOwner.frameId);
      if (!frame) this.pendingSceneFrame = null;
      else if (!this.sceneFrameDrag && recordIncludes(frame, frameOwner.rect)) {
        this.pendingSceneFrame = null;
      } else {
        reconciled = stateWithSceneFrameRect(reconciled, frameOwner.frameId, frameOwner.rect);
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

export function stateWithChainItemBoundary(state, componentId, itemId, boundary) {
  if (!state || !Array.isArray(state.components)) return state;
  let componentChanged = false;
  const components = state.components.map((component) => {
    if (component.id !== componentId) return component;
    const chain = chainWithItemBoundary(component.chain, itemId, boundary);
    if (chain === component.chain) return component;
    componentChanged = true;
    return { ...component, chain };
  });
  return componentChanged ? { ...state, components } : state;
}

export function stateWithSceneFrameRect(state, frameId, rect) {
  if (!state || !Array.isArray(state.mappings)) return state;
  const mappingIndex = state.mappings.findIndex((mapping) => String(mapping.id) === String(state.ui?.selectedMappingId || ""));
  if (mappingIndex < 0) return state;
  let changed = false;
  const surfaces = state.mappings[mappingIndex].surfaces.map((frame) => {
    if (frame.id !== frameId) return frame;
    changed = true;
    return { ...frame, ...rect };
  });
  if (!changed) return state;
  const mappings = state.mappings.slice();
  mappings[mappingIndex] = { ...mappings[mappingIndex], surfaces };
  return { ...state, mappings, surfaces };
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

function chainWithItemBoundary(chain, itemId, boundary) {
  if (!Array.isArray(chain)) return chain;
  let changed = false;
  const next = chain.map((item) => {
    if (item.id === itemId) {
      changed = true;
      return { ...item, boundary: { ...item.boundary, ...boundary } };
    }
    if (item.kind !== "group" || !Array.isArray(item.chain)) return item;
    const nested = chainWithItemBoundary(item.chain, itemId, boundary);
    if (nested === item.chain) return item;
    changed = true;
    return { ...item, chain: nested };
  });
  return changed ? next : chain;
}

function findChainItemPath(chain = [], itemId = "", ancestors = []) {
  for (const item of chain || []) {
    if (item?.id === itemId) return [...ancestors, item];
    if (item?.kind !== "group") continue;
    const nested = findChainItemPath(item.chain || [], itemId, [...ancestors, item]);
    if (nested) return nested;
  }
  return null;
}

function rotatedContextPoint(context, x, y) {
  const cosine = Math.cos(context.rotation || 0);
  const sine = Math.sin(context.rotation || 0);
  return {
    x: context.originX + x * cosine - y * sine,
    y: context.originY + x * sine + y * cosine,
  };
}

function recordIncludes(actual, expected) {
  return Object.entries(expected || {}).every(([key, value]) => actual?.[key] === value);
}
