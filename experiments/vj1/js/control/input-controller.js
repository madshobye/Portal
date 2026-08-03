import { bindReorderList } from "./reorder-list.js";
import { formatTrimTime, roundTrimTime } from "./component-view.js";
import { getByPath, readInputValue, setByPath, setByPathCreate, syncRangeValue } from "./path-input-utils.js";
import { createLiveRenderPatch } from "../domain/live-render-patch.js";
import {
  ensureLiveParameterDiffBank,
  setLiveParameterDiff,
} from "../domain/live-parameter-diffs.js";
import { applyEditorSelection } from "../domain/editor-selection.js";
import { bindMarkdownEditors } from "./markdown-editor.js";
import { nodeBoundaryWithUniformScale } from "../libraries/render-engine/roi/index.js";
import {
  addParameterAnimationTrack,
  addParameterEventTrack,
  removeParameterAnimationTrack,
  updateParameterAnimationTrack,
} from "../libraries/composition-engine/shared/parameter-animation-tracks.js";

export function createInputController({
  store,
  getState,
  modals,
  bindComponentFilters,
  bindCatalogSortControls,
  resetProjectMapping,
  currentWorkspace,
  refreshSelectedMappingProjection,
  setStatus = () => {},
  triggerParameterAnimation = () => {},
  triggerIsfEvent = () => {},
  onLiveInput = () => {},
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
    bindIsfEventButtons(scope);
    bindLiveInputs(scope);
    bindLiveAnimationInputs(scope);
    bindSelectionAndSourceButtons(scope);
    bindSceneAndRouteButtons(scope);
    bindChainControls(scope);
    bindParameterAnimationControls(scope);
    bindRemovalAndMappingButtons(scope);
    bindParamContextMenus(scope);
    bindComponentContextMenus(scope);
  }

  function bindIsfEventButtons(scope) {
    scope.querySelectorAll("[data-trigger-isf-event]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const path = String(button.dataset.triggerIsfEvent || "");
        const target = isfEventTarget(getState(), path);
        if (!target) return;
        triggerIsfEvent(target);
      });
    });
  }

  function bindParameterAnimationControls(scope) {
    scope.querySelectorAll("[data-animation-editor]").forEach((editor) => {
      const componentId = editor.dataset.animationComponentId;
      const targetNodeId = editor.dataset.animationTargetNodeId;
      editor.querySelector("[data-add-parameter-animation]")?.addEventListener("click", () => {
        const select = editor.querySelector("[data-animation-new-parameter]");
        const option = select?.selectedOptions?.[0];
        if (!select?.value || !option) return;
        commitAnimationEdit("add", () => addParameterAnimationTrack(getState().nodes, {
          componentId,
          targetNodeId,
          parameterId: select.value,
          from: Number(option.dataset.animationFrom),
          to: Number(option.dataset.animationTo),
          baseValue: Number(option.dataset.animationFrom),
          targetRange: [
            Number(option.dataset.animationMin),
            Number(option.dataset.animationMax),
          ],
          duration: 2,
        }));
      });
      editor.querySelector("[data-add-parameter-event]")?.addEventListener("click", () => {
        const select = editor.querySelector("[data-animation-new-event]");
        if (!select?.value) return;
        commitAnimationEdit("add-event", () => addParameterEventTrack(
          getState().nodes,
          {
            componentId,
            targetNodeId,
            parameterId: select.value,
            triggerKind: "manual",
          },
        ));
      });
      editor.querySelectorAll("[data-add-animation-suggestion]").forEach((button) => {
        button.addEventListener("click", () => {
          const parameterSelect = editor.querySelector("[data-animation-new-parameter]");
          const explicitParameterId = button.dataset.animationParameter || "";
          const parameterOption = explicitParameterId
            ? [...(parameterSelect?.options || [])].find((option) =>
                option.value === explicitParameterId
              )
            : parameterSelect?.selectedOptions?.[0];
          const parameterId = explicitParameterId || parameterOption?.value || "";
          if (!parameterId || !parameterOption) return;
          commitAnimationEdit("suggestion", () => addParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            parameterId,
            baseValue: Number(button.dataset.animationBase ?? parameterOption.dataset.animationFrom),
            targetRange: [
              Number(button.dataset.animationMin ?? parameterOption.dataset.animationMin),
              Number(button.dataset.animationMax ?? parameterOption.dataset.animationMax),
            ],
            from: Number(button.dataset.animationFrom ?? parameterOption.dataset.animationFrom),
            to: Number(button.dataset.animationTo ?? parameterOption.dataset.animationTo),
            mode: button.dataset.animationMode,
            duration: Number(button.dataset.animationDuration),
            phase: Number(button.dataset.animationPhase),
            curve: button.dataset.animationCurve,
            returnMode: button.dataset.animationReturnMode,
            pause: Number(button.dataset.animationPause),
            runMode: button.dataset.animationRunMode,
            triggerBehavior: button.dataset.animationTriggerBehavior,
            randomRate: Number(button.dataset.animationRandomRate),
            combination: button.dataset.animationCombination,
            transportKind: button.dataset.animationTransportKind || "sequence",
            envelopeInitial: Number(button.dataset.animationEnvelopeInitial),
            envelopeSegments: parseAnimationEnvelopeSegments(button.dataset.animationEnvelopeSegments),
            triggerKind: button.dataset.animationTriggerKind || "manual",
            triggerAddress: button.dataset.animationTriggerAddress || "",
            triggerThreshold: Number(button.dataset.animationTriggerThreshold),
            triggerInterval: Number(button.dataset.animationTriggerInterval),
            noiseRate: Number(button.dataset.animationNoiseRate),
            noiseSeed: button.dataset.animationNoiseSeed === ""
              ? undefined
              : Number(button.dataset.animationNoiseSeed),
            noiseDetail: Number(button.dataset.animationNoiseDetail),
            noiseRoughness: Number(button.dataset.animationNoiseRoughness),
            noiseBurst: button.dataset.animationNoiseBurst === "true",
            smoothing: Number(button.dataset.animationSmoothing),
          }));
        });
      });
      editor.querySelectorAll("[data-animation-track-id]").forEach((track) => {
        const trackId = track.dataset.animationTrackId;
        track.querySelector("[data-animation-target-parameter]")?.addEventListener("change", (event) => {
          const option = event.currentTarget.selectedOptions?.[0];
          if (!option) return;
          const eventTrack = track.dataset.animationTrackKind === "event";
          commitAnimationEdit("target-parameter", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: eventTrack
              ? { parameterId: option.value }
              : {
                  parameterId: option.value,
                  baseValue: Number(option.dataset.animationBase),
                  targetRange: [
                    Number(option.dataset.animationMin),
                    Number(option.dataset.animationMax),
                  ],
                },
          }));
        });
        track.querySelector("[data-animation-driver]")?.addEventListener("change", (event) => {
          const option = event.currentTarget.selectedOptions?.[0];
          if (!option) return;
          commitAnimationEdit("driver", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: {
              sourceKind: option.dataset.animationSourceKind || "timeline",
              sourceAddress: option.dataset.animationSourceAddress || "",
              transportKind: option.dataset.animationTransportKind || "sequence",
            },
          }));
        });
        track.querySelector("[data-animation-trigger-source]")?.addEventListener("change", (event) => {
          const option = event.currentTarget.selectedOptions?.[0];
          if (!option) return;
          commitAnimationEdit("trigger-source", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: {
              triggerKind: option.dataset.animationTriggerKind || "manual",
              triggerAddress: option.dataset.animationTriggerAddress || "",
            },
          }));
        });
        track.querySelector("[data-toggle-parameter-animation]")?.addEventListener("click", (event) => {
          const enabled = event.currentTarget.getAttribute("aria-pressed") !== "true";
          commitAnimationEdit("toggle", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: { enabled },
          }));
        });
        track.querySelector("[data-remove-parameter-animation]")?.addEventListener("click", () => {
          commitAnimationEdit("remove", () => removeParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
          }), (draft) => {
            const component = draft.components?.find((entry) => entry.id === componentId);
            if (component) {
              component.significantAnimationParams = (
                component.significantAnimationParams || []
              ).filter((entry) => entry.trackId !== trackId);
            }
            for (const overrides of Object.values(draft.ui?.live?.parameterDiffs || {})) {
              delete overrides?.[componentId]?.animation?.[trackId];
            }
          });
        });
        track.querySelector("[data-trigger-parameter-animation]")?.addEventListener("click", () => {
          triggerParameterAnimation({
            componentId,
            targetNodeId,
            trackId,
            address: track.dataset.animationTriggerAddress || "",
          });
        });
        track.querySelector("[data-toggle-animation-return]")?.addEventListener("click", (event) => {
          const returnMode = event.currentTarget.getAttribute("aria-pressed") === "true"
            ? "retrace"
            : "repeat";
          commitAnimationEdit("return-mode", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: { returnMode },
          }));
        });
        track.querySelector("[data-toggle-animation-noise-burst]")?.addEventListener("click", (event) => {
          const noiseBurst = event.currentTarget.getAttribute("aria-pressed") !== "true";
          commitAnimationEdit("noise-burst", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: { noiseBurst },
          }));
        });
        const envelopeSegments = () => [...track.querySelectorAll("[data-animation-envelope-segment]")]
          .map((segment) => ({
            value: Number(segment.querySelector('[data-envelope-segment-field="value"]')?.value) || 0,
            duration: Number(segment.querySelector('[data-envelope-segment-field="duration"]')?.value) || 0.1,
            curve: segment.querySelector('[data-envelope-segment-field="curve"]')?.value || "linear",
          }));
        const commitEnvelopeSegments = (action) => commitAnimationEdit(action, () =>
          updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: { envelopeSegments: envelopeSegments() },
          })
        );
        track.querySelectorAll("[data-envelope-segment-field]").forEach((input) => {
          if (input.type === "range") {
            input.addEventListener("input", () => syncRangeValue(input));
          }
          input.addEventListener("change", () => commitEnvelopeSegments("envelope-step"));
        });
        track.querySelectorAll("[data-remove-animation-envelope-segment]").forEach((button) => {
          button.addEventListener("click", () => {
            button.closest("[data-animation-envelope-segment]")?.remove();
            commitEnvelopeSegments("envelope-remove-step");
          });
        });
        track.querySelector("[data-add-animation-envelope-segment]")?.addEventListener("click", () => {
          const segments = envelopeSegments();
          const last = segments[segments.length - 1];
          commitAnimationEdit("envelope-add-step", () => updateParameterAnimationTrack(getState().nodes, {
            componentId,
            targetNodeId,
            trackId,
            patch: {
              envelopeSegments: [
                ...segments,
                { duration: 0.2, value: last?.value >= 0.5 ? 0 : 1, curve: "linear" },
              ],
            },
          }));
        });
        track.querySelectorAll("[data-animation-track-field]").forEach((input) => {
          if (input.type === "range") {
            input.addEventListener("input", () => syncRangeValue(input));
          }
          input.addEventListener("change", () => {
            const field = input.dataset.animationTrackField;
            const value = ["mode", "curve", "runMode", "triggerBehavior", "combination"].includes(field)
              ? input.value
              : Number(input.value);
            commitAnimationEdit(field, () => updateParameterAnimationTrack(getState().nodes, {
              componentId,
              targetNodeId,
              trackId,
              patch: { [field]: value },
            }));
          });
        });
      });
    });
  }

  function commitAnimationEdit(action, edit, updateDraft = null) {
    try {
      const nextNodes = edit();
      store.update((draft) => {
        draft.nodes = nextNodes;
        updateDraft?.(draft);
      }, {
        reason: `update:parameter-animation-${action}`,
        effects: { graph: { mode: "recompile" } },
      });
    } catch (error) {
      console.error("[VJ1_PARAMETER_ANIMATION_EDIT_FAILED]", error);
      setStatus(`Animation was not updated: ${error?.message || error}`);
    }
  }

  function parseAnimationEnvelopeSegments(value = "") {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function bindComponentContextMenus(scope) {
    scope.querySelectorAll("[data-select-component]").forEach((button) => {
      button.addEventListener("contextmenu", (event) => {
        const componentId = button.dataset.selectComponent;
        const component = getState().components?.find((item) => item.id === componentId);
        if (!component || component.type === "scene") return;
        event.preventDefault();
        event.stopPropagation();
        openComponentContextMenu(component, event.clientX, event.clientY);
      });
    });
  }

  function openComponentContextMenu(component, x, y) {
    document.querySelector("[data-component-context-menu]")?.remove();
    document.querySelector("[data-param-context-menu]")?.remove();
    const menu = document.createElement("div");
    menu.className = "param-context-menu";
    menu.dataset.componentContextMenu = "true";
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    menu.innerHTML = `<button type="button" data-copy-component-as-scene>Convert to Scene</button>`;
    document.body.append(menu);
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector("[data-copy-component-as-scene]")?.addEventListener("click", () => {
      store.copyComponentToScene?.(component.id);
      menu.remove();
    });
    const dismiss = (event) => {
      if (!menu.contains(event.target)) menu.remove();
    };
    setTimeout(() => document.addEventListener("pointerdown", dismiss, { capture: true, once: true }), 0);
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
        if (commitComponentValues([{ path, value }], `update:${path}`)) return;
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

  function bindLiveAnimationInputs(scope) {
    scope.querySelectorAll("[data-live-animation-update]").forEach((input) => {
      const update = () => {
        if (input.type === "range") syncRangeValue(input);
        const componentId = input.dataset.liveComponentId || "";
        const targetNodeId = input.dataset.liveAnimationTargetNodeId || "";
        const trackId = input.dataset.liveAnimationTrackId || "";
        const field = input.dataset.liveAnimationUpdate || "";
        if (!componentId || !targetNodeId || !trackId || !field) return;
        store.updateLive((draft) => {
          setLiveAnimationOverride(
            draft,
            componentId,
            targetNodeId,
            trackId,
            field,
            readInputValue(input),
          );
        }, {
          reason: "live:animation-update",
          input: "ui",
        });
      };
      input.addEventListener(input.type === "range" ? "input" : "change", update);
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
      button.addEventListener("click", () => modals.openSourceChoicePicker(
        button.dataset.openSourceChoice,
        button.dataset.sourceChoiceCategory || "",
        {
          allowComponents: button.dataset.sourceChoiceComponents === "true",
          ownerComponentId: button.dataset.sourceChoiceOwner || "",
        },
      ));
    });
    scope.querySelectorAll("[data-set-component]").forEach((button) => {
      button.addEventListener("click", () => store.update((draft) => {
        setByPath(draft, button.dataset.componentPath, button.dataset.setComponent);
        if (currentWorkspace(draft) === "mapping" && button.dataset.componentPath?.startsWith("mappings.")) refreshSelectedMappingProjection(draft);
      }, `update:${button.dataset.componentPath}`));
    });
    scope.querySelectorAll("[data-open-element-picker]").forEach((button) => {
      button.addEventListener("click", () => modals.openElementPicker(
        button.dataset.componentId || getState().ui.selectedComponentId,
        button.dataset.targetChainItem || ""
      ));
    });
  }

  function bindSceneAndRouteButtons(scope) {
    scope.querySelectorAll("[data-add-scene]").forEach((button) => {
      button.addEventListener("click", () => store.addScene?.());
    });
  }

  function bindChainControls(scope) {
    scope.querySelectorAll("[data-select-chain-item]").forEach((button) => {
      const select = () => {
        const itemId = button.dataset.selectChainItem;
        const state = getState();
        if (state.ui.selectedChainItemId !== itemId
          || (state.ui.workspace === "scene" && state.ui.sceneInspectorTarget !== "element")) {
          store.selectChainItem(itemId);
        }
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
    const live = control.dataset.paramContextMode === "live";
    const animation = control.dataset.paramContextKind === "animation";
    const liveComponentId = control.dataset.paramContextComponentId || control.dataset.liveComponentId || "";
    const liveItemId = control.dataset.paramContextItemId || control.dataset.liveItemId || "";
    const componentMatch = /^components\.(\d+)\.(.+)$/.exec(path);
    const state = getState();
    const componentIndex = live || animation
      ? state.components?.findIndex((item) => String(item.id) === String(liveComponentId)) ?? -1
      : componentMatch ? Number(componentMatch[1]) : -1;
    const component = componentIndex >= 0 ? state.components?.[componentIndex] : null;
    const relativePath = live ? path : animation ? "" : componentMatch?.[2] || "";
    const animationIdentity = animation ? {
      targetNodeId: control.dataset.paramContextAnimationTargetNodeId || "",
      trackId: control.dataset.paramContextAnimationTrackId || "",
      field: control.dataset.paramContextAnimationField || "",
    } : null;
    const significant = !!component && (animation
      ? (component.significantAnimationParams || []).some((entry) =>
          entry.targetNodeId === animationIdentity.targetNodeId &&
          entry.trackId === animationIdentity.trackId &&
          entry.field === animationIdentity.field
        )
      : (component.significantParams || []).includes(relativePath));
    const boundaryScaleInput = control.querySelector?.("input[type='range']");
    const canMarkSignificant = !!component &&
      (animation
        ? !!animationIdentity.targetNodeId && !!animationIdentity.trackId && !!animationIdentity.field
        : !!relativePath && !isBoundaryScaleInput(boundaryScaleInput, path));
    const resettable = control.dataset.paramContextResettable !== "false";
    const menu = document.createElement("div");
    menu.className = "param-context-menu";
    menu.dataset.paramContextMenu = "true";
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
    menu.innerHTML = `
      ${resettable ? `<button type="button" data-param-reset>Reset to default</button>` : ""}
      ${canMarkSignificant ? `<button type="button" data-param-significant>${significant ? "Remove from significant" : "Make significant"}</button>` : ""}
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
      const boundaryReset = isBoundaryScaleInput(boundaryScaleInput, path)
        ? boundaryFromScaleInput(boundaryScaleInput, value)
        : null;
      const reset = (draft) => {
        if (boundaryReset) {
          const widthPath = path.replace(/\.scale$/, ".width");
          const heightPath = path.replace(/\.scale$/, ".height");
          if (live) {
            setLiveOverride(draft, liveComponentId, widthPath, boundaryReset.width);
            setLiveOverride(draft, liveComponentId, heightPath, boundaryReset.height);
          } else {
            setByPath(draft, widthPath, boundaryReset.width);
            setByPath(draft, heightPath, boundaryReset.height);
            syncMappingEdits(draft, widthPath);
          }
          return;
        }
        if (live) setLiveOverride(draft, liveComponentId, path, value);
        else {
          setByPathCreate(draft, path, value);
          syncMappingEdits(draft, path);
        }
      };
      const livePatches = boundaryReset
        ? [
            createLiveRenderPatch(liveComponentId, path.replace(/\.scale$/, ".width"), boundaryReset.width, liveItemId),
            createLiveRenderPatch(liveComponentId, path.replace(/\.scale$/, ".height"), boundaryReset.height, liveItemId),
          ]
        : [createLiveRenderPatch(liveComponentId, path, value, liveItemId)];
      updateLiveAware(live, reset, live ? "live:reset-default" : `update:${path}`, live ? livePatches : []);
      menu.remove();
    });
    menu.querySelector("[data-param-significant]")?.addEventListener("click", () => {
      if (!component || (!relativePath && !animation)) return menu.remove();
      store.update((draft) => {
        const target = draft.components?.[componentIndex];
        if (!target) return;
        if (animation) {
          const entries = [...(target.significantAnimationParams || [])];
          const index = entries.findIndex((entry) =>
            entry.targetNodeId === animationIdentity.targetNodeId &&
            entry.trackId === animationIdentity.trackId &&
            entry.field === animationIdentity.field
          );
          if (index >= 0) entries.splice(index, 1);
          else entries.push({
            ...animationIdentity,
            label: control.dataset.paramContextAnimationLabel || animationIdentity.field,
            min: Number(control.dataset.paramContextAnimationMin),
            max: Number(control.dataset.paramContextAnimationMax),
            step: Number(control.dataset.paramContextAnimationStep) || 0,
            scale: "linear",
          });
          target.significantAnimationParams = entries;
          return;
        }
        const paths = new Set(target.significantParams || []);
        if (paths.has(relativePath)) paths.delete(relativePath);
        else paths.add(relativePath);
        target.significantParams = [...paths];
      }, {
        reason: "update:significant-param",
        // Significance is persisted control-surface metadata. It changes the
        // Live/MIDI assignment list, but not the executable visual program.
        // Replacing Output state here can interrupt an already-active Live
        // override even though no render value changed.
        outputState: "unchanged",
        // The marker can be authored from Component, Scene, or Live. Refresh
        // both its local highlight and the consolidated active-output list
        // immediately; waiting for a later MIDI value leaves that list stale.
        effects: {
          control: { regions: ["live-projection-rail", "inspector"] },
        },
      });
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
    if (control.dataset.videoTrimAvailable !== "true") return;
    const update = (event, phase) => updateVideoTrimFromInputs(
      control,
      event.currentTarget.dataset.videoTrimInput,
      `${phase}:${event.currentTarget.dataset.update}`
    );
    startInput.addEventListener("input", (event) => update(event, "scrub"));
    startInput.addEventListener("change", (event) => update(event, "update"));
    endInput.addEventListener("input", (event) => update(event, "scrub"));
    endInput.addEventListener("change", (event) => update(event, "update"));
    syncVideoTrimControl(control, Number(startInput.value) || 0, Number(endInput.value) || 0, Number(startInput.max));
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
    const value = readInputValue(input);
    if (isBoundaryScaleInput(input, path)) {
      const boundary = boundaryFromScaleInput(input, value);
      const widthPath = path.replace(/\.scale$/, ".width");
      const heightPath = path.replace(/\.scale$/, ".height");
      if (commitComponentValues([
        { path: widthPath, value: boundary.width },
        { path: heightPath, value: boundary.height },
      ], reason)) return;
    } else if (commitComponentValues([{ path, value }], reason)) {
      return;
    }
    store.update((draft) => {
      if (isBoundaryScaleInput(input, path)) {
        const boundary = boundaryFromScaleInput(input, value);
        setByPath(draft, path.replace(/\.scale$/, ".width"), boundary.width);
        setByPath(draft, path.replace(/\.scale$/, ".height"), boundary.height);
        syncMappingEdits(draft, path.replace(/\.scale$/, ".width"));
        return;
      }
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, value);
      syncMappingEdits(draft, path);
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
    const itemId = control.dataset.liveItemId || "";
    if (control.dataset.colorMode !== "live" &&
        commitComponentValues([{ path, value }], reason)) return;
    updateLiveAware(control.dataset.colorMode === "live", (draft) => {
      if (control.dataset.colorMode === "live") {
        setLiveOverride(draft, componentId, path, value);
        return;
      }
      const setter = path.includes(".source.params.") ? setByPathCreate : setByPath;
      setter(draft, path, value);
      syncMappingEdits(draft, path);
    }, reason, [createLiveRenderPatch(componentId, path, value, itemId)]);
  }

  function updateVideoTrimFromInputs(control, activeRole, reason) {
    const startInput = control.querySelector("[data-video-trim-input='start']");
    const endInput = control.querySelector("[data-video-trim-input='end']");
    const startPath = startInput?.dataset.update;
    const endPath = endInput?.dataset.update;
    if (!startInput || !endInput || !startPath || !endPath) return;
    const max = Math.max(0.01, Number(startInput.max) || Number(endInput.max));
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
    const startValue = roundTrimTime(start);
    const endValue = keepImplicitEnd ? 0 : roundTrimTime(end);
    if (commitComponentValues([
      { path: startPath, value: startValue },
      { path: endPath, value: endValue },
    ], reason)) return;
    store.update((draft) => {
      setByPath(draft, startPath, startValue);
      setByPath(draft, endPath, endValue);
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
    const itemId = minInput.dataset.liveItemId || "";
    if (!minInput.dataset.liveUpdate && commitComponentValues([
      { path: minPath, value: minValue },
      { path: maxPath, value: maxValue },
    ], reason)) return;
    updateLiveAware(!!minInput.dataset.liveUpdate, (draft) => {
      if (minInput.dataset.liveUpdate) {
        setLiveOverride(draft, componentId, minPath, minValue);
        setLiveOverride(draft, componentId, maxPath, maxValue);
        return;
      }
      setByPathCreate(draft, minPath, minValue);
      setByPathCreate(draft, maxPath, maxValue);
      syncMappingEdits(draft, minPath);
    }, reason, [
      createLiveRenderPatch(componentId, minPath, minValue, itemId),
      createLiveRenderPatch(componentId, maxPath, maxValue, itemId),
    ]);
  }

  function togglePathFromButton(button, reason) {
    const path = button.dataset.togglePath;
    if (!path) return;
    const nextValue = applyOptimisticToggleIntent(button);
    const mappingSurfaceVisibility = /^mappings\.(\d+)\.surfaces\.(\d+)\.enabled$/.exec(path);
    if (mappingSurfaceVisibility && typeof store.setMappingSurfaceVisibility === "function") {
      const current = getState();
      const mapping = current.mappings?.[Number(mappingSurfaceVisibility[1])];
      const surface = mapping?.surfaces?.[Number(mappingSurfaceVisibility[2])];
      if (mapping && surface) {
        store.setMappingSurfaceVisibility(mapping.id, surface.id, nextValue, reason);
        return;
      }
    }
    if (path.startsWith("components.") && typeof store.setComponentValue === "function") {
      const handled = store.setComponentValue(path, nextValue, {
        reason,
        selectAction: button.dataset.toggleSelectAction || "",
        selectId: button.dataset.toggleSelectId || "",
      });
      if (handled) return;
    }
    store.update((draft) => {
      setByPath(draft, path, nextValue);
      syncMappingEdits(draft, path);
      // A Mapping Surface eye also selects its row. Commit that UI focus in
      // the same transaction: emitting a second `select-surface` command made
      // one click schedule two control rebuilds and two preview activations.
      if (button.dataset.toggleSelectAction === "data-select-surface" &&
          button.dataset.toggleSelectId) {
        applyEditorSelection(draft.ui, "surface", button.dataset.toggleSelectId);
      }
    }, reason);
    if (button.dataset.toggleSelectAction === "data-select-surface") return;
    selectToggleTarget(button);
  }

  function commitComponentValues(entries, reason, options = {}) {
    if (typeof store.setComponentValues !== "function" ||
        !entries.length ||
        entries.some((entry) => !String(entry?.path || "").startsWith("components."))) {
      return false;
    }
    return store.setComponentValues(entries, { reason, ...options }) === true;
  }

  function updateLivePathFromInput(input, reason) {
    const componentId = input.dataset.liveComponentId;
    const itemId = input.dataset.liveItemId || "";
    const path = input.dataset.liveUpdate;
    const value = readInputValue(input);
    onLiveInput({
      reason,
      componentId: String(componentId || ""),
      itemId: String(itemId || ""),
      path: String(path || ""),
      value,
      inputType: String(input.type || input.tagName || ""),
    });
    if (isBoundaryScaleInput(input, path)) {
      const boundary = boundaryFromScaleInput(input, value);
      const widthPath = path.replace(/\.scale$/, ".width");
      const heightPath = path.replace(/\.scale$/, ".height");
      updateLiveAware(true, (draft) => {
        setLiveOverride(draft, componentId, widthPath, boundary.width);
        setLiveOverride(draft, componentId, heightPath, boundary.height);
      }, reason, [
        createLiveRenderPatch(componentId, widthPath, boundary.width, itemId),
        createLiveRenderPatch(componentId, heightPath, boundary.height, itemId),
      ]);
      return;
    }
    updateLiveAware(true, (draft) => setLiveOverride(
      draft,
      componentId,
      path,
      value
    ), reason, [createLiveRenderPatch(componentId, path, value, itemId)]);
  }

  function toggleLivePathFromButton(button, reason) {
    const componentId = button.dataset.liveComponentId;
    const itemId = button.dataset.liveItemId || "";
    const path = button.dataset.liveToggle;
    if (!componentId || !path) return;
    const nextValue = applyOptimisticToggleIntent(button);
    updateLiveAware(
      true,
      (draft) => setLiveOverride(draft, componentId, path, nextValue),
      reason,
      [createLiveRenderPatch(componentId, path, nextValue, itemId)]
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

  function syncMappingEdits(draft, path) {
    if (currentWorkspace(draft) !== "mapping") return;
    if (path.startsWith("mappings.")) refreshSelectedMappingProjection(draft);
  }

  return { bind };
}

export function isfEventTarget(state = {}, path = "") {
  const segments = String(path || "").split(".").filter(Boolean);
  const paramsIndex = segments.lastIndexOf("params");
  const parameterId = paramsIndex >= 0 ? segments[paramsIndex + 1] : "";
  if (!parameterId) return null;
  const ownerSegments = segments.slice(0, paramsIndex);
  if (ownerSegments.at(-1) === "source") ownerSegments.pop();
  let owner = getByPath(state, ownerSegments.join("."));
  if (!owner?.id && ownerSegments.length) {
    ownerSegments.pop();
    owner = getByPath(state, ownerSegments.join("."));
  }
  const target = String(owner?.id || "");
  return target ? { target, parameterId } : null;
}

export function isBoundaryScaleInput(input, path = "") {
  return path.endsWith(".boundary.scale") && input?.dataset?.boundaryWidth !== undefined && input?.dataset?.boundaryHeight !== undefined;
}

export function boundaryFromScaleInput(input, scale) {
  const boundary = nodeBoundaryWithUniformScale({
    width: Number(input.dataset.boundaryWidth) || 1,
    height: Number(input.dataset.boundaryHeight) || 1,
  }, scale);
  return {
    width: Math.round(boundary.width * 1e12) / 1e12,
    height: Math.round(boundary.height * 1e12) / 1e12,
  };
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
  const iconElement = button.querySelector?.(".material-symbols-rounded");
  const iconName = nextValue
    ? button.dataset.toggleEnabledIcon
    : button.dataset.toggleDisabledIcon;
  if (iconElement && iconName) iconElement.textContent = iconName;
  const action = nextValue ? "Disable" : "Enable";
  const label = button.dataset.toggleLabel || "";
  button.setAttribute?.("title", `${action} ${label}`.trim());
  button.setAttribute?.("aria-label", `${action} ${label}`.trim());
  return nextValue;
}

export function setLiveOverride(state, componentId, path, value) {
  setLiveParameterDiff(state, componentId, path, value);
}

export function setLiveAnimationOverride(
  state,
  componentId,
  targetNodeId,
  trackId,
  field,
  value,
) {
  if (!componentId || !targetNodeId || !trackId || !field || !Number.isFinite(Number(value))) return;
  const overrides = ensureLiveParameterDiffBank(state);
  if (!overrides) return;
  const override = overrides[componentId] ||= {};
  override.animation ||= {};
  const track = override.animation[trackId] ||= {
    targetNodeId: String(targetNodeId),
    fields: {},
  };
  track.targetNodeId = String(targetNodeId);
  track.fields ||= {};
  track.fields[field] = Number(value);
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
  const safeMax = Math.max(0.01, Number(max));
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
