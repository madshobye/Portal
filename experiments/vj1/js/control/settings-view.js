import { normalizeRenderSettings, RESOLUTION_CEILING_PRESETS } from "../domain/render-settings.js?v=projector-resolution-ceilings-1";
import { esc, formatRangeValue, icon } from "./template-utils.js?v=flat-orange-sliders-70";
import { screenCaptureStatus } from "../output/screen-capture-service.js?v=screen-input-registry-1";

export function settingsModalTemplate(state, activeTab = "outputs") {
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
          <label class="field">Pixel density <input type="number" min="0.5" max="2" step="0.25" data-settings-update="render.pixelDensity" value="${render.pixelDensity}" /></label>
          <div class="soft-note">Caps both embedded previews and standalone output windows. Lower values reduce render, video-upload, and CPU scheduling pressure.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">tune</span><span>Advanced sampling</span></div>
          <div class="field-pair">
            <label class="field">Surface overscan <input type="number" min="0.5" max="2" step="0.05" data-settings-update="render.sampling.surfaceOverscan" value="${render.sampling.surfaceOverscan}" /></label>
            <label class="field">Surface detail <input type="number" min="0.5" max="2" step="0.05" data-settings-update="render.sampling.recordingFrameScale" value="${render.sampling.recordingFrameScale}" /></label>
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
  return ["outputs", "inputs", "rendering"].includes(value) ? value : "outputs";
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
