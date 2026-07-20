import { listGeneratorNodeComponents as listGeneratorComponents, listEffectNodeComponents as listShaderComponents } from "../libraries/visual-nodes/index.js?v=node-catalog-14";
import { patchNodeDegree, planCompositorInputs, planPatchExecution, summarizeTextureBranches } from "../graph/patch-planner.js";
import { compileComponentPatch } from "../graph/render-scheduler.js?v=chain-only-authority-1";
import { effectIcon, esc, icon } from "./template-utils.js?v=power-flicker-1";

export function mappingStudioTemplate(state) {
  const component = selectedComponent(state);
  const patch = compileComponentPatch(component || {});
  const plan = planPatchExecution(patch);
  const compositor = planCompositorInputs(plan);
  return `
    <section class="mapping-stage" data-mapping-stage data-scroll-region data-scroll-key="mapping-stage">
      <div class="mapping-board">
        ${compositor.inputs.length
          ? compositor.inputs.map((input, index) => mappingBranchRowTemplate(input, index, plan)).join("")
          : mappingPlanRowTemplate(plan)}
        <div class="mapping-flow-row mapping-control-row">
          ${mappingSchedulerNodeTemplate(state)}
          <div class="mapping-wire"><span></span></div>
          ${mappingEventNodeTemplate(component)}
        </div>
      </div>
    </section>
  `;
}

export function mappingInspectorTemplate(component, state) {
  const patch = compileComponentPatch(component || {});
  const plan = planPatchExecution(patch);
  const compositorPlan = planCompositorInputs(plan);
  const branchSummaries = summarizeTextureBranches(plan);
  const outputNode = patch.nodes.find((node) => node.role === "output");
  const compositor = outputNode?.state?.compositor || {};
  const branchWarnings = branchSummaries.flatMap((branch) => branch.warnings || []);
  const compositorWarnings = compositorPlan.warnings || [];
  const generators = listGeneratorComponents();
  const effects = listShaderComponents();
  return `
    <article class="sculpt-card mapping-inspector">
      <label class="field">Component
        <select data-update="ui.selectedComponentId">
          ${state.components.map((item) => `<option value="${esc(item.id)}" ${item.id === component?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
        </select>
      </label>
      <label class="field inline-param">
        <span>Manual scheduler</span>
        <input type="checkbox" data-update="scheduler.manualLane" ${state.scheduler?.manualLane === false ? "" : "checked"} />
      </label>
      <div class="mapping-stat-grid">
        <span><strong>${patch.nodes.length}</strong><small>nodes</small></span>
        <span><strong>${patch.edges.length}</strong><small>edges</small></span>
        <span><strong>${compositorPlan.inputs.length}</strong><small>branches</small></span>
      </div>
      <div class="soft-note">${esc(compositor.type === "layered" ? `${compositor.inputCount} layered compositor inputs` : "Single texture passthrough")}</div>
      ${plan.warnings.length ? `<div class="soft-note">${esc(plan.warnings.length)} graph warning${plan.warnings.length === 1 ? "" : "s"}</div>` : ""}
      ${branchWarnings.length ? `<div class="soft-note">${esc(branchWarnings.length)} branch warning${branchWarnings.length === 1 ? "" : "s"}</div>` : ""}
      ${compositorWarnings.length ? `<div class="soft-note">${esc(compositorWarnings.length)} compositor warning${compositorWarnings.length === 1 ? "" : "s"}</div>` : ""}
      ${branchSummaries.length ? `
        <div class="node-chip-list compact">
          ${branchSummaries.map((branch) => `
            <div class="node-chip">
              <span>${esc(branch.inletId || `texture-${branch.index || 1}`)}</span>
              <small>${esc(branch.sourceLabel)} -> ${esc(branch.effectComponentIds.join(" -> ") || "output")}</small>
            </div>
          `).join("")}
        </div>
      ` : ""}
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">auto_awesome</span><span>Generators</span></div>
      <div class="node-chip-list compact">
        ${generators.map(componentChipTemplate).join("")}
      </div>
      <div class="ui-section-header rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
      <div class="node-chip-list compact">
        ${effects.map(componentChipTemplate).join("")}
      </div>
    </article>
  `;
}

export function mappingInletsTemplate(component) {
  const patch = compileComponentPatch(component || {});
  const plan = planPatchExecution(patch);
  const ports = [];
  for (const node of plan.nodes) {
    for (const inlet of node.inlets || []) ports.push({ node, inlet });
    for (const param of Object.keys(node.params || {})) {
      ports.push({ node, inlet: { id: param, label: param, type: "number" } });
    }
  }
  return ports.length
    ? ports.map(({ node, inlet }) => `<div class="node-chip"><span>${esc(inlet.label || inlet.id)}</span><small>${esc(nodeLabel(node))} / ${esc(inlet.type)}</small></div>`).join("")
    : `<div class="node-chip"><span>texture</span><small>source</small></div>`;
}

function selectedComponent(state) {
  return state.components.find((item) => item.id === state.ui.selectedComponentId) || state.components[0];
}

function mappingPlanRowTemplate(plan) {
  return `
    <div class="mapping-flow-row">
      ${plan.nodes.map((node, index) => `
        ${index > 0 ? `<div class="mapping-wire"><span></span></div>` : ""}
        ${mappingNodeTemplate(node, index, plan)}
      `).join("")}
    </div>
  `;
}

function mappingBranchRowTemplate(input, branchIndex, plan) {
  const nodes = [input.source, ...(input.effects || []), input.output].filter(Boolean);
  return `
    <div class="mapping-flow-row" data-branch="${branchIndex + 1}">
      ${nodes.map((node, index) => `
        ${index > 0 ? `<div class="mapping-wire"><span></span></div>` : ""}
        ${mappingNodeTemplate(node, index, plan)}
      `).join("")}
    </div>
  `;
}

function mappingNodeTemplate(node, index, plan = null) {
  const degree = plan ? patchNodeDegree(plan, node.id) : { in: node.inlets?.length || 0, out: node.outlets?.length || 0 };
  return `
    <article class="mapping-node mapping-node-${esc(node.role || node.kind)}" style="--node-index: ${index};">
      <header>${icon(mappingNodeIcon(node))}<strong>${esc(nodeLabel(node))}</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", node.inlets)}
        ${mappingPortsTemplate("out", node.outlets)}
      </div>
      ${node.params && Object.keys(node.params).length ? `
        <div class="mapping-param-pills">
          ${Object.entries(node.params).map(([key, value]) => `<span>${esc(key)} <small>${esc(formatMappingValue(value))}</small></span>`).join("")}
        </div>
      ` : ""}
      <div class="mapping-param-pills">
        <span>degree <small>${degree.in} in / ${degree.out} out</small></span>
        ${node.state?.renderRequest ? `<span>request <small>${esc(formatRenderRequest(node.state.renderRequest))}</small></span>` : ""}
      </div>
    </article>
  `;
}

function mappingSchedulerNodeTemplate(state) {
  return `
    <article class="mapping-node mapping-node-scheduler">
      <header>${icon("schedule")}<strong>Manual Scheduler</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", [{ id: "event", label: "event", type: "event" }])}
        ${mappingPortsTemplate("out", [{ id: "event", label: "event", type: "event" }])}
      </div>
      <div class="mapping-param-pills">
        <span>lane <small>${state.scheduler?.manualLane === false ? "off" : "on"}</small></span>
        <span>mode <small>${esc(state.scheduler?.mode || "hardconfigured")}</small></span>
      </div>
    </article>
  `;
}

function mappingEventNodeTemplate(component) {
  return `
    <article class="mapping-node mapping-node-event">
      <header>${icon("bolt")}<strong>Param Event</strong></header>
      <div class="mapping-port-columns">
        ${mappingPortsTemplate("in", [{ id: "event", label: "event", type: "event" }])}
        ${mappingPortsTemplate("out", [{ id: "params", label: component?.name || "component", type: "number" }])}
      </div>
      <div class="mapping-param-pills"><span>target <small>${esc(component?.name || "component")}</small></span></div>
    </article>
  `;
}

function mappingPortsTemplate(label, ports = []) {
  return `
    <div class="mapping-ports">
      <small>${esc(label)}</small>
      ${ports.length ? ports.map((port) => `
        <span><i></i>${esc(port.label || port.id)}<em>${esc(port.type)}</em></span>
      `).join("") : `<span class="is-empty"><i></i>none<em>-</em></span>`}
    </div>
  `;
}

function componentChipTemplate(component) {
  const inletCount = component.inlets?.length || 0;
  const outletCount = component.outlets?.length || 0;
  const paramCount = component.params?.length || 0;
  return `
    <div class="node-chip">
      <span>${esc(component.name || component.id)}</span>
      <small>${inletCount} in / ${outletCount} out / ${paramCount} param${paramCount === 1 ? "" : "s"}</small>
    </div>
  `;
}

function mappingNodeIcon(node) {
  if (node.role === "source" || node.kind === "generator") return "input";
  if (node.role === "effect") return effectIcon(node.componentId);
  if (node.role === "group" || node.kind === "group") return "account_tree";
  if (node.role === "output") return "output";
  return "schema";
}

function nodeLabel(node) {
  if (node.role === "source" && node.params?.generatorId) return node.params.generatorId;
  if (node.role === "group" || node.kind === "group") return node.state?.group?.name || "Group";
  if (node.role === "output") return "Output";
  return node.componentId || node.id || "Node";
}

function formatMappingValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : value;
}

function formatRenderRequest(request = {}) {
  const role = request.role || "texture";
  const width = Math.max(1, Math.floor(Number(request.width) || 1));
  const height = Math.max(1, Math.floor(Number(request.height) || 1));
  return `${role} ${width}x${height}`;
}
