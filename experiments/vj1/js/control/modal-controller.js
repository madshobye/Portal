import { createOutputDefinition, normalizeRenderSettings } from "../domain/render-settings.js";
import { sortComponentCatalog } from "./catalog-view.js";
import { getByPath, setByPath, setByPathCreate } from "./path-input-utils.js";
import { elementMediaCategory, elementPickerUiModel, sourceChoicePickerUiModel } from "./picker-view.js";
import { settingsUiModel } from "./settings-view.js";
import { createAkaiMidiMixProfile, normalizeMidiInputSettings } from "../libraries/control-engine/midi-input-profile/index.js";
import { createDmxFixture, normalizeDeviceSettings } from "../libraries/dmx-engine/index.js";
import { mergeSourceChoice } from "../domain/source-choice.js";
import {
  createAuthoredMediaSource,
} from "../domain/authored-visual-source.js";
import { catalogPickerUiGraph, settingsModalUiGraph } from "./control-ui-program.js";

const SETTINGS_UI_SCOPE = "vj1.control.settings";
const PICKER_UI_SCOPE = "vj1.control.catalog-picker";

export function sourceForCatalogMedia(mediaId, state = {}) {
  const id = String(mediaId || "");
  const media = (state?.media || []).find((item) => String(item.id || "") === id);
  return createAuthoredMediaSource(id, media);
}

export function createModalController({
  store,
  getState,
  getHost,
  mediaLibrary,
  refreshMedia,
  getCatalogSortMode,
  retainedUi,
  midiInput = null,
  dmxOutput = null,
  screenCapture = null,
}) {
  if (!screenCapture) throw new Error("SCREEN_CAPTURE_SERVICE_REQUIRED");
  if (!retainedUi) throw new Error("SETTINGS_UI_RUNTIME_REQUIRED");
  let elementPicker = null;
  let sourceChoicePicker = null;
  let settingsOpen = false;
  let mediaRefreshInFlight = false;
  let dmxTestChannel = 1;
  screenCapture.subscribe(() => { if (settingsOpen) render(getState()); });

  function render(state = getState()) {
    const host = getHost();
    if (!host) return;
    if (!elementPicker && !sourceChoicePicker && !settingsOpen) {
      retainedUi.deactivate(SETTINGS_UI_SCOPE);
      retainedUi.deactivate(PICKER_UI_SCOPE);
      return;
    }
    if (settingsOpen) {
      retainedUi.deactivate(PICKER_UI_SCOPE);
      renderSettings(host, state);
      return;
    }
    retainedUi.deactivate(SETTINGS_UI_SCOPE);
    if (sourceChoicePicker) {
      renderSourceChoicePicker(host, state);
      return;
    }
    if (elementPicker) {
      renderElementPicker(host, state);
      return;
    }
  }

  function renderSettings(host, state) {
    retainedUi.activate(settingsModalUiGraph(settingsUiModel(state, {
      projectId: state.project?.folderName || state.project?.name || "unopened",
      midiStatus: midiInput?.snapshot?.() || {},
      dmxStatus: dmxOutput?.snapshot?.() || {},
      sharedInputs: screenCapture.snapshot().inputs,
    })), { host, scope: SETTINGS_UI_SCOPE });
  }

  function renderSourceChoicePicker(host, state) {
    const model = sourceChoicePickerUiModel(state, sourceChoicePicker, mediaLibrary);
    if (model.actions[0]) model.actions[0].disabled = mediaRefreshInFlight;
    retainedUi.activate(catalogPickerUiGraph(
      model,
      { id: PICKER_UI_SCOPE },
    ), { host, scope: PICKER_UI_SCOPE });
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
    if (target?.valueMode === "mediaId") setMediaValue(authoredSourceMediaId(source), target);
    else setSourceChoice(source, target);
  }

  function sourceChoiceCategory(source, state) {
    const mediaId = authoredSourceMediaId(source);
    if (mediaId) {
      return elementMediaCategory((state.media || []).find((item) => item.id === mediaId) || {});
    }
    if (source?.type === "generator" && source.generatorId === "cameraInput") return "live";
    if (source?.type === "generator" && source.generatorId === "black") return "blank";
    return source?.type || "";
  }

  function authoredSourceMediaId(source = {}) {
    if (
      source.type === "generator" &&
      (source.generatorId === "mediaImage" || source.generatorId === "modelMedia")
    ) return String(source.params?.mediaId || "");
    return "";
  }

  function renderElementPicker(host, state) {
    const sortMode = getCatalogSortMode(state);
    const components = sortComponentCatalog(state.components || [], sortMode);
    const model = elementPickerUiModel(state, elementPicker, mediaLibrary, { components, sortMode });
    if (model.actions[0]) model.actions[0].disabled = mediaRefreshInFlight;
    retainedUi.activate(catalogPickerUiGraph(
      model,
      { id: PICKER_UI_SCOPE },
    ), { host, scope: PICKER_UI_SCOPE });
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
    render(getState());
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
      render(getState());
    }
  }

  async function startConfiguredScreenCapture() {
    const settings = normalizeRenderSettings(getState().render || {}).screenCapture;
    try {
      await screenCapture.start(settings);
    } catch {
      // The shared service reports the actionable browser/permission error.
    }
  }

  function openSettings() {
    settingsOpen = true;
    elementPicker = null;
    sourceChoicePicker = null;
    render();
  }

  function openMediaPicker(path, accept = "", onSelect = null) {
    openChoicePicker({
      path,
      allowedCategory: accept || "",
      filter: accept || "all",
      valueMode: "mediaId",
      onSelect: typeof onSelect === "function" ? onSelect : null,
    });
  }

  function openElementPicker(componentId, selectedChainItemId = "") {
    elementPicker = {
      componentId,
      selectedChainItemId,
    };
    sourceChoicePicker = null;
    settingsOpen = false;
    render();
  }

  function activateElementPickerTarget(target = elementPicker) {
    if (target?.selectedChainItemId) store.selectChainItem(target.selectedChainItemId);
  }

  function closeElementPicker() {
    elementPicker = null;
    render();
  }

  function openSourceChoicePicker(path, allowedCategory = "", options = {}) {
    openChoicePicker({
      path,
      allowedCategory,
      filter: allowedCategory || "all",
      allowComponents: options.allowComponents === true,
      ownerComponentId: String(options.ownerComponentId || ""),
    });
  }

  function openChoicePicker(picker) {
    sourceChoicePicker = picker.allowedCategory
      ? { ...picker, filter: picker.allowedCategory, search: "" }
      : { ...picker };
    elementPicker = null;
    settingsOpen = false;
    render();
  }

  function closeSourceChoicePicker() {
    sourceChoicePicker = null;
    render();
  }

  function setSourceChoice(source, target = sourceChoicePicker) {
    if (!target?.path) return;
    store.update((draft) => {
      const previous = getByPath(draft, target.path) || {};
      setByPathCreate(draft, target.path, mergeSourceChoice(
        previous,
        source?.type === "media"
          ? sourceForCatalogMedia(source.mediaId, draft)
          : source,
      ));
    }, `update:${target.path}`);
  }

  function setMediaValue(mediaId, target = sourceChoicePicker) {
    if (typeof target?.onSelect === "function") {
      target.onSelect(mediaId);
      return;
    }
    if (!target?.path) return;
    store.update((draft) => {
      setByPath(draft, target.path, mediaId);
      if (/\.source\.mediaId$/.test(target.path)) {
        const sourcePath = target.path.replace(/\.mediaId$/, "");
        setByPath(draft, `${sourcePath}.type`, "media");
      }
    }, `update:${target.path}`);
  }

  function closeSettings() {
    settingsOpen = false;
    render();
  }

  function updateSetting(address, value, reason = `settings:${address}`) {
    if (!address) return;
    store.update((draft) => {
      setByPath(draft, address, value);
      draft.render = normalizeRenderSettings(draft.render);
      draft.devices = normalizeDeviceSettings(draft.devices);
    }, reason);
    render(getState());
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

  function addMidiProfile() {
    store.update((draft) => {
      const inputs = normalizeMidiInputSettings(draft.inputs);
      if (!inputs.midi.profiles.length) inputs.midi.profiles.push(createAkaiMidiMixProfile());
      draft.inputs = inputs;
    }, "add-midi-profile");
    midiInput?.connect?.();
  }

  function removeMidiProfile() {
    store.update((draft) => {
      draft.inputs = normalizeMidiInputSettings();
    }, "remove-midi-profile");
    midiInput?.disconnect?.();
  }

  function addDmxFixture() {
    store.update((draft) => {
      const devices = normalizeDeviceSettings(draft.devices);
      const profileId = devices.dmx.profiles[0]?.id || "";
      devices.dmx.fixtures.push(createDmxFixture(profileId, devices.dmx.fixtures.length));
      draft.devices = devices;
    }, "add-dmx-fixture");
  }

  function removeDmxFixture(fixtureId) {
    store.update((draft) => {
      const devices = normalizeDeviceSettings(draft.devices);
      devices.dmx.fixtures = devices.dmx.fixtures.filter((fixture) => fixture.id !== fixtureId);
      draft.devices = devices;
    }, "remove-dmx-fixture");
  }

  function updateDmxFixture(address, value) {
    const [index, field] = String(address || "").split(":");
    store.update((draft) => {
      const devices = normalizeDeviceSettings(draft.devices);
      const fixture = devices.dmx.fixtures[Number(index)];
      if (fixture && ["name", "profileId", "startChannel", "enabled"].includes(field)) {
        fixture[field] = field === "startChannel" ? Number(value) : field === "enabled" ? value === true : value;
      }
      draft.devices = normalizeDeviceSettings(devices);
    }, `dmx-fixture:${field}`);
    render(getState());
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

  function handleUiCommand(command) {
    if (command.action === "settings.close") {
      closeSettings();
      return true;
    }
    if (command.action === "settings.change") {
      updateSetting(String(command.address || ""), command.payload?.value);
      return true;
    }
    if (command.action === "settings.screen-name") {
      screenCapture.rename(String(command.address || ""), String(command.payload?.value || ""));
      return true;
    }
    if (command.action === "settings.dmx-fixture") {
      updateDmxFixture(String(command.address || ""), command.payload?.value);
      return true;
    }
    if (command.action === "settings.dmx-test") {
      if (command.address === "channel") dmxTestChannel = Math.max(1, Number(command.payload?.value) || 1);
      else dmxOutput?.setTestChannel?.(dmxTestChannel, Math.max(0, Number(command.payload?.value) || 0) / 255);
      return true;
    }
    if (command.action === "settings.action") {
      const action = String(command.payload?.id || "");
      if (action === "render-preset") applyRenderPreset(command.payload?.preset);
      else if (action === "add-output") addConfiguredOutput();
      else if (action === "remove-output") removeConfiguredOutput(command.payload?.outputId);
      else if (action === "add-midi-profile") addMidiProfile();
      else if (action === "remove-midi-profile") removeMidiProfile();
      else if (action === "connect-midi") midiInput?.connect?.();
      else if (action === "test-midi-leds") midiInput?.testLeds?.();
      else if (action === "midi-page") {
        const status = midiInput?.snapshot?.() || {};
        midiInput?.setPage?.((Number(status.page) || 0) + Number(command.payload?.delta || 0));
      } else if (action === "start-screen-capture") startConfiguredScreenCapture();
      else if (action === "stop-screen-capture") screenCapture.stopAll();
      else if (action === "stop-screen-capture-input") screenCapture.stop(command.payload?.inputId);
      else if (action === "connect-dmx") dmxOutput?.connect?.();
      else if (action === "disconnect-dmx") dmxOutput?.disconnect?.();
      else if (action === "add-dmx-fixture") addDmxFixture();
      else if (action === "remove-dmx-fixture") removeDmxFixture(command.payload?.fixtureId);
      else if (action === "clear-dmx-test") dmxOutput?.clearTestChannels?.();
      render(getState());
      return true;
    }
    if (command.action === "picker.close") {
      if (sourceChoicePicker) closeSourceChoicePicker();
      else if (elementPicker) closeElementPicker();
      return true;
    }
    if (command.action === "picker.select") {
      if (sourceChoicePicker) chooseSource(command.payload?.value);
      else if (elementPicker) {
        const selection = command.payload?.value || {};
        addElement(selection.kind, selection.value);
      }
      return true;
    }
    if (command.action === "picker.filter" || command.action === "picker.search") {
      // CatalogPickerNode owns filter/search state and restoration. The app
      // observes the semantic command without maintaining a second UI model.
      return true;
    }
    if (command.action === "picker.action") {
      const action = String(command.payload?.id || "");
      if (action === "refresh") refreshMediaPicker();
      else if (action.startsWith("marker:")) {
        store.cycleCatalogMarker?.(action.slice("marker:".length), String(command.payload?.itemId || "").replace(/^[^:]+:/, ""));
      } else if (action.startsWith("sort:")) {
        const [, scope, mode] = action.split(":");
        if (["component", "media"].includes(scope) && ["recent", "marker", "name", "created"].includes(mode)) {
          store.updateUi?.((ui) => {
            ui.catalogSortModes ||= {};
            ui.catalogSortModes[scope] = mode;
          }, `catalog-sort:${scope}`);
          render(getState());
        }
      }
      return true;
    }
    return command.action === "settings.select-tab";
  }

  return { render, openSettings, openMediaPicker, openElementPicker, openSourceChoicePicker, handleUiCommand };
}

export function scaleMappingForRenderChange(draft, previousRender, nextRender) {
  // v25 mappings are relative to the output world and therefore remain valid
  // when either the host size or an authored proportion changes.
  return draft;
}
