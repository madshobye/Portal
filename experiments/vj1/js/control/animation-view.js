import { RENDER_QUALITY_PARAM_ID } from "../libraries/visual-nodes/shared/component-schema.js";
import {
  parameterAnimationTracks,
  parameterAnimationTriggerAddress,
} from "../libraries/composition-engine/shared/parameter-animation-tracks.js";
import { ANIMATION_CURVES } from "../libraries/control-engine/animation-curve/index.js";
import { esc, formatRangeValue, icon } from "./template-utils.js";

const CURVE_LABELS = Object.freeze({
  linear: "Linear",
  smoothstep: "Smoothstep",
  smootherstep: "Smootherstep",
  "quad-in": "Quadratic in",
  "quad-out": "Quadratic out",
  "quad-in-out": "Quadratic in-out",
  "cubic-in": "Cubic in",
  "cubic-out": "Cubic out",
  "cubic-in-out": "Cubic in-out",
  "quart-in": "Quartic in",
  "quart-out": "Quartic out",
  "quart-in-out": "Quartic in-out",
  "sine-in": "Sine in",
  "sine-out": "Sine out",
  "sine-in-out": "Sine in-out",
});

export function parameterAnimationViewTemplate({
  state = {},
  componentId = "",
  targetNodeId = "",
  parameters = [],
} = {}) {
  const numeric = parameters.filter((param) =>
    param?.type === "number" &&
    param.id !== RENDER_QUALITY_PARAM_ID &&
    Number.isFinite(Number(param.min)) &&
    Number.isFinite(Number(param.max)) &&
    Number(param.min) !== Number(param.max)
  );
  const tracks = parameterAnimationTracks(state.nodes, componentId, targetNodeId);
  const parameterById = new Map(numeric.map((param) => [param.id, param]));
  const animated = new Set(tracks.map((track) => track.parameterId));
  const available = numeric.filter((param) => !animated.has(param.id));

  return `
    <section class="parameter-animation-editor" data-animation-editor data-animation-component-id="${esc(componentId)}" data-animation-target-node-id="${esc(targetNodeId)}">
      <div class="parameter-animation-track-list">
        ${tracks.length
          ? tracks.map((track) => animationTrackTemplate(
            track,
            parameterById.get(track.parameterId),
            componentId,
          )).join("")
          : `<div class="soft-note parameter-animation-empty">No parameter animations.</div>`}
      </div>
      ${available.length ? `
        <div class="parameter-animation-add">
          <select class="param-select" data-animation-new-parameter aria-label="Parameter to animate">
            ${available.map((param) => animationParameterOption(param)).join("")}
          </select>
          <button type="button" data-add-parameter-animation>${icon("add")}<span>Add animation</span></button>
        </div>
      ` : numeric.length
        ? `<div class="soft-note">Every numeric parameter already has an animation track.</div>`
        : `<div class="soft-note">This element does not expose numeric parameters yet.</div>`}
    </section>
  `;
}

function animationTrackTemplate(track, parameter = {}, componentId = "") {
  const label = parameter.label || track.parameterId;
  const min = Number.isFinite(Number(parameter.min))
    ? Number(parameter.min)
    : Math.min(track.from, track.to);
  const max = Number.isFinite(Number(parameter.max))
    ? Number(parameter.max)
    : Math.max(track.from, track.to);
  const step = Math.abs(Number(parameter.step)) || Math.max(0.001, Math.abs(max - min) / 100);
  const triggerAddress = parameterAnimationTriggerAddress(componentId, track.id);
  const common = `data-animation-track-id="${esc(track.id)}" data-animation-trigger-address="${esc(triggerAddress)}"`;
  return `
    <article class="parameter-animation-track ${track.enabled ? "is-enabled" : ""}" ${common}>
      <header>
        <button type="button" class="animation-track-enable ${track.enabled ? "is-selected" : ""}" data-toggle-parameter-animation aria-pressed="${track.enabled}" title="${track.enabled ? "Disable" : "Enable"} ${esc(label)} animation">
          ${icon(track.enabled ? "animation" : "motion_photos_off")}
        </button>
        <strong>${esc(label)}</strong>
        <button type="button" class="animation-track-remove" data-remove-parameter-animation title="Remove ${esc(label)} animation" aria-label="Remove ${esc(label)} animation">${icon("close")}</button>
      </header>
      <label class="field">
        <span>Pattern</span>
        <select class="param-select" data-animation-track-field="mode">
          <option value="loop" ${track.mode === "loop" ? "selected" : ""}>Loop</option>
          <option value="ping-pong" ${track.mode === "ping-pong" ? "selected" : ""}>Ping-pong</option>
        </select>
      </label>
      <label class="field">
        <span>Run</span>
        <select class="param-select" data-animation-track-field="runMode">
          <option value="automatic" ${track.runMode === "automatic" ? "selected" : ""}>Automatic</option>
          <option value="triggered" ${track.runMode === "triggered" ? "selected" : ""}>Triggered</option>
        </select>
      </label>
      ${track.runMode === "triggered" ? `
        ${track.mode === "ping-pong" ? `
          <label class="field">
            <span>Trigger behavior</span>
            <select class="param-select" data-animation-track-field="triggerBehavior">
              <option value="full-sequence" ${track.triggerBehavior === "full-sequence" ? "selected" : ""}>Complete sequence</option>
              <option value="next-leg" ${track.triggerBehavior === "next-leg" ? "selected" : ""}>Stop at each end</option>
            </select>
          </label>
        ` : ""}
        <button type="button" class="animation-trigger-button" data-trigger-parameter-animation>
          ${icon("play_arrow")}<span>Trigger</span>
        </button>
      ` : ""}
      <label class="field">
        <span>Curve</span>
        <select class="param-select" data-animation-track-field="curve">
          ${ANIMATION_CURVES.map((curve) => `
            <option value="${esc(curve)}" ${track.curve === curve ? "selected" : ""}>${esc(CURVE_LABELS[curve] || curve)}</option>
          `).join("")}
        </select>
      </label>
      ${track.mode === "ping-pong" ? `
        <button type="button" class="animation-return-toggle ${track.returnMode === "repeat" ? "is-selected" : ""}" data-toggle-animation-return aria-pressed="${track.returnMode === "repeat"}" title="Apply the selected curve independently on the return leg">
          ${icon("swap_vert")}<span>Invert curve on return</span>
        </button>
      ` : ""}
      ${animationRangeTemplate("From", "from", track.from, min, max, step)}
      ${animationRangeTemplate("To", "to", track.to, min, max, step)}
      ${animationRangeTemplate("Cycle duration", "duration", track.duration, 0.05, 60, 0.05, " s")}
      ${animationRangeTemplate("End pause", "pause", track.pause, 0, 30, 0.05, " s")}
      ${track.runMode === "automatic"
        ? animationRangeTemplate("Phase", "phase", track.phase, 0, 1, 0.01)
        : animationRangeTemplate("Random trigger", "randomRate", track.randomRate, 0, 120, 0.5, " / min")}
    </article>
  `;
}

function animationParameterOption(param) {
  const value = clamp(Number(param.value), Number(param.min), Number(param.max));
  const to = approximatelyEqual(value, Number(param.max)) ? Number(param.min) : Number(param.max);
  return `<option value="${esc(param.id)}" data-animation-from="${esc(value)}" data-animation-to="${esc(to)}" data-animation-min="${esc(param.min)}" data-animation-max="${esc(param.max)}">${esc(param.label || param.id)}</option>`;
}

function animationRangeTemplate(label, field, value, min, max, step, suffix = "") {
  return `
    <label class="field range-field">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, step)}${esc(suffix)}</output>
      <input type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" data-animation-track-field="${esc(field)}" data-range-suffix="${esc(suffix)}" />
    </label>
  `;
}

function clamp(value, min, max) {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(min, max), Math.max(Math.min(min, max), safe));
}

function approximatelyEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) <= 1e-9;
}
