import { createOutputDefinition, normalizeRenderSettings } from "../domain/render-settings.js?v=max-frame-rate-1";
import { sortComponentCatalog } from "./catalog-view.js?v=changed-sort-user-truth-1";
import { setClass, setText } from "./dom-utils.js?v=preview-pointer-deferral-1";
import { getByPath, readInputValue, setByPath, syncRangeValue } from "./path-input-utils.js?v=path-input-utils-extraction-1";
import { elementMediaCategory, elementPickerTemplate, mediaPickerTemplate, sourceChoicePickerTemplate } from "./picker-view.js?v=source-picker-filters-1";
import { configuredOutputsTemplate, settingsModalTemplate } from "./settings-view.js?v=max-frame-rate-1";
import { mergeSourceChoice } from "../domain/source-choice.js?v=media-source-identity-1";

export function createModalController({
  store,
  getState,
  getHost,
  mediaLibrary,
  refreshMedia,
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
  const activeMediaPreviews = new Set();
  const visibleMediaPreviews = new WeakSet();
  const mediaPreviewActivationTokens = new WeakMap();
  const maxRetainedMediaPreviews = 500;
  let reportedPreviewObserverFallback = false;
  let mediaRefreshInFlight = false;

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
    bindElementPickerFilters(host);
    bindDemandMediaPreviews(host);
    host.querySelectorAll("[data-pick-source-media]").forEach((button) => {
      button.addEventListener("click", () => chooseSource({ type: "media", mediaId: button.dataset.pickSourceMedia || "" }));
    });
    host.querySelector("[data-pick-source-camera]")?.addEventListener("click", () => chooseSource({ type: "camera" }));
    host.querySelector("[data-pick-source-black]")?.addEventListener("click", () => chooseSource({ type: "black" }));
    host.querySelectorAll("[data-pick-source-generator]").forEach((button) => {
      button.addEventListener("click", () => chooseSource({ type: "generator", generatorId: button.dataset.pickSourceGenerator }));
    });
  }

  function chooseSource(source) {
    const target = sourceChoicePicker;
    const category = sourceChoiceCategory(source, getState());
    if (target?.allowedCategory && category !== target.allowedCategory) {
      console.error("[VJ1_SOURCE_CATEGORY_REJECTED]", {
        allowedCategory: target.allowedCategory,
        receivedCategory: category,
        source,
      });
      return;
    }
    closeSourceChoicePicker();
    setSourceChoice(source, target);
  }

  function sourceChoiceCategory(source, state) {
    if (source?.type === "media") {
      return elementMediaCategory((state.media || []).find((item) => item.id === source.mediaId) || {});
    }
    if (source?.type === "camera") return "live";
    if (source?.type === "black") return "blank";
    return source?.type || "";
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
    bindElementPickerFilters(host);
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
      button.addEventListener("click", () => addElement("source", { type: "generator", generatorId: button.dataset.addElementGenerator }));
    });
    host.querySelectorAll("[data-add-element-effect]").forEach((button) => {
      button.addEventListener("click", () => addElement("effect", button.dataset.addElementEffect));
    });
  }

  function addElement(kind, value) {
    const target = elementPicker;
    if (!target?.componentId) return;
    // Release the picker's focused search field before publishing the chain
    // mutation. Otherwise the shell's editor-deferral guard can retain the
    // new inspector state while removing the very field whose blur would
    // flush it, leaving the chain visually stale until another render/refresh.
    closeElementPicker();
    activateElementPickerTarget(target);
    if (kind === "source") store.addChainSource(target.componentId, value);
    else if (kind === "group") store.addChainGroup(target.componentId);
    else if (kind === "effect") store.addChainEffect(target.componentId, value);
  }

  function renderMediaPicker(host, state) {
    if (!replaceHtmlIfChanged(host, mediaPickerTemplate(state, mediaPicker, mediaLibrary))) return;
    bindClose(host, closeMediaPicker);
    host.querySelector("[data-refresh-media]")?.addEventListener("click", refreshMediaPicker);
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

  async function refreshMediaPicker() {
    if (mediaRefreshInFlight || typeof refreshMedia !== "function") return;
    mediaRefreshInFlight = true;
    const host = getHost();
    const button = host?.querySelector("[data-refresh-media]");
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    resetDemandMediaPreviews();
    try {
      await refreshMedia();
      render(getState());
    } catch (error) {
      console.error("[VJ1_MEDIA_REFRESH_FAILED]", {
        message: error?.message || String(error),
        fallback: "leave the Media picker open for an explicit retry",
      });
    } finally {
      mediaRefreshInFlight = false;
      const currentButton = getHost()?.querySelector("[data-refresh-media]");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.removeAttribute("aria-busy");
      }
    }
  }

  function bindDemandMediaPreviews(host) {
    resetDemandMediaPreviews();
    const previews = Array.from(host.querySelectorAll("[data-media-preview-id]"));
    if (!previews.length) return;
    for (const preview of previews) {
      const trigger = preview.closest?.("button") || preview;
      trigger.addEventListener("pointerenter", () => activateMediaPreview(preview));
      trigger.addEventListener("focus", () => activateMediaPreview(preview));
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
        if (entry.isIntersecting) {
          visibleMediaPreviews.add(entry.target);
          activateMediaPreview(entry.target);
        } else {
          visibleMediaPreviews.delete(entry.target);
        }
      }
      enforceMediaPreviewRetentionLimit();
    }, { rootMargin: "360px 0px" });
    previews.forEach((preview) => mediaPreviewObserver.observe(preview));
  }

  async function activateMediaPreview(preview) {
    if (!preview) return;
    if (preview.dataset.mediaPreviewLoaded === "true") {
      activeMediaPreviews.delete(preview);
      activeMediaPreviews.add(preview);
      return;
    }
    const mediaId = preview.dataset.mediaPreviewId || "";
    const token = Symbol(mediaId);
    mediaPreviewActivationTokens.set(preview, token);
    preview.dataset.mediaPreviewLoading = "true";
    activeMediaPreviews.add(preview);
    const url = await Promise.resolve(mediaLibrary.acquirePreviewUrl?.(mediaId) || "");
    if (mediaPreviewActivationTokens.get(preview) !== token || !preview.isConnected) return;
    delete preview.dataset.mediaPreviewLoading;
    if (!url) return;
    preview.src = url;
    preview.dataset.mediaPreviewLoaded = "true";
    activeMediaPreviews.add(preview);
    if (preview.tagName === "VIDEO") {
      preview.preload = "metadata";
      preview.load?.();
    }
    enforceMediaPreviewRetentionLimit();
  }

  function enforceMediaPreviewRetentionLimit() {
    if (activeMediaPreviews.size <= maxRetainedMediaPreviews) return;
    for (const preview of activeMediaPreviews) {
      if (activeMediaPreviews.size <= maxRetainedMediaPreviews) break;
      if (visibleMediaPreviews.has(preview)) continue;
      unloadMediaPreview(preview);
    }
  }

  function unloadMediaPreview(preview) {
    if (!preview || (preview.dataset.mediaPreviewLoaded !== "true" && preview.dataset.mediaPreviewLoading !== "true")) return;
    const mediaId = preview.dataset.mediaPreviewId || "";
    mediaPreviewActivationTokens.delete(preview);
    delete preview.dataset.mediaPreviewLoading;
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
    for (const preview of activeMediaPreviews) {
      mediaPreviewActivationTokens.delete(preview);
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
    const applyFilter = () => filterElementPicker(host, input.value || "", activeElementFilter(host));
    input.addEventListener("input", applyFilter);
    applyFilter();
  }

  function bindElementPickerFilters(host) {
    host.querySelectorAll("[data-element-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.elementFilter || "all";
        const picker = sourceChoicePicker || elementPicker;
        if (picker && !picker.allowedCategory) picker.filter = filter;
        host.querySelectorAll("[data-element-filter]").forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("is-active", active);
          candidate.setAttribute("aria-pressed", active ? "true" : "false");
        });
        filterElementPicker(host, host.querySelector("[data-element-search]")?.value || "", filter);
      });
    });
  }

  function activeElementFilter(host) {
    return host.querySelector("[data-element-filter].is-active")?.dataset.elementFilter || "all";
  }

  function filterElementPicker(host, value, filter = "all") {
    const query = normalizeSearchText(value);
    host.querySelectorAll("[data-element-search-card]").forEach((card) => {
      const haystack = normalizeSearchText(card.dataset.elementSearchCard || "");
      const category = card.dataset.elementCategory || "";
      card.classList.toggle("is-search-hidden", !!query && !haystack.includes(query));
      card.classList.toggle("is-filter-hidden", filter !== "all" && category !== filter);
    });
    host.querySelectorAll("[data-element-section]").forEach((section) => {
      const cards = Array.from(section.querySelectorAll("[data-element-search-card]"));
      const visibleCount = cards.filter((card) => (
        !card.classList.contains("is-search-hidden") && !card.classList.contains("is-filter-hidden")
      )).length;
      const empty = section.querySelector("[data-element-empty]");
      const sectionHidden = visibleCount <= 0;
      section.hidden = sectionHidden;
      section.classList.toggle("is-search-hidden", sectionHidden);
      if (empty) empty.hidden = true;
    });
    const sections = Array.from(host.querySelectorAll("[data-element-section]"));
    const hasVisibleSection = sections.some((section) => !section.hidden);
    const noResults = host.querySelector("[data-element-no-results]");
    if (noResults) noResults.hidden = hasVisibleSection || (!query && filter === "all");
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
    elementPicker = { componentId, selectedChainItemId, filter: "all" };
    focusElementPickerSearch = true;
    mediaPicker = null;
    sourceChoicePicker = null;
    settingsOpen = false;
    render();
  }

  function activateElementPickerTarget(target = elementPicker) {
    if (target?.selectedChainItemId) store.selectChainItem(target.selectedChainItemId);
  }

  function closeElementPicker() {
    elementPicker = null;
    resetDemandMediaPreviews();
    render();
  }

  function openSourceChoicePicker(path, allowedCategory = "") {
    sourceChoicePicker = { path, allowedCategory, filter: allowedCategory || "all" };
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

  function setSourceChoice(source, target = sourceChoicePicker) {
    if (!target?.path) return;
    store.update((draft) => {
      const previous = getByPath(draft, target.path) || {};
      setByPath(draft, target.path, mergeSourceChoice(previous, source));
    }, `update:${target.path}`);
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
