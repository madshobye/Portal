import { MAX_PIXEL_DENSITY, normalizeRenderSettings, RESOLUTION_CEILING_PRESETS } from "../domain/render-settings.js";
import { esc, formatRangeValue, icon } from "./template-utils.js";
import { screenCaptureStatus } from "../output/screen-capture-service.js";
import { normalizeMidiInputSettings } from "../libraries/control-engine/midi-input-profile/index.js";
import {
  DMX_CHANNEL_ROLES,
  DMX_SAMPLE_FEATURES,
  dmxFixtureEndChannel,
  dmxPatchWarnings,
  normalizeDmxDeviceSettings,
} from "../libraries/dmx-engine/index.js";

export function settingsModalTemplate(state, activeTab = "outputs", midiStatus = {}, dmxStatus = {}) {
  activeTab = normalizeSettingsTab(activeTab);
  const render = normalizeRenderSettings(state.render || {});
  const camera = render.camera;
  const screen = render.screenCapture;
  const sharedInputs = screenCaptureStatus().inputs;
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel settings-modal" data-settings-modal role="dialog" aria-modal="true" aria-label="Project settings">
      <header class="modal-header">
        <div>
          <strong>Project settings</strong>
          <small>Composition proportions and rendering budget.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <nav class="settings-tabs" role="tablist" aria-label="Settings sections">
        ${settingsTab("outputs", "Outputs", activeTab)}
        ${settingsTab("inputs", "Inputs", activeTab)}
        ${settingsTab("devices", "Devices", activeTab)}
        ${settingsTab("rendering", "Rendering", activeTab)}
      </nav>
      <div class="settings-modal-body" data-scroll-region data-scroll-key="settings:${activeTab}">
        <section class="ui-section element-section parameter-surface settings-view-surface" data-settings-panel="outputs" ${visiblePanel("outputs", activeTab)}>
          <div class="settings-preset-row">
            <button type="button" data-render-preset="16:9">16:9</button>
            <button type="button" data-render-preset="4:3">4:3</button>
            <button type="button" data-render-preset="16:10">16:10</button>
            <button type="button" data-render-preset="1:1">1:1</button>
            <button type="button" data-render-preset="9:16">9:16</button>
          </div>
          <div class="configured-output-list" data-configured-output-list data-output-signature="${esc(render.outputs.map((output) => output.id).join("|"))}">
            ${configuredOutputsTemplate(render)}
          </div>
          <button type="button" class="chain-add-button" data-add-output>${icon("add")} Add output</button>
          <div class="soft-note">The active output window supplies the pixels. Outputs keep only their proportions and are arranged side by side in Mapping.</div>
        </section>
        <section class="ui-section element-section parameter-surface settings-view-surface settings-inputs-panel" data-settings-panel="inputs" ${visiblePanel("inputs", activeTab)}>
          <div data-midi-settings data-midi-signature="${esc(midiSettingsSignature(state, midiStatus))}">
            ${midiSettingsTemplate(state, midiStatus)}
          </div>
          <div class="settings-group">
            <div class="settings-group-title"><span class="material-symbols-rounded">videocam</span><span>Camera</span></div>
            <label class="field">Camera direction
              <select data-settings-update="render.camera.facingMode">
                <option value="user" ${camera.facingMode === "user" ? "selected" : ""}>Front</option>
                <option value="environment" ${camera.facingMode === "environment" ? "selected" : ""}>Rear / external</option>
              </select>
            </label>
            ${settingsToggle("Mirror camera image", "render.camera.mirrored", camera.mirrored)}
            ${settingsToggle("Use maximum supported resolution", "render.camera.maxResolution", camera.maxResolution)}
            <div class="soft-note">The browser chooses a capture size suitable for the current render demand. Changing Camera settings restarts an active capture.</div>
          </div>
          <div class="settings-group">
            <div class="settings-group-title"><span class="material-symbols-rounded">present_to_all</span><span>Shared screen inputs</span></div>
            <label class="field">Maximum frame rate <input type="number" min="1" max="60" step="1" data-settings-update="render.screenCapture.frameRate" value="${screen.frameRate}" /></label>
            <label class="field">Pointer
              <select data-settings-update="render.screenCapture.cursor">
                <option value="always" ${screen.cursor === "always" ? "selected" : ""}>Always</option>
                <option value="motion" ${screen.cursor === "motion" ? "selected" : ""}>While moving</option>
                <option value="never" ${screen.cursor === "never" ? "selected" : ""}>Hidden</option>
              </select>
            </label>
            ${settingsToggle("Prefer the current browser tab", "render.screenCapture.preferCurrentTab", screen.preferCurrentTab)}
            ${settingsToggle("Allow sharing this app tab", "render.screenCapture.includeCurrentTab", screen.includeCurrentTab)}
            ${settingsToggle("Allow changing the shared surface", "render.screenCapture.surfaceSwitching", screen.surfaceSwitching)}
            <div class="settings-capture-actions">
              <button type="button" class="chain-add-button" data-start-screen-capture>${icon("add")} Add screen or window</button>
              <button type="button" class="icon-buttonish" data-stop-screen-capture ${sharedInputs.length ? "" : "hidden"}>Stop all</button>
            </div>
            <div class="screen-capture-list" data-screen-capture-list data-screen-capture-signature="${esc(screenCaptureSignature(sharedInputs))}">
              ${screenCaptureInputsTemplate(sharedInputs)}
            </div>
            <div class="soft-note" data-screen-capture-status>Nothing is currently shared.</div>
            <div class="soft-note">Each browser-approved input stays open for this session. Screen Share generators select an input by its stable session ID; Preview and same-origin Output windows share the same streams.</div>
          </div>
        </section>
        <section class="ui-section element-section parameter-surface settings-view-surface settings-devices-panel" data-settings-panel="devices" ${visiblePanel("devices", activeTab)}>
          <div data-dmx-settings data-dmx-signature="${esc(dmxSettingsSignature(state, dmxStatus))}">
            ${dmxSettingsTemplate(state, dmxStatus)}
          </div>
        </section>
        <section class="ui-section element-section parameter-surface settings-view-surface settings-rendering-panel" data-settings-panel="rendering" ${visiblePanel("rendering", activeTab)}>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">grid_4x4</span><span>Scene proportion</span></div>
          ${aspectRatioField("Scene aspect ratio", "render.sceneAspectRatio", render.sceneAspectRatio)}
          <div class="soft-note">One relative coordinate space shared by every Scene and Surface.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">aspect_ratio</span><span>Component proportion</span></div>
          ${aspectRatioField("Default Component aspect ratio", "render.componentAspectRatio", render.componentAspectRatio)}
          <div class="soft-note">Defines default Component geometry. Runtime texture resolution follows visible demand.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">texture</span><span>Resolution ceiling</span></div>
          <label class="field">Maximum class
            <select data-settings-update="render.resolutionCeiling">
              ${RESOLUTION_CEILING_PRESETS.map((preset) => `<option value="${preset.id}" ${render.resolutionCeiling === preset.id ? "selected" : ""}>${preset.label}</option>`).join("")}
            </select>
          </label>
          <div class="soft-note">A safety ceiling for adaptive buffers, expressed without authoring a width and height. Auto follows the current window.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">speed</span><span>Performance</span></div>
          <label class="field">Maximum frame rate <input type="number" min="1" max="120" step="1" data-settings-update="render.maxFrameRate" value="${render.maxFrameRate}" /></label>
          <label class="field">Pixel density <input type="number" min="0.5" max="${MAX_PIXEL_DENSITY}" step="0.25" data-settings-update="render.pixelDensity" value="${render.pixelDensity}" /></label>
          <div class="soft-note">Caps both embedded previews and standalone output windows. Lower values reduce render, video-upload, and CPU scheduling pressure.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">tune</span><span>Advanced sampling</span></div>
          <div class="field-pair">
            <label class="field">Surface overscan <input type="number" min="0.5" max="2" step="0.05" data-settings-update="render.sampling.surfaceOverscan" value="${render.sampling.surfaceOverscan}" /></label>
            <label class="field">Surface detail <input type="number" min="0.5" max="2" step="0.05" data-settings-update="render.sampling.surfaceDetailScale" value="${render.sampling.surfaceDetailScale}" /></label>
          </div>
          ${settingsToggle("Limit Scene raster to logical size", "render.sampling.limitSceneToLogicalSize", render.sampling.limitSceneToLogicalSize)}
          <div class="soft-note">Independent raster-demand multipliers. Both default to 1×; Surface detail can be lowered to 0.5× for lower Scene cost.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">high_quality</span><span>Component upscaling</span></div>
          ${settingsToggle("Enable upscaling pipeline", "render.upscaling.enabled", render.upscaling.enabled)}
          ${percentRange("Internal render amount", "render.upscaling.amount", render.upscaling.amount, 0.35, 1, 0.01, "upscaling-amount")}
          <div class="soft-note">Renders each chain component at this fraction, then applies one fast edge-aware upscale before projection.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">grain</span><span>Post processing</span></div>
          ${settingsToggle("Grayscale", "render.postProcessing.grayscaleEnabled", render.postProcessing.grayscaleEnabled)}
          ${percentRange("Grayscale amount", "render.postProcessing.grayscaleAmount", render.postProcessing.grayscaleAmount, 0, 1, 0.05, "grayscale-amount")}
          ${settingsToggle("Monochrome noise", "render.postProcessing.noiseEnabled", render.postProcessing.noiseEnabled)}
          <label class="field range-field">
            <span>Noise amount</span>
            <output class="range-value" data-range-value data-noise-amount-label>${formatRangeValue(render.postProcessing.noiseAmount * 100, 0.1)}%</output>
            <input type="range" min="0" max="0.2" step="0.005" data-range-format="percent" data-display-step="0.1" data-settings-update="render.postProcessing.noiseAmount" value="${render.postProcessing.noiseAmount}" />
          </label>
          <div class="soft-note">These filters run at the component’s full target resolution after upscaling.</div>
          </div>
        </section>
      </div>
    </section>
  `;
}

export function dmxSettingsTemplate(state = {}, status = {}) {
  const settings = normalizeDmxDeviceSettings(state?.devices?.dmx);
  const warnings = dmxPatchWarnings(settings);
  const statusLabel = status.connected
    ? `${status.refreshRate || settings.refreshRate} Hz target · ${status.universeLength || 1} channels`
    : status.state === "requesting"
      ? "Waiting for serial device…"
      : status.error || "Not connected";
  return `
    <div class="settings-group">
      <div class="settings-group-title"><span class="material-symbols-rounded">settings_input_component</span><span>DMX output</span></div>
      ${settingsToggle("Enable continuous DMX output", "devices.dmx.enabled", settings.enabled)}
      <label class="field">Refresh rate
        <input type="number" min="20" max="40" step="1" data-settings-update="devices.dmx.refreshRate" value="${settings.refreshRate}" />
      </label>
      <div class="settings-capture-actions">
        <button type="button" class="chain-add-button" data-connect-dmx>${status.connected ? "Reconnect" : "Connect USB DMX"}</button>
        <button type="button" class="icon-buttonish" data-disconnect-dmx ${status.connected ? "" : "disabled"} title="Disconnect DMX" aria-label="Disconnect DMX">${icon("link_off")}</button>
      </div>
      <div class="soft-note${status.error ? " is-error" : ""}">${esc(statusLabel)}</div>
      <div class="soft-note">The global controller repeats the last complete universe independently of rendering. This transport expects a raw 250 kbaud USB serial DMX interface.</div>
    </div>
    <div class="settings-group">
      <div class="settings-group-title"><span class="material-symbols-rounded">light</span><span>Fixtures</span></div>
      <div class="dmx-fixture-list">
        ${settings.fixtures.length
          ? settings.fixtures.map((fixture, index) => dmxFixtureTemplate(fixture, index, settings)).join("")
          : `<div class="soft-note">Add a patched fixture before inserting a DMX Probe.</div>`}
      </div>
      <button type="button" class="chain-add-button" data-add-dmx-fixture>${icon("add")} Add fixture</button>
      ${warnings.map((warning) => `<div class="soft-note is-error">${esc(warning)}</div>`).join("")}
    </div>
    <div class="settings-group">
      <div class="settings-group-title"><span class="material-symbols-rounded">tune</span><span>Raw channel test</span></div>
      <div class="field-pair">
        <label class="field">Channel <input type="number" min="1" max="512" step="1" value="1" data-dmx-test-channel /></label>
        <label class="field range-field"><span>Value</span><output class="range-value" data-range-value>0</output><input type="range" min="0" max="255" step="1" value="0" data-dmx-test-value /></label>
      </div>
      <button type="button" class="chain-add-button" data-clear-dmx-test>Clear test override</button>
      <div class="soft-note">Use a low value and move one channel at a time while identifying an undocumented fixture profile.</div>
    </div>
  `;
}

export function dmxSettingsSignature(state = {}, status = {}) {
  return JSON.stringify({
    settings: normalizeDmxDeviceSettings(state?.devices?.dmx),
    status: {
      state: status.state || "",
      error: status.error || "",
      connected: status.connected === true,
      enabled: status.enabled === true,
      refreshRate: Number(status.refreshRate) || 0,
      universeLength: Number(status.universeLength) || 0,
      portInfo: status.portInfo || null,
    },
  });
}

function dmxFixtureTemplate(fixture, fixtureIndex, settings) {
  const profile = settings.profiles.find((entry) => entry.id === fixture.profileId);
  return `
    <article class="configured-output-card dmx-fixture-card">
      <div class="ui-section-header configured-output-head">
        ${icon("light")}
        <input class="section-title-input" type="text" data-dmx-fixture-name="${fixtureIndex}" value="${esc(fixture.name)}" aria-label="Fixture name" />
        <button type="button" class="list-remove" data-remove-dmx-fixture="${fixture.id}" title="Remove fixture" aria-label="Remove ${esc(fixture.name)}">${icon("close")}</button>
      </div>
      <label class="field">Profile
        <select data-dmx-fixture-profile="${fixtureIndex}">
          ${settings.profiles.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === fixture.profileId ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}
        </select>
      </label>
      <div class="field-pair">
        <label class="field">Start channel <input type="number" min="1" max="512" step="1" data-dmx-fixture-start="${fixtureIndex}" value="${fixture.startChannel}" /></label>
        <label class="settings-toggle"><span>Enabled</span><input type="checkbox" data-dmx-fixture-enabled="${fixtureIndex}" ${fixture.enabled ? "checked" : ""} /></label>
      </div>
      <div class="soft-note">Channels ${fixture.startChannel}–${dmxFixtureEndChannel(fixture, profile)} · ${esc(profile?.description || profile?.name || "")}</div>
      ${profile ? `
        <details class="dmx-profile-editor">
          <summary>${profile.channels.length} profile channels</summary>
          <div class="field-pair">
            <label class="field">Sample columns
              <input type="number" min="1" max="32" step="1" value="${profile.sampleResolution.width}" data-dmx-profile-sample-width="${fixtureIndex}" />
            </label>
            <label class="field">Sample rows
              <input type="number" min="1" max="32" step="1" value="${profile.sampleResolution.height}" data-dmx-profile-sample-height="${fixtureIndex}" />
            </label>
          </div>
          ${profile.channels.map((entry, channelIndex) => `
            <div class="dmx-profile-channel">
              <input type="text" value="${esc(entry.name)}" data-dmx-channel-name="${fixtureIndex}:${channelIndex}" aria-label="Channel ${channelIndex + 1} name" />
              <select data-dmx-channel-role="${fixtureIndex}:${channelIndex}" aria-label="Channel ${channelIndex + 1} role">
                ${DMX_CHANNEL_ROLES.map((role) => `<option value="${role}" ${role === entry.role ? "selected" : ""}>${role}</option>`).join("")}
              </select>
              <select data-dmx-channel-feature="${fixtureIndex}:${channelIndex}" aria-label="Channel ${channelIndex + 1} canvas source">
                ${DMX_SAMPLE_FEATURES.map((feature) => `<option value="${feature}" ${feature === entry.sampleFeature ? "selected" : ""}>${feature}</option>`).join("")}
              </select>
              <input type="number" min="1" max="${profile.sampleResolution.width}" step="1" value="${entry.sampleCell.x + 1}" data-dmx-channel-cell-x="${fixtureIndex}:${channelIndex}" aria-label="Channel ${channelIndex + 1} sample column" />
              <input type="number" min="1" max="${profile.sampleResolution.height}" step="1" value="${entry.sampleCell.y + 1}" data-dmx-channel-cell-y="${fixtureIndex}:${channelIndex}" aria-label="Channel ${channelIndex + 1} sample row" />
            </div>
          `).join("")}
          <div class="soft-note">Each channel can sample a feature from one cell of the probe’s grid. A 1×1 profile samples the whole placed probe.</div>
        </details>
      ` : ""}
    </article>
  `;
}

export function midiSettingsTemplate(state = {}, status = {}) {
  const profiles = normalizeMidiInputSettings(state.inputs).midi.profiles;
  const profile = profiles[0];
  if (!profile) {
    return `
      <div class="settings-group">
        <div class="settings-group-title"><span class="material-symbols-rounded">tune</span><span>MIDI controllers</span></div>
        <button type="button" class="chain-add-button" data-add-midi-profile>${icon("add")} Add Akai MIDImix</button>
        <div class="soft-note">Adds one general MIDI input shared by Preview, Output, Live, and every Component animation.</div>
      </div>
    `;
  }
  const statusLabel = status.state === "ready"
    ? `${status.inputCount || 0} input · ${status.feedbackOutputCount || 0} feedback output`
    : status.state === "requesting"
      ? "Waiting for MIDI permission…"
      : status.error || "Ready to connect";
  return `
    <div class="settings-group">
      <div class="settings-group-title"><span class="material-symbols-rounded">tune</span><span>MIDI controller</span></div>
      <div class="midi-profile-row">
        <span class="material-symbols-rounded">graphic_eq</span>
        <span><strong>${esc(profile.name)}</strong><small>${esc(statusLabel)}</small></span>
        <button type="button" class="chain-add-button" data-connect-midi>${status.state === "ready" ? "Connected" : "Connect"}</button>
        <button type="button" class="icon-buttonish" data-remove-midi-profile title="Remove MIDI profile" aria-label="Remove MIDI profile">${icon("delete")}</button>
      </div>
      <button type="button" class="chain-add-button" data-test-midi-leds ${status.feedbackOutputCount ? "" : "disabled"}>${icon("lightbulb")} Test all button LEDs</button>
      ${status.state === "ready" && !status.feedbackOutputCount
        ? `<div class="soft-note is-error">MIDI input is connected, but Chrome exposed no matching MIDImix output port. Available outputs: ${esc((status.outputs || []).map((output) => output.name).join(", ") || "none")}.</div>`
        : ""}
      ${midiAssignmentBankTemplate("Scenes · amber Mute row", status.scenes)}
      ${midiAssignmentBankTemplate("Components · red Record Arm row", status.components)}
      ${midiAssignmentBankTemplate("Significant parameters · bottom knob row", status.parameters)}
      <div class="midi-bank-pager">
        <button type="button" class="icon-buttonish" data-midi-page="-1" ${Number(status.page) <= 0 ? "disabled" : ""}>${icon("chevron_left")}</button>
        <span>Bank ${Number(status.page || 0) + 1} / ${Math.max(1, Number(status.pageCount) || 1)}</span>
        <button type="button" class="icon-buttonish" data-midi-page="1" ${Number(status.page) + 1 >= Number(status.pageCount || 1) ? "disabled" : ""}>${icon("chevron_right")}</button>
      </div>
      <div class="soft-note">Pinned, favorite, and starred items come first; remaining slots use the most recently changed items. Bank Left/Right selects the next eight.</div>
    </div>
  `;
}

export function midiSettingsSignature(state = {}, status = {}) {
  return JSON.stringify({
    profiles: normalizeMidiInputSettings(state.inputs).midi.profiles,
    status,
  });
}

function midiAssignmentBankTemplate(label, assignments = []) {
  return `
    <div class="midi-assignment-bank">
      <small>${esc(label)}</small>
      <div class="midi-assignment-slots">
        ${Array.from({ length: 8 }, (_, index) => {
          const item = assignments?.[index];
          const accent = /^#[0-9a-f]{6}$/i.test(item?.accent || "") ? item.accent : "#777777";
          return `<span class="midi-assignment-slot ${item ? "" : "is-empty"}" title="${esc(item?.name || item?.id || `Empty slot ${index + 1}`)}" style="--midi-accent:${accent}">${item ? esc(item.name || item.id) : index + 1}</span>`;
        }).join("")}
      </div>
    </div>
  `;
}

export function screenCaptureInputsTemplate(inputs = []) {
  if (!inputs.length) return `<div class="screen-capture-empty">No shared inputs.</div>`;
  return inputs.map((input) => `
    <article class="screen-capture-row">
      ${icon("present_to_all")}
      <label class="screen-capture-name">
        <span class="sr-only">Input name</span>
        <input type="text" value="${esc(input.name)}" data-screen-capture-name="${esc(input.id)}" maxlength="120" />
      </label>
      <span class="screen-capture-size">${input.width && input.height ? `${input.width} × ${input.height}` : "Starting…"}</span>
      <button type="button" class="list-remove" data-stop-screen-capture-input="${esc(input.id)}" title="Stop ${esc(input.name)}" aria-label="Stop ${esc(input.name)}">${icon("close")}</button>
    </article>
  `).join("");
}

export function screenCaptureSignature(inputs = []) {
  return inputs.map((input) => `${input.id}:${input.name}:${input.width}x${input.height}`).join("|");
}

export function configuredOutputsTemplate(render) {
  return render.outputs.map((output, index) => `
    <article class="configured-output-card">
      <div class="ui-section-header configured-output-head">
        ${icon("crop_16_9")}
        <input class="section-title-input" type="text" data-settings-update="render.outputs.${index}.name" value="${esc(output.name)}" aria-label="Output ${index + 1} name" />
        <button type="button" class="list-remove" data-remove-output="${esc(output.id)}" title="Remove output" aria-label="Remove ${esc(output.name)}" ${render.outputs.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
      </div>
      ${aspectRatioField("Output aspect ratio", `render.outputs.${index}.aspectRatio`, output.aspectRatio)}
    </article>
  `).join("");
}

function aspectRatioField(label, path, value) {
  return `<label class="field">${label}<input type="number" min="0.05" max="20" step="0.001" data-settings-update="${path}" value="${Math.round(Number(value) * 1000) / 1000}" /></label>`;
}

function settingsTab(id, label, activeTab) {
  const active = activeTab === id;
  return `<button type="button" role="tab" data-settings-tab="${id}" class="${active ? "is-active" : ""}" aria-selected="${active ? "true" : "false"}">${label}</button>`;
}

export function normalizeSettingsTab(value) {
  if (value === "camera" || value === "screen") return "inputs";
  return ["outputs", "inputs", "devices", "rendering"].includes(value) ? value : "outputs";
}

function visiblePanel(id, activeTab) {
  return id === activeTab ? "" : "hidden";
}

function settingsToggle(label, path, checked) {
  return `
    <label class="settings-toggle">
      <span>${label}</span>
      <input type="checkbox" data-settings-update="${path}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function percentRange(label, path, value, min, max, step, marker) {
  return `
    <label class="field range-field">
      <span>${label}</span>
      <output class="range-value" data-range-value data-${marker}-label>${formatRangeValue(value * 100, 1)}%</output>
      <input type="range" min="${min}" max="${max}" step="${step}" data-range-format="percent" data-display-step="1" data-settings-update="${path}" value="${value}" />
    </label>
  `;
}
