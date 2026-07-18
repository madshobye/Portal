import { applySceneSourceNode, resolveSceneSourceNode } from "../domain/models.js?v=render-coordinate-scope-3";
import { touchComponentUsed, touchRecordingFrameUsed } from "../domain/component-activity.js?v=adaptive-component-demand-29";
import { bindReorderList } from "./reorder-list.js";
import { formatTrimTime, roundTrimTime } from "./component-view.js?v=madstodo-4";
import { getByPath, readInputValue, setByPath, setByPathCreate, syncRangeValue } from "./path-input-utils.js?v=path-input-utils-extraction-1";
import { createLiveRenderPatch } from "../domain/live-render-patch.js?v=live-param-patch-1";
import { bindMarkdownEditors } from "./markdown-editor.js?v=text-style-controls-1";

export function createInputController({
  store,
  getState,
  modals,
  bindComponentFilters,
  bindCatalogSortControls,
  resetProjectMapping,
  currentWorkspace,
  applySelectedSceneSnapshot,
  syncSelectedSceneSnapshot,
}) {
  const paramContextScopes = new WeakSet();

  function bind(scope) {
    bindComponentFilters(scope);
    bindCatalogSortControls(scope);
    scope.querySelectorAll("[data-video-trim]").forEach(bindVideoTrimControl);
    scope.querySelectorAll("[data-param-range]").forEach(bindParamRangeControl);
    scope.querySelectorAll("[data-color-param]").forEach(bindColorParamControl);
    bindPersistentInputs(scope);
    bindMarkdownEditors(scope);
    bindPathButtons(scope);
    bindLiveInputs(scope);
    bindSelectionAndSourceButtons(scope);
    bindCanvasAndRouteButtons(scope);
    bindChainControls(scope);
    bindRemovalAndMappingButtons(scope);
    bindParamContextMenus(scope);
  }

  function bindPersistentInputs(scope) {
    scope.querySelectorAll("[data-update]").forEach((input) => {
      if (input.dataset.videoTrimInput || input.dataset.paramRangeInput) return;
      if (input.type === "range") {
        input.addEventListener("input", () => {
          syncRangeValue(input);
          updatePathFromInput(input, `scrub:${input.dataset.update}`);
        });
        input.addEventListener("change", () => {
          syncRangeValue(input);
          updatePathFromInput(input, `update:${input.dataset.update}`);
        });
      } else if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updatePathFromInput(input, `edit:${input.dataset.update}`));
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
      } else {
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
      }
    });
  }

  function bindPathButtons(scope) {
    scope.querySelectorAll("[data-set-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const path = button.dataset.setPath;
        const value = button.dataset.setValueType === "number" ? Number(button.dataset.setValue) : button.dataset.setValue;
        store.update((draft) => setByPath(draft, path, value), `update:${path}`);
      });
    });
    scope.querySelectorAll("[data-toggle-path]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePathFromButton(button, `toggle:${button.dataset.togglePath}`);
      });
    });
  }

  function bindLiveInputs(scope) {
    scope.querySelectorAll("[data-live-update]").forEach((input) => {
      if (input.dataset.paramRangeInput) return;
      if (input.type === "range") {
        input.addEventListener("input", () => {
          syncRangeValue(input);
          updateLivePathFromInput(input, "scrub:live");
        });
        input.addEventListener("change", () => {
          syncRangeValue(input);
          updateLivePathFromInput(input, "live:update");
        });
      } else if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updateLivePathFromInput(input, "scrub:live"));
        input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
      } else {
        input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
      }
    });
    scope.querySelectorAll("[data-live-toggle]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleLivePathFromButton(button, "live:toggle");
      });
    });
  }

  function bindSelectionAndSourceButtons(scope) {
    scope.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    scope.querySelectorAll("[data-select-component]").forEach((button) => {
      button.addEventListener("click", () => store.selectComponent(button.dataset.selectComponent));
    });
    scope.querySelectorAll("[data-set-source-type]").forEach((button) => {
      button.addEventListener("click", () => store.update((draft) => {
        setByPath(draft, button.dataset.sourcePath, button.dataset.setSourceType);
      }, `update:${button.dataset.sourcePath}`));
    });
    scope.querySelectorAll("[data-set-generator]").forEach((button) => {
      button.addEventListener("click", () => store.update((draft) => {
        setByPath(draft, button.dataset.generatorPath, button.dataset.setGenerator);
      }, `update:${button.dataset.generatorPath}`));
    });
    scope.querySelectorAll("[data-open-media-picker]").forEach((button) => {
      button.addEventListener("click", () => modals.openMediaPicker(button.dataset.mediaPath, button.dataset.mediaAccept || ""));
    });
    scope.querySelectorAll("[data-open-source-choice]").forEach((button) => {
      button.addEventListener("click", () => modals.openSourceChoicePicker(button.dataset.openSourceChoice));
    });
    scope.querySelectorAll("[data-set-component]").forEach((button) => {
      button.addEventListener("click", () => store.update((draft) => {
        setByPath(draft, button.dataset.componentPath, button.dataset.setComponent);
        if (currentWorkspace(draft) === "scene" && button.dataset.componentPath?.startsWith("scenes.")) applySelectedSceneSnapshot(draft);
      }, `update:${button.dataset.componentPath}`));
    });
    scope.querySelectorAll("[data-open-element-picker]").forEach((button) => {
      button.addEventListener("click", () => modals.openElementPicker(
        button.dataset.componentId || getState().ui.selectedComponentId,
        button.dataset.targetChainItem || ""
      ));
    });
  }

  function bindCanvasAndRouteButtons(scope) {
    scope.querySelectorAll("[data-add-canvas-component]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasComponent?.());
    });
    scope.querySelectorAll("[data-add-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.addCanvasFrame?.(button.dataset.canvasComponentId || getState().ui.selectedComponentId));
    });
    scope.querySelectorAll("[data-remove-canvas-frame]").forEach((button) => {
      button.addEventListener("click", () => store.removeCanvasFrame?.(button.dataset.canvasComponentId, button.dataset.removeCanvasFrame));
    });
    scope.querySelectorAll("[data-set-route-source-node]").forEach((button) => {
      button.addEventListener("click", () => store.update((draft) => {
        const route = getByPath(draft, button.dataset.routeBase);
        const node = resolveSceneSourceNode(draft, button.dataset.setRouteSourceNode);
        if (route) {
          Object.assign(route, applySceneSourceNode(route, node));
          if (node) {
            touchComponentUsed(draft, node.componentId);
            if (node.frameId) touchRecordingFrameUsed(draft, node.frameId);
          }
        }
        if (currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
      }, "update:surface-source-node"));
    });
  }

  function bindChainControls(scope) {
    scope.querySelectorAll("[data-select-chain-item]").forEach((button) => {
      const select = () => {
        const itemId = button.dataset.selectChainItem;
        if (getState().ui.selectedChainItemId !== itemId) store.selectChainItem(itemId);
      };
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        // Select before a native row drag can cancel click. Rendering is held
        // for the complete pointer sequence by the shell controller.
        select();
      });
      button.addEventListener("click", select);
    });
    scope.querySelectorAll("[data-remove-chain-item]").forEach((button) => {
      button.addEventListener("click", () => store.removeChainItem?.(button.dataset.componentId, button.dataset.removeChainItem));
    });
    scope.querySelectorAll("[data-chain-reorder-list]").forEach((list) => {
      bindReorderList(list, {
        itemSelector: ".chain-item-row[data-reorder-id]",
        dropSelector: "[data-reorder-id]",
        onReorder: (fromId, toId, position) => store.reorderChain(list.dataset.componentId, fromId, toId, position),
      });
    });
  }

  function bindRemovalAndMappingButtons(scope) {
    scope.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    scope.querySelectorAll("[data-remove-component]").forEach((button) => {
      button.addEventListener("click", () => store.removeComponent(button.dataset.removeComponent));
    });
    scope.querySelectorAll("[data-reset-surface-mapping]").forEach((button) => {
      button.addEventListener("click", () => resetProjectMapping(button.dataset.resetSurfaceMapping));
    });
    scope.querySelectorAll("[data-reset-mapping]").forEach((button) => {
      button.addEventListener("click", () => resetProjectMapping());
    });
  }

  function bindParamContextMenus(scope) {
    if (!scope || paramContextScopes.has(scope)) return;
    paramContextScopes.add(scope);
    scope.addEventListener("contextmenu", (event) => {
      const control = event.target?.closest?.("[data-param-context-path]");
      if (!control || !scope.contains(control)) return;
      event.preventDefault();
      openParamContextMenu(control, event.clientX, event.clientY);
    });
  }

  function openParamContextMenu(control, x, y) {
    document.querySelector("[data-param-context-menu]")?.remove();
    const path = control.dataset.paramContextPath;
    if (!path) return;
    const componentMatch = /^components\.(\d+)\.(.+)$/.exec(path);
    const state = getState();
    const component = componentMatch ? state.components?.[Number(componentMatch[1])] : null;
    const relativePath = componentMatch?.[2] || "";
    const significant = !!component && (component.significantParams || []).includes(relativePath);
    const menu = document.createElement("div");
    menu.className = "param-context-menu";
    menu.dataset.paramContextMenu = "true";
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    menu.innerHTML = `
      <button type="button" data-param-reset>Reset to default</button>
      <button type="button" data-param-significant>${significant ? "Remove from significant" : "Make significant"}</button>
    `;
    document.body.append(menu);
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector("[data-param-reset]")?.addEventListener("click", () => {
      let value;
      try { value = JSON.parse(control.dataset.paramDefault); }
      catch (error) {
        console.error("[VJ1_PARAM_DEFAULT_PARSE_FAILED]", { path, fallback: "leave parameter unchanged", message: error?.message || String(error) });
        menu.remove();
        return;
      }
      store.update((draft) => {
        setByPathCreate(draft, path, value);
        syncSceneEdits(draft, path);
      }, `update:${path}`);
      menu.remove();
    });
    menu.querySelector("[data-param-significant]")?.addEventListener("click", () => {
      if (!component || !relativePath) return menu.remove();
      store.update((draft) => {
        const target = draft.components?.[Number(componentMatch[1])];
        if (!target) return;
        const paths = new Set(target.significantParams || []);
        if (paths.has(relativePath)) paths.delete(relativePath);
        else paths.add(relativePath);
        target.significantParams = [...paths];
      }, "update:significant-param");
      menu.remove();
    });
    const close = (event) => {
      if (!menu.contains(event.target)) menu.remove();
    };
    setTimeout(() => window.addEventListener("pointerdown", close, { once: true, capture: true }), 0);
  }

  function bindVideoTrimControl(control) {
    const startInput = control.querySelector("[data-video-trim-input='start']");
    const endInput = control.querySelector("[data-video-trim-input='end']");
    if (!startInput || !endInput) return;
    const update = (event, phase) => updateVideoTrimFromInputs(
      control,
      event.currentTarget.dataset.videoTrimInput,
      `${phase}:${event.currentTarget.dataset.update}`
    );
    startInput.addEventListener("input", (event) => update(event, "scrub"));
    startInput.addEventListener("change", (event) => update(event, "update"));
    endInput.addEventListener("input", (event) => update(event, "scrub"));
    endInput.addEventListener("change", (event) => update(event, "update"));
    syncVideoTrimControl(control, Number(startInput.value) || 0, Number(endInput.value) || 0, Number(startInput.max) || 60);
  }

  function bindParamRangeControl(control) {
    const minInput = control.querySelector("[data-param-range-input='min']");
    const maxInput = control.querySelector("[data-param-range-input='max']");
    if (!minInput || !maxInput) return;
    const isLive = !!minInput.dataset.liveUpdate;
    const update = (event, phase) => updateParamRangeFromInputs(
      control,
      event.currentTarget.dataset.paramRangeInput,
      isLive ? (phase === "scrub" ? "scrub:live" : "live:update") : `${phase}:${event.currentTarget.dataset.update}`
    );
    minInput.addEventListener("input", (event) => update(event, "scrub"));
    minInput.addEventListener("change", (event) => update(event, "update"));
    maxInput.addEventListener("input", (event) => update(event, "scrub"));
    maxInput.addEventListener("change", (event) => update(event, "update"));
    syncParamRangeControl(control, Number(minInput.value), Number(maxInput.value));
  }

  function updatePathFromInput(input, reason) {
    const path = input.dataset.update;
    store.update((draft) => {
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, readInputValue(input));
      syncSceneEdits(draft, path);
    }, reason);
  }

  function bindColorParamControl(control) {
    const rgbInput = control.querySelector("[data-color-rgb]");
    const alphaInput = control.querySelector("[data-color-alpha]");
    const reason = (phase) => control.dataset.colorMode === "live" ? (phase === "scrub" ? "scrub:live" : "live:update") : `${phase}:${control.dataset.colorPath}`;
    rgbInput?.addEventListener("input", () => updateColorParamFromControl(control, reason("scrub")));
    rgbInput?.addEventListener("change", () => updateColorParamFromControl(control, reason("color")));
    alphaInput?.addEventListener("input", () => updateColorParamFromControl(control, reason("scrub")));
    alphaInput?.addEventListener("change", () => updateColorParamFromControl(control, reason("color")));
  }

  function updateColorParamFromControl(control, reason) {
    const path = control.dataset.colorPath;
    if (!path) return;
    const value = colorValueFromControl(control);
    const componentId = control.dataset.liveComponentId;
    updateLiveAware(control.dataset.colorMode === "live", (draft) => {
      if (control.dataset.colorMode === "live") {
        setLiveOverride(draft, componentId, path, value);
        return;
      }
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, value);
      syncSceneEdits(draft, path);
    }, reason, [createLiveRenderPatch(componentId, path, value)]);
  }

  function updateVideoTrimFromInputs(control, activeRole, reason) {
    const startInput = control.querySelector("[data-video-trim-input='start']");
    const endInput = control.querySelector("[data-video-trim-input='end']");
    const startPath = startInput?.dataset.update;
    const endPath = endInput?.dataset.update;
    if (!startInput || !endInput || !startPath || !endPath) return;
    const max = Math.max(0.01, Number(startInput.max) || Number(endInput.max) || 60);
    let start = clamp(Number(startInput.value) || 0, 0, max);
    let end = clamp(Number(endInput.value) || max, 0, max);
    if (start > end) {
      if (activeRole === "start") end = start;
      else start = end;
    }
    startInput.value = String(start);
    endInput.value = String(end);
    syncVideoTrimControl(control, start, end, max);
    const keepImplicitEnd = control.dataset.videoTrimImplicitEnd === "true" && activeRole !== "end";
    store.update((draft) => {
      setByPath(draft, startPath, roundTrimTime(start));
      setByPath(draft, endPath, keepImplicitEnd ? 0 : roundTrimTime(end));
    }, reason);
  }

  function updateParamRangeFromInputs(control, activeRole, reason) {
    const minInput = control.querySelector("[data-param-range-input='min']");
    const maxInput = control.querySelector("[data-param-range-input='max']");
    if (!minInput || !maxInput) return;
    const minPath = minInput.dataset.update || minInput.dataset.liveUpdate;
    const maxPath = maxInput.dataset.update || maxInput.dataset.liveUpdate;
    if (!minPath || !maxPath) return;
    const lowerBound = Number(minInput.min);
    const upperBound = Number(minInput.max);
    let minValue = clamp(Number(minInput.value), lowerBound, upperBound);
    let maxValue = clamp(Number(maxInput.value), lowerBound, upperBound);
    if (minValue > maxValue) {
      if (activeRole === "min") maxValue = minValue;
      else minValue = maxValue;
    }
    minInput.value = String(minValue);
    maxInput.value = String(maxValue);
    syncParamRangeControl(control, minValue, maxValue);
    const componentId = minInput.dataset.liveComponentId;
    updateLiveAware(!!minInput.dataset.liveUpdate, (draft) => {
      if (minInput.dataset.liveUpdate) {
        setLiveOverride(draft, componentId, minPath, minValue);
        setLiveOverride(draft, componentId, maxPath, maxValue);
        return;
      }
      setByPathCreate(draft, minPath, minValue);
      setByPathCreate(draft, maxPath, maxValue);
      syncSceneEdits(draft, minPath);
    }, reason, [
      createLiveRenderPatch(componentId, minPath, minValue),
      createLiveRenderPatch(componentId, maxPath, maxValue),
    ]);
  }

  function togglePathFromButton(button, reason) {
    const path = button.dataset.togglePath;
    if (!path) return;
    const nextValue = applyOptimisticToggleIntent(button);
    store.update((draft) => {
      setByPath(draft, path, nextValue);
      syncSceneEdits(draft, path);
    }, reason);
    selectToggleTarget(button);
  }

  function updateLivePathFromInput(input, reason) {
    const componentId = input.dataset.liveComponentId;
    const path = input.dataset.liveUpdate;
    const value = readInputValue(input);
    updateLiveAware(true, (draft) => setLiveOverride(
      draft,
      componentId,
      path,
      value
    ), reason, [createLiveRenderPatch(componentId, path, value)]);
  }

  function toggleLivePathFromButton(button, reason) {
    const componentId = button.dataset.liveComponentId;
    const path = button.dataset.liveToggle;
    if (!componentId || !path) return;
    const nextValue = applyOptimisticToggleIntent(button);
    updateLiveAware(
      true,
      (draft) => setLiveOverride(draft, componentId, path, nextValue),
      reason,
      [createLiveRenderPatch(componentId, path, nextValue)]
    );
    selectToggleTarget(button);
  }

  function selectToggleTarget(button) {
    const action = button.dataset.toggleSelectAction;
    const id = button.dataset.toggleSelectId;
    if (!id) return;
    if (action === "data-select-surface") store.selectSurface(id);
    else if (action === "data-select-component") store.selectComponent(id);
    else if (action === "chain-item") store.selectChainItem(id);
  }

  function updateLiveAware(isLive, recipe, reason, livePatches = []) {
    if (isLive && typeof store.updateLive === "function") {
      store.updateLive(recipe, { reason, livePatches });
      return;
    }
    store.update(recipe, reason);
  }

  function syncSceneEdits(draft, path) {
    if (currentWorkspace(draft) !== "scene") return;
    if (path.startsWith("scenes.")) applySelectedSceneSnapshot(draft);
    else if (path.startsWith("surfaces.")) syncSelectedSceneSnapshot(draft);
  }

  return { bind };
}

// A control's data attribute is the last user-commanded truth until the next
// render acknowledges it. Rapid clicks therefore alternate intent even while
// rendering/autosave/buffering is still reporting an older observed state.
export function applyOptimisticToggleIntent(button) {
  const nextValue = button?.dataset?.toggleValue !== "true";
  if (!button?.dataset) return nextValue;
  button.dataset.toggleValue = nextValue ? "true" : "false";
  button.classList?.toggle?.("is-enabled", nextValue);
  button.setAttribute?.("aria-pressed", String(nextValue));
  return nextValue;
}

function setLiveOverride(state, componentId, path, value) {
  if (!componentId || !path) return;
  const overrides = activeLiveOverrideBank(state);
  const override = overrides[componentId] ||= {};
  setByPathCreate(override, path, value);
}

function activeLiveOverrideBank(state) {
  state.ui.live ||= {};
  state.ui.live.componentOverrides ||= {};
  state.ui.live.sceneOverrides ||= {};
  const sceneId = String(state.ui.live.selectedSceneId || "");
  if (sceneId) state.ui.live.sceneOverrides[sceneId] = state.ui.live.componentOverrides;
  return state.ui.live.componentOverrides;
}

function colorValueFromControl(control) {
  const rgb = normalizeColorHex(control.querySelector("[data-color-rgb]")?.value || "#ffffff").slice(0, 7);
  const alpha = clamp(Number(control.querySelector("[data-color-alpha]")?.value) || 0, 0, 1);
  return `${rgb}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

function normalizeColorHex(value = "#ffffffff") {
  const match = /^#?([a-f\d]{6})([a-f\d]{2})?$/i.exec(String(value || "").trim());
  if (!match) return "#ffffffff";
  return `#${match[1].toLowerCase()}${(match[2] || "ff").toLowerCase()}`;
}

function syncVideoTrimControl(control, start, end, max) {
  const safeMax = Math.max(0.01, Number(max) || 60);
  const safeStart = clamp(Number(start) || 0, 0, safeMax);
  const safeEnd = clamp(Number(end) || safeMax, safeStart, safeMax);
  control.style.setProperty("--trim-start", `${((safeStart / safeMax) * 100).toFixed(3)}%`);
  control.style.setProperty("--trim-end", `${((safeEnd / safeMax) * 100).toFixed(3)}%`);
  const startLabel = control.querySelector("[data-video-trim-label='start']");
  const endLabel = control.querySelector("[data-video-trim-label='end']");
  if (startLabel) startLabel.textContent = formatTrimTime(safeStart);
  if (endLabel) endLabel.textContent = formatTrimTime(safeEnd);
}

function syncParamRangeControl(control, minValue, maxValue) {
  const minInput = control.querySelector("[data-param-range-input='min']");
  const maxInput = control.querySelector("[data-param-range-input='max']");
  if (!minInput || !maxInput) return;
  const lowerBound = Number(minInput.min);
  const upperBound = Number(minInput.max);
  const span = Math.max(0.000001, upperBound - lowerBound);
  const safeMin = clamp(Number(minValue), lowerBound, upperBound);
  const safeMax = clamp(Number(maxValue), safeMin, upperBound);
  control.style.setProperty("--range-start", `${(((safeMin - lowerBound) / span) * 100).toFixed(3)}%`);
  control.style.setProperty("--range-end", `${(((safeMax - lowerBound) / span) * 100).toFixed(3)}%`);
  const display = control.dataset.rangeDisplay || "number";
  const minLabel = control.querySelector("[data-param-range-label='min']");
  const maxLabel = control.querySelector("[data-param-range-label='max']");
  if (minLabel) minLabel.textContent = formatParamRangeValue(safeMin, display, Number(minInput.step));
  if (maxLabel) maxLabel.textContent = formatParamRangeValue(safeMax, display, Number(maxInput.step));
}

function formatParamRangeValue(value, display = "number", step = 0.01) {
  if (display === "degrees") return `${Math.round(value)}°`;
  if (display === "percent") return `${Math.round(value * 100)}%`;
  const decimals = step >= 1 ? 0 : Math.min(3, Math.max(0, String(step).split(".")[1]?.length || 0));
  return Number(value).toFixed(decimals);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
