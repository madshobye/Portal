import { BLEND_MODES, GENERATORS, SOURCE_TYPES } from "../constants.js";
import { applySceneSnapshotToState, createLiveCompositionView, createLiveRenderState, createSceneSnapshot } from "../domain/models.js";
import { buildOutputUrl } from "../view-routing.js";
import { listShaderComponents } from "../shaders/shader-registry.js";
import { createEmbeddedPreviewApp } from "../output/embedded-preview-app.js?v=scene-snapshots-90";

export function createControlShell({ root, store, bridge, mediaLibrary, projectService }) {
  let refs = {};
  let latestState = store.getState();
  let renderFrame = 0;
  let renderPending = false;
  let deferredRenderState = null;
  let deferredRenderTimer = 0;
  let activePointerCount = 0;
  let interactionHoldUntil = 0;
  let mediaPicker = null;
  const renderedHtml = new WeakMap();
  const mediaPreviewUrls = new Map();
  const embeddedPreview = createEmbeddedPreviewApp({ store, mediaLibrary });
  const interactionQuietMs = 160;

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    store.subscribe((state, reason) => {
      latestState = state;
      if (reason === "mapping-state") {
        renderTopbar(state);
        renderPreview(state);
        return;
      }
      if (reason === "output-metrics" || reason === "preview-metrics" || reason === "project-history" || reason === "project-autosave" || reason === "project-autosave-error") {
        renderTopbar(state);
        return;
      }
      if (reason.startsWith("edit:")) {
        renderTopbar(state);
        updatePreviewState(state);
        return;
      }
      if (reason.startsWith("scrub:")) {
        updatePreviewState(state);
        return;
      }
      scheduleRender(state);
    });
  }

  function scheduleRender(state) {
    if (shouldDeferRender()) {
      deferRender(state);
      return;
    }
    scheduleRenderNow(state);
  }

  function scheduleRenderNow(state) {
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (shouldDeferRender()) {
        deferRender(state);
        return;
      }
      render(state);
    });
  }

  function deferRender(state) {
    deferredRenderState = state;
    renderPending = true;
    renderTopbar(state);
    updatePreviewState(state);
    scheduleDeferredRenderFlush();
  }

  function scheduleDeferredRenderFlush() {
    if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
    deferredRenderTimer = setTimeout(flushDeferredRender, interactionQuietMs);
  }

  function flushDeferredRender() {
    deferredRenderTimer = 0;
    if (!renderPending || !deferredRenderState) return;
    if (shouldDeferRender()) {
      scheduleDeferredRenderFlush();
      return;
    }
    const state = deferredRenderState;
    deferredRenderState = null;
    renderPending = false;
    scheduleRenderNow(state);
  }

  function render(state) {
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderPreview(state);
    renderModal(state);
  }

  function replaceHtmlIfChanged(node, html) {
    if (!node) return false;
    const next = String(html ?? "");
    if (renderedHtml.get(node) === next) return false;
    node.innerHTML = next;
    renderedHtml.set(node, next);
    return true;
  }

  function bindStaticEvents() {
    bindInteractionDeferral();

    refs.openOutput.addEventListener("click", () => {
      window.open(buildOutputUrl("output"), "vj1-output", "popup=yes,width=1280,height=720");
      store.update((draft) => {
        draft.ui.outputWindowOpen = true;
      }, "open-output");
      setTimeout(() => bridge.sendState(), 350);
    });

    refs.togglePreview.addEventListener("click", () => {
      store.update((draft) => {
        draft.ui.debugPreview = !draft.ui.debugPreview;
      }, "toggle-preview");
    });

    refs.toggleLabels.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.showLabels = !draft.global.showLabels;
      }, "toggle-labels");
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);

    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      button.addEventListener("click", () => {
        const workspace = ["compose", "scene", "live"].includes(button.dataset.workspace) ? button.dataset.workspace : "scene";
        const mappingActive = workspace === "scene";
        if (typeof store.setWorkspace === "function") store.setWorkspace(workspace);
        else {
          store.update((draft) => {
            draft.ui.workspace = workspace;
            draft.global.calibrating = mappingActive;
          }, "workspace");
        }
        embeddedPreview.command("set-calibrate", { calibrating: mappingActive });
        bridge.command("set-calibrate", { calibrating: mappingActive });
      });
    });

    refs.blackout.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.blackout = !draft.global.blackout;
      }, "blackout");
    });

    refs.undo.addEventListener("click", async () => {
      refs.undo.disabled = true;
      await projectService.undoProject().catch((error) => setStatus(`Undo error: ${error.message || error}`));
    });

    refs.redo.addEventListener("click", async () => {
      refs.redo.disabled = true;
      await projectService.redoProject().catch((error) => setStatus(`Redo error: ${error.message || error}`));
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      await importFiles(event.dataTransfer?.files || []);
    });
  }

  function bindInteractionDeferral() {
    root.addEventListener("pointerdown", (event) => {
      if (!isInteractiveNode(event.target)) return;
      activePointerCount += 1;
      beginInteractionHold();
    }, true);
    window.addEventListener("pointerup", endPointerInteractionSoon, true);
    window.addEventListener("pointercancel", endPointerInteractionSoon, true);
    root.addEventListener("focusin", (event) => {
      if (isInteractiveNode(event.target)) beginInteractionHold();
    }, true);
    root.addEventListener("focusout", () => {
      interactionHoldUntil = performance.now() + interactionQuietMs;
      scheduleDeferredRenderFlush();
    }, true);
    root.addEventListener("input", (event) => {
      if (isInteractiveNode(event.target)) beginInteractionHold();
    }, true);
    root.addEventListener("change", (event) => {
      if (!isInteractiveNode(event.target)) return;
      interactionHoldUntil = performance.now() + interactionQuietMs;
      scheduleDeferredRenderFlush();
    }, true);
  }

  function beginInteractionHold() {
    interactionHoldUntil = performance.now() + interactionQuietMs;
    if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
  }

  function endPointerInteractionSoon() {
    activePointerCount = Math.max(0, activePointerCount - 1);
    interactionHoldUntil = performance.now() + interactionQuietMs;
    scheduleDeferredRenderFlush();
  }

  function shouldDeferRender() {
    const now = performance.now();
    return activePointerCount > 0 || now < interactionHoldUntil || hasFocusedEditor();
  }

  function hasFocusedEditor() {
    return isTextEditingNode(document.activeElement);
  }

  async function openProjectFolder() {
    const result = await projectService.openFolder().catch((error) => {
      setStatus(`Folder error: ${error.message || error}`);
      return null;
    });
    if (result?.fallback) refs.importFiles.click();
  }

  async function importFiles(files) {
    let result = await projectService.importExternalFiles(files).catch((error) => {
      setStatus(`Import error: ${error.message || error}`);
      return null;
    });
    if (result?.needsFolder) {
      const opened = await projectService.openFolder().catch((error) => {
        setStatus(`Folder error: ${error.message || error}`);
        return null;
      });
      if (opened?.fallback) {
        setStatus("Open a project folder before importing files");
        return;
      }
      result = await projectService.importExternalFiles(files).catch((error) => {
        setStatus(`Import error: ${error.message || error}`);
        return null;
      });
    }
    if (result?.imported) setStatus(`Imported ${result.imported} file${result.imported === 1 ? "" : "s"}`);
  }

  function renderTopbar(state) {
    const projectName = state.project.name || "VJ1";
    const projectMeta = state.project.warnings?.[0] || (
      state.project.folderName && state.project.folderName !== projectName
        ? state.project.folderName
        : ""
    );
    setText(refs.projectName, projectName);
    setText(refs.projectMeta, projectMeta || "Choose a project folder to begin");
    setClass(refs.projectMeta, "is-hidden", !projectMeta && !!state.project.folderName);
    setClass(refs.outputStatus, "is-live", state.metrics.clients > 0);
    setText(refs.outputStatusText, state.metrics.clients > 0 ? `${Math.round(state.metrics.fps || 0)} fps` : "output");
    const renderCost = activeRenderCost(state);
    setClass(refs.renderCost, "is-hot", renderCost > 0.8);
    setText(refs.renderCostText, formatRenderCost(renderCost));
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.toggleLabels, "is-active", state.global.showLabels !== false);
    setClass(refs.blackout, "is-active", state.global.blackout);
    refs.undo.disabled = !state.ui.canUndo;
    refs.redo.disabled = !state.ui.canRedo;
    refs.workspaceSwitch.querySelectorAll("[data-workspace]").forEach((button) => {
      setClass(button, "is-active", button.dataset.workspace === currentWorkspace(state));
    });
  }

  function renderProjectRail(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    const workspace = currentWorkspace(state);
    const html = `
      ${hasProject ? railToolsTemplate(state, workspace) : `
        <div class="folder-first-note">
          <span class="material-symbols-rounded">gesture</span>
          <p>Open a folder first. The set, media, scenes, shaders, and mappings will live there together.</p>
        </div>
      `}
    `;
    if (replaceHtmlIfChanged(refs.projectRail, html)) bindRailEvents();
  }

  function railToolsTemplate(state, workspace) {
    if (workspace === "compose") return compositionToolsTemplate(state);
    if (workspace === "live") return liveToolsTemplate(state);
    return sceneToolsTemplate(state);
  }

  function compositionToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">account_tree</span><span>Compositions</span></div>
        <div class="composition-card-list">
          ${state.compositions.map((composition) => compositionPillTemplate(composition, state)).join("") || emptyNote("Create visual recipes")}
        </div>
        <button type="button" data-add-composition>${icon("add")} Add composition</button>
      </div>
    `;
  }

  function sceneToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scenes</span></div>
        <div class="scene-card-list">
          ${state.scenes.map((scene) => scenePillTemplate(scene, state)).join("") || emptyNote("Capture surface assignments")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scene ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-save-scene title="Capture scene" aria-label="Capture scene">${icon("add")}</button>
        </div>
      </div>
      ${sceneRailConfigTemplate(state)}
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">select_all</span><span>Surfaces</span></div>
        <div class="surface-pills">
          ${state.surfaces.map((surface) => sceneSurfacePillTemplate(surface, state)).join("")}
        </div>
        <button type="button" data-add-surface>${icon("add")} Add surface</button>
      </div>
    `;
  }

  function liveToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">play_circle</span><span>Live Scenes</span></div>
        <div class="scene-card-list live-scene-list">
          ${state.scenes.map((scene) => liveScenePillTemplate(scene, state)).join("") || emptyNote("Capture scenes first")}
        </div>
      </div>
    `;
  }

  function renderStudio(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!refs.studio.querySelector("[data-studio-stage]")) {
      refs.studio.innerHTML = `
      <section class="studio-stage" data-studio-stage>
        <div class="visual-frame" data-preview-host>
        </div>
      </section>
    `;
      bindStudioEvents();
    }
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    setClass(previewHost, "is-empty", !hasProject);
    if (!hasProject) {
      replaceHtmlIfChanged(previewHost, projectEmptyTemplate());
      embeddedPreview.pause();
    }
  }

  function renderPreview(state) {
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    if (!previewHost || previewHost.classList.contains("is-empty")) return;
    const workspace = currentWorkspace(state);
    const kind = workspace === "compose" ? "composition" : "preview";
    const previewState = workspace === "live" ? createLiveRenderState(state) : state;
    if (!previewHost.querySelector("[data-embedded-preview-stage]")) {
      replaceHtmlIfChanged(previewHost, `
        <div class="embedded-preview-stage" data-embedded-preview-stage></div>
        <div class="preview-tools">
          <button type="button" class="preview-tool" data-toggle-mapping-handles title="Toggle mapping handles" aria-label="Toggle mapping handles">${icon("control_point_duplicate")}</button>
          <div class="preview-fps" data-preview-fps>0 fps</div>
        </div>
      `);
    }
    const handleButton = previewHost.querySelector("[data-toggle-mapping-handles]");
    setClass(handleButton, "is-subtle", state.global.mappingHandleMode === "near");
    setClass(handleButton, "is-hidden", kind !== "preview");
    if (handleButton && !handleButton.dataset.bound) {
      handleButton.dataset.bound = "true";
      handleButton.addEventListener("click", () => {
        store.update((draft) => {
          draft.global.mappingHandleMode = draft.global.mappingHandleMode === "near" ? "always" : "near";
        }, "toggle-mapping-handles");
      });
    }
    embeddedPreview.mount({
      host: previewHost,
      stage: previewHost.querySelector("[data-embedded-preview-stage]"),
      hud: previewHost.querySelector("[data-preview-fps]"),
      mode: kind,
      state: previewState,
    });
  }

  function updatePreviewState(state) {
    const workspace = currentWorkspace(state);
    const kind = workspace === "compose" ? "composition" : "preview";
    embeddedPreview.setState(workspace === "live" ? createLiveRenderState(state) : state, kind);
  }

  function renderInspector(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!hasProject) {
      replaceHtmlIfChanged(refs.inspector, panelTemplate(
        "folder_open",
        "Project first",
        `<div class="soft-note">The controls appear after you choose a folder. That keeps every look connected to a real local show file.</div>`
      ));
      return;
    }
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    let html = "";
    if (currentWorkspace(state) === "compose") {
      const selectedComposition = state.compositions.find((composition) => composition.id === state.ui.selectedCompositionId) || state.compositions[0];
      html = panelTemplate(
        "account_tree",
        "Composition",
        selectedComposition ? compositionTemplate(selectedComposition, state) : emptyNote("No composition")
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    if (currentWorkspace(state) === "live") {
      html = panelTemplate(
        "tune",
        "Live",
        liveInspectorTemplate(state)
      );
      if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
      return;
    }
    html = `
      ${panelTemplate("select_all", "Surface", selectedSurface ? sceneSurfaceTemplate(selectedSurface, state) : emptyNote("No surface"))}
    `;
    if (replaceHtmlIfChanged(refs.inspector, html)) bindInputs(refs.inspector, state);
  }

  function bindRailEvents() {
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    refs.projectRail.querySelectorAll("[data-select-composition]").forEach((button) => {
      button.addEventListener("click", () => store.selectComposition(button.dataset.selectComposition));
    });
    refs.projectRail.querySelectorAll("[data-add-composition]").forEach((button) => {
      button.addEventListener("click", () => store.addComposition());
    });
    refs.projectRail.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
    refs.projectRail.querySelector("[data-save-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scene ${latestState.scenes.length + 1}`;
      store.saveScene(name);
    });
    refs.projectRail.querySelectorAll("[data-update]").forEach((input) => {
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updatePathFromInput(input, `edit:${input.dataset.update}`));
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
      }
    });
    refs.projectRail.querySelectorAll("[data-select-scene]").forEach((button) => {
      button.addEventListener("click", () => store.selectScene(button.dataset.selectScene));
    });
    refs.projectRail.querySelectorAll("[data-live-scene]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          draft.ui.live.selectedSceneId = button.dataset.liveScene;
          draft.ui.live.compositionOverrides = {};
        }, "live:scene");
      });
    });
    refs.projectRail.querySelectorAll("[data-delete-scene]").forEach((button) => {
      button.addEventListener("click", () => store.deleteScene(button.dataset.deleteScene));
    });
    refs.projectRail.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    refs.projectRail.querySelectorAll("[data-remove-composition]").forEach((button) => {
      button.addEventListener("click", () => store.removeComposition(button.dataset.removeComposition));
    });
    refs.projectRail.querySelectorAll("[data-add-shader]").forEach((button) => {
      button.addEventListener("click", () => addShaderPass(button.dataset.addShader, "composition", latestState.ui.selectedCompositionId));
    });
  }

  function renderModal(state) {
    const host = refs.modalHost;
    if (!host) return;
    if (!mediaPicker) {
      replaceHtmlIfChanged(host, "");
      return;
    }
    if (!replaceHtmlIfChanged(host, mediaPickerTemplate(state, mediaPicker, mediaLibrary, mediaPreviewUrls))) return;
    host.querySelector("[data-close-modal]")?.addEventListener("click", closeMediaPicker);
    host.querySelector(".modal-backdrop")?.addEventListener("click", closeMediaPicker);
    host.querySelectorAll("[data-pick-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const mediaId = button.dataset.pickMedia || "";
        store.update((draft) => {
          setByPath(draft, mediaPicker.path, mediaId);
          const sourcePath = mediaPicker.path.replace(/\.mediaId$/, "");
          setByPath(draft, `${sourcePath}.type`, "media");
        }, `update:${mediaPicker.path}`);
        closeMediaPicker();
      });
    });
  }

  function openMediaPicker(path) {
    mediaPicker = { path };
    renderModal(latestState);
  }

  function closeMediaPicker() {
    mediaPicker = null;
    renderModal(latestState);
  }

  function bindStudioEvents() {
    refs.studio.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.studio.querySelector("[data-import-files]")?.addEventListener("click", () => refs.importFiles.click());
    refs.studio.querySelector("[data-reset-mapping]")?.addEventListener("click", () => {
      embeddedPreview.command("reset-mapping");
      bridge.command("reset-mapping");
    });
  }

  function bindInputs(scope, state) {
    scope.querySelectorAll("[data-update]").forEach((input) => {
      if (input.type === "range") {
        input.addEventListener("input", () => {
          updateRangeLabel(input);
          updatePathFromInput(input, `scrub:${input.dataset.update}`);
        });
        input.addEventListener("change", () => {
          updatePathFromInput(input, `update:${input.dataset.update}`);
        });
        return;
      }
      if (input.type === "text" || input.tagName === "TEXTAREA") {
        input.addEventListener("input", () => updatePathFromInput(input, `edit:${input.dataset.update}`));
        input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
        return;
      }
      input.addEventListener("change", () => updatePathFromInput(input, `update:${input.dataset.update}`));
    });
    scope.querySelectorAll("[data-live-update]").forEach((input) => {
      if (input.type === "range") {
        input.addEventListener("input", () => {
          updateRangeLabel(input);
          updateLivePathFromInput(input, "scrub:live");
        });
        input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
        return;
      }
      input.addEventListener("change", () => updateLivePathFromInput(input, "live:update"));
    });
    scope.querySelectorAll("[data-select-layer]").forEach((button) => {
      button.addEventListener("click", () => store.selectLayer(button.dataset.selectLayer));
    });
    scope.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    scope.querySelectorAll("[data-select-composition]").forEach((button) => {
      button.addEventListener("click", () => store.selectComposition(button.dataset.selectComposition));
    });
    scope.querySelectorAll("[data-set-source-type]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.sourcePath, button.dataset.setSourceType);
        }, `update:${button.dataset.sourcePath}`);
      });
    });
    scope.querySelectorAll("[data-set-generator]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.generatorPath, button.dataset.setGenerator);
        }, `update:${button.dataset.generatorPath}`);
      });
    });
    scope.querySelectorAll("[data-open-media-picker]").forEach((button) => {
      button.addEventListener("click", () => openMediaPicker(button.dataset.mediaPath));
    });
    scope.querySelectorAll("[data-set-composition]").forEach((button) => {
      button.addEventListener("click", () => {
        store.update((draft) => {
          setByPath(draft, button.dataset.compositionPath, button.dataset.setComposition);
          if (currentWorkspace(draft) === "scene" && button.dataset.compositionPath?.startsWith("scenes.")) {
            applySelectedSceneSnapshot(draft);
          }
        }, `update:${button.dataset.compositionPath}`);
      });
    });
    scope.querySelectorAll("[data-remove-pass]").forEach((button) => {
      button.addEventListener("click", () => removeShaderPass(button.dataset.target, button.dataset.targetId, Number(button.dataset.passIndex)));
    });
    scope.querySelectorAll("[data-add-shader]").forEach((button) => {
      button.addEventListener("click", () => {
        addShaderPass(
          button.dataset.addShader,
          button.dataset.target || "composition",
          button.dataset.targetId || latestState.ui.selectedCompositionId
        );
      });
    });
    scope.querySelectorAll("[data-remove-surface]").forEach((button) => {
      button.addEventListener("click", () => store.removeSurface(button.dataset.removeSurface));
    });
    scope.querySelectorAll("[data-remove-composition]").forEach((button) => {
      button.addEventListener("click", () => store.removeComposition(button.dataset.removeComposition));
    });
    scope.querySelectorAll("[data-reset-surface-mapping]").forEach((button) => {
      button.addEventListener("click", () => {
        embeddedPreview.command("reset-mapping", { surfaceId: button.dataset.resetSurfaceMapping });
        bridge.command("reset-mapping", { surfaceId: button.dataset.resetSurfaceMapping });
      });
    });
    scope.querySelectorAll("[data-reset-mapping]").forEach((button) => {
      button.addEventListener("click", () => {
        embeddedPreview.command("reset-mapping");
        bridge.command("reset-mapping");
      });
    });
  }

  function addShaderPass(id, target, targetId) {
    store.update((draft) => {
      const owner = getShaderOwner(draft, target, targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].push({ id, enabled: true, amount: id === "custom" ? 0.5 : 0.32 });
      if (target === "surface" && currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
    }, "add-shader-pass");
  }

  function removeShaderPass(target, targetId, index) {
    store.update((draft) => {
      const owner = getShaderOwner(draft, target, targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].splice(index, 1);
      if (target === "surface" && currentWorkspace(draft) === "scene") applySelectedSceneSnapshot(draft);
    }, "remove-shader-pass");
  }

  function getShaderOwner(state, target, targetId) {
    if (target === "surface" && currentWorkspace(state) === "scene") {
      const scene = getSelectedScene(state);
      return sceneSurfaceSnapshot(scene, targetId);
    }
    if (target === "surface") return state.surfaces.find((surface) => surface.id === targetId);
    if (target === "composition") return state.compositions.find((composition) => composition.id === targetId);
    return null;
  }

  function setStatus(message) {
    store.update((draft) => {
      draft.metrics.message = message;
    }, "status");
  }

  function updatePathFromInput(input, reason) {
    store.update((draft) => {
      setByPath(draft, input.dataset.update, readInputValue(input));
      if (currentWorkspace(draft) === "scene") {
        if (input.dataset.update.startsWith("scenes.")) {
          applySelectedSceneSnapshot(draft);
        } else if (input.dataset.update.startsWith("surfaces.")) {
          syncSelectedSceneSnapshot(draft);
        }
      }
    }, reason);
  }

  function updateLivePathFromInput(input, reason) {
    store.update((draft) => {
      const compositionId = input.dataset.liveCompositionId;
      if (!compositionId) return;
      draft.ui.live.compositionOverrides ||= {};
      const override = draft.ui.live.compositionOverrides[compositionId] ||= {};
      setByPathCreate(override, input.dataset.liveUpdate, readInputValue(input));
    }, reason);
  }

  return { mount };
}

function shellTemplate() {
  return `
    <div class="control-app studio-app" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <header class="topbar studio-topbar">
        <div class="brand">
          <div class="brand-mark">VJ</div>
          <button id="open-folder-main" class="project-button" type="button" title="Open project folder">
            <span class="material-symbols-rounded">folder_open</span>
            <span>
              <strong id="project-name">VJ1</strong>
              <small id="project-meta">Choose a project folder</small>
            </span>
          </button>
        </div>
        <div class="top-actions">
          <div id="workspace-switch" class="workspace-switch" role="group" aria-label="Workspace">
            <button type="button" data-workspace="compose">${icon("account_tree")}<span>Compositions</span></button>
            <button type="button" data-workspace="scene" class="is-active">${icon("auto_awesome")}<span>Scenes</span></button>
            <button type="button" data-workspace="live">${icon("play_circle")}<span>Live</span></button>
          </div>
          <button id="toggle-preview" class="icon-buttonish" type="button" title="Toggle preview" aria-label="Toggle preview">${icon("visibility")}</button>
          <button id="toggle-labels" class="icon-buttonish" type="button" title="Show labels" aria-label="Show labels">${icon("label")}</button>
          <button id="undo-project" class="icon-buttonish" type="button" title="Undo" aria-label="Undo" disabled>${icon("undo")}</button>
          <button id="redo-project" class="icon-buttonish" type="button" title="Redo" aria-label="Redo" disabled>${icon("redo")}</button>
          <button id="blackout-main" class="icon-buttonish danger" type="button" title="Blackout" aria-label="Blackout">${icon("brightness_1")}</button>
          <button id="open-output" class="icon-buttonish" type="button" title="Open output" aria-label="Open output">${icon("open_in_new")}</button>
          <span id="render-cost" class="status-pill cost-pill" title="Render cost"><span class="material-symbols-rounded">speed</span><span id="render-cost-text">0%</span></span>
          <span id="output-status" class="status-pill"><span class="status-dot"></span><span id="output-status-text">output</span></span>
          <input id="import-files-main" class="hidden" type="file" multiple webkitdirectory data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
      </header>
      <div class="studio-layout">
        <aside id="project-rail" class="project-rail"></aside>
        <aside id="inspector" class="studio-inspector"></aside>
        <main id="studio" class="studio-main"></main>
      </div>
      <div id="modal-host"></div>
    </div>
  `;
}

function collectRefs(root) {
  return {
    projectName: root.querySelector("#project-name"),
    projectMeta: root.querySelector("#project-meta"),
    outputStatus: root.querySelector("#output-status"),
    outputStatusText: root.querySelector("#output-status-text"),
    renderCost: root.querySelector("#render-cost"),
    renderCostText: root.querySelector("#render-cost-text"),
    openOutput: root.querySelector("#open-output"),
    togglePreview: root.querySelector("#toggle-preview"),
    toggleLabels: root.querySelector("#toggle-labels"),
    undo: root.querySelector("#undo-project"),
    redo: root.querySelector("#redo-project"),
    blackout: root.querySelector("#blackout-main"),
    workspaceSwitch: root.querySelector("#workspace-switch"),
    openFolder: root.querySelector("#open-folder-main"),
    importFiles: root.querySelector("#import-files-main"),
    projectRail: root.querySelector("#project-rail"),
    studio: root.querySelector("#studio"),
    inspector: root.querySelector("#inspector"),
    modalHost: root.querySelector("#modal-host"),
  };
}

function compositionPillTemplate(composition, state) {
  const selected = state.ui.selectedCompositionId === composition.id;
  return `
    <div class="composition-card-row">
      <button type="button" class="composition-card ${selected ? "is-selected" : ""}" data-select-composition="${esc(composition.id)}">
        ${composition.thumbnail
          ? `<img src="${esc(composition.thumbnail)}" alt="" loading="lazy" />`
          : `<div class="composition-card-empty">${icon("account_tree")}</div>`}
        <span>${esc(composition.name)}</span>
      </button>
      <button type="button" class="composition-card-remove" data-remove-composition="${esc(composition.id)}" title="Remove" aria-label="Remove ${esc(composition.name)}" ${state.compositions.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
    </div>
  `;
}

function sceneSurfacePillTemplate(surface, state) {
  const sceneSurface = getSceneSurfaceView(surface, state);
  const composition = state.compositions.find((item) => item.id === sceneSurface.compositionId);
  return selectablePillTemplate({
    selected: state.ui.selectedSurfaceId === surface.id,
    action: "data-select-surface",
    id: surface.id,
    iconName: sceneSurface.enabled ? "crop_free" : "hide_source",
    label: surface.name,
    meta: composition?.name || "None",
    removeAction: "data-remove-surface",
    removeDisabled: state.surfaces.length <= 1,
  });
}

function selectablePillTemplate({ selected, action, id, iconName, label, meta, removeAction = "", removeDisabled = false }) {
  return `
    <div class="list-row">
      <button type="button" class="list-select ${selected ? "is-selected" : ""}" ${action}="${esc(id)}">
        ${icon(iconName)}
        <span>${esc(label)}</span>
        <small>${esc(meta)}</small>
      </button>
      ${removeAction ? `<button type="button" class="list-remove" ${removeAction}="${esc(id)}" title="Remove" aria-label="Remove ${esc(label)}" ${removeDisabled ? "disabled" : ""}>${icon("close")}</button>` : ""}
    </div>
  `;
}

function compositionTemplate(composition, state) {
  const base = pathForComposition(state, composition);
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(composition.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
      </div>
      ${sourcePickerTemplate(composition, state, base)}
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, composition.blend)}</label>
        <label class="field">Speed <input type="number" min="0" step="0.05" data-update="${base}.speed" value="${composition.speed}" /></label>
      </div>
      ${rangeTemplate("Intensity", `${base}.opacity`, composition.opacity)}
      ${compositionChainTemplate(composition, base)}
    </article>
  `;
}

function sourcePickerTemplate(composition, state, base) {
  const source = composition.source || {};
  const media = state.media.find((item) => item.id === source.mediaId);
  return `
    <div class="source-section">
      <div class="field">
        <span>Source</span>
        <div class="segmented-pills">
          ${SOURCE_TYPES.map((type) => `
            <button type="button" class="${source.type === type.id ? "is-selected" : ""}" data-set-source-type="${type.id}" data-source-path="${base}.source.type">
              ${icon(sourceTypeIcon(type.id))}
              <span>${esc(type.label)}</span>
            </button>
          `).join("")}
        </div>
      </div>
      ${source.type === "generator" ? generatorPickerTemplate(`${base}.source.generatorId`, source.generatorId) : ""}
      ${source.type === "media" ? mediaPickerButtonTemplate(`${base}.source.mediaId`, media) : ""}
      ${source.type === "camera" ? `<div class="soft-note">Using the portal camera feed.</div>` : ""}
      ${source.type === "black" ? `<div class="soft-note">Black source selected.</div>` : ""}
    </div>
  `;
}

function generatorPickerTemplate(path, value) {
  return `
    <div class="field">
      <span>Generator</span>
      <div class="generator-grid">
        ${GENERATORS.filter((generator) => generator.id !== "black").map((generator) => `
          <button type="button" class="generator-card ${generator.id === value ? "is-selected" : ""}" data-set-generator="${generator.id}" data-generator-path="${path}">
            <span class="generator-swatch generator-${generator.id}"></span>
            <strong>${esc(generator.label)}</strong>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function mediaPickerButtonTemplate(path, media) {
  return `
    <div class="field">
      <span>Media</span>
      <button type="button" class="media-select-button" data-open-media-picker data-media-path="${path}">
        ${icon(media?.type === "video" ? "movie" : media?.type === "image" ? "image" : "perm_media")}
        <span>${esc(media?.name || "Choose media")}</span>
        ${icon("chevron_right")}
      </button>
    </div>
  `;
}

function sceneSurfaceTemplate(surface, state) {
  const scene = getSelectedScene(state);
  const surfaceBase = pathForSurface(state, surface);
  const sceneIndex = scene ? state.scenes.findIndex((item) => item.id === scene.id) : -1;
  const surfaceIndex = scene?.snapshot?.surfaces?.findIndex((item) => item.id === surface.id) ?? -1;
  const hasSceneSurface = sceneIndex >= 0 && surfaceIndex >= 0;
  const sceneSurface = hasSceneSurface ? scene.snapshot.surfaces[surfaceIndex] : null;
  const sceneBase = `scenes.${sceneIndex}.snapshot.surfaces.${surfaceIndex}`;
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${surfaceBase}.name" value="${esc(surface.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        <label class="mini-toggle">${icon("power_settings_new")}<input type="checkbox" data-update="${surfaceBase}.enabled" ${surface.enabled ? "checked" : ""} /></label>
      </div>
      <div class="setup-actions">
        <button type="button" data-reset-surface-mapping="${surface.id}">${icon("restart_alt")} Reset surface</button>
      </div>
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Scene assignment</span></div>
      ${hasSceneSurface ? `
        ${rangeTemplate("Presence", `${sceneBase}.opacity`, sceneSurface.opacity)}
        ${compositionAssignmentTemplate(`${sceneBase}.compositionId`, state.compositions, sceneSurface.compositionId)}
      ` : `<div class="soft-note">Capture a scene to store composition assignments for this surface.</div>`}
    </article>
  `;
}

function sceneRailConfigTemplate(state) {
  const scene = getSelectedScene(state);
  if (!scene) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
        ${emptyNote("Capture a scene to edit scene settings.")}
      </div>
    `;
  }
  const base = pathForScene(state, scene);
  return `
    <div class="rail-section">
      <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scene</span></div>
      <label class="field">Name <input type="text" data-update="${base}.name" value="${esc(scene.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" /></label>
    </div>
  `;
}

function panelTemplate(iconName, title, body) {
  return `
    <section class="glass-panel focus-panel">
      <header class="panel-title">
        <span class="material-symbols-rounded">${iconName}</span>
        <span>${esc(title)}</span>
      </header>
      ${body}
    </section>
  `;
}

function compositionChainTemplate(composition, ownerPath) {
  return `
    <div class="chain-column">
      <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Chain</span></div>
      ${shaderChainTemplate(composition.shaderChain, "composition", composition.id, ownerPath)}
      <details class="chain-add">
        <summary>${icon("add")} Add effect</summary>
        <div class="effect-palette">
          ${listShaderComponents().map((shader) => `
            <button type="button" data-add-shader="${shader.id}" data-target="composition" data-target-id="${composition.id}" title="${esc(shader.name)}">
              ${icon(effectIcon(shader.id))}
              <span>${esc(shader.name)}</span>
            </button>
          `).join("")}
        </div>
      </details>
    </div>
  `;
}

function shaderChainTemplate(chain, target, targetId, ownerPath, chainKey = "shaderChain") {
  if (!chain?.length) return `<div class="soft-note">No effects on this ${target}</div>`;
  return `
    <div class="chain-list">
      ${chain.map((pass, index) => `
        <div class="chain-pass">
          <label>${icon(effectIcon(pass.id))}<input type="checkbox" data-update="${ownerPath}.${chainKey}.${index}.enabled" ${pass.enabled ? "checked" : ""} />${esc(pass.id)}</label>
          <input type="range" min="0" max="1" step="0.01" data-update="${ownerPath}.${chainKey}.${index}.amount" value="${pass.amount}" />
          <button type="button" data-remove-pass data-target="${target}" data-target-id="${targetId}" data-pass-index="${index}" title="Remove effect" aria-label="Remove effect">${icon("close")}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function projectEmptyTemplate() {
  return `
    <div class="project-empty">
      <span class="material-symbols-rounded">folder_open</span>
      <h2>Open a folder to begin</h2>
      <p>Your folder becomes the show: media, shaders, scenes, mappings, and project settings live together.</p>
      <div class="button-row">
        <button type="button" class="primary" data-open-folder>${icon("folder_open")} Open folder</button>
        <button type="button" data-import-files>${icon("upload_file")} Import files</button>
      </div>
    </div>
  `;
}

function mediaPickerTemplate(state, picker, mediaLibrary, urlCache) {
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel media-modal" role="dialog" aria-modal="true" aria-label="Choose media">
      <header class="modal-header">
        <div>
          <strong>Choose media</strong>
          <small>${state.media.length} file${state.media.length === 1 ? "" : "s"}</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <div class="media-picker-grid">
        ${state.media.length ? state.media.map((item) => mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache)).join("") : `
          <div class="soft-note">Drop image or video files into the browser, or add them to the project folder.</div>
        `}
      </div>
    </section>
  `;
}

function mediaPickerCardTemplate(item, picker, state, mediaLibrary, urlCache) {
  const selected = item.id === currentMediaValue(picker, state);
  const imageUrl = item.type === "image" ? mediaPreviewUrl(item.id, mediaLibrary, urlCache) : "";
  return `
    <button type="button" class="media-picker-card ${selected ? "is-selected" : ""}" data-pick-media="${esc(item.id)}" title="${esc(item.path || item.name)}">
      ${imageUrl
        ? `<img src="${esc(imageUrl)}" alt="" loading="lazy" />`
        : `<div class="media-picker-placeholder">${icon(item.type === "video" ? "movie" : "image")}</div>`}
      <span>${esc(item.name)}</span>
      <small>${esc(item.type)}</small>
    </button>
  `;
}

function currentMediaValue(picker, state) {
  if (!picker?.path || !state) return "";
  const parts = picker.path.split(".");
  let cursor = state;
  for (const part of parts) {
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
  }
  return typeof cursor === "string" ? cursor : "";
}

function mediaPreviewUrl(id, mediaLibrary, urlCache) {
  if (urlCache.has(id)) return urlCache.get(id);
  const file = mediaLibrary.getFile(id);
  if (!file) return "";
  const url = URL.createObjectURL(file);
  urlCache.set(id, url);
  return url;
}

function scenePillTemplate(scene, state) {
  const selected = state.ui.selectedSceneId === scene.id;
  const compositions = sceneFingerprintCompositions(scene, state);
  return `
    <div class="composition-card-row">
      <button type="button" class="composition-card scene-card ${selected ? "is-selected" : ""}" data-select-scene="${esc(scene.id)}">
        ${sceneFingerprintTemplate(compositions)}
        <span>${esc(scene.name)}</span>
      </button>
      <button type="button" class="composition-card-remove" data-delete-scene="${esc(scene.id)}" title="Remove" aria-label="Remove ${esc(scene.name)}">${icon("close")}</button>
    </div>
  `;
}

function liveScenePillTemplate(scene, state) {
  const selected = liveSelectedSceneId(state) === scene.id;
  const compositions = sceneFingerprintCompositions(scene, state);
  return `
    <button type="button" class="composition-card scene-card live-scene-card ${selected ? "is-selected" : ""}" data-live-scene="${esc(scene.id)}">
      ${sceneFingerprintTemplate(compositions)}
      <span>${esc(scene.name)}</span>
    </button>
  `;
}

function liveInspectorTemplate(state) {
  const scene = getLiveSelectedScene(state);
  if (!scene) return emptyNote("No scenes");
  const compositions = liveSceneCompositions(scene, state);
  return `
    <div class="live-panel">
      <div class="live-scene-name">${esc(scene.name)}</div>
      <div class="live-composition-list">
        ${compositions.map((composition) => liveCompositionTemplate(composition, state)).join("") || emptyNote("No compositions")}
      </div>
    </div>
  `;
}

function liveCompositionTemplate(composition, state) {
  const view = createLiveCompositionView(composition, state);
  return `
    <article class="live-composition-card">
      <header class="live-composition-head">
        ${composition.thumbnail
          ? `<img src="${esc(composition.thumbnail)}" alt="" loading="lazy" />`
          : `<div class="composition-card-empty">${icon("account_tree")}</div>`}
        <strong>${esc(composition.name)}</strong>
      </header>
      ${liveRangeTemplate("Presence", composition.id, "opacity", view.opacity)}
      <div class="field-pair live-field-pair">
        <label class="field">Blend ${liveSelectValuesTemplate(composition.id, "blend", BLEND_MODES, view.blend)}</label>
        <label class="field">Speed <input type="number" min="0" step="0.05" data-live-composition-id="${esc(composition.id)}" data-live-update="speed" value="${view.speed}" /></label>
      </div>
      ${liveShaderChainTemplate(view.shaderChain, composition.id)}
    </article>
  `;
}

function liveShaderChainTemplate(chain, compositionId) {
  if (!chain?.length) return "";
  return `
    <div class="live-chain-list">
      ${chain.map((pass, index) => `
        <div class="live-chain-pass">
          <label>${icon(effectIcon(pass.id))}<input type="checkbox" data-live-composition-id="${esc(compositionId)}" data-live-update="shaderChain.${index}.enabled" ${pass.enabled ? "checked" : ""} />${esc(pass.id)}</label>
          <input type="range" min="0" max="1" step="0.01" data-live-composition-id="${esc(compositionId)}" data-live-update="shaderChain.${index}.amount" value="${pass.amount}" />
        </div>
      `).join("")}
    </div>
  `;
}

function liveRangeTemplate(label, compositionId, path, value) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="0" max="1" step="0.01" data-live-composition-id="${esc(compositionId)}" data-live-update="${path}" value="${value}" />
    </label>
  `;
}

function liveSelectValuesTemplate(compositionId, path, values, value) {
  return `
    <select data-live-composition-id="${esc(compositionId)}" data-live-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function sceneFingerprintCompositions(scene, state) {
  const ids = [];
  for (const surface of scene.snapshot?.surfaces || []) {
    if (surface.compositionId && !ids.includes(surface.compositionId)) ids.push(surface.compositionId);
  }
  return ids
    .map((id) => state.compositions.find((composition) => composition.id === id))
    .filter(Boolean);
}

function sceneFingerprintTemplate(compositions) {
  if (!compositions.length) return `<div class="composition-card-empty">${icon("auto_awesome_motion")}</div>`;
  const withThumbs = compositions.filter((composition) => composition.thumbnail);
  if (!withThumbs.length) return `<div class="composition-card-empty">${icon("auto_awesome_motion")}</div>`;
  return `
    <div class="scene-fingerprint">
      ${withThumbs.slice(0, 5).map((composition, index) => `
        <img
          src="${esc(composition.thumbnail)}"
          alt=""
          loading="lazy"
          style="--fingerprint-index: ${index}; --fingerprint-count: ${withThumbs.length};"
        />
      `).join("")}
    </div>
  `;
}

function syncSelectedSceneSnapshot(state) {
  const scene = state.scenes.find((item) => item.id === state.ui.selectedSceneId);
  if (!scene) return;
  scene.snapshot = createSceneSnapshot(state);
}

function applySelectedSceneSnapshot(state) {
  const scene = getSelectedScene(state);
  if (scene) applySceneSnapshotToState(state, scene);
}

function getSelectedScene(state) {
  return state.scenes.find((scene) => scene.id === state.ui.selectedSceneId) || null;
}

function getLiveSelectedScene(state) {
  const id = liveSelectedSceneId(state);
  return state.scenes.find((scene) => scene.id === id) || null;
}

function liveSelectedSceneId(state) {
  return state.ui?.live?.selectedSceneId || state.scenes[0]?.id || "";
}

function liveSceneCompositions(scene, state) {
  return sceneFingerprintCompositions(scene, state);
}

function sceneSurfaceSnapshot(scene, surfaceId) {
  return scene?.snapshot?.surfaces?.find((surface) => surface.id === surfaceId) || null;
}

function getSceneSurfaceView(surface, state) {
  const snapshot = sceneSurfaceSnapshot(getSelectedScene(state), surface.id);
  return snapshot ? { ...surface, ...snapshot } : surface;
}

function currentWorkspace(state) {
  return ["compose", "scene", "live"].includes(state.ui?.workspace) ? state.ui.workspace : "scene";
}

function sourceTypeIcon(type) {
  if (type === "media") return "perm_media";
  if (type === "camera") return "photo_camera";
  if (type === "black") return "brightness_1";
  return "auto_awesome";
}

function activeRenderCost(state) {
  const previewCost = Number(state.metrics.previewRenderCost);
  if (state.ui?.debugPreview && Number.isFinite(previewCost)) return previewCost;
  const outputCost = Number(state.metrics.renderCost);
  return Number.isFinite(outputCost) ? outputCost : 0;
}

function formatRenderCost(cost) {
  const percent = Math.max(0, Math.min(999, Number(cost) * 100 || 0));
  return `${percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function rangeTemplate(label, path, value) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="0" max="1" step="0.01" data-update="${path}" value="${value}" />
    </label>
  `;
}

function selectValuesTemplate(path, values, value) {
  return `
    <select data-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function compositionAssignmentTemplate(path, compositions, value) {
  return `
    <div class="field composition-assignment-field">
      <span>Composition</span>
      <div class="composition-card-list assignment-card-list">
        ${compositions.map((composition) => {
          const selected = composition.id === value;
          return `
            <button type="button" class="composition-card assignment-card ${selected ? "is-selected" : ""}" data-set-composition="${esc(composition.id)}" data-composition-path="${esc(path)}">
              ${composition.thumbnail
                ? `<img src="${esc(composition.thumbnail)}" alt="" loading="lazy" />`
                : `<div class="composition-card-empty">${icon("account_tree")}</div>`}
              <span>${esc(composition.name)}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
    if (!cursor) return;
  }
  const last = parts[parts.length - 1];
  cursor[Number.isNaN(Number(last)) ? last : Number(last)] = value;
}

function setByPathCreate(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = Number.isNaN(Number(parts[i])) ? parts[i] : Number(parts[i]);
    const nextPart = parts[i + 1];
    if (cursor[part] === undefined) cursor[part] = Number.isNaN(Number(nextPart)) ? {} : [];
    cursor = cursor[part];
  }
  const last = parts[parts.length - 1];
  cursor[Number.isNaN(Number(last)) ? last : Number(last)] = value;
}

function readInputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "range" || input.type === "number") return Number(input.value);
  return input.value;
}

function updateRangeLabel(input) {
  const label = input.closest(".range-field");
  const value = label?.querySelector("strong");
  if (value) value.textContent = Number(input.value).toFixed(2);
}

function pathForSurface(state, surface) {
  return `surfaces.${state.surfaces.findIndex((item) => item.id === surface.id)}`;
}

function pathForScene(state, scene) {
  return `scenes.${state.scenes.findIndex((item) => item.id === scene.id)}`;
}

function pathForComposition(state, composition) {
  return `compositions.${state.compositions.findIndex((item) => item.id === composition.id)}`;
}

function emptyNote(text) {
  return `<div class="soft-note">${esc(text)}</div>`;
}

function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

function setText(node, text) {
  const next = String(text ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function setHTML(node, html) {
  const next = String(html ?? "");
  if (node && node.innerHTML !== next) node.innerHTML = next;
}

function setClass(node, className, on) {
  if (!node) return;
  const hasClass = node.classList.contains(className);
  if (on && !hasClass) node.classList.add(className);
  if (!on && hasClass) node.classList.remove(className);
}

function isInteractiveNode(node) {
  return !!node?.closest?.("input, select, textarea, button, label, [contenteditable='true'], [data-update], [data-action]");
}

function isTextEditingNode(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(node.type);
}

function effectIcon(id) {
  return {
    ripple: "water",
    rgbSplit: "gradient",
    kaleido: "filter_vintage",
    pixelate: "grid_view",
    plasma: "blur_on",
    lumaKey: "tonality",
    custom: "data_object",
  }[id] || "auto_awesome";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
