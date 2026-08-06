import { MAX_PIXEL_DENSITY, normalizeRenderSettings, RESOLUTION_CEILING_PRESETS } from "../domain/render-settings.js";
import { normalizeMidiInputSettings } from "../libraries/control-engine/midi-input-profile/index.js";
import { dmxFixtureEndChannel, dmxPatchWarnings, normalizeDmxDeviceSettings } from "../libraries/dmx-engine/index.js";
import { uiStateAddressPart } from "../libraries/ui-engine/index.js";

export function settingsUiModel(state, {
  projectId = "unopened",
  midiStatus = {},
  dmxStatus = {},
  sharedInputs = [],
} = {}) {
  const projectStateId = uiStateAddressPart(projectId, "unopened");
  const render = normalizeRenderSettings(state.render || {});
  const dmx = normalizeDmxDeviceSettings(state?.devices?.dmx);
  const midiProfiles = normalizeMidiInputSettings(state.inputs).midi.profiles;
  const flowLayout = Object.freeze({ grow: 0, shrink: 0, basis: "auto", overflow: "visible" });
  const control = (id, type, label, address, value, extra = {}) => ({
    id, type, label, address, value,
    layout: flowLayout,
    binding: { action: "settings.change", address },
    ...(type === "number" ? { commitMode: "commit" } : {}),
    ...extra,
  });
  const action = (id, label, actionId = id, payload = {}, extra = {}) => ({
    id, type: "button", label, icon: extra.icon || "",
    layout: flowLayout,
    inputs: { commandPayload: { id: actionId, ...payload } },
    onActivate: "settings.action",
    ...extra,
  });
  const note = (id, text, tone = "muted", extra = {}) => ({
    id, type: "text", text, tone, layout: flowLayout, ...extra,
  });
  const group = (id, title, icon, children, extra = {}) => ({
    id,
    type: "panel",
    title,
    icon,
    children,
    presentation: "settings-section",
    contentPresentation: "settings-section-content",
    layout: { ...flowLayout, fill: true },
    ...extra,
  });
  const sectionGrid = (id, children) => ({
    id,
    type: "layout",
    orientation: "grid",
    presentation: "settings-section-grid",
    children,
    layout: { ...flowLayout, fill: true },
  });

  const outputSections = [
    group("presets", "Output proportions", "crop_16_9", [
      ...["16:9", "4:3", "16:10", "1:1", "9:16"].map((preset) => action(`preset-${preset.replace(":", "-")}`, preset, "render-preset", { preset })),
    ], { contentOrientation: "grid", contentPresentation: "settings-preset-grid" }),
    ...render.outputs.map((output, index) => group(`output-${output.id}`, output.name, "crop_16_9", [
      control("aspect", "number", "Output aspect ratio", `render.outputs.${index}.aspectRatio`, output.aspectRatio, { min: 0.05, max: 20, step: 0.001 }),
      action("remove", "Remove output", "remove-output", { outputId: output.id }, { icon: "close", disabled: render.outputs.length <= 1 }),
    ], { titleBinding: { label: "Output name", value: output.name, address: `render.outputs.${index}.name`, action: "settings.change" } })),
  ];
  const outputs = [
    sectionGrid("output-sections", outputSections),
    action("add-output", "Add output", "add-output", {}, { icon: "add", presentation: "settings-footer-action" }),
    note("output-note", "The active output window supplies the pixels. Outputs keep only their proportions and are arranged side by side in Mapping."),
  ];

  const midi = midiProfiles.length ? [
    note("midi-status", midiStatus.state === "ready" ? `${midiStatus.inputCount || 0} input · ${midiStatus.feedbackOutputCount || 0} feedback output` : midiStatus.error || "Ready to connect"),
    action("midi-connect", midiStatus.state === "ready" ? "Connected" : "Connect", "connect-midi"),
    action("midi-test", "Test all button LEDs", "test-midi-leds", {}, { icon: "lightbulb", disabled: !midiStatus.feedbackOutputCount }),
    action("midi-previous", "Previous bank", "midi-page", { delta: -1 }, { icon: "chevron_left", disabled: Number(midiStatus.page) <= 0 }),
    action("midi-next", "Next bank", "midi-page", { delta: 1 }, { icon: "chevron_right", disabled: Number(midiStatus.page) + 1 >= Number(midiStatus.pageCount || 1) }),
    action("midi-remove", "Remove MIDI profile", "remove-midi-profile", {}, { icon: "delete" }),
  ] : [action("midi-add", "Add Akai MIDImix", "add-midi-profile", {}, { icon: "add" })];
  const inputs = [sectionGrid("input-sections", [
    group("midi", "MIDI controller", "tune", [
      ...midi,
      note("midi-note", "MIDI is shared by Preview, Output, Live, and Component animation."),
    ]),
    group("camera", "Camera", "videocam", [
      control("facing", "select", "Camera direction", "render.camera.facingMode", render.camera.facingMode, { options: [{ value: "user", label: "Front" }, { value: "environment", label: "Rear / external" }] }),
      control("mirror", "toggle", "Mirror camera image", "render.camera.mirrored", render.camera.mirrored),
      control("max-resolution", "toggle", "Use maximum supported resolution", "render.camera.maxResolution", render.camera.maxResolution),
      note("camera-note", "Changing Camera settings restarts an active capture."),
    ]),
    group("screen", "Shared screen inputs", "present_to_all", [
      control("screen-rate", "number", "Maximum frame rate", "render.screenCapture.frameRate", render.screenCapture.frameRate, { min: 1, max: 60, step: 1 }),
      control("screen-cursor", "select", "Pointer", "render.screenCapture.cursor", render.screenCapture.cursor, { options: ["always", "motion", "never"].map((value) => ({ value, label: value })) }),
      control("prefer-tab", "toggle", "Prefer the current browser tab", "render.screenCapture.preferCurrentTab", render.screenCapture.preferCurrentTab),
      control("include-tab", "toggle", "Allow sharing this app tab", "render.screenCapture.includeCurrentTab", render.screenCapture.includeCurrentTab),
      control("surface-switching", "toggle", "Allow changing the shared surface", "render.screenCapture.surfaceSwitching", render.screenCapture.surfaceSwitching),
      action("screen-add", "Add screen or window", "start-screen-capture", {}, { icon: "add" }),
      action("screen-stop-all", "Stop all", "stop-screen-capture", {}, { hidden: sharedInputs.length === 0 }),
      ...sharedInputs.flatMap((input, index) => [
        control(`screen-name-${index}`, "textInput", "Input name", `screenCapture.${input.id}.name`, input.name, { binding: { action: "settings.screen-name", address: input.id } }),
        note(`screen-size-${index}`, input.width && input.height ? `${input.width} × ${input.height}` : "Starting…"),
        action(`screen-stop-${index}`, `Stop ${input.name}`, "stop-screen-capture-input", { inputId: input.id }, { icon: "close" }),
      ]),
      note("screen-note", "Browser-approved inputs remain available for this session and are shared with same-origin Output windows."),
    ], { slotPresentation: "settings-wide-slot" }),
  ])];

  const deviceSections = [
    group("dmx-output", "DMX output", "settings_input_component", [
      control("dmx-enabled", "toggle", "Enable continuous DMX output", "devices.dmx.enabled", dmx.enabled),
      control("dmx-rate", "number", "Refresh rate", "devices.dmx.refreshRate", dmx.refreshRate, { min: 20, max: 40, step: 1 }),
      action("dmx-connect", dmxStatus.connected ? "Reconnect" : "Connect USB DMX", "connect-dmx"),
      action("dmx-disconnect", "Disconnect DMX", "disconnect-dmx", {}, { icon: "link_off", disabled: !dmxStatus.connected }),
      note("dmx-status", dmxStatus.connected ? `${dmxStatus.refreshRate || dmx.refreshRate} Hz target · ${dmxStatus.universeLength || 1} channels` : dmxStatus.error || "Not connected", dmxStatus.error ? "danger" : "muted"),
      note("dmx-note", "The device service repeats the last complete universe independently of rendering."),
    ]),
    ...dmx.fixtures.map((fixture, fixtureIndex) => {
      const profile = dmx.profiles.find((entry) => entry.id === fixture.profileId);
      return group(`fixture-${fixture.id}`, fixture.name, "light", [
        control("profile", "select", "Profile", `dmxFixture.${fixtureIndex}.profileId`, fixture.profileId, { binding: { action: "settings.dmx-fixture", address: `${fixtureIndex}:profileId` }, options: dmx.profiles.map((entry) => ({ value: entry.id, label: entry.name })) }),
        control("start", "number", "Start channel", `dmxFixture.${fixtureIndex}.startChannel`, fixture.startChannel, { binding: { action: "settings.dmx-fixture", address: `${fixtureIndex}:startChannel` }, min: 1, max: 512, step: 1 }),
        control("enabled", "toggle", "Enabled", `dmxFixture.${fixtureIndex}.enabled`, fixture.enabled, { binding: { action: "settings.dmx-fixture", address: `${fixtureIndex}:enabled` } }),
        note("channels", `Channels ${fixture.startChannel}–${dmxFixtureEndChannel(fixture, profile)}`),
        action("remove", "Remove fixture", "remove-dmx-fixture", { fixtureId: fixture.id }, { icon: "close" }),
      ], { titleBinding: { label: "Fixture name", value: fixture.name, address: `${fixtureIndex}:name`, action: "settings.dmx-fixture" } });
    }),
    group("dmx-test", "Raw channel test", "tune", [
      control("test-channel", "number", "Channel", "devices.dmx.test.channel", 1, { binding: { action: "settings.dmx-test", address: "channel" }, min: 1, max: 512, step: 1 }),
      control("test-value", "number", "Value", "devices.dmx.test.value", 0, { binding: { action: "settings.dmx-test", address: "value" }, min: 0, max: 255, step: 1 }),
      action("clear-test", "Clear test override", "clear-dmx-test"),
      note("dmx-test-note", "Use a low value and move one channel at a time while identifying a fixture profile."),
    ]),
  ];
  const devices = [
    sectionGrid("device-sections", deviceSections),
    action("add-fixture", "Add fixture", "add-dmx-fixture", {}, { icon: "add", presentation: "settings-footer-action" }),
    ...dmxPatchWarnings(dmx).map((warning, index) => note(`warning-${index}`, warning, "danger")),
  ];

  const rendering = [sectionGrid("rendering-sections", [
    group("scene-proportion", "Scene proportion", "grid_4x4", [
      control("scene-aspect", "number", "Scene aspect ratio", "render.sceneAspectRatio", render.sceneAspectRatio, { min: 0.05, max: 20, step: 0.001 }),
      note("scene-note", "One relative coordinate space is shared by every Scene and Surface."),
    ]),
    group("component-proportion", "Component proportion", "aspect_ratio", [
      control("component-aspect", "number", "Default Component aspect ratio", "render.componentAspectRatio", render.componentAspectRatio, { min: 0.05, max: 20, step: 0.001 }),
      note("component-note", "Defines default Component geometry. Runtime texture resolution follows visible demand."),
    ]),
    group("resolution", "Resolution ceiling", "texture", [
      control("ceiling", "select", "Maximum class", "render.resolutionCeiling", render.resolutionCeiling, { options: RESOLUTION_CEILING_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })) }),
      note("resolution-note", "A safety ceiling for adaptive buffers. Auto follows the current window."),
    ]),
    group("performance", "Performance", "speed", [
      control("max-rate", "number", "Maximum frame rate", "render.maxFrameRate", render.maxFrameRate, { min: 1, max: 120, step: 1 }),
      control("density", "number", "Pixel density", "render.pixelDensity", render.pixelDensity, { min: 0.5, max: MAX_PIXEL_DENSITY, step: 0.25 }),
      note("performance-note", "Caps Preview and standalone Output. Lower values reduce render, upload, and scheduling pressure.", "muted", { slotPresentation: "settings-wide-slot" }),
    ], { contentOrientation: "grid", contentPresentation: "settings-control-grid" }),
    group("sampling", "Advanced sampling", "tune", [
      control("overscan", "number", "Surface overscan", "render.sampling.surfaceOverscan", render.sampling.surfaceOverscan, { min: 0.5, max: 2, step: 0.05 }),
      control("detail", "number", "Surface detail", "render.sampling.surfaceDetailScale", render.sampling.surfaceDetailScale, { min: 0.5, max: 2, step: 0.05 }),
      control("limit-scene", "toggle", "Limit Scene raster to logical size", "render.sampling.limitSceneToLogicalSize", render.sampling.limitSceneToLogicalSize, { slotPresentation: "settings-wide-slot" }),
      note("sampling-note", "Independent raster-demand multipliers; Surface detail may be reduced to lower Scene cost.", "muted", { slotPresentation: "settings-wide-slot" }),
    ], { contentOrientation: "grid", contentPresentation: "settings-control-grid" }),
    group("upscaling", "Component upscaling", "high_quality", [
      control("upscale-enabled", "toggle", "Enable upscaling pipeline", "render.upscaling.enabled", render.upscaling.enabled),
      control("upscale-amount", "number", "Internal render amount", "render.upscaling.amount", render.upscaling.amount, { min: 0.35, max: 1, step: 0.01 }),
      note("upscaling-note", "Renders each Component at this fraction before one edge-aware upscale.", "muted", { slotPresentation: "settings-wide-slot" }),
    ]),
    group("post", "Post processing", "grain", [
      control("gray-enabled", "toggle", "Grayscale", "render.postProcessing.grayscaleEnabled", render.postProcessing.grayscaleEnabled),
      control("gray-amount", "number", "Grayscale amount", "render.postProcessing.grayscaleAmount", render.postProcessing.grayscaleAmount, { min: 0, max: 1, step: 0.05 }),
      control("noise-enabled", "toggle", "Monochrome noise", "render.postProcessing.noiseEnabled", render.postProcessing.noiseEnabled),
      control("noise-amount", "number", "Noise amount", "render.postProcessing.noiseAmount", render.postProcessing.noiseAmount, { min: 0, max: 0.2, step: 0.005 }),
      note("post-note", "These filters run at the component’s full target resolution after upscaling.", "muted", { slotPresentation: "settings-wide-slot" }),
    ], { contentOrientation: "grid", contentPresentation: "settings-control-grid", slotPresentation: "settings-wide-slot" }),
  ])];

  return {
    id: "settings-modal",
    type: "modal",
    open: true,
    title: "Project settings",
    description: "Composition proportions and rendering budget.",
    presentation: "settings-modal",
    contentPresentation: "settings-modal-content",
    onClose: "settings.close",
    stateAddress: `projects/${projectStateId}/settings`,
    children: [{
      id: "tabs",
      type: "tabs",
      stateAddress: `projects/${projectStateId}/settings-tabs`,
      presentation: "settings-tabs",
      tabListPresentation: "settings-tab-list",
      panelsPresentation: "settings-tab-panels",
      layout: { fill: true, grow: 1, shrink: 1, basis: 0, overflow: "hidden" },
      onSelect: "settings.select-tab",
      tabs: [
        { id: "outputs", label: "Outputs", panelPresentation: "settings-tab-panel", contentPresentation: "settings-tab-content", children: outputs },
        { id: "inputs", label: "Inputs", panelPresentation: "settings-tab-panel", contentPresentation: "settings-tab-content", children: inputs },
        { id: "devices", label: "Devices", panelPresentation: "settings-tab-panel", contentPresentation: "settings-tab-content", children: devices },
        { id: "rendering", label: "Rendering", panelPresentation: "settings-tab-panel", contentPresentation: "settings-tab-content", children: rendering },
      ],
    }],
  };
}

export function normalizeSettingsTab(value) {
  if (value === "camera" || value === "screen") return "inputs";
  return ["outputs", "inputs", "devices", "rendering"].includes(value) ? value : "outputs";
}
