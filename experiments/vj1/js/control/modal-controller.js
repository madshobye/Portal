import { createOutputDefinition, normalizeRenderSettings } from "../domain/render-settings.js?v=screen-input-registry-1";
import { sortComponentCatalog } from "./catalog-view.js?v=catalog-tools-row-1";
import { setClass, setText } from "./dom-utils.js?v=scroll-region-1";
import { getByPath, readInputValue, setByPath, syncRangeValue } from "./path-input-utils.js?v=path-input-utils-extraction-1";
import { elementMediaCategory, elementPickerTemplate, sourceChoicePickerTemplate } from "./picker-view.js?v=scroll-region-1";
import { configuredOutputsTemplate, screenCaptureInputsTemplate, screenCaptureSignature, settingsModalTemplate } from "./settings-view.js?v=screen-input-registry-1";
import { mergeSourceChoice } from "../domain/source-choice.js?v=media-source-identity-1";
import { renameScreenCaptureInput, screenCaptureStatus, startScreenCapture, stopScreenCapture, stopScreenCaptureInput, subscribeScreenCapture } from "../output/screen-capture-service.js?v=screen-input-registry-1";
import { screenInputOptionsTemplate } from "./parameter-view.js?v=screen-input-registry-1";

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
  subscribeScreenCapture((status) => {
    syncScreenCaptureStatus(getHost(), status);
    syncScreenInputSelects(status.inputs);
  });

  function render(state = getState()) {
    const host = getHost();
    if (!host) return;
    if (!elementPicker && !sourceChoicePicker && !settingsOpen) {
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
    resetDemandMediaPreviews();
    replaceHtmlIfChanged(host, "");
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
    bindCatalogSortControls(host);
    bindCatalogMarkerControls(host);
    host.querySelector("[data-refresh-media]")?.addEventListener("click", refreshMediaPicker);
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
    if (target?.valueMode === "mediaId") setMediaValue(source.mediaId || "", target);
    else setSourceChoice(source, target);
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
    bindCatalogMarkerControls(host);
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

  function bindCatalogMarkerControls(host) {
    host.querySelectorAll("[data-cycle-catalog-marker]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        store.cycleCatalogMarker?.(
          button.dataset.cycleCatalogMarker || "",
          button.dataset.catalogMarkerId || "",
        );
      });
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
    bindOnce(host, "[data-start-screen-capture]", startConfiguredScreenCapture);
    bindOnce(host, "[data-stop-screen-capture]", () => stopScreenCapture());
    bindScreenCaptureInputs(host);
    bindOnce(host, "[data-add-output]", addConfiguredOutput);
    bindOnce(host, "[data-remove-output]", (button) => removeConfiguredOutput(button.dataset.removeOutput));
  }

  async function startConfiguredScreenCapture() {
    const settings = normalizeRenderSettings(getState().render || {}).screenCapture;
    try {
      await startScreenCapture(settings);
    } catch {
      // The shared service reports the actionable browser/permission error.
    }
  }

  function syncScreenCaptureStatus(host, status = screenCaptureStatus()) {
    const output = host?.querySelector?.("[data-screen-capture-status]");
    if (!output) return;
    const list = host.querySelector("[data-screen-capture-list]");
    const signature = screenCaptureSignature(status.inputs);
    if (list && list.dataset.screenCaptureSignature !== signature) {
      list.innerHTML = screenCaptureInputsTemplate(status.inputs);
      list.dataset.screenCaptureSignature = signature;
      bindScreenCaptureInputs(host);
    }
    const stopAll = host.querySelector("[data-stop-screen-capture]");
    if (stopAll) stopAll.hidden = !status.inputs.length;
    setText(output, status.status === "active"
      ? `${status.inputs.length} shared input${status.inputs.length === 1 ? "" : "s"} active.`
      : status.status === "requesting"
        ? "Waiting for screen selection…"
        : status.error || "Nothing is currently shared.");
    output.classList.toggle("is-error", status.status === "error");
  }

  function syncScreenInputSelects(inputs = []) {
    globalThis.document?.querySelectorAll?.("[data-screen-input-select]").forEach((select) => {
      const html = screenInputOptionsTemplate(inputs, select.value);
      if (select.innerHTML !== html) select.innerHTML = html;
    });
  }

  function bindScreenCaptureInputs(host) {
    host.querySelectorAll("[data-screen-capture-name]").forEach((input) => {
      if (input.dataset.captureBound) return;
      input.dataset.captureBound = "true";
      input.addEventListener("change", () => renameScreenCaptureInput(input.dataset.screenCaptureName, input.value));
    });
    host.querySelectorAll("[data-stop-screen-capture-input]").forEach((button) => {
      if (button.dataset.captureBound) return;
      button.dataset.captureBound = "true";
      button.addEventListener("click", () => stopScreenCaptureInput(button.dataset.stopScreenCaptureInput));
    });
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
    syncScreenCaptureStatus(host);
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
    elementPicker = null;
    sourceChoicePicker = null;
    render();
  }

  function openMediaPicker(path, accept = "") {
    sourceChoicePicker = {
      path,
      allowedCategory: accept || "",
      filter: accept || "all",
      valueMode: "mediaId",
    };
    elementPicker = null;
    settingsOpen = false;
    render();
  }

  function openElementPicker(componentId, selectedChainItemId = "") {
    elementPicker = { componentId, selectedChainItemId, filter: "all" };
    focusElementPickerSearch = true;
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

  function setMediaValue(mediaId, target = sourceChoicePicker) {
    if (!target?.path) return;
    store.update((draft) => {
      setByPath(draft, target.path, mediaId);
      if (/\.mediaId$/.test(target.path)) {
        const sourcePath = target.path.replace(/\.mediaId$/, "");
        setByPath(draft, `${sourcePath}.type`, "media");
      }
    }, `update:${target.path}`);
  }

  function closeSettings() {
    settingsOpen = false;
    render();
  }

  function updateRenderSetting(input, reason) {
    store.update((draft) => {
      setByPath(draft, input.dataset.settingsUpdate, readInputValue(input));
      draft.render = normalizeRenderSettings(draft.render);
    }, reason);
    syncSettingsModal(getHost(), store.getState());
  }

  function applyRenderPreset(preset) {
    const presets = {
      "16:9": 16 / 9,
      "4:3": 4 / 3,
      "16:10": 16 / 10,
      "1:1": 1,
      "9:16": 9 / 16,
    };
    const aspectRatio = presets[preset] || presets["16:9"];
    store.update((draft) => {
      draft.render = normalizeRenderSettings({
        ...draft.render,
        outputs: (draft.render.outputs || []).map((output, index) => index === 0 ? { ...output, aspectRatio } : output),
      });
    }, "render-preset");
  }

  function addConfiguredOutput() {
    store.update((draft) => {
      const previousRender = normalizeRenderSettings(draft.render);
      const output = createOutputDefinition(previousRender.outputs.length, previousRender.outputs[0]?.aspectRatio);
      if (previousRender.outputs.some((item) => item.id === output.id)) output.id = `output-${Date.now().toString(36)}`;
      draft.render = normalizeRenderSettings({ ...previousRender, outputs: [...previousRender.outputs, output] });
    }, "add-output");
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
  // v25 mappings are relative to the output world and therefore remain valid
  // when either the host size or an authored proportion changes.
  return draft;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}
