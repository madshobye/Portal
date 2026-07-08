import { BLEND_MODES, GENERATORS, ROUTE_TYPES, SOURCE_TYPES } from "../constants.js";
import { clamp01 } from "../domain/models.js";
import { buildOutputUrl } from "../view-routing.js";
import { listShaderComponents } from "../shaders/shader-registry.js";

export function createControlShell({ root, store, bridge, mediaLibrary, projectService }) {
  let refs = {};
  let latestState = store.getState();

  function mount() {
    root.innerHTML = shellTemplate();
    refs = collectRefs(root);
    bindStaticEvents();
    store.subscribe((state, reason) => {
      latestState = state;
      if (reason === "output-metrics" || reason === "mapping-state") {
        renderTopbar(state);
        renderLowerStatus(state);
        return;
      }
      render(state);
    });
  }

  function render(state) {
    renderTopbar(state);
    renderProjectRail(state);
    renderStudio(state);
    renderInspector(state);
    renderMixDock(state);
    renderLowerStatus(state);
    renderPreview(state);
  }

  function bindStaticEvents() {
    refs.openOutput.addEventListener("click", () => {
      window.open(buildOutputUrl("output"), "vj1-output", "popup=yes,width=1280,height=720");
      store.update((draft) => {
        draft.ui.outputWindowOpen = true;
      }, "open-output");
      setTimeout(() => bridge.sendState(), 350);
    });

    refs.togglePreview.addEventListener("click", () => {
      store.update((draft) => {
        draft.ui.debugPreview = !draft.ui.debugPreview;
      }, "toggle-preview");
    });

    refs.importFiles.addEventListener("change", async () => {
      await importFiles(refs.importFiles.files);
      refs.importFiles.value = "";
    });

    refs.openFolder.addEventListener("click", openProjectFolder);
    refs.saveProject.addEventListener("click", saveProject);

    refs.calibrate.addEventListener("click", () => {
      const next = !latestState.global.calibrating;
      store.update((draft) => {
        draft.global.calibrating = next;
      }, "calibrate-state");
      bridge.command("set-calibrate", { calibrating: next });
    });

    refs.blackout.addEventListener("click", () => {
      store.update((draft) => {
        draft.global.blackout = !draft.global.blackout;
      }, "blackout");
    });

    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      await importFiles(event.dataTransfer?.files || []);
    });
  }

  async function openProjectFolder() {
    const result = await projectService.openFolder().catch((error) => {
      setStatus(`Folder error: ${error.message || error}`);
      return null;
    });
    if (result?.fallback) refs.importFiles.click();
  }

  async function saveProject() {
    await projectService.saveProject().catch((error) => setStatus(`Save error: ${error.message || error}`));
  }

  async function importFiles(files) {
    const imported = await mediaLibrary.importFiles(files);
    store.update((draft) => {
      draft.media = mergeMedia(draft.media, imported.media);
      if (!draft.project.folderName && imported.media[0]?.path?.includes("/")) {
        draft.project.name = imported.media[0].path.split("/")[0];
        draft.project.folderName = draft.project.name;
      }
      if (imported.shaders[0]) {
        draft.shaders.customName = imported.shaders[0].name;
        draft.shaders.customCode = imported.shaders[0].code;
        draft.ui.shaderStatus = "Shader loaded";
      }
    }, "import-files");
    bridge.sendMediaFiles(mediaLibrary.getAllFiles());
  }

  function renderTopbar(state) {
    setText(refs.projectName, state.project.name || "VJ1");
    setText(
      refs.projectMeta,
      state.project.folderName ? state.project.folderName : "Choose a project folder to begin"
    );
    setClass(refs.outputStatus, "is-live", state.metrics.clients > 0);
    setText(refs.outputStatusText, state.metrics.clients > 0 ? `${Math.round(state.metrics.fps)} fps` : "output");
    setClass(refs.togglePreview, "is-active", state.ui.debugPreview);
    setClass(refs.calibrate, "is-active", state.global.calibrating);
    setClass(refs.blackout, "is-active", state.global.blackout);
  }

  function renderProjectRail(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    refs.projectRail.innerHTML = `
      <button class="project-card ${state.project.folderName ? "is-ready" : ""}" type="button" data-open-folder>
        <span class="material-symbols-rounded">folder_open</span>
        <span>
          <strong>${esc(state.project.folderName || "Open project folder")}</strong>
          <small>${state.media.length ? `${state.media.length} media files` : "Media, scenes, shaders, mappings"}</small>
        </span>
      </button>
      ${hasProject ? projectToolsTemplate(state) : `
        <div class="folder-first-note">
          <span class="material-symbols-rounded">gesture</span>
          <p>Open a folder first. The set, media, scenes, shaders, and mappings will live there together.</p>
        </div>
      `}
    `;
    bindRailEvents();
  }

  function projectToolsTemplate(state) {
    return `
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">movie</span><span>Sources</span></div>
        <div class="media-pills">
          ${state.media.slice(0, 9).map((item) => mediaPillTemplate(item)).join("") || emptyNote("Drop a folder or add media")}
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">auto_awesome_motion</span><span>Scenes</span></div>
        <div class="scene-pills">
          ${state.scenes.map((scene) => scenePillTemplate(scene)).join("") || emptyNote("Capture looks as scenes")}
        </div>
        <div class="capture-row">
          <input type="text" data-scene-name value="Scene ${state.scenes.length + 1}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
          <button class="icon-buttonish" type="button" data-save-scene title="Capture scene" aria-label="Capture scene">${icon("add")}</button>
        </div>
      </div>
      <div class="rail-section">
        <div class="rail-title"><span class="material-symbols-rounded">blur_on</span><span>Effects</span></div>
        <div class="effect-palette">
          ${listShaderComponents().map((shader) => `
            <button type="button" data-add-shader="${shader.id}" title="${esc(shader.name)}">
              ${icon(effectIcon(shader.id))}
              <span>${esc(shader.name)}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderStudio(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    refs.studio.innerHTML = `
      <section class="studio-stage">
        <div class="stage-head">
          <div>
            <h2>Visual Studio</h2>
            <p>${hasProject ? "Shape the live image directly." : "Start with a folder so the set has a home."}</p>
          </div>
          <div class="stage-actions">
            <button type="button" data-save-mapping title="Save mapping" aria-label="Save mapping">${icon("grid_on")}</button>
            <button type="button" data-reset-mapping title="Reset mapping" aria-label="Reset mapping">${icon("restart_alt")}</button>
          </div>
        </div>
        <div class="visual-frame ${hasProject ? "" : "is-empty"}" data-preview-host>
          ${hasProject ? "" : projectEmptyTemplate()}
        </div>
      </section>
    `;
    bindStudioEvents();
  }

  function renderPreview(state) {
    const previewHost = refs.studio.querySelector("[data-preview-host]");
    if (!previewHost || previewHost.classList.contains("is-empty")) return;
    if (!state.ui.debugPreview) {
      previewHost.innerHTML = `<div class="empty-preview">${icon("visibility_off")} Preview hidden</div>`;
      return;
    }
    if (previewHost.querySelector("iframe")) return;
    previewHost.innerHTML = `<iframe class="preview-frame" src="${buildOutputUrl("preview")}" title="VJ1 output preview"></iframe>`;
  }

  function renderInspector(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!hasProject) {
      refs.inspector.innerHTML = `
        <section class="glass-panel focus-panel">
          <header class="panel-title">
            <span class="material-symbols-rounded">folder_open</span>
            <span>Project first</span>
          </header>
          <div class="soft-note">The controls appear after you choose a folder. That keeps every look connected to a real local show file.</div>
        </section>
      `;
      return;
    }
    const selectedLayer = state.layers.find((layer) => layer.id === state.ui.selectedLayerId) || state.layers[0];
    const selectedSurface = state.surfaces.find((surface) => surface.id === state.ui.selectedSurfaceId) || state.surfaces[0];
    refs.inspector.innerHTML = `
      <section class="glass-panel focus-panel">
        <header class="panel-title">
          <span class="material-symbols-rounded">tune</span>
          <span>Look</span>
        </header>
        ${selectedLayer ? layerSculptTemplate(selectedLayer, state) : emptyNote("No layer")}
      </section>
      <section class="glass-panel focus-panel">
        <header class="panel-title">
          <span class="material-symbols-rounded">select_all</span>
          <span>Surface</span>
        </header>
        ${selectedSurface ? surfaceSculptTemplate(selectedSurface, state) : emptyNote("No surface")}
      </section>
    `;
    bindInputs(refs.inspector, state);
  }

  function renderMixDock(state) {
    const hasProject = !!state.project.folderName || state.media.length > 0;
    if (!hasProject) {
      refs.mixDock.innerHTML = `
        <div class="dock-strip folder-waiting">
          <span class="material-symbols-rounded">folder_open</span>
          <span>Waiting for a project folder</span>
        </div>
      `;
      return;
    }
    refs.mixDock.innerHTML = `
      <div class="dock-strip">
        <button type="button" class="dock-add" data-add-layer title="Add layer" aria-label="Add layer">${icon("add")}</button>
        ${state.layers.map((layer) => layerDockTemplate(layer, state)).join("")}
      </div>
      <div class="dock-strip surfaces">
        <button type="button" class="dock-add" data-add-surface title="Add surface" aria-label="Add surface">${icon("add")}</button>
        ${state.surfaces.map((surface) => surfaceDockTemplate(surface, state)).join("")}
      </div>
    `;
    bindInputs(refs.mixDock, state);
    refs.mixDock.querySelectorAll("[data-add-layer]").forEach((button) => {
      button.addEventListener("click", () => store.addLayer());
    });
    refs.mixDock.querySelectorAll("[data-add-surface]").forEach((button) => {
      button.addEventListener("click", () => store.addSurface());
    });
  }

  function renderLowerStatus(state) {
    setHTML(refs.lowerStatus, `
      <span>${icon("sensors")} ${state.metrics.message || "No output connected"}</span>
      <span>${icon("speed")} ${Math.round(state.metrics.fps || 0)} fps / ${Number(state.metrics.frameMs || 0).toFixed(1)} ms</span>
      <span>${icon("data_object")} ${state.ui.shaderError || state.ui.shaderStatus}</span>
    `);
  }

  function bindRailEvents() {
    refs.projectRail.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.projectRail.querySelector("[data-save-scene]")?.addEventListener("click", () => {
      const name = refs.projectRail.querySelector("[data-scene-name]")?.value?.trim() || `Scene ${latestState.scenes.length + 1}`;
      store.saveScene(name);
    });
    refs.projectRail.querySelectorAll("[data-recall-scene]").forEach((button) => {
      button.addEventListener("click", () => store.recallScene(button.dataset.recallScene));
    });
    refs.projectRail.querySelectorAll("[data-add-shader]").forEach((button) => {
      button.addEventListener("click", () => addShaderPass(button.dataset.addShader, "layer", latestState.ui.selectedLayerId));
    });
    refs.projectRail.querySelectorAll("[data-assign-media]").forEach((button) => {
      button.addEventListener("click", () => {
        const mediaId = button.dataset.assignMedia;
        store.update((draft) => {
          const layer = draft.layers.find((item) => item.id === draft.ui.selectedLayerId);
          if (layer) layer.source = { type: "media", mediaId, generatorId: layer.source.generatorId };
        }, "assign-media");
      });
    });
  }

  function bindStudioEvents() {
    refs.studio.querySelector("[data-open-folder]")?.addEventListener("click", openProjectFolder);
    refs.studio.querySelector("[data-import-files]")?.addEventListener("click", () => refs.importFiles.click());
    refs.studio.querySelector("[data-save-mapping]")?.addEventListener("click", () => bridge.command("save-mapping"));
    refs.studio.querySelector("[data-reset-mapping]")?.addEventListener("click", () => bridge.command("reset-mapping"));
  }

  function bindInputs(scope, state) {
    scope.querySelectorAll("[data-update]").forEach((input) => {
      const eventName = input.type === "range" || input.type === "text" || input.tagName === "TEXTAREA" ? "input" : "change";
      input.addEventListener(eventName, () => {
        store.update((draft) => {
          setByPath(draft, input.dataset.update, readInputValue(input));
        }, `update:${input.dataset.update}`);
      });
    });
    scope.querySelectorAll("[data-select-layer]").forEach((button) => {
      button.addEventListener("click", () => store.selectLayer(button.dataset.selectLayer));
    });
    scope.querySelectorAll("[data-select-surface]").forEach((button) => {
      button.addEventListener("click", () => store.selectSurface(button.dataset.selectSurface));
    });
    scope.querySelectorAll("[data-remove-pass]").forEach((button) => {
      button.addEventListener("click", () => removeShaderPass(button.dataset.target, button.dataset.targetId, Number(button.dataset.passIndex)));
    });
  }

  function addShaderPass(id, target, targetId) {
    store.update((draft) => {
      const owner = target === "surface"
        ? draft.surfaces.find((surface) => surface.id === targetId)
        : draft.layers.find((layer) => layer.id === targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].push({ id, enabled: true, amount: id === "custom" ? 0.5 : 0.32 });
    }, "add-shader-pass");
  }

  function removeShaderPass(target, targetId, index) {
    store.update((draft) => {
      const owner = target === "surface"
        ? draft.surfaces.find((surface) => surface.id === targetId)
        : draft.layers.find((layer) => layer.id === targetId);
      const chainKey = target === "surface" ? "finalShaderChain" : "shaderChain";
      owner?.[chainKey].splice(index, 1);
    }, "remove-shader-pass");
  }

  function setStatus(message) {
    store.update((draft) => {
      draft.metrics.message = message;
    }, "status");
  }

  return { mount };
}

function shellTemplate() {
  return `
    <div class="control-app studio-app" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false">
      <header class="topbar studio-topbar">
        <div class="brand">
          <div class="brand-mark">VJ</div>
          <div>
            <h1 id="project-name">VJ1</h1>
            <p id="project-meta">Choose a project folder</p>
          </div>
        </div>
        <div class="top-actions">
          <button id="open-folder-main" class="icon-buttonish primary" type="button" title="Open project folder" aria-label="Open project folder">${icon("folder_open")}</button>
          <button id="save-project-main" class="icon-buttonish" type="button" title="Save project" aria-label="Save project">${icon("save")}</button>
          <button id="toggle-preview" class="icon-buttonish" type="button" title="Toggle preview" aria-label="Toggle preview">${icon("visibility")}</button>
          <button id="calibrate-main" class="icon-buttonish" type="button" title="Calibrate mapping" aria-label="Calibrate mapping">${icon("grid_on")}</button>
          <button id="blackout-main" class="icon-buttonish danger" type="button" title="Blackout" aria-label="Blackout">${icon("brightness_1")}</button>
          <button id="open-output" class="icon-buttonish" type="button" title="Open output" aria-label="Open output">${icon("open_in_new")}</button>
          <span id="output-status" class="status-pill"><span class="status-dot"></span><span id="output-status-text">output</span></span>
          <input id="import-files-main" class="hidden" type="file" multiple webkitdirectory data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        </div>
      </header>
      <div class="studio-layout">
        <aside id="project-rail" class="project-rail"></aside>
        <main id="studio" class="studio-main"></main>
        <aside id="inspector" class="studio-inspector"></aside>
      </div>
      <footer class="studio-dock">
        <div id="mix-dock" class="mix-dock"></div>
        <div id="lower-status" class="lower-status"></div>
      </footer>
    </div>
  `;
}

function collectRefs(root) {
  return {
    projectName: root.querySelector("#project-name"),
    projectMeta: root.querySelector("#project-meta"),
    outputStatus: root.querySelector("#output-status"),
    outputStatusText: root.querySelector("#output-status-text"),
    openOutput: root.querySelector("#open-output"),
    togglePreview: root.querySelector("#toggle-preview"),
    calibrate: root.querySelector("#calibrate-main"),
    blackout: root.querySelector("#blackout-main"),
    openFolder: root.querySelector("#open-folder-main"),
    saveProject: root.querySelector("#save-project-main"),
    importFiles: root.querySelector("#import-files-main"),
    projectRail: root.querySelector("#project-rail"),
    studio: root.querySelector("#studio"),
    inspector: root.querySelector("#inspector"),
    mixDock: root.querySelector("#mix-dock"),
    lowerStatus: root.querySelector("#lower-status"),
  };
}

function layerSculptTemplate(layer, state) {
  const base = pathForLayer(state, layer);
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(layer.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        <label class="mini-toggle">${icon("power_settings_new")}<input type="checkbox" data-update="${base}.enabled" ${layer.enabled ? "checked" : ""} /></label>
      </div>
      ${rangeTemplate("Intensity", `${base}.opacity`, layer.opacity)}
      <div class="field-pair">
        <label class="field">Source ${selectTemplate(`${base}.source.type`, SOURCE_TYPES, layer.source.type)}</label>
        <label class="field">Generator ${selectTemplate(`${base}.source.generatorId`, GENERATORS, layer.source.generatorId)}</label>
      </div>
      <label class="field">Media ${mediaSelectTemplate(`${base}.source.mediaId`, state.media, layer.source.mediaId)}</label>
      <div class="field-pair">
        <label class="field">Blend ${selectValuesTemplate(`${base}.blend`, BLEND_MODES, layer.blend)}</label>
        <label class="field">Speed <input type="number" min="0" step="0.05" data-update="${base}.speed" value="${layer.speed}" /></label>
      </div>
      ${shaderChainTemplate(layer.shaderChain, "layer", layer.id, base)}
    </article>
  `;
}

function surfaceSculptTemplate(surface, state) {
  const base = pathForSurface(state, surface);
  return `
    <article class="sculpt-card">
      <div class="sculpt-head">
        <input type="text" data-update="${base}.name" value="${esc(surface.name)}" spellcheck="false" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" />
        <label class="mini-toggle">${icon("power_settings_new")}<input type="checkbox" data-update="${base}.enabled" ${surface.enabled ? "checked" : ""} /></label>
      </div>
      ${rangeTemplate("Presence", `${base}.opacity`, surface.opacity)}
      <div class="field-pair">
        <label class="field">Route ${selectTemplate(`${base}.route.type`, ROUTE_TYPES, surface.route.type)}</label>
        <label class="field">Layer ${layerSelectTemplate(`${base}.route.layerId`, state.layers, surface.route.layerId)}</label>
      </div>
      <div class="field-pair">
        <label class="field">Generator ${selectTemplate(`${base}.route.generatorId`, GENERATORS, surface.route.generatorId)}</label>
        <label class="field">Blend ${selectValuesTemplate(`${base}.finalBlend`, BLEND_MODES, surface.finalBlend)}</label>
      </div>
      <label class="toggle-line">${icon("label")}<span>Surface label</span><input type="checkbox" data-update="${base}.showLabel" ${surface.showLabel ? "checked" : ""} /></label>
      ${shaderChainTemplate(surface.finalShaderChain, "surface", surface.id, base, "finalShaderChain")}
    </article>
  `;
}

function layerDockTemplate(layer, state) {
  const selected = state.ui.selectedLayerId === layer.id;
  const base = pathForLayer(state, layer);
  return `
    <button class="dock-tile ${selected ? "is-selected" : ""}" type="button" data-select-layer="${layer.id}">
      ${icon(layer.enabled ? "layers" : "layers_clear")}
      <span>${esc(layer.name)}</span>
      <small>${Math.round(clamp01(layer.opacity) * 100)}%</small>
    </button>
    <input class="dock-slider" type="range" min="0" max="1" step="0.01" data-update="${base}.opacity" value="${layer.opacity}" />
  `;
}

function surfaceDockTemplate(surface, state) {
  const selected = state.ui.selectedSurfaceId === surface.id;
  return `
    <button class="dock-tile ${selected ? "is-selected" : ""}" type="button" data-select-surface="${surface.id}">
      ${icon("crop_free")}
      <span>${esc(surface.name)}</span>
      <small>${esc(surface.route.type)}</small>
    </button>
  `;
}

function shaderChainTemplate(chain, target, targetId, ownerPath, chainKey = "shaderChain") {
  if (!chain?.length) return `<div class="soft-note">No effects on this ${target}</div>`;
  return `
    <div class="chain-list">
      ${chain.map((pass, index) => `
        <div class="chain-pass">
          <label>${icon(effectIcon(pass.id))}<input type="checkbox" data-update="${ownerPath}.${chainKey}.${index}.enabled" ${pass.enabled ? "checked" : ""} />${esc(pass.id)}</label>
          <input type="range" min="0" max="1" step="0.01" data-update="${ownerPath}.${chainKey}.${index}.amount" value="${pass.amount}" />
          <button type="button" data-remove-pass data-target="${target}" data-target-id="${targetId}" data-pass-index="${index}" title="Remove effect" aria-label="Remove effect">${icon("close")}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function projectEmptyTemplate() {
  return `
    <div class="project-empty">
      <span class="material-symbols-rounded">folder_open</span>
      <h2>Open a folder to begin</h2>
      <p>Your folder becomes the show: media, shaders, scenes, mappings, and project settings live together.</p>
      <div class="button-row">
        <button type="button" class="primary" data-open-folder>${icon("folder_open")} Open folder</button>
        <button type="button" data-import-files>${icon("upload_file")} Import files</button>
      </div>
    </div>
  `;
}

function mediaPillTemplate(item) {
  return `
    <button type="button" data-assign-media="${esc(item.id)}" title="${esc(item.path)}">
      ${icon(item.type === "image" ? "image" : "movie")}
      <span>${esc(item.name)}</span>
    </button>
  `;
}

function scenePillTemplate(scene) {
  return `
    <button type="button" data-recall-scene="${scene.id}">
      ${icon("play_arrow")}
      <span>${esc(scene.name)}</span>
    </button>
  `;
}

function rangeTemplate(label, path, value) {
  return `
    <label class="field range-field">
      <span><span>${label}</span><strong>${Number(value).toFixed(2)}</strong></span>
      <input type="range" min="0" max="1" step="0.01" data-update="${path}" value="${value}" />
    </label>
  `;
}

function selectTemplate(path, options, value) {
  return `
    <select data-update="${path}">
      ${options.map((option) => `<option value="${option.id}" ${option.id === value ? "selected" : ""}>${esc(option.label)}</option>`).join("")}
    </select>
  `;
}

function selectValuesTemplate(path, values, value) {
  return `
    <select data-update="${path}">
      ${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}
    </select>
  `;
}

function mediaSelectTemplate(path, media, value) {
  return `
    <select data-update="${path}">
      <option value="">None</option>
      ${media.map((item) => `<option value="${esc(item.id)}" ${item.id === value ? "selected" : ""}>${esc(item.name)}</option>`).join("")}
    </select>
  `;
}

function layerSelectTemplate(path, layers, value) {
  return `
    <select data-update="${path}">
      ${layers.map((layer) => `<option value="${esc(layer.id)}" ${layer.id === value ? "selected" : ""}>${esc(layer.name)}</option>`).join("")}
    </select>
  `;
}

function setByPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    cursor = cursor?.[Number.isNaN(Number(part)) ? part : Number(part)];
    if (!cursor) return;
  }
  const last = parts[parts.length - 1];
  cursor[Number.isNaN(Number(last)) ? last : Number(last)] = value;
}

function readInputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "range" || input.type === "number") return Number(input.value);
  return input.value;
}

function pathForLayer(state, layer) {
  return `layers.${state.layers.findIndex((item) => item.id === layer.id)}`;
}

function pathForSurface(state, surface) {
  return `surfaces.${state.surfaces.findIndex((item) => item.id === surface.id)}`;
}

function mergeMedia(current, incoming) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function emptyNote(text) {
  return `<div class="soft-note">${esc(text)}</div>`;
}

function icon(name) {
  return `<span class="material-symbols-rounded" aria-hidden="true">${name}</span>`;
}

function setText(node, text) {
  const next = String(text ?? "");
  if (node && node.textContent !== next) node.textContent = next;
}

function setHTML(node, html) {
  const next = String(html ?? "");
  if (node && node.innerHTML !== next) node.innerHTML = next;
}

function setClass(node, className, on) {
  if (!node) return;
  const hasClass = node.classList.contains(className);
  if (on && !hasClass) node.classList.add(className);
  if (!on && hasClass) node.classList.remove(className);
}

function effectIcon(id) {
  return {
    ripple: "water",
    rgbSplit: "gradient",
    kaleido: "filter_vintage",
    pixelate: "grid_view",
    plasma: "blur_on",
    lumaKey: "tonality",
    custom: "data_object",
  }[id] || "auto_awesome";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
