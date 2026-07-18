import { normalizeRenderSettings } from "../domain/render-settings.js?v=max-frame-rate-1";
import { esc, formatRangeValue, icon } from "./template-utils.js?v=flat-orange-sliders-70";

export function settingsModalTemplate(state, activeTab = "outputs") {
  const render = normalizeRenderSettings(state.render || {});
  const camera = render.camera;
  return `
    <div class="modal-backdrop"></div>
    <section class="modal-panel settings-modal" data-settings-modal role="dialog" aria-modal="true" aria-label="Project settings">
      <header class="modal-header">
        <div>
          <strong>Project settings</strong>
          <small>Output frame and rendering budget.</small>
        </div>
        <button type="button" class="icon-buttonish" data-close-modal title="Close" aria-label="Close">${icon("close")}</button>
      </header>
      <nav class="settings-tabs" role="tablist" aria-label="Settings sections">
        ${settingsTab("outputs", "Outputs", activeTab)}
        ${settingsTab("camera", "Camera", activeTab)}
        ${settingsTab("rendering", "Rendering", activeTab)}
      </nav>
      <div class="settings-modal-body">
        <section class="ui-section element-section" data-settings-panel="outputs" ${visiblePanel("outputs", activeTab)}>
          <div class="settings-preset-row">
            <button type="button" data-render-preset="wide">960 x 540</button>
            <button type="button" data-render-preset="xga" title="1024 x 768">XGA</button>
            <button type="button" data-render-preset="wxga" title="1280 x 800">WXGA</button>
            <button type="button" data-render-preset="hd" title="1280 x 720">HD</button>
            <button type="button" data-render-preset="fhd" title="1920 x 1080">Full HD</button>
            <button type="button" data-render-preset="wuxga" title="1920 x 1200">WUXGA</button>
            <button type="button" data-render-preset="2k">2K</button>
            <button type="button" data-render-preset="4k">4K</button>
          </div>
          <div class="configured-output-list" data-configured-output-list data-output-signature="${esc(render.outputs.map((output) => output.id).join("|"))}">
            ${configuredOutputsTemplate(render)}
          </div>
          <button type="button" class="chain-add-button" data-add-output>${icon("add")} Add output</button>
          <div class="soft-note">Outputs are arranged side by side in the Scene mapping workspace.</div>
        </section>
        <section class="ui-section element-section" data-settings-panel="camera" ${visiblePanel("camera", activeTab)}>
          <div class="settings-preset-row">
            <button type="button" data-camera-preset="sd">640 x 480</button>
            <button type="button" data-camera-preset="hd">HD</button>
            <button type="button" data-camera-preset="fhd">Full HD</button>
            <button type="button" data-camera-preset="4k">4K</button>
          </div>
          <div class="field-pair">
            <label class="field">Width <input type="number" min="160" max="7680" step="1" data-settings-update="render.camera.width" value="${camera.width}" /></label>
            <label class="field">Height <input type="number" min="120" max="4320" step="1" data-settings-update="render.camera.height" value="${camera.height}" /></label>
          </div>
          <label class="field">Camera direction
            <select data-settings-update="render.camera.facingMode">
              <option value="user" ${camera.facingMode === "user" ? "selected" : ""}>Front</option>
              <option value="environment" ${camera.facingMode === "environment" ? "selected" : ""}>Rear / external</option>
            </select>
          </label>
          ${settingsToggle("Mirror camera image", "render.camera.mirrored", camera.mirrored)}
          ${settingsToggle("Use maximum supported resolution", "render.camera.maxResolution", camera.maxResolution)}
          <div class="soft-note">The browser chooses the closest supported mode. Changing Camera settings restarts an active capture.</div>
        </section>
        <section class="ui-section element-section settings-rendering-panel" data-settings-panel="rendering" ${visiblePanel("rendering", activeTab)}>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">aspect_ratio</span><span>Component initial size</span></div>
          <div class="field-pair">
            <label class="field">Width <input type="number" min="64" max="8192" step="1" data-settings-update="render.componentTexture.width" value="${render.componentTexture.width}" /></label>
            <label class="field">Height <input type="number" min="64" max="8192" step="1" data-settings-update="render.componentTexture.height" value="${render.componentTexture.height}" /></label>
          </div>
          <div class="soft-note">Defines the starting frame geometry and aspect. Runtime texture resolution follows the largest visible render demand.</div>
          </div>
          <div class="settings-group">
          <div class="settings-group-title"><span class="material-symbols-rounded">texture</span><span>Surface texture</span></div>
          <label class="field">Resolution policy
            <select data-settings-update="render.surfaceTexture.mode">
              <option value="auto" ${render.surfaceTexture.mode === "auto" ? "selected" : ""}>Auto · projected pixel demand</option>
              <option value="manual" ${render.surfaceTexture.mode === "manual" ? "selected" : ""}>Manual maximum</option>
            </select>
          </label>
          <div class="field-pair" data-manual-surface-texture ${render.surfaceTexture.mode === "manual" ? "" : "hidden"}>
            <label class="field">Max width <input type="number" min="64" max="8192" step="1" data-settings-update="render.surfaceTexture.maxWidth" value="${render.surfaceTexture.maxWidth}" /></label>
            <label class="field">Max height <input type="number" min="64" max="8192" step="1" data-settings-update="render.surfaceTexture.maxHeight" value="${render.surfaceTexture.maxHeight}" /></label>
          </div>
          <div class="soft-note">Auto follows visible projected-pixel demand. Manual only limits the final per-surface raster; it never changes component dimensions.</div>
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
            <label class="field">Recording frame <input type="number" min="0.5" max="2" step="0.05" data-settings-update="render.sampling.recordingFrameScale" value="${render.sampling.recordingFrameScale}" /></label>
          </div>
          ${settingsToggle("Limit Canvas raster to logical size", "render.sampling.limitCanvasToLogicalSize", render.sampling.limitCanvasToLogicalSize)}
          <div class="soft-note">Independent raster-demand multipliers. Both default to 1×; recording frames can be lowered to 0.5× for lower Canvas cost.</div>
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

export function configuredOutputsTemplate(render) {
  return render.outputs.map((output, index) => `
    <article class="configured-output-card">
      <div class="ui-section-header configured-output-head">
        ${icon("crop_16_9")}
        <input class="section-title-input" type="text" data-settings-update="render.outputs.${index}.name" value="${esc(output.name)}" aria-label="Output ${index + 1} name" />
        <button type="button" class="list-remove" data-remove-output="${esc(output.id)}" title="Remove output" aria-label="Remove ${esc(output.name)}" ${render.outputs.length <= 1 ? "disabled" : ""}>${icon("close")}</button>
      </div>
      <div class="field-pair">
        <label class="field">Width <input type="number" min="128" max="8192" step="1" data-settings-update="render.outputs.${index}.width" value="${output.width}" /></label>
        <label class="field">Height <input type="number" min="128" max="8192" step="1" data-settings-update="render.outputs.${index}.height" value="${output.height}" /></label>
      </div>
    </article>
  `).join("");
}

function settingsTab(id, label, activeTab) {
  const active = activeTab === id;
  return `<button type="button" role="tab" data-settings-tab="${id}" class="${active ? "is-active" : ""}" aria-selected="${active ? "true" : "false"}">${label}</button>`;
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
