import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { paramRangePairTemplate, rangeTemplate } from "../js/control/template-utils.js";
import { elementPickerTemplate } from "../js/control/picker-view.js";
import { settingsModalTemplate } from "../js/control/settings-view.js";
import { createInitialState } from "../js/domain/models.js";
import { previewRasterDensity } from "../js/output/embedded-preview-app.js";
import { isPointerInteractionNode } from "../js/control/dom-utils.js";

test("preview presses defer UI rebuilding and draggable chain rows select on press", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const previewTarget = {
    closest(selector) {
      return selector === "[data-embedded-preview-stage]" ? this : null;
    },
  };
  const passiveTarget = { closest() { return null; } };

  assert.equal(isPointerInteractionNode(previewTarget), true);
  assert.equal(isPointerInteractionNode(passiveTarget), false);
  assert.ok(controllerSource.includes("if (!isPointerInteractionNode(event.target)) return;"));
  assert.match(inputSource, /querySelectorAll\("\[data-select-chain-item\]"\)[\s\S]*?addEventListener\("pointerdown"/);
  assert.ok(inputSource.includes('button.addEventListener("click", select);'));
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  assert.ok(previewSource.includes('element.setPointerCapture?.(event.pointerId);'));
  assert.ok(previewSource.includes('element.addEventListener("pointermove", onPointerMove);'));
  assert.ok(!previewSource.includes("canvas.mousePressed("));
});

test("range params render their label and value above a full-width slider", () => {
  const sharedRange = rangeTemplate("Opacity", "components.0.opacity", 0.42);
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(sharedRange.includes('<span>Opacity</span>'));
  assert.ok(sharedRange.includes('<output class="range-value" data-range-value>0.42</output>'));
  assert.ok(!controllerSource.includes("formatParamValue("));
  assert.ok(controllerSource.includes("syncRangeValue(input)"));
  assert.ok(!controllerSource.includes("data-color-alpha-label"));
  assert.ok(styleSource.includes("--param-slider-width: 176px;"));
  assert.ok(styleSource.includes("grid-template-columns: auto minmax(0, 1fr);"));
  assert.match(styleSource, /\.range-value::before \{[\s\S]*?content: "\(";/);
  assert.match(styleSource, /\.range-value::after \{[\s\S]*?content: "\)";/);
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
  assert.ok(styleSource.includes(".live-chain-pass > .chain-param-list"));
  assert.ok(styleSource.includes("grid-column: 1 / -1;"));
});

test("Component Canvas and Live inspectors give range tracks their own full-width row", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("refs.inspector.dataset.workspace = currentWorkspace(state);"));
  assert.match(styleSource, /\.range-field input\[type="range"\] \{[\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styleSource, /\.studio-inspector:is\(\[data-workspace="component"\], \[data-workspace="canvas"\], \[data-workspace="live"\]\) \.param-range-pair \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.ok(!styleSource.includes(".live-chain-pass .range-field"));
  assert.ok(!styleSource.includes(".chain-pass .range-field"));
  assert.ok(!styleSource.includes(".live-chain-pass .chain-param-list"));
  assert.ok(styleSource.includes(".live-chain-pass label:not(.range-field)"));
  assert.ok(styleSource.includes("--range-stack-gap: 9px;"));
  assert.match(styleSource, /\.chain-param-list \{[\s\S]*?gap: var\(--range-stack-gap\);/);
});

test("groups expose blend mode and alpha in persistent and Live inspectors", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const groupEditor = componentSource.slice(
    componentSource.indexOf("function groupChainItemTemplate("),
    componentSource.indexOf("function sourceChainItemTemplate(")
  );
  const liveGroup = sceneLiveSource.slice(
    sceneLiveSource.indexOf('if (item.kind === "group")', sceneLiveSource.indexOf("function liveChainItemTemplate(")),
    sceneLiveSource.indexOf("const referencedComponent", sceneLiveSource.indexOf("function liveChainItemTemplate("))
  );

  assert.ok(groupEditor.includes('selectValuesTemplate(`${base}.blend`, BLEND_MODES'));
  assert.ok(groupEditor.includes('rangeTemplate("Alpha", `${base}.opacity`'));
  assert.ok(groupEditor.includes('class="chain-composite-controls group-composite-controls"'));
  assert.ok(liveGroup.includes('liveSelectValuesTemplate(componentId, `${path}.blend`, BLEND_MODES'));
  assert.ok(liveGroup.includes('liveRangeTemplate("Alpha", componentId, `${path}.opacity`'));
});

test("paired HSV ranges render two accessible handles and shared range state", () => {
  const html = paramRangePairTemplate({
    minParam: { id: "hueMin", label: "Hue", min: 0, max: 360, step: 1, rangeKind: "hue", rangeDisplay: "degrees" },
    maxParam: { id: "hueMax", label: "Hue", min: 0, max: 360, step: 1, rangeKind: "hue", rangeDisplay: "degrees" },
    minPath: "components.0.chain.1.params.hueMin",
    maxPath: "components.0.chain.1.params.hueMax",
    minValue: 200,
    maxValue: 260,
  });
  const controllerSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(html.includes("data-param-range"));
  assert.ok(html.includes('data-param-range-input="min"'));
  assert.ok(html.includes('data-param-range-input="max"'));
  assert.ok(html.includes('aria-label="Hue minimum"'));
  assert.ok(html.includes('aria-label="Hue maximum"'));
  assert.ok(html.includes("200°"));
  assert.ok(html.includes("260°"));
  assert.ok(controllerSource.includes("bindParamRangeControl"));
  assert.ok(controllerSource.includes("updateParamRangeFromInputs"));
  assert.ok(controllerSource.includes("syncParamRangeControl"));
  assert.ok(styleSource.includes('.param-range-pair[data-range-kind="hue"]'));
});

test("component panel exposes frame shape and relative resolution controls", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(componentSource.includes('data-set-path="${base}.frameShape"'));
  assert.ok(componentSource.includes('data-set-path="${base}.resolutionScale"'));
  assert.ok(componentSource.includes('["landscape", "Landscape"]'));
  assert.ok(componentSource.includes('["portrait", "Portrait"]'));
  assert.ok(componentSource.includes('["square", "Square"]'));
  assert.ok(componentSource.includes("const scaleOptions = [0.5, 1, 2];"));
  assert.ok(componentSource.includes("component-frame-summary"));
  assert.ok(styleSource.includes(".component-option-grid"));
});

test("control surfaces share one flat section module and concentric corner tokens", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const pickerSource = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(controllerSource.includes('class="ui-section rail-section"'));
  assert.ok(primitivesSource.includes('class="ui-section focus-panel"'));
  assert.ok(pickerSource.includes('class="ui-section element-section"'));
  assert.ok(settingsSource.includes('class="ui-section element-section"'));
  assert.ok(styleSource.includes("--section-inset: 6px;"));
  assert.ok(styleSource.includes("--radius-section: 12px;"));
  assert.ok(styleSource.includes("--radius-section-inner: 6px;"));
  assert.match(styleSource, /\.ui-section \{[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section\);/);
  assert.ok(styleSource.includes(".section-toolbar"));
  assert.match(styleSource, /\.section-toolbar \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /\.component-frame-summary \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /\.text-list-item \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.ok(componentSource.includes('class="section-toolbar component-quick-toolbar"'));
});

test("topbar identity stays neutral until interaction", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.brand-mark \{[\s\S]*?background: var\(--panel-soft\);[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.project-button \.material-symbols-rounded \{[\s\S]*?color: var\(--muted\);/);
});

test("both control columns reserve a persistent scrollbar lane outside their sections", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?padding-right: 10px;[\s\S]*?overflow-y: scroll;[\s\S]*?scrollbar-gutter: stable;/);
  assert.match(styleSource, /\.project-rail::\-webkit-scrollbar,[\s\S]*?\.studio-inspector::\-webkit-scrollbar/);
  assert.match(styleSource, /\.project-rail::\-webkit-scrollbar-thumb,[\s\S]*?\.studio-inspector::\-webkit-scrollbar-thumb/);
});

test("every workspace rail uses the same constrained first-column module", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.project-rail,[\s\S]*?\.studio-inspector \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styleSource, /\.rail-section \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(styleSource, /\.capture-row \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 36px;/);
  assert.match(styleSource, /\.capture-row input \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/);
});

test("the scrollbar lane replaces excess space between the two control columns", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.studio-layout \{[\s\S]*?column-gap: 4px;[\s\S]*?row-gap: 12px;/);
  assert.match(styleSource, /\.studio-main \{[\s\S]*?margin-left: 8px;/);
  assert.match(styleSource, /@media \(max-width: 760px\)[\s\S]*?\.studio-main \{[\s\S]*?margin-left: 0;/);
});

test("editable element names live in their section headers beside the icon", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const settingsSource = readFileSync(new URL("../js/control/settings-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitivesSource.includes("function titleInputTemplate(path, value)"));
  assert.ok(primitivesSource.includes("function editableSectionTitleTemplate(iconName, path, value)"));
  assert.ok(primitivesSource.includes('class="section-title-input"'));
  assert.ok(controllerSource.includes('from "./view-primitives.js?v=view-primitives-extraction-1"'));
  assert.ok(!controllerSource.includes('class="sculpt-head"'));
  assert.ok(settingsSource.includes('class="section-title-input"'));
  assert.ok(!settingsSource.includes('<label class="field">Name <input'));
  assert.ok(styleSource.includes(".ui-section-header .section-title-input"));
  assert.match(styleSource, /\.ui-section-header,[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow: hidden;/);
  assert.match(styleSource, /\.ui-section-header \.section-title-input \{[\s\S]*?flex: 1 1 0;[\s\S]*?max-width: 100%;[\s\S]*?color: inherit;[\s\S]*?font-size: inherit;[\s\S]*?font-weight: inherit;[\s\S]*?letter-spacing: inherit;[\s\S]*?text-transform: inherit;/);
  assert.doesNotMatch(styleSource, /\.ui-section-header \.section-title-input \{[^}]*font-size: 14px;/);
});

test("thumbnail list items share a connected image and bottom label bar", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const primitivesSource = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitivesSource.includes("function componentCardBarTemplate(label)"));
  assert.ok(primitivesSource.includes('class="component-card-bar"'));
  assert.match(styleSource, /\.component-card > \.component-thumbnail,[\s\S]*?border-radius: var\(--radius-section-inner\) var\(--radius-section-inner\) 0 0;/);
  assert.match(styleSource, /\.component-card-bar \{[\s\S]*?min-height: 26px;[\s\S]*?padding: 4px 8px;[\s\S]*?border-radius: 0 0 var\(--radius-section-inner\) var\(--radius-section-inner\);[\s\S]*?background: #000;/);
  assert.match(styleSource, /\.component-card-bar span \{[\s\S]*?color: var\(--muted\);/);
  assert.match(styleSource, /\.component-card\.is-selected \.component-card-bar span \{[\s\S]*?color: var\(--ink\);/);
  assert.match(styleSource, /\.component-card-remove \{[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/);
  assert.match(styleSource, /\.component-card-row:hover \.component-card-remove \{[\s\S]*?visibility: visible;[\s\S]*?transition-delay: 600ms, 0s, 0s, 600ms;/);
  assert.match(styleSource, /\.component-card-row:focus-within \.component-card-remove \{[\s\S]*?transition-delay: 0s;/);
});

test("ordinary sliders use the tall track and square active handle from the UI system", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(styleSource.includes("--accent-strong: #6f3300;"));
  assert.ok(styleSource.includes("--slider-track: #454545;"));
  assert.ok(styleSource.includes("--slider-thumb: #9a9997;"));
  assert.ok(styleSource.includes("--slider-text: #777674;"));
  assert.match(styleSource, /\.range-field > span \{[\s\S]*?color: var\(--slider-text\);/);
  assert.match(styleSource, /\.range-value \{[\s\S]*?color: var\(--slider-text\);/);
  assert.ok(styleSource.includes("--slider-height: 22px;"));
  assert.match(styleSource, /input\[type="range"\]::\-webkit-slider-thumb \{[\s\S]*?width: var\(--slider-height\);[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: 0;[\s\S]*?background: var\(--slider-thumb\);/);
  assert.match(styleSource, /input\[type="range"\]::\-webkit-slider-runnable-track \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--slider-track\);/);
  assert.match(styleSource, /\.param-range-track \{[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /input\[type="range"\]:active::\-webkit-slider-thumb,[\s\S]*?background: var\(--accent-strong\);/);
});

test("movie trim keeps two handles while sharing the ordinary slider geometry", () => {
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.match(styleSource, /\.video-trim-track \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: var\(--radius-section-inner\);/);
  assert.match(styleSource, /\.video-trim-slider input\[type="range"\]::\-webkit-slider-thumb \{[\s\S]*?width: var\(--slider-height\);[\s\S]*?height: var\(--slider-height\);[\s\S]*?border-radius: 0;/);
  assert.match(styleSource, /\.video-trim-slider input\[type="range"\]:active::\-webkit-slider-thumb,[\s\S]*?background: var\(--accent-strong\);/);
});

test("scene surfaces expose projection cover contain and stretch", () => {
  const source = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.ok(!source.includes("Scene assignment"));
  assert.ok(source.includes('const PROJECTION_FIT_MODES = ["cover", "contain", "stretch"]'));
  assert.ok(source.includes("Projection fit"));
  assert.ok(source.includes("sceneBase}.projectionFit"));
  assert.ok(source.includes('rangeTemplate("Feather", `${surfaceBase}.feather`'));
  assert.ok(source.indexOf("Projection fit") < source.indexOf("componentAssignmentTemplate(sceneBase"));
});

test("component catalogs expose shared local filtering", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("componentFilterTemplate"));
  assert.ok(source.includes("data-component-filter-card"));
  assert.ok(source.includes("bindComponentFilters"));
  assert.ok(style.includes(".component-filter-field"));
  assert.ok(style.includes("[data-component-filter-card][hidden]"));
  assert.ok(style.includes("display: none !important;"));
});

test("the primary workspace is architecturally named Component", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  assert.ok(shell.includes('data-workspace="component"'));
  assert.ok(!shell.includes('data-workspace="compose"'));
  assert.ok(controller.includes('workspace === "component"'));
  assert.ok(controller.includes("componentToolsTemplate"));
  assert.ok(!controller.includes("compositionToolsTemplate"));
});

test("component catalogs expose stable per-view sorting modes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const catalogSource = readFileSync(new URL("../js/control/catalog-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes("state.ui?.catalogSortModes?.[scope]"));
  assert.ok(source.includes('ui.catalogSortModes ||= { component: "recent", scene: "recent" }'));
  assert.ok(source.includes("ui.catalogSortModes[catalog] = mode"));
  assert.ok(source.includes('catalogSortMode(state, "component")'));
  assert.ok(source.includes('catalogSortMode(state, "scene")'));
  assert.ok(source.includes("if (viewKey === activeCatalogViewKey) return"));
  assert.ok(source.includes("captureCatalogOrder(workspace, state)"));
  assert.ok(catalogSource.includes('data-catalog-sort="${nextMode}"'));
  assert.ok(catalogSource.includes("(activeIndex + 1) % modes.length"));
  assert.ok(catalogSource.includes("Sorted by ${activeLabel.toLowerCase()}; click to sort by ${nextLabel.toLowerCase()}"));
  assert.ok(!catalogSource.includes('role="group" aria-label="Sort components"'));
  assert.ok(source.includes('["recent", "name", "created"]'));
  assert.ok(style.includes(".component-sort-toggle"));
});

test("Live scene cards expose reset only for retained temporary overrides", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.ok(sceneLiveSource.includes("data-reset-live-scene"));
  assert.ok(sceneLiveSource.includes("state.ui?.live?.sceneOverrides"));
  assert.ok(source.includes("store.resetLiveScene"));
});

test("Live scenes expose an opt-in transition duration that defaults to zero", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const models = readFileSync(new URL("../js/domain/models.js", import.meta.url), "utf8");
  assert.ok(source.includes('data-update="ui.live.transitionDuration"'));
  assert.ok(source.includes('min="0" max="10" step="0.1"'));
  assert.ok(models.includes("transitionDuration: 0"));
});

test("Live exposes a phase-continuous global visual time stretch", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.match(source, /function liveToolsTemplate[\s\S]*?Live Scenes[\s\S]*?scene-card-list live-scene-list[\s\S]*?Timing[\s\S]*?live-time-scale[\s\S]*?live-transition-duration/);
  assert.ok(source.includes("Time stretch"));
  assert.ok(source.includes('data-update="global.timeStretch"'));
  assert.ok(source.includes('min="-4" max="4" step="0.01"'));
  assert.ok(source.includes("const timeScale = timeStretch <= -4 ? 0 : 2 ** timeStretch"));
});

test("embedded preview retargets resize observation after workspace DOM replacement", () => {
  const source = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  assert.ok(source.includes("function observeCurrentStage()"));
  assert.ok(source.includes("resizeObserver.unobserve?.(observedStage)"));
  assert.ok(source.includes("function scheduleSettledResize("));
  assert.ok(source.includes("stableMeasurements < 1 && attempts < 8"));
  assert.ok(source.includes("hideCanvasUntilSettledDraw()"));
  assert.ok(source.includes("const stageChanged = !!canvas && stage !== nextStage"));
  assert.ok(source.includes("modeChanged || stageChanged || canvasElementIsHidden()"));
  assert.ok(source.includes("function cancelSettledResize()"));
  assert.match(source, /function pause\(\) \{[\s\S]*?cancelSettledResize\(\)/);
  assert.ok(source.includes("if (revealCanvasAfterDraw)"));
  assert.ok(controllerSource.includes('if (reason === "workspace")'));
  assert.ok(controllerSource.includes("render(state);"));
});

test("ordinary UI interactions do not wait through a fixed post-click quiet period", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(!source.includes("interactionQuietMs"));
  assert.ok(!source.includes("interactionHoldUntil"));
  assert.match(source, /function scheduleDeferredRenderFlush\(\) \{[\s\S]*?setTimeout\(flushDeferredRender, 0\);/);
  assert.match(source, /function shouldDeferRender\(\) \{[\s\S]*?return activePointerCount > 0 \|\| hasFocusedEditor\(\);/);
  assert.match(source, /return active\?\.tagName !== "SELECT" && isTextEditingNode\(active\);/);
});

test("local UI controls use the UI-only state path", () => {
  const controller = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const projectService = readFileSync(new URL("../js/services/project-folder-service.js", import.meta.url), "utf8");

  assert.match(controller, /function updateUi\(recipe, reason\)[\s\S]*?store\.updateUi\(recipe, reason\)/);
  assert.match(controller, /updateUi\(\(ui\) => \{[\s\S]*?updatePreviewViewportForUi\(ui, \(viewport\) => zoomViewport/);
  assert.match(controller, /ui\.catalogSortModes\[catalog\] = mode/);
  assert.match(app, /projectService\.scheduleAutoSave\(change\);[\s\S]*?change\.scope === "ui" \|\| change\.scope === "runtime"/);
  assert.match(projectService, /if \(event\.phase === "edit" \|\| event\.phase === "scrub"\) return;/);
  assert.ok(!projectService.includes('event.scope === "ui"'));
});

test("output metrics use a targeted runtime state path", () => {
  const bridge = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(bridge.includes("store.getMetrics?.() || store.getState().metrics"));
  assert.ok(bridge.includes("store.updateRuntime ||"));
  assert.ok(!bridge.includes("store.getState().metrics.clients"));
  assert.ok(!bridge.includes("store.getState().metrics.outputs"));
});

test("canvas uses the shared chain and exposes recording frames as scene routes", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const selectorsSource = readFileSync(new URL("../js/control/control-selectors.js", import.meta.url), "utf8");
  const modalSource = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(!source.includes("Build a larger visual with the same sources"));
  assert.ok(!source.includes("<span>Sampling</span>"));
  assert.match(source, /function canvasToolsTemplate[\s\S]*?Canvases[\s\S]*?<span>Frames<\/span>/);
  assert.ok(source.includes('class="recording-frame-pills"'));
  assert.ok(!source.includes('class="canvas-inspector-section"'));
  assert.ok(componentSource.includes("componentUnifiedChainTemplate(component, state, base)"));
  assert.match(componentSource, /function componentUnifiedChainTemplate[\s\S]*?<section class="chain-list-section" aria-label="Elements">/);
  assert.doesNotMatch(componentSource, /function componentUnifiedChainTemplate[\s\S]*?<span>Chain<\/span>/);
  assert.match(style, /\.chain-list-section \{[\s\S]*?padding: var\(--section-inset\);[\s\S]*?background: var\(--panel-2\);/);
  assert.match(componentSource, /function componentSelectedChainSettingsTemplate[\s\S]*?<section class="ui-section focus-panel chain-settings-panel" aria-label="Selected element parameters">/);
  assert.match(source, /currentWorkspace\(state\) === "component"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedComponent, state\)/);
  assert.match(source, /currentWorkspace\(state\) === "canvas"[\s\S]*?componentSelectedChainSettingsTemplate\(selectedCanvas, state\)/);
  assert.ok(!source.includes('emptyNote("Select a chain item")'));
  assert.match(style, /\.chain-item-editor \{[\s\S]*?padding: 0;[\s\S]*?background: transparent;/);
  assert.ok(source.includes('workspace === "component" || workspace === "canvas" ? "component"'));
  assert.ok(modalSource.includes("data-add-element-component"));
  assert.ok(modalSource.includes('type: "component"'));
  assert.ok(componentSource.includes('ownerComponent?.type === "canvas" && item.source?.type === "component"'));
  assert.ok(componentSource.includes('isCanvasComponentPlacement ? "" : `<label class="field">Component'));
  assert.ok(componentSource.includes('if (item.source?.type === "component") return sourceTitle'));
  assert.ok(source.includes("data-preview-quality"));
  assert.ok(source.includes("data-preview-quality-label"));
  assert.ok(source.includes('quality === "auto" ? "low" : quality === "low" ? "full" : "auto"'));
  assert.ok(source.includes("internal Canvas raster follows the visible preview size"));
  assert.ok(source.includes('workspace === "scene" || workspace === "live"'));
  assert.ok(source.includes("draft.ui.previewQualities[workspace]"));
  assert.ok(!source.includes('data-update="${base}.canvas.previewQuality"'));
  assert.ok(source.includes("data-add-canvas-frame"));
  assert.ok(inputSource.includes("data-set-route-source-node"));
  assert.ok(!source.includes("data-assign-scene-source"));
  assert.ok(source.includes("sceneSourceNodes(state)"));
  assert.ok(source.includes('catalogItemsInSnapshot("component", ordinaryComponents(state))'));
  assert.ok(selectorsSource.includes('filter((component) => component.type !== "canvas")'));
  assert.ok(!source.includes("data-set-route-frame"));
  assert.ok(source.includes("state.recordingFrames || []"));
  assert.ok(!source.includes("component.canvas?.frames"));
  assert.ok(!source.includes("Surface sample rects"));
  assert.ok(!source.includes("Canvas sample rect"));
  assert.ok(!source.includes("data-add-canvas-layer"));
  assert.ok(!source.includes('item.role === "canvas-layer"'));
  assert.ok(!source.includes('data-update="${base}.x"'));
});

test("Scene and Live preview resolution supports automatic low and full demand", () => {
  const options = { configuredDensity: 1.5, displayScale: 0.5, deviceScale: 2 };
  assert.equal(previewRasterDensity({ ...options, quality: "auto" }), 1);
  assert.equal(previewRasterDensity({ ...options, quality: "low" }), 0.5);
  assert.equal(previewRasterDensity({ ...options, quality: "full" }), 1.5);
});

test("compact text lists share one full-width item generator", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const primitives = readFileSync(new URL("../js/control/view-primitives.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(primitives.includes("function textListItemTemplate("));
  assert.match(source, /function canvasFramePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(primitives, /function selectablePillTemplate[\s\S]*?return textListItemTemplate\(/);
  assert.match(componentSource, /function chainItemRowTemplate[\s\S]*?const row = textListItemTemplate\(/);
  assert.ok(style.includes(".text-list-item {"));
  assert.match(style, /\.text-list-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?border: 1px solid var\(--line\);/);
  assert.match(style, /\.text-list-item\.has-leading\.has-remove \{[\s\S]*?var\(--text-list-leading-size\)[\s\S]*?var\(--text-list-remove-size\)/);
  assert.match(style, /\.text-list-item \.text-list-remove \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(style, /\.text-list-item \.text-list-remove \{[\s\S]*?justify-content: center;/);
  assert.match(style, /\.text-list-item:hover \{[\s\S]*?background:/);
  assert.match(style, /button\.text-list-main:hover \{[\s\S]*?background: transparent;/);
  assert.ok(!style.includes(".surface-pills .list-select.is-selected"));
  assert.match(style, /\.chain-item-row \.enable-toggle\.is-enabled \{[\s\S]*?background: rgba\(255, 255, 255, 0\.055\);[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.chain-item-row\.is-selected \.enable-toggle\.is-enabled \{[\s\S]*?color: var\(--ink\);/);
  assert.match(style, /\.chain-group-children \{[\s\S]*?padding-left: 8px;[\s\S]*?border-left: 3px solid var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone \{[\s\S]*?border: 1px dashed var\(--line-strong\);/);
  assert.match(style, /\.chain-group-drop-zone\.is-drop-target \{[\s\S]*?border-color: rgba\(255, 255, 255, 0\.55\);[\s\S]*?background: rgba\(255, 255, 255, 0\.06\);/);
});

test("Live expands Canvas component placements into referenced element controls", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  assert.ok(sceneLiveSource.includes("live-referenced-component"));
  assert.match(controllerSource, /currentWorkspace\(state\) === "live"[\s\S]*?html = liveInspectorTemplate\(state\);/);
  assert.match(sceneLiveSource, /function liveComponentTemplate[\s\S]*?<article class="ui-section focus-panel live-component-card">[\s\S]*?<header class="ui-section-header panel-title live-component-head">/);
  assert.ok(!sceneLiveSource.includes('class="live-panel"'));
  assert.ok(sceneLiveSource.includes("createLiveComponentView(referencedComponent, state)"));
  assert.ok(sceneLiveSource.includes("liveUnifiedChainTemplate(referencedView.chain, referencedComponent.id, state, nextAncestry)"));
  assert.ok(sceneLiveSource.includes("!ancestry.has(referencedComponent.id)"));
});

test("project settings expose component upscaling and native-resolution post filters", () => {
  const controllerSource = settingsModalTemplate(createInitialState());

  for (const path of [
    "render.upscaling.enabled",
    "render.upscaling.amount",
    "render.postProcessing.grayscaleEnabled",
    "render.postProcessing.grayscaleAmount",
    "render.postProcessing.noiseEnabled",
    "render.postProcessing.noiseAmount",
  ]) {
    assert.ok(controllerSource.includes(`data-settings-update="${path}"`));
  }
  assert.ok(controllerSource.includes("These filters run at the component’s full target resolution after upscaling."));
});

test("project settings expose one adaptive surface texture policy", () => {
  const source = settingsModalTemplate(createInitialState());
  assert.ok(source.includes('data-settings-update="render.componentTexture.width"'));
  assert.ok(source.includes('data-settings-update="render.componentTexture.height"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.mode"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxWidth"'));
  assert.ok(source.includes('data-settings-update="render.surfaceTexture.maxHeight"'));
  assert.ok(source.includes('data-settings-update="render.sampling.surfaceOverscan"'));
  assert.ok(source.includes('data-settings-update="render.sampling.recordingFrameScale"'));
  assert.ok(source.includes('data-settings-update="render.sampling.limitCanvasToLogicalSize"'));
  assert.equal(source.includes('data-settings-update="render.edgeSoftness"'), false);
  assert.ok(source.includes("Auto · projected pixel demand"));
  assert.ok(source.includes("it never changes component dimensions"));
  assert.ok(!source.includes('data-settings-update="render.surfaceWidth"'));
  assert.ok(!source.includes('data-settings-update="render.surfaceHeight"'));
});

test("project settings expose common WXGA and WUXGA projector presets", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState())}`;
  assert.ok(source.includes('data-render-preset="wxga" title="1280 x 800"'));
  assert.ok(source.includes('data-render-preset="wuxga" title="1920 x 1200"'));
  assert.ok(source.includes("wxga: [1280, 800]"));
  assert.ok(source.includes("wuxga: [1920, 1200]"));
});

test("project settings expose camera capture preferences", () => {
  const source = settingsModalTemplate(createInitialState(), "camera");
  assert.ok(source.includes("data-camera-preset"));
  assert.ok(source.includes('data-settings-update="render.camera.width"'));
  assert.ok(source.includes('data-settings-update="render.camera.height"'));
  assert.ok(source.includes('data-settings-update="render.camera.facingMode"'));
  assert.ok(source.includes('data-settings-update="render.camera.mirrored"'));
  assert.ok(source.includes('data-settings-update="render.camera.maxResolution"'));
});

test("project settings keep one modal DOM and patch tab values in place", () => {
  const source = `${readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8")}\n${settingsModalTemplate(createInitialState())}`;
  assert.ok(source.includes('if (!host.querySelector("[data-settings-modal]"))'));
  assert.ok(source.includes("function syncSettingsModal(host, state)"));
  assert.ok(source.includes("function bindSettingsModalControls(host)"));
  assert.ok(source.includes('data-settings-tab="outputs"'));
  assert.ok(source.includes('data-settings-tab="camera"'));
  assert.ok(source.includes('data-settings-tab="rendering"'));
  assert.ok(source.includes('data-configured-output-list'));
  assert.ok(!source.includes("settingsScroll"));
});

test("scrub changes are sent to live output on the next animation frame", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const stateSource = readFileSync(new URL("../js/app-state.js", import.meta.url), "utf8");
  const inputSource = readFileSync(new URL("../js/control/input-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const outputSource = readFileSync(new URL("../js/output/output-app.js", import.meta.url), "utf8");

  assert.ok(appSource.includes("function sendScrubState()"));
  assert.ok(appSource.includes("requestAnimationFrame"));
  assert.ok(appSource.includes("sendScrubState();"));
  assert.ok(!appSource.includes("setTimeout(() => bridge.sendState(), 90)"));
  assert.ok(stateSource.includes("function updateLive(recipe"));
  assert.ok(inputSource.includes('typeof store.updateLive === "function"'));
  assert.ok(previewSource.includes('pendingState?.ui?.outputWindowOpen && pendingState?.ui?.workspace !== "live"'));
  assert.ok(previewSource.includes('renderer.setState(previewSizedState(), { normalized: true });'));
  assert.ok(rendererSource.includes('setState(nextState, { normalized = false } = {})'));
  assert.ok(outputSource.includes('renderer?.setState(state, { normalized: true });'));
});

test("opening an output from Scene takes that Scene live before opening the Live-driven popup", () => {
  const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const bridgeSource = readFileSync(new URL("../js/services/output-bridge-service.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("store.selectLiveScene(state.ui.selectedSceneId);"));
  assert.ok(controllerSource.includes('buildOutputUrl("output", { outputId: output.id })'));
  assert.ok(!controllerSource.includes("const initialSceneId ="));
  assert.ok(controllerSource.includes("store.selectLiveScene(button.dataset.liveScene)"));
  assert.ok(bridgeSource.includes("store.getLiveRenderState?.()"));
  assert.ok(bridgeSource.includes("targetClientId"));
  assert.ok(!bridgeSource.includes("initialSceneAccepted"));
  assert.ok(!bridgeSource.includes("initialSceneId"));
  assert.ok(appSource.includes('state.ui.workspace === "scene"'));
  assert.ok(appSource.includes('bridge.command("sync-mapping"'));
  assert.ok(appSource.includes("bridge.sendState();"));
  assert.ok(!appSource.includes("isSceneSurfaceOutputChange(reason)"));
  assert.ok(!appSource.includes("bridge.sendState(store.getRenderState())"));
  assert.ok(!appSource.includes('if (state.ui.workspace === "scene") return;'));
  assert.ok(!controllerSource.includes("setTimeout(() => bridge.sendState(), 350)"));
});

test("multiple configured outputs have individual popup actions", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const settingsHtml = settingsModalTemplate(createInitialState());

  assert.ok(shellSource.includes('id="output-menu"'));
  assert.ok(controllerSource.includes("data-open-output-id"));
  assert.ok(!controllerSource.includes("data-open-all-outputs"));
  assert.ok(controllerSource.includes("outputs.length === 1"));
  assert.ok(controllerSource.includes("dataset.outputsSignature"));
  assert.ok(settingsHtml.includes("render.outputs.0.width"));
  assert.ok(settingsHtml.includes("data-add-output"));
});

test("topbar shows separate active-renderer CPU and GPU work timers", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const gpuTimerSource = readFileSync(new URL("../js/output/gpu-timer-tracker.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="cpu-time"'));
  assert.ok(shellSource.includes('id="gpu-time"'));
  assert.ok(shellSource.includes('id="cpu-time-text">0.0 ms'));
  assert.ok(shellSource.includes('id="gpu-time-text">--'));
  assert.ok(!shellSource.includes('id="cpu-time-text">CPU'));
  assert.ok(!shellSource.includes('id="gpu-time-text">GPU'));
  assert.ok(controllerSource.includes("activeWorkMetric(state, outputFps)"));
  assert.ok(controllerSource.includes("state.ui?.debugPreview && previewFps > 0"));
  assert.ok(controllerSource.includes('source: "preview"'));
  assert.ok(controllerSource.includes("state.metrics.previewFrameMs"));
  assert.ok(controllerSource.includes("state.metrics.previewGpuMs"));
  assert.ok(controllerSource.includes("1000 / value"));
  assert.ok(controllerSource.includes("profile?.componentWallMs ?? profile?.componentMs"));
  assert.ok(controllerSource.includes("CPU render work:"));
  assert.ok(controllerSource.includes("GPU render work:"));
  assert.ok(!controllerSource.includes('`CPU ${formatTimeMs'));
  assert.ok(!controllerSource.includes('`GPU ${formatTimeMs'));
  assert.ok(controllerSource.includes('sample?.type === "component"'));
  assert.ok(controllerSource.includes("cache hit"));
  assert.ok(controllerSource.includes("stage reuse"));
  assert.match(styleSource, /\.work-time-pill #gpu-time-text[\s\S]*?white-space: nowrap;/);
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query_webgl2")'));
  assert.ok(gpuTimerSource.includes('getExtension("EXT_disjoint_timer_query")'));
  assert.ok(rendererSource.includes("this.pruneRenderCaches();\n    this.gpuTimer.sealFrame"));
  assert.ok(rendererSource.includes("gpuSupported: this.gpuTimer.supported"));
  assert.ok(previewSource.includes("draft.metrics.previewGpuMs = metrics.gpuMs || 0"));
  assert.ok(shellSource.includes('id="render-cost" class="status-pill cost-pill" type="button"'));
  assert.ok(controllerSource.includes("performanceProfileDurationMs = 10000"));
  assert.ok(controllerSource.includes("analyzeVj1Project(latestState, { runtimeSamples: session.samples })"));
  assert.ok(controllerSource.includes("globalThis.__vj1LastProfileReport = report"));
  assert.ok(controllerSource.includes("downloadPerformanceProfile(report"));
});

test("topbar metric readouts reserve stable widths", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".cost-pill #render-cost-text {\n  width: 4ch;"));
  assert.ok(source.includes(".work-time-pill #cpu-time-text,\n.work-time-pill #gpu-time-text {\n  width: 6ch;"));
  assert.ok(source.includes("#output-status-text {\n  display: inline-block;\n  width: 7ch;"));
  assert.ok(source.includes("font-variant-numeric: tabular-nums;"));
});

test("list thumbnails crop to fill and brighten their grayscale state", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const templates = readFileSync(new URL("../js/control/template-utils.js", import.meta.url), "utf8");
  assert.ok(templates.includes('<div class="component-thumbnail"><img'));
  assert.match(source, /\.component-thumbnail,\n\.component-card-empty \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?overflow: hidden;/);
  assert.match(source, /\.component-thumbnail img \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;[\s\S]*?object-fit: cover;/);
  assert.ok(source.includes("filter: grayscale(1) contrast(1.16) brightness(1.08);"));
});

test("media cards use one full-width text column without the generic icon inset", () => {
  const source = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.ok(source.includes(".media-element-card {\n  grid-template-columns: minmax(0, 1fr);"));
  assert.match(source, /\.media-element-card > \.component-thumbnail,\n\.media-element-card > \.media-picker-placeholder \{\n  grid-column: 1;\n  grid-row: 3;/);
});

test("component picker cards use the same thumbnail layout as media cards", () => {
  const source = readFileSync(new URL("../js/control/picker-view.js", import.meta.url), "utf8");
  assert.match(source, /Components[\s\S]*?<div class="element-grid media-element-grid">[\s\S]*?class="element-card media-element-card" data-add-element-component=/);
});

test("component selection modal exposes the shared persisted catalog sorting", () => {
  const state = {
    media: [],
    components: [
      { id: "canvas", name: "Canvas", type: "canvas" },
      { id: "beta", name: "Beta", type: "component" },
      { id: "alpha", name: "Alpha", type: "component" },
    ],
  };
  const html = elementPickerTemplate(state, { componentId: "canvas" }, null, new Map(), {
    components: [state.components[2], state.components[1], state.components[0]],
    sortMode: "name",
  });
  const controller = readFileSync(new URL("../js/control/modal-controller.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(html.indexOf("Alpha") < html.indexOf("Beta"));
  assert.match(html, /data-catalog-sort-scope="component" data-catalog-sort="created"/);
  assert.match(html, /Sorted by name; click to sort by created/);
  assert.ok(controller.includes("sortComponentCatalog(state.components || [], sortMode)"));
  assert.ok(controller.includes("bindCatalogSortControls(host)"));
  assert.match(style, /\.component-sort-toggle button\.is-active \{[\s\S]*?background: transparent;[\s\S]*?color: var\(--muted\);/);
  assert.match(style, /\.component-sort-toggle button:active,[\s\S]*?background: var\(--accent-strong\);/);
});

test("workspace view buttons are compact icons with accessible names", () => {
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  for (const label of ["Components", "Canvas", "Scenes", "Live"]) {
    assert.ok(shellSource.includes(`title="${label}" aria-label="${label}"`));
    assert.ok(!shellSource.includes(`<span>${label}</span>`));
  }
  assert.ok(!shellSource.includes('data-workspace="mapping"'));
  const projectButtonIndex = shellSource.indexOf('id="open-folder-main"');
  const viewSwitchIndex = shellSource.indexOf('class="workspace-switch workspace-view-switch"');
  const closeProjectIndex = shellSource.indexOf('id="close-project"');
  const topActionsIndex = shellSource.indexOf('class="top-actions"');
  const liveButtonIndex = shellSource.indexOf('data-workspace="live"');
  assert.ok(projectButtonIndex < closeProjectIndex && closeProjectIndex < viewSwitchIndex);
  assert.ok(viewSwitchIndex < liveButtonIndex && liveButtonIndex < topActionsIndex);
  assert.equal((shellSource.slice(viewSwitchIndex, topActionsIndex).match(/data-workspace=/g) || []).length, 4);
  assert.ok(shellSource.indexOf('data-workspace="scene"') < liveButtonIndex);
  assert.ok(shellSource.includes('class="project-title-control"'));
  assert.match(styleSource, /\.icon-buttonish\.close-project-button \{[\s\S]*?position: static;[\s\S]*?width: 26px;[\s\S]*?height: 26px;/);
  assert.match(styleSource, /\.close-project-button \.material-symbols-rounded \{[\s\S]*?font-size: 16px;/);
  assert.match(styleSource, /\.workspace-switch button \{[\s\S]*?width: 36px;[\s\S]*?padding: 0;/);
});

test("empty project start shows one folder action and disables project views", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../js/control/shell-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

  assert.ok(shellSource.includes('id="close-project"'));
  assert.ok(controllerSource.includes("No project open"));
  assert.ok(controllerSource.includes("button.disabled = !hasProject;"));
  assert.ok(controllerSource.includes("hasOpenProject(state)"));
  assert.ok(controllerSource.includes('class="studio-stage project-empty-stage"'));
  assert.ok(!controllerSource.includes("Project first"));
  assert.ok(!controllerSource.includes("data-import-files>${icon"));
  assert.ok(styleSource.includes(".no-project-open .studio-layout"));
  assert.ok(styleSource.includes(".no-project-open .project-rail"));
  assert.ok(styleSource.includes(".workspace-switch button:disabled"));
});

test("3d model controls use full-width slider rows", () => {
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const modelControls = componentSource.slice(
    componentSource.indexOf("function modelSourceControlsTemplate"),
    componentSource.indexOf("function generatorParamControlsTemplate")
  );

  assert.ok(modelControls.includes("model-param-list"));
  assert.ok(modelControls.includes("Depth scale"));
  assert.ok(modelControls.includes("Visible depth"));
  assert.ok(modelControls.includes("params.visibleDepth"));
  assert.ok(modelControls.includes("Wire thickness"));
  assert.ok(!modelControls.includes("field-pair"));
  assert.ok(styleSource.includes(".model-param-list"));
});

test("seed params stay internal and are not rendered as sliders", () => {
  const controllerSource = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const componentSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const sceneLiveSource = readFileSync(new URL("../js/control/scene-live-view.js", import.meta.url), "utf8");
  const parameterSource = readFileSync(new URL("../js/control/parameter-view.js", import.meta.url), "utf8");

  assert.ok(parameterSource.includes('param?.id !== "seed"'));
  assert.ok(parameterSource.includes("const visible = visibleParamControls(params);"));
  assert.ok(componentSource.includes("paramControlsTemplate(component.params"));
  assert.ok(sceneLiveSource.includes("paramControlsTemplate(params"));
});

test("selected generators omit the redundant source chooser", () => {
  const source = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const picker = source.slice(source.indexOf("function sourcePickerTemplate("), source.indexOf("function mediaSourceFitControlsTemplate("));

  assert.match(picker, /source\.type === "generator" \? "" : `<div class="field">/);
  assert.match(picker, /source\.type === "generator" \? generatorParamControlsTemplate/);
});

test("inspector dropdowns share compact slider-like styling without an orange focus ring", () => {
  const source = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");
  const style = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const editor = source.slice(source.indexOf("function sourceChainItemTemplate("), source.indexOf("function sourceTransformControlsTemplate("));

  assert.match(editor, /class="chain-composite-controls"[\s\S]*?<span>Blend<\/span>[\s\S]*?rangeTemplate\("Opacity"/);
  assert.match(style, /\.chain-composite-controls \{[\s\S]*?display: grid;[\s\S]*?gap: var\(--range-stack-gap\);/);
  assert.match(style, /\.studio-inspector select \{[\s\S]*?height: var\(--slider-height\);[\s\S]*?border: 0;[\s\S]*?border-radius: var\(--radius-section-inner\);[\s\S]*?background: var\(--slider-track\);/);
  assert.match(style, /\.studio-inspector select:focus-visible \{[\s\S]*?outline: 1px solid var\(--slider-thumb\);/);
  assert.doesNotMatch(style, /\.studio-inspector select:focus-visible \{[^}]*var\(--accent/);
});

test("components expose persistent instance synchronization without changing component ids", () => {
  const controllerSource = readFileSync(new URL("../js/control/component-view.js", import.meta.url), "utf8");

  assert.ok(controllerSource.includes("function componentInstanceSyncTemplate"));
  assert.ok(controllerSource.includes("Sync instances"));
  assert.ok(controllerSource.includes(".syncInstances"));
  assert.ok(controllerSource.includes('data-toggle-path="${base}.syncInstances"'));
  assert.ok(controllerSource.includes("each Canvas placement and surface its own phase"));
});

test("global clipboard routing follows clicked lists chains Groups and external images", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");
  const clipboardSource = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");
  const previewSource = readFileSync(new URL("../js/output/embedded-preview-app.js", import.meta.url), "utf8");

  assert.ok(source.includes("clipboard.bindWindowEvents()"));
  assert.ok(clipboardSource.includes('window.addEventListener("copy", copyFromCurrentTarget)'));
  assert.ok(clipboardSource.includes('window.addEventListener("paste", pasteIntoCurrentTarget)'));
  assert.ok(source.includes('data-paste-scope="component-list"'));
  assert.ok(source.includes('data-paste-scope="canvas-list"'));
  assert.ok(source.includes('data-paste-scope="scene-list"'));
  assert.ok(source.includes('data-paste-scope="surface-list"'));
  assert.ok(clipboardSource.includes("imageFilesFromTransfer"));
  assert.ok(clipboardSource.includes("imageUrlFromTransfer"));
  assert.ok(source.includes("onChainItemTarget: (componentId, itemId)"));
  assert.ok(previewSource.includes("onChainItemTarget?.(state.ui.selectedComponentId, itemId)"));
});

test("project undo and redo expose standard keyboard shortcuts", () => {
  const source = readFileSync(new URL("../js/control/control-shell-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes('window.addEventListener("keydown", handleHistoryKeydown)'));
  assert.ok(source.includes("event.metaKey || event.ctrlKey"));
  assert.ok(source.includes("if (event.shiftKey) redoProject()"));
  assert.ok(source.includes("else undoProject()"));
});

test("global selection supports cut and guarded delete shortcuts", () => {
  const source = readFileSync(new URL("../js/control/clipboard-controller.js", import.meta.url), "utf8");

  assert.ok(source.includes('window.addEventListener("cut", cutFromCurrentTarget)'));
  assert.ok(source.includes('window.addEventListener("keydown", handleDeleteKeydown)'));
  assert.ok(source.includes("writeClipboardPayload(event, payload)"));
  assert.ok(source.includes('event.key !== "Delete" && event.key !== "Backspace"'));
  assert.ok(source.includes("store.removeChainItem?.(value.componentId, value.itemId)"));
});
