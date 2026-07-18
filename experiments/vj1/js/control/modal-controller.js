import { createOutputDefinition, normalizeRenderSettings } from "../domain/models.js?v=render-coordinate-scope-3";
import { sortComponentCatalog } from "./catalog-view.js?v=catalog-view-extraction-1";
import { setClass, setText } from "./dom-utils.js?v=preview-pointer-deferral-1";
import { getByPath, readInputValue, setByPath, syncRangeValue } from "./path-input-utils.js?v=path-input-utils-extraction-1";
import { elementPickerTemplate, mediaPickerTemplate, sourceChoicePickerTemplate } from "./picker-view.js?v=media-demand-6";
import { configuredOutputsTemplate, settingsModalTemplate } from "./settings-view.js?v=editable-titles-71";

export function createModalController({
  store,
  getState,
  getHost,
  mediaLibrary,
  replaceHtmlIfChanged,
  getCatalogSortMode,
  bindCatalogSortControls,
}) {
  let mediaPicker = null;
  let elementPicker = null;
  let sourceChoicePicker = null;
  let focusElementPickerSearch = false;
  let settingsOpen = false;
  let settingsTab = "outputs";
  let mediaPreviewObserver = null;
  const mediaPreviewUnloadTimers = new Map();
  const activeMediaPreviews = new Set();
  let reportedPreviewObserverFallback = false;

  function render(state = getState()) {
    const host = getHost();
    if (!host) return;
    if (!mediaPicker && !elementPicker && !sourceChoicePicker && !settingsOpen) {
      resetDemandMediaPreviews();
      replaceHtmlIfChanged(host, "");
      return;
    }
    if (settingsOpen) {
      renderSettings(host, state);
      return;
    }
    if (sourceChoicePicker) {
      renderSourceChoicePicker(host, state);
      return;
    }
    if (elementPicker) {
      renderElementPicker(host, state);
      return;
    }
    renderMediaPicker(host, state);
  }

  function renderSettings(host, state) {
    resetDemandMediaPreviews();
    if (!host.querySelector("[data-settings-modal]")) {
      replaceHtmlIfChanged(host, settingsModalTemplate(state, settingsTab));
      bindClose(host, closeSettings);
      host.querySelectorAll("[data-settings-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          settingsTab = button.dataset.settingsTab || "outputs";
          applySettingsTab(host);
        });
      });
    }
    syncSettingsModal(host, state);
    bindSettingsModalControls(host);
  }

  function renderSourceChoicePicker(host, state) {
    if (!replaceHtmlIfChanged(host, sourceChoicePickerTemplate(state, sourceChoicePicker, mediaLibrary))) return;
    bindClose(host, closeSourceChoicePicker);
    bindElementPickerSearch(host);
    bindDemandMediaPreviews(host);
    host.querySelectorAll("[data-pick-source-media]").forEach((button) => {
      button.addEventListener("click", () => chooseSource({ type: "media", mediaId: button.dataset.pickSourceMedia || "" }));
    });
    host.querySelector("[data-pick-source-camera]")?.addEventListener("click", () => chooseSource({ type: "camera" }));
    host.querySelector("[data-pick-source-black]")?.addEventListener("click", () => chooseSource({ type: "black" }));
    host.querySelectorAll("[data-pick-source-generator]").forEach((button) => {
      button.addEventListener("click", () => chooseSource({ type: "generator", generatorId: button.dataset.pickSourceGenerator || "testPattern" }));
    });
  }

  function chooseSource(source) {
    setSourceChoice(source);
    closeSourceChoicePicker();
  }

  function renderElementPicker(host, state) {
    const sortMode = getCatalogSortMode(state);
    const components = sortComponentCatalog(state.components || [], sortMode);
    if (!replaceHtmlIfChanged(host, elementPickerTemplate(state, elementPicker, mediaLibrary, {
      components,
      sortMode,
    }))) return;
    bindClose(host, closeElementPicker);
    bindElementPickerSearch(host);
    bindCatalogSortControls(host);
    focusPendingElementPickerSearch(host);
    bindDemandMediaPreviews(host);
    host.querySelectorAll("[data-add-element-media]").forEach((button) => {
      button.addEventListener("click", () => addElement("source", { type: "media", mediaId: button.dataset.addElementMedia || "" }));
    });
    host.querySelectorAll("[data-add-element-component]").forEach((button) => {
      button.addEventListener("click", () => addElement("source", { type: "component", componentId: button.dataset.addElementComponent || "" }));
    });
    host.querySelector("[data-add-element-camera]")?.addEventListener("click", () => addElement("source", { type: "camera" }));
    host.querySelector("[data-add-element-group]")?.addEventListener("click", () => addElement("group"));
    host.querySelectorAll("[data-add-element-generator]").forEach((button) => {
      button.addEventListener("click", () => addElement("source", { type: "generator", generatorId: button.dataset.addElementGenerator || "testPattern" }));
    });
    host.querySelectorAll("[data-add-element-effect]").forEach((button) => {
      button.addEventListener("click", () => addElement("effect", button.dataset.addElementEffect));
    });
  }

  function addElement(kind, value) {
    activateElementPickerTarget();
    if (kind === "source") store.addChainSource(elementPicker.componentId, value);
    else if (kind === "group") store.addChainGroup(elementPicker.componentId);
    else if (kind === "effect") store.addChainEffect(elementPicker.componentId, value);
    closeElementPicker();
  }

  function renderMediaPicker(host, state) {
    if (!replaceHtmlIfChanged(host, mediaPickerTemplate(state, mediaPicker, mediaLibrary))) return;
    bindClose(host, closeMediaPicker);
    bindDemandMediaPreviews(host);
    host.querySelectorAll("[data-pick-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const mediaId = button.dataset.pickMedia || "";
        store.update((draft) => {
          setByPath(draft, mediaPicker.path, mediaId);
          if (/\.mediaId$/.test(mediaPicker.path)) {
            const sourcePath = mediaPicker.path.replace(/\.mediaId$/, "");
            setByPath(draft, `${sourcePath}.type`, "media");
          }
        }, `update:${mediaPicker.path}`);
        closeMediaPicker();
      });
    });
  }

  function bindDemandMediaPreviews(host) {
    resetDemandMediaPreviews();
    const previews = Array.from(host.querySelectorAll("[data-media-preview-id]"));
    if (!previews.length) return;
    for (const preview of previews) {
      const trigger = preview.closest?.("button") || preview;
      trigger.addEventListener("pointerenter", () => activateMediaPreview(preview));
      trigger.addEventListener("focus", () => activateMediaPreview(preview));
      trigger.addEventListener("pointerleave", () => scheduleMediaPreviewUnload(preview));
    }
    if (typeof IntersectionObserver !== "function") {
      previews.slice(0, 24).forEach(activateMediaPreview);
      if (!reportedPreviewObserverFallback) {
        reportedPreviewObserverFallback = true;
        console.warn("[VJ1_MEDIA_PREVIEW_OBSERVER_UNAVAILABLE]", {
          eagerLimit: 24,
          message: "Viewport observation is unavailable; only the first preview batch and hovered items are loaded",
        });
      }
      return;
    }
    mediaPreviewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activateMediaPreview(entry.target);
        else scheduleMediaPreviewUnload(entry.target);
      }
    }, { rootMargin: "360px 0px" });
    previews.forEach((preview) => mediaPreviewObserver.observe(preview));
  }

  function activateMediaPreview(preview) {
    clearMediaPreviewUnload(preview);
    if (!preview || preview.dataset.mediaPreviewLoaded === "true") return;
    const mediaId = preview.dataset.mediaPreviewId || "";
    const url = mediaLibrary.acquirePreviewUrl?.(mediaId) || "";
    if (!url) return;
    preview.src = url;
    preview.dataset.mediaPreviewLoaded = "true";
    activeMediaPreviews.add(preview);
    if (preview.tagName === "VIDEO") {
      preview.preload = "metadata";
      preview.load?.();
    }
  }

  function scheduleMediaPreviewUnload(preview) {
    if (!preview || preview.dataset.mediaPreviewLoaded !== "true" || mediaPreviewUnloadTimers.has(preview)) return;
    const timeout = setTimeout(() => unloadMediaPreview(preview), 3000);
    mediaPreviewUnloadTimers.set(preview, timeout);
  }

  function clearMediaPreviewUnload(preview) {
    const timeout = mediaPreviewUnloadTimers.get(preview);
    if (timeout !== undefined) clearTimeout(timeout);
    mediaPreviewUnloadTimers.delete(preview);
  }

  function unloadMediaPreview(preview) {
    clearMediaPreviewUnload(preview);
    if (!preview || preview.dataset.mediaPreviewLoaded !== "true") return;
    const mediaId = preview.dataset.mediaPreviewId || "";
    preview.pause?.();
    preview.removeAttribute("src");
    if (preview.tagName === "VIDEO") {
      preview.preload = "none";
      preview.load?.();
    }
    delete preview.dataset.mediaPreviewLoaded;
    activeMediaPreviews.delete(preview);
    mediaLibrary.releasePreviewUrl?.(mediaId);
  }

  function resetDemandMediaPreviews() {
    mediaPreviewObserver?.disconnect?.();
    mediaPreviewObserver = null;
    for (const timeout of mediaPreviewUnloadTimers.values()) clearTimeout(timeout);
    mediaPreviewUnloadTimers.clear();
    for (const preview of activeMediaPreviews) {
      preview.pause?.();
      preview.removeAttribute?.("src");
      if (preview.tagName === "VIDEO") {
        preview.preload = "none";
        preview.load?.();
      }
      if (preview.dataset) delete preview.dataset.mediaPreviewLoaded;
    }
    activeMediaPreviews.clear();
    mediaLibrary.releasePreviewUrls?.();
  }

  function bindClose(host, close) {
    host.querySelector("[data-close-modal]")?.addEventListener("click", close);
    host.querySelector(".modal-backdrop")?.addEventListener("click", close);
  }

  function bindSettingsModalControls(host) {
    host.querySelectorAll("[data-settings-update]").forEach((input) => {
      if (input.dataset.settingsBound) return;
      input.dataset.settingsBound = "true";
      input.addEventListener("input", () => {
        syncRangeValue(input);
        updateRenderSetting(input, `scrub:${input.dataset.settingsUpdate}`);
      });
      input.addEventListener("change", () => {
        syncRangeValue(input);
        updateRenderSetting(input, `update:${input.dataset.settingsUpdate}`);
      });
    });
    bindOnce(host, "[data-render-preset]", (button) => applyRenderPreset(button.dataset.renderPreset));
    bindOnce(host, "[data-camera-preset]", (button) => applyCameraPreset(button.dataset.cameraPreset));
    bindOnce(host, "[data-add-output]", addConfiguredOutput);
    bindOnce(host, "[data-remove-output]", (button) => removeConfiguredOutput(button.dataset.removeOutput));
  }

  function bindOnce(host, selector, listener) {
    host.querySelectorAll(selector).forEach((element) => {
      if (element.dataset.settingsBound) return;
      element.dataset.settingsBound = "true";
      element.addEventListener("click", () => listener(element));
    });
  }

  function syncSettingsModal(host, state) {
    const modal = host.querySelector("[data-settings-modal]");
    if (!modal) return;
    const renderSettings = normalizeRenderSettings(state.render || {});
    const outputList = modal.querySelector("[data-configured-output-list]");
    const outputSignature = renderSettings.outputs.map((output) => output.id).join("|");
    if (outputList && outputList.dataset.outputSignature !== outputSignature) {
      outputList.innerHTML = configuredOutputsTemplate(renderSettings);
      outputList.dataset.outputSignature = outputSignature;
    }
    const normalizedState = { ...state, render: renderSettings };
    modal.querySelectorAll("[data-settings-update]").forEach((input) => {
      if (input === document.activeElement) return;
      const value = getByPath(normalizedState, input.dataset.settingsUpdate);
      if (input.type === "checkbox") input.checked = value === true;
      else if (value !== undefined && input.value !== String(value)) input.value = String(value);
    });
    setText(modal.querySelector("[data-upscaling-amount-label]"), `${Math.round(renderSettings.upscaling.amount * 100)}%`);
    setText(modal.querySelector("[data-grayscale-amount-label]"), `${Math.round(renderSettings.postProcessing.grayscaleAmount * 100)}%`);
    setText(modal.querySelector("[data-noise-amount-label]"), `${Math.round(renderSettings.postProcessing.noiseAmount * 1000) / 10}%`);
    const manualSurfaceTexture = renderSettings.surfaceTexture.mode === "manual";
    modal.querySelectorAll("[data-manual-surface-texture]").forEach((element) => {
      element.hidden = !manualSurfaceTexture;
      element.querySelectorAll("input").forEach((input) => { input.disabled = !manualSurfaceTexture; });
    });
    applySettingsTab(host);
  }

  function applySettingsTab(host) {
    host.querySelectorAll("[data-settings-tab]").forEach((button) => {
      const active = button.dataset.settingsTab === settingsTab;
      setClass(button, "is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    host.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== settingsTab;
    });
  }

  function bindElementPickerSearch(host) {
    const input = host.querySelector("[data-element-search]");
    if (!input) return;
    const applyFilter = () => filterElementPicker(host, input.value || "");
    input.addEventListener("input", applyFilter);
    applyFilter();
  }

  function filterElementPicker(host, value) {
    const query = normalizeSearchText(value);
    host.querySelectorAll("[data-element-search-card]").forEach((card) => {
      const haystack = normalizeSearchText(card.dataset.elementSearchCard || "");
      card.classList.toggle("is-search-hidden", !!query && !haystack.includes(query));
    });
    host.querySelectorAll("[data-element-section]").forEach((section) => {
      const cards = Array.from(section.querySelectorAll("[data-element-search-card]"));
      const visibleCount = cards.filter((card) => !card.classList.contains("is-search-hidden")).length;
      const empty = section.querySelector("[data-element-empty]");
      const sectionHidden = visibleCount <= 0;
      section.hidden = sectionHidden;
      section.classList.toggle("is-search-hidden", sectionHidden);
      if (empty) empty.hidden = true;
    });
    const sections = Array.from(host.querySelectorAll("[data-element-section]"));
    const hasVisibleSection = sections.some((section) => !section.hidden);
    const noResults = host.querySelector("[data-element-no-results]");
    if (noResults) noResults.hidden = hasVisibleSection || !query;
  }

  function focusPendingElementPickerSearch(host) {
    if (!focusElementPickerSearch) return;
    focusElementPickerSearch = false;
    requestAnimationFrame(() => {
      const input = host.querySelector("[data-element-search]");
      if (input && document.activeElement !== input) input.focus({ preventScroll: true });
    });
  }

  function openSettings() {
    resetDemandMediaPreviews();
    settingsOpen = true;
    mediaPicker = null;
    elementPicker = null;
    sourceChoicePicker = null;
    render();
  }

  function openMediaPicker(path, accept = "") {
    mediaPicker = { path, accept };
    elementPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    render();
  }

  function closeMediaPicker() {
    mediaPicker = null;
    resetDemandMediaPreviews();
    render();
  }

  function openElementPicker(componentId, selectedChainItemId = "") {
    elementPicker = { componentId, selectedChainItemId };
    focusElementPickerSearch = true;
    mediaPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    render();
  }

  function activateElementPickerTarget() {
    if (elementPicker?.selectedChainItemId) store.selectChainItem(elementPicker.selectedChainItemId);
  }

  function closeElementPicker() {
    elementPicker = null;
    resetDemandMediaPreviews();
    render();
  }

  function openSourceChoicePicker(path) {
    sourceChoicePicker = { path };
    mediaPicker = null;
    elementPicker = null;
    settingsOpen = false;
    render();
  }

  function closeSourceChoicePicker() {
    sourceChoicePicker = null;
    resetDemandMediaPreviews();
    render();
  }

  function setSourceChoice(source) {
    if (!sourceChoicePicker?.path) return;
    store.update((draft) => {
      const previous = getByPath(draft, sourceChoicePicker.path) || {};
      const next = { ...source };
      if (next.type === "generator" && previous.type === "generator" && previous.generatorId === next.generatorId && previous.params) next.params = previous.params;
      if (next.type === "media" && previous.type === "media" && previous.mediaId === next.mediaId) {
        next.start = previous.start;
        next.end = previous.end;
        next.speed = previous.speed;
      }
      setByPath(draft, sourceChoicePicker.path, next);
    }, `update:${sourceChoicePicker.path}`);
  }

  function closeSettings() {
    settingsOpen = false;
    render();
  }

  function updateRenderSetting(input, reason) {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      setByPath(draft, input.dataset.settingsUpdate, readInputValue(input));
      draft.render = normalizeRenderSettings(draft.render);
      scaleMappingForRenderChange(draft, previousRender, draft.render);
    }, reason);
    syncSettingsModal(getHost(), store.getState());
  }

  function applyRenderPreset(preset) {
    const presets = {
      wide: [960, 540], xga: [1024, 768], wxga: [1280, 800], hd: [1280, 720],
      fhd: [1920, 1080], wuxga: [1920, 1200], "2k": [2048, 1080], "4k": [3840, 2160],
    };
    const [frameWidth, frameHeight] = presets[preset] || presets.wide;
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      draft.render = normalizeRenderSettings({
        ...draft.render,
        outputs: (draft.render.outputs || []).map((output, index) => index === 0 ? { ...output, width: frameWidth, height: frameHeight } : output),
      });
      scaleMappingForRenderChange(draft, previousRender, draft.render);
    }, "render-preset");
  }

  function addConfiguredOutput() {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      const output = createOutputDefinition(previousRender.outputs.length, previousRender.frameWidth, previousRender.frameHeight);
      if (previousRender.outputs.some((item) => item.id === output.id)) output.id = `output-${Date.now().toString(36)}`;
      draft.render = normalizeRenderSettings({ ...previousRender, outputs: [...previousRender.outputs, output] });
    }, "add-output");
  }

  function applyCameraPreset(preset) {
    const size = { sd: [640, 480], hd: [1280, 720], fhd: [1920, 1080], "4k": [3840, 2160] }[preset];
    if (!size) return;
    store.update((draft) => {
      draft.render = normalizeRenderSettings({
        ...draft.render,
        camera: { ...draft.render?.camera, width: size[0], height: size[1], maxResolution: false },
      });
    }, "camera-preset");
  }

  function removeConfiguredOutput(outputId) {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      if (previousRender.outputs.length <= 1) return;
      draft.render = normalizeRenderSettings({
        ...previousRender,
        outputs: previousRender.outputs.filter((output) => output.id !== outputId),
      });
    }, "remove-output");
  }

  return { render, openSettings, openMediaPicker, openElementPicker, openSourceChoicePicker };
}

export function scaleMappingForRenderChange(draft, previousRender, nextRender) {
  const previous = normalizeRenderSettings(previousRender);
  const next = normalizeRenderSettings(nextRender);
  const scaleX = next.worldWidth / Math.max(1, previous.worldWidth);
  const scaleY = next.worldHeight / Math.max(1, previous.worldHeight);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return;
  if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) return;
  const mapping = draft.mappings?.local;
  if (!Array.isArray(mapping?.surfaces)) return;
  for (const mappedSurface of mapping.surfaces) {
    if (!Array.isArray(mappedSurface.corners)) continue;
    mappedSurface.corners = mappedSurface.corners.map((corner) => ({
      x: Math.round((Number(corner.x) || 0) * scaleX * 1000) / 1000,
      y: Math.round((Number(corner.y) || 0) * scaleY * 1000) / 1000,
    }));
  }
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}
