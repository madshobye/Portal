import { ANIMATION_CURVES } from "../../control-engine/animation-curve/index.js";
import { defineUiNode, UI_COMMAND_PHASES } from "../ui-node.js";

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

const COMBINATION_LABELS = Object.freeze({
  replace: "Replace base value",
  add: "Add to base value",
  multiply: "Multiply base value",
});

const GENERIC_ANIMATION_SUGGESTIONS = Object.freeze([
  {
    id: "generic-triggered-envelope",
    label: "Triggered envelope",
    transportKind: "envelope",
    triggerKind: "manual",
    envelopeSegments: [
      { duration: 0.1, value: 1, curve: "quad-out" },
      { duration: 0.35, value: 0, curve: "quad-in" },
    ],
  },
  {
    id: "generic-noise-drift",
    label: "Noise drift",
    transportKind: "noise",
    noiseRate: 0.6,
    noiseDetail: 2,
    noiseRoughness: 0.45,
    smoothing: 0.08,
  },
  {
    id: "generic-noise-burst",
    label: "Triggered noise burst",
    transportKind: "noise",
    noiseBurst: true,
    triggerKind: "manual",
    noiseRate: 8,
    noiseDetail: 3,
    noiseRoughness: 0.65,
    envelopeSegments: [
      { duration: 0.03, value: 1, curve: "quad-out" },
      { duration: 0.45, value: 0, curve: "cubic-out" },
    ],
    smoothing: 0.02,
  },
]);

export const ParameterAnimationEditorNode = defineUiNode({
  id: "core.ui.parameter-animation-editor",
  name: "Parameter Animation Editor",
  version: "0.1.0",
  description: "Retained parameter-track editor that owns its markup, local form state, and semantic edit events.",
  inlets: { model: { type: "any", required: true } },
  outlets: { edit: { type: "event", optional: true } },
  events: ["edit"],
  capabilities: ["ui-control", "ui-parameter-animation-editor"],
  factory: createParameterAnimationEditorInstance,
});

function createParameterAnimationEditorInstance({ host, inputs: initialInputs, document, emit }) {
  let inputs = initialInputs || {};
  let root = null;

  function mount() {
    root = document.createElement("div");
    root.className = "ui-node-parameter-animation-editor";
    root.dataset.uiNodeOwned = "parameter-animation-editor";
    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
    host.replaceChildren(root);
    update(inputs);
  }

  function update(nextInputs = {}) {
    inputs = nextInputs || {};
    root.innerHTML = renderParameterAnimationEditor(inputs.model || {});
  }

  function onInput(event) {
    const input = event.target?.closest?.('input[type="range"]');
    if (input && root.contains(input)) syncOwnedRangeValue(input);
  }

  function onClick(event) {
    const target = event.target?.closest?.("button");
    if (!target || !root.contains(target)) return;
    const editor = target.closest("[data-animation-editor]");
    const track = target.closest("[data-animation-track-id]");
    const context = animationContext(editor, track);
    if (target.matches("[data-add-parameter-animation]")) {
      const option = editor.querySelector("[data-animation-new-parameter]")?.selectedOptions?.[0];
      if (option) dispatch("add-track", context, { track: trackFromParameterOption(option) });
    } else if (target.matches("[data-add-parameter-event]")) {
      const parameterId = editor.querySelector("[data-animation-new-event]")?.value || "";
      if (parameterId) dispatch("add-event", context, { parameterId });
    } else if (target.matches("[data-add-animation-suggestion]")) {
      const option = suggestionParameterOption(editor, target);
      if (option) dispatch("add-track", context, { track: trackFromSuggestion(target, option) });
    } else if (target.matches("[data-toggle-parameter-animation]")) {
      dispatch("update-track", context, { patch: { enabled: target.getAttribute("aria-pressed") !== "true" } });
    } else if (target.matches("[data-remove-parameter-animation]")) {
      dispatch("remove-track", context);
    } else if (target.matches("[data-trigger-parameter-animation]")) {
      dispatch("trigger-track", context, { address: track?.dataset.animationTriggerAddress || "" });
    } else if (target.matches("[data-toggle-animation-return]")) {
      dispatch("update-track", context, { patch: { returnMode: target.getAttribute("aria-pressed") === "true" ? "retrace" : "repeat" } });
    } else if (target.matches("[data-toggle-animation-noise-burst]")) {
      dispatch("update-track", context, { patch: { noiseBurst: target.getAttribute("aria-pressed") !== "true" } });
    } else if (target.matches("[data-remove-animation-envelope-segment]")) {
      target.closest("[data-animation-envelope-segment]")?.remove();
      dispatch("update-track", context, { patch: { envelopeSegments: readEnvelopeSegments(track) } });
    } else if (target.matches("[data-add-animation-envelope-segment]")) {
      const segments = readEnvelopeSegments(track);
      const last = segments.at(-1);
      dispatch("update-track", context, { patch: { envelopeSegments: [...segments, { duration: 0.2, value: last?.value >= 0.5 ? 0 : 1, curve: "linear" }] } });
    }
  }

  function onChange(event) {
    const input = event.target;
    const editor = input?.closest?.("[data-animation-editor]");
    const track = input?.closest?.("[data-animation-track-id]");
    if (!editor || !root.contains(editor)) return;
    const context = animationContext(editor, track);
    if (input.matches("[data-animation-target-parameter]")) {
      const option = input.selectedOptions?.[0];
      if (!option) return;
      dispatch("update-track", context, { patch: track?.dataset.animationTrackKind === "event"
        ? { parameterId: option.value }
        : { parameterId: option.value, baseValue: Number(option.dataset.animationBase), targetRange: [Number(option.dataset.animationMin), Number(option.dataset.animationMax)] } });
    } else if (input.matches("[data-animation-driver]")) {
      const option = input.selectedOptions?.[0];
      if (option) dispatch("update-track", context, { patch: { sourceKind: option.dataset.animationSourceKind || "timeline", sourceAddress: option.dataset.animationSourceAddress || "", transportKind: option.dataset.animationTransportKind || "sequence" } });
    } else if (input.matches("[data-animation-trigger-source]")) {
      const option = input.selectedOptions?.[0];
      if (option) dispatch("update-track", context, { patch: { triggerKind: option.dataset.animationTriggerKind || "manual", triggerAddress: option.dataset.animationTriggerAddress || "" } });
    } else if (input.matches("[data-envelope-segment-field]")) {
      dispatch("update-track", context, { patch: { envelopeSegments: readEnvelopeSegments(track) } });
    } else if (input.matches("[data-animation-track-field]")) {
      const field = input.dataset.animationTrackField;
      const value = ["mode", "curve", "runMode", "triggerBehavior", "combination"].includes(field) ? input.value : Number(input.value);
      dispatch("update-track", context, { patch: { [field]: value } });
    }
  }

  function dispatch(operation, context, detail = {}) {
    emit("edit", { operation, ...context, ...detail }, UI_COMMAND_PHASES.COMMIT);
  }

  function dispose() {
    root?.removeEventListener("click", onClick);
    root?.removeEventListener("change", onChange);
    root?.removeEventListener("input", onInput);
    root?.remove();
    root = null;
  }

  return Object.freeze({ mount, update, dispose, element: () => root });
}

export function renderParameterAnimationEditor({
  componentId = "",
  targetNodeId = "",
  numeric = [],
  events = [],
  tracks = [],
  signalSources = [],
  triggerSources = [],
  significantAnimationParams = [],
} = {}) {
  const numericTracks = tracks.filter((track) => track.kind !== "event");
  const eventTracks = tracks.filter((track) => track.kind === "event");
  const parameterById = new Map(numeric.map((param) => [param.id, param]));
  const animated = new Set(numericTracks.map((track) => track.parameterId));
  const automatedEvents = new Set(
    eventTracks.map((track) => track.parameterId),
  );
  const available = numeric.filter((param) => !animated.has(param.id));
  const availableEvents = events.filter((param) =>
    !automatedEvents.has(param.id)
  );
  const parameterSuggestions = available.flatMap((param) =>
    parameterAnimationSuggestions(param).map((suggestion) => ({ param, suggestion }))
  );

  return `
    <section class="parameter-animation-editor" data-animation-editor data-animation-component-id="${esc(componentId)}" data-animation-target-node-id="${esc(targetNodeId)}">
      <div class="parameter-animation-track-list">
        ${tracks.length
          ? tracks.map((track) => track.kind === "event"
            ? eventAnimationTrackTemplate(
                track,
                events.find((param) => param.id === track.parameterId),
                componentId,
                triggerSources,
                events.filter((param) =>
                  param.id === track.parameterId ||
                  !automatedEvents.has(param.id)
                ),
                significantAnimationParams,
              )
            : animationTrackTemplate(
                track,
                parameterById.get(track.parameterId),
                componentId,
                signalSources,
                triggerSources,
                numeric.filter((param) =>
                  param.id === track.parameterId || !animated.has(param.id)
                ),
                significantAnimationParams,
              )).join("")
          : `<div class="soft-note parameter-animation-empty">No parameter animations.</div>`}
      </div>
      ${available.length ? `
        <div class="parameter-animation-add">
          <select class="param-select" data-animation-new-parameter aria-label="Parameter to animate">
            ${available.map((param) => animationParameterOption(param)).join("")}
          </select>
          <button
            type="button"
            class="icon-buttonish parameter-animation-add-button"
            data-add-parameter-animation
            title="Add animation for selected parameter"
            aria-label="Add animation for selected parameter"
          >${icon("add")}</button>
        </div>
        ${parameterSuggestions.length ? `
          <div class="parameter-animation-suggestions">
            <span class="soft-note">Recommended for this element</span>
            ${parameterSuggestions.map(({ param, suggestion }) =>
              animationSuggestionTemplate(param, suggestion, { showParameter: true })
            ).join("")}
          </div>
        ` : ""}
        <div class="parameter-animation-suggestions">
          <span class="soft-note">Animation recipes for selected parameter</span>
          ${GENERIC_ANIMATION_SUGGESTIONS.map((suggestion) =>
            animationSuggestionTemplate(null, suggestion)
          ).join("")}
        </div>
      ` : numeric.length
        ? `<div class="soft-note">Every numeric parameter already has an animation track.</div>`
        : events.length
          ? ""
          : `<div class="soft-note">This element does not expose numeric parameters yet.</div>`}
      ${events.length ? `
        <div class="parameter-animation-suggestions">
          <span class="soft-note">Event automation</span>
        </div>
        ${availableEvents.length ? `
          <div class="parameter-animation-add">
            <select class="param-select" data-animation-new-event aria-label="Event to automate">
              ${availableEvents.map((param) =>
                `<option value="${esc(param.id)}">${esc(param.label || param.id)}</option>`
              ).join("")}
            </select>
            <button
              type="button"
              class="icon-buttonish parameter-animation-add-button"
              data-add-parameter-event
              title="Add event automation"
              aria-label="Add event automation"
            >${icon("add")}</button>
          </div>
        ` : `<div class="soft-note">Every event already has an automation track.</div>`}
      ` : ""}
    </section>
  `;
}

function animationTrackTemplate(
  track,
  parameter = {},
  componentId = "",
  signalSources = [],
  triggerSources = [],
  parameterTargets = [],
  significantAnimationParams = [],
) {
  const label = parameter.label || track.parameterId;
  const min = Number.isFinite(Number(parameter.min))
    ? Number(parameter.min)
    : Math.min(track.from, track.to);
  const max = Number.isFinite(Number(parameter.max))
    ? Number(parameter.max)
    : Math.max(track.from, track.to);
  const step = Math.abs(Number(parameter.step)) || Math.max(0.001, Math.abs(max - min) / 100);
  const mapping = animationMappingRange(track.combination, min, max);
  const triggerAddress = track.triggerSignalAddress || "";
  const common = `data-animation-track-id="${esc(track.id)}" data-animation-trigger-address="${esc(triggerAddress)}"`;
  const rangeContext = {
    componentId,
    targetNodeId: track.targetNodeId,
    trackId: track.id,
    significantAnimationParams,
  };
  const range = (rangeLabel, field, value, rangeMin, rangeMax, rangeStep, suffix = "") =>
    animationRangeTemplate(
      rangeLabel,
      field,
      value,
      rangeMin,
      rangeMax,
      rangeStep,
      suffix,
      rangeContext,
    );
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
        <span>Parameter</span>
        <select class="param-select" data-animation-target-parameter>
          ${parameterTargets.map((target) =>
            animationTargetParameterOption(target, track.parameterId)
          ).join("")}
        </select>
      </label>
      <label class="field">
        <span>Driver</span>
        <select class="param-select" data-animation-driver>
          ${signalSources.map((source) => `
            <option
              value="${esc(`${source.kind}:${source.address}`)}"
              data-animation-source-kind="${esc(source.kind)}"
              data-animation-source-address="${esc(source.address)}"
              data-animation-transport-kind="${esc(source.transportKind || "sequence")}"
              ${(track.sourceKind || "timeline") === source.kind &&
                (track.sourceAddress || "") === source.address &&
                (track.transportKind || "sequence") === (source.transportKind || "sequence") ? "selected" : ""}
            >${esc(source.label)}</option>
          `).join("")}
        </select>
      </label>
      ${(track.sourceKind || "timeline") === "timeline" && (track.transportKind || "sequence") === "sequence" ? `
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
        ${animationTriggerTemplate(track, triggerSources, rangeContext)}
      ` : ""}
      ` : ""}
      ${(track.sourceKind || "timeline") === "timeline" && track.transportKind === "envelope" ? `
        ${animationTriggerTemplate(track, triggerSources, rangeContext)}
        ${range("Initial", "envelopeInitial", track.envelopeInitial, 0, 1, 0.01)}
        <div class="animation-envelope-segments" data-animation-envelope-segments>
          ${(track.envelopeSegments || []).map((segment, index) =>
            animationEnvelopeSegmentTemplate(segment, index)
          ).join("")}
        </div>
        <button type="button" class="secondary" data-add-animation-envelope-segment>
          ${icon("add")}<span>Add envelope step</span>
        </button>
      ` : ""}
      ${(track.sourceKind || "timeline") === "timeline" && track.transportKind === "noise" ? `
        ${range("Noise speed", "noiseRate", track.noiseRate, 0.01, 20, 0.01, "×")}
        ${range("Noise detail", "noiseDetail", track.noiseDetail, 1, 4, 1)}
        ${range("Noise roughness", "noiseRoughness", track.noiseRoughness, 0, 1, 0.01)}
        ${range("Noise seed", "noiseSeed", track.noiseSeed, 1, 10000, 1)}
        <button type="button" class="animation-noise-burst-toggle ${track.noiseBurst ? "is-selected" : ""}" data-toggle-animation-noise-burst aria-pressed="${track.noiseBurst === true}">
          ${icon("bolt")}<span>Trigger as burst</span>
        </button>
        ${track.noiseBurst ? `
          ${animationTriggerTemplate(track, triggerSources, rangeContext)}
          <div class="animation-envelope-segments" data-animation-envelope-segments>
            ${(track.envelopeSegments || []).map((segment, index) =>
              animationEnvelopeSegmentTemplate(segment, index)
            ).join("")}
          </div>
          <button type="button" class="secondary" data-add-animation-envelope-segment>
            ${icon("add")}<span>Add burst step</span>
          </button>
        ` : ""}
      ` : ""}
      ${(track.sourceKind || "timeline") === "timeline" && (track.transportKind || "sequence") === "sequence" ? `
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
      ` : ""}
      <label class="field">
        <span>Combine</span>
        <select class="param-select" data-animation-track-field="combination">
          ${Object.entries(COMBINATION_LABELS).map(([mode, modeLabel]) => `
            <option value="${esc(mode)}" ${track.combination === mode ? "selected" : ""}>${esc(modeLabel)}</option>
          `).join("")}
        </select>
      </label>
      ${range("From", "from", track.from, mapping.min, mapping.max, mapping.step || step)}
      ${range("To", "to", track.to, mapping.min, mapping.max, mapping.step || step)}
      ${range("Running average", "smoothing", track.smoothing || 0, 0, 5, 0.01, " s")}
      ${(track.sourceKind || "timeline") === "timeline" && (track.transportKind || "sequence") === "sequence" ? `
      ${range("Cycle duration", "duration", track.duration, 0.05, 60, 0.05, " s")}
      ${range("End pause", "pause", track.pause, 0, 30, 0.05, " s")}
      ${track.runMode === "automatic"
        ? range("Phase", "phase", track.phase, 0, 1, 0.01)
        : ""}
      ` : ""}
    </article>
  `;
}

function eventAnimationTrackTemplate(
  track,
  parameter = {},
  componentId = "",
  triggerSources = [],
  eventTargets = [],
  significantAnimationParams = [],
) {
  const label = parameter.label || track.parameterId;
  const triggerAddress = track.triggerSignalAddress || "";
  return `
    <article class="parameter-animation-track is-event-track ${track.enabled ? "is-enabled" : ""}"
      data-animation-track-id="${esc(track.id)}"
      data-animation-track-kind="event"
      data-animation-trigger-address="${esc(triggerAddress)}">
      <header>
        <button type="button" class="animation-track-enable ${track.enabled ? "is-selected" : ""}" data-toggle-parameter-animation aria-pressed="${track.enabled}" title="${track.enabled ? "Disable" : "Enable"} ${esc(label)} automation">
          ${icon(track.enabled ? "bolt" : "motion_photos_off")}
        </button>
        <strong>${esc(label)}</strong>
        <button type="button" class="animation-track-remove" data-remove-parameter-animation title="Remove ${esc(label)} automation" aria-label="Remove ${esc(label)} automation">${icon("close")}</button>
      </header>
      <label class="field">
        <span>Event</span>
        <select class="param-select" data-animation-target-parameter>
          ${eventTargets.map((target) => `
            <option value="${esc(target.id)}" ${target.id === track.parameterId ? "selected" : ""}>
              ${esc(target.label || target.id)}
            </option>
          `).join("")}
        </select>
      </label>
      ${animationTriggerTemplate(track, triggerSources, {
        componentId,
        targetNodeId: track.targetNodeId,
        trackId: track.id,
        significantAnimationParams,
      })}
    </article>
  `;
}

function animationTriggerTemplate(track, triggerSources = [], rangeContext = null) {
  const triggerKind = track.triggerKind || (track.randomRate > 0 ? "random" : "manual");
  const triggerAddress = track.triggerAddress || "";
  return `
    <label class="field">
      <span>Trigger source</span>
      <select class="param-select" data-animation-trigger-source>
        ${triggerSources.map((source) => `
          <option
            value="${esc(`${source.kind}:${source.address}`)}"
            data-animation-trigger-kind="${esc(source.kind)}"
            data-animation-trigger-address="${esc(source.address)}"
            ${triggerKind === source.kind && triggerAddress === source.address ? "selected" : ""}
          >${esc(source.label)}</option>
        `).join("")}
      </select>
    </label>
    ${triggerKind === "manual" ? `
      <button type="button" class="animation-trigger-button" data-trigger-parameter-animation>
        ${icon("play_arrow")}<span>Trigger</span>
      </button>
    ` : ""}
    ${triggerKind === "periodic"
      ? animationRangeTemplate("Trigger interval", "triggerInterval", track.triggerInterval, 0.05, 60, 0.05, " s", rangeContext)
      : ""}
    ${triggerKind === "random"
      ? animationRangeTemplate("Random trigger", "randomRate", track.randomRate, 0, 120, 0.5, " / min", rangeContext)
      : ""}
    ${triggerKind === "probe"
      ? animationRangeTemplate("Trigger threshold", "triggerThreshold", track.triggerThreshold, 0, 1, 0.01, "", rangeContext)
      : ""}
  `;
}

function animationEnvelopeSegmentTemplate(segment = {}, index = 0) {
  return `
    <fieldset class="animation-envelope-segment" data-animation-envelope-segment>
      <legend>Step ${index + 1}</legend>
      ${animationEnvelopeRangeTemplate("Target", "value", segment.value, 0, 1, 0.01)}
      ${animationEnvelopeRangeTemplate("Duration", "duration", segment.duration, 0.01, 10, 0.01, " s")}
      <label class="field">
        <span>Curve</span>
        <select class="param-select" data-envelope-segment-field="curve">
          ${ANIMATION_CURVES.map((curve) => `
            <option value="${esc(curve)}" ${segment.curve === curve ? "selected" : ""}>${esc(CURVE_LABELS[curve] || curve)}</option>
          `).join("")}
        </select>
      </label>
      <button type="button" class="secondary" data-remove-animation-envelope-segment>
        ${icon("close")}<span>Remove step</span>
      </button>
    </fieldset>
  `;
}

function animationEnvelopeRangeTemplate(label, field, value, min, max, step, suffix = "") {
  return `
    <label class="field range-field">
      <span>${esc(label)}</span>
      <output class="range-value" data-range-value>${formatRangeValue(value, step)}${esc(suffix)}</output>
      <input type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" data-envelope-segment-field="${esc(field)}" data-range-suffix="${esc(suffix)}" />
    </label>
  `;
}

function animationParameterOption(param) {
  const value = clamp(Number(param.value), Number(param.min), Number(param.max));
  const to = approximatelyEqual(value, Number(param.max)) ? Number(param.min) : Number(param.max);
  return `<option value="${esc(param.id)}" data-animation-from="${esc(value)}" data-animation-to="${esc(to)}" data-animation-min="${esc(param.min)}" data-animation-max="${esc(param.max)}">${esc(param.label || param.id)}</option>`;
}

function animationTargetParameterOption(param, selectedParameterId = "") {
  const value = clamp(Number(param.value), Number(param.min), Number(param.max));
  return `
    <option
      value="${esc(param.id)}"
      data-animation-base="${esc(value)}"
      data-animation-min="${esc(param.min)}"
      data-animation-max="${esc(param.max)}"
      ${param.id === selectedParameterId ? "selected" : ""}
    >${esc(param.label || param.id)}</option>
  `;
}

function parameterAnimationSuggestions(param = {}) {
  const templates = [
    ...(param.defaultAnimation ? [param.defaultAnimation] : []),
    ...(param.suggestedAnimations || []),
  ];
  const seen = new Set();
  return templates.filter((template) => {
    const id = String(template?.id || "");
    if (!id || !seen.has(id)) {
      if (id) seen.add(id);
      return true;
    }
    return false;
  });
}

function animationSuggestionTemplate(param, suggestion = {}, { showParameter = false } = {}) {
  const hasParameter = !!param?.id;
  const value = hasParameter
    ? clamp(Number(param.value), Number(param.min), Number(param.max))
    : 0;
  const from = Number.isFinite(Number(suggestion.from)) ? Number(suggestion.from) : value;
  const to = Number.isFinite(Number(suggestion.to))
    ? Number(suggestion.to)
    : hasParameter && approximatelyEqual(value, Number(param.max))
      ? Number(param.min)
      : hasParameter ? Number(param.max) : 1;
  const targetAttributes = hasParameter
    ? `
      data-animation-parameter="${esc(param.id)}"
      data-animation-base="${esc(value)}"
      data-animation-min="${esc(param.min)}"
      data-animation-max="${esc(param.max)}"
      data-animation-from="${esc(from)}"
      data-animation-to="${esc(to)}"`
    : `data-animation-use-selected-parameter="true"`;
  const label = `${showParameter ? `${param.label || param.id} · ` : ""}${suggestion.label || "Animation"}`;
  return `
    <button
      type="button"
      class="secondary"
      data-add-animation-suggestion
      ${targetAttributes}
      data-animation-mode="${esc(suggestion.mode || "loop")}"
      data-animation-duration="${esc(suggestion.duration ?? 2)}"
      data-animation-phase="${esc(suggestion.phase ?? 0)}"
      data-animation-curve="${esc(suggestion.curve || "linear")}"
      data-animation-return-mode="${esc(suggestion.returnMode || "retrace")}"
      data-animation-pause="${esc(suggestion.pause ?? 0)}"
      data-animation-run-mode="${esc(suggestion.runMode || "automatic")}"
      data-animation-trigger-behavior="${esc(suggestion.triggerBehavior || "full-sequence")}"
      data-animation-random-rate="${esc(suggestion.randomRate ?? 0)}"
      data-animation-combination="${esc(suggestion.combination || "replace")}"
      data-animation-transport-kind="${esc(suggestion.transportKind || "sequence")}"
      data-animation-envelope-initial="${esc(suggestion.envelopeInitial ?? 0)}"
      data-animation-envelope-segments="${esc(JSON.stringify(suggestion.envelopeSegments || []))}"
      data-animation-trigger-kind="${esc(suggestion.triggerKind || "manual")}"
      data-animation-trigger-address="${esc(suggestion.triggerAddress || "")}"
      data-animation-trigger-threshold="${esc(suggestion.triggerThreshold ?? 0.5)}"
      data-animation-trigger-interval="${esc(suggestion.triggerInterval ?? 1)}"
      data-animation-noise-rate="${esc(suggestion.noiseRate ?? 1)}"
      data-animation-noise-seed="${esc(suggestion.noiseSeed ?? "")}"
      data-animation-noise-detail="${esc(suggestion.noiseDetail ?? 2)}"
      data-animation-noise-roughness="${esc(suggestion.noiseRoughness ?? 0.5)}"
      data-animation-noise-burst="${suggestion.noiseBurst === true}"
      data-animation-smoothing="${esc(suggestion.smoothing ?? 0)}"
    >${icon("animation")}<span>${esc(label)}</span></button>
  `;
}

function animationRangeTemplate(label, field, value, min, max, step, suffix = "", context = null) {
  const significant = context?.significantAnimationParams?.some((entry) =>
    String(entry.trackId) === String(context.trackId) &&
    String(entry.targetNodeId) === String(context.targetNodeId) &&
    entry.field === field
  );
  const contextPath = `animation:${context?.targetNodeId || ""}:${context?.trackId || ""}:${field}`;
  const contextAttributes = context?.componentId ? [
    `data-param-context-path="${esc(contextPath)}"`,
    'data-param-context-kind="animation"',
    `data-param-context-component-id="${esc(context.componentId)}"`,
    `data-param-context-animation-target-node-id="${esc(context.targetNodeId)}"`,
    `data-param-context-animation-track-id="${esc(context.trackId)}"`,
    `data-param-context-animation-field="${esc(field)}"`,
    `data-param-context-animation-label="${esc(label)}"`,
    `data-param-context-animation-min="${esc(min)}"`,
    `data-param-context-animation-max="${esc(max)}"`,
    `data-param-context-animation-step="${esc(step)}"`,
    'data-param-context-resettable="false"',
  ].join(" ") : "";
  return `
    <label class="field range-field param-context-target${significant ? " is-significant" : ""}" ${contextAttributes}>
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

function animationMappingRange(combination, min, max) {
  const low = Math.min(Number(min), Number(max));
  const high = Math.max(Number(min), Number(max));
  if (combination === "add") {
    const span = Math.max(high - low, 0.000001);
    return { min: -span, max: span, step: span / 100 };
  }
  if (combination === "multiply") {
    return { min: -4, max: 4, step: 0.01 };
  }
  return { min: low, max: high };
}

function animationContext(editor, track) {
  return {
    componentId: String(editor?.dataset.animationComponentId || ""),
    targetNodeId: String(editor?.dataset.animationTargetNodeId || ""),
    trackId: String(track?.dataset.animationTrackId || ""),
  };
}

function trackFromParameterOption(option) {
  return {
    parameterId: option.value,
    from: Number(option.dataset.animationFrom),
    to: Number(option.dataset.animationTo),
    baseValue: Number(option.dataset.animationFrom),
    targetRange: [Number(option.dataset.animationMin), Number(option.dataset.animationMax)],
    duration: 2,
  };
}

function suggestionParameterOption(editor, button) {
  const select = editor.querySelector("[data-animation-new-parameter]");
  const explicit = button.dataset.animationParameter || "";
  return explicit
    ? [...(select?.options || [])].find((option) => option.value === explicit)
    : select?.selectedOptions?.[0];
}

function trackFromSuggestion(button, option) {
  const number = (name, fallback) => Number(button.dataset[name] ?? fallback);
  return {
    parameterId: button.dataset.animationParameter || option.value,
    baseValue: number("animationBase", option.dataset.animationFrom),
    targetRange: [number("animationMin", option.dataset.animationMin), number("animationMax", option.dataset.animationMax)],
    from: number("animationFrom", option.dataset.animationFrom),
    to: number("animationTo", option.dataset.animationTo),
    mode: button.dataset.animationMode,
    duration: number("animationDuration", 2),
    phase: number("animationPhase", 0),
    curve: button.dataset.animationCurve,
    returnMode: button.dataset.animationReturnMode,
    pause: number("animationPause", 0),
    runMode: button.dataset.animationRunMode,
    triggerBehavior: button.dataset.animationTriggerBehavior,
    randomRate: number("animationRandomRate", 0),
    combination: button.dataset.animationCombination,
    transportKind: button.dataset.animationTransportKind || "sequence",
    envelopeInitial: number("animationEnvelopeInitial", 0),
    envelopeSegments: parseEnvelopeSegments(button.dataset.animationEnvelopeSegments),
    triggerKind: button.dataset.animationTriggerKind || "manual",
    triggerAddress: button.dataset.animationTriggerAddress || "",
    triggerThreshold: number("animationTriggerThreshold", 0.5),
    triggerInterval: number("animationTriggerInterval", 1),
    noiseRate: number("animationNoiseRate", 1),
    noiseSeed: button.dataset.animationNoiseSeed === "" ? undefined : number("animationNoiseSeed", undefined),
    noiseDetail: number("animationNoiseDetail", 2),
    noiseRoughness: number("animationNoiseRoughness", 0.5),
    noiseBurst: button.dataset.animationNoiseBurst === "true",
    smoothing: number("animationSmoothing", 0),
  };
}

function readEnvelopeSegments(track) {
  return [...(track?.querySelectorAll("[data-animation-envelope-segment]") || [])].map((segment) => ({
    value: Number(segment.querySelector('[data-envelope-segment-field="value"]')?.value) || 0,
    duration: Number(segment.querySelector('[data-envelope-segment-field="duration"]')?.value) || 0.1,
    curve: segment.querySelector('[data-envelope-segment-field="curve"]')?.value || "linear",
  }));
}

function parseEnvelopeSegments(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function syncOwnedRangeValue(input) {
  const output = input.closest(".range-field")?.querySelector("[data-range-value]");
  if (output) output.textContent = `${formatRangeValue(input.value, input.step)}${input.dataset.rangeSuffix || ""}`;
}

function formatRangeValue(value, step = 0.01) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  const increment = Math.abs(Number(step)) || 0.01;
  const decimals = increment >= 1 ? 0 : increment >= 0.1 ? 1 : increment >= 0.01 ? 2 : 3;
  return number.toFixed(decimals);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${esc(name)}</span>`;
}
