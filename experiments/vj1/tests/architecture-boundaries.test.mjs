import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { listGeneratorNodeComponents } from "../js/libraries/visual-nodes/index.js";

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../js");
const libraryRoot = resolve(jsRoot, "libraries");
const modules = collectModules(jsRoot);
const moduleSet = new Set(modules);
const graph = new Map(modules.map((filename) => [filename, localImports(filename)]));

test("JavaScript modules have an acyclic static dependency graph", () => {
  const cycles = findCycles(graph);
  assert.deepEqual(cycles, [], cycles.map((cycle) => cycle.map(moduleName).join(" -> ")).join("\n"));
});

test("domain and graph modules do not depend on application, UI, services, or output runtimes", () => {
  const violations = [];
  for (const [filename, dependencies] of graph) {
    const layer = moduleName(filename).split("/")[0];
    if (layer !== "domain" && layer !== "graph") continue;
    for (const dependency of dependencies) {
      const dependencyLayer = moduleName(dependency).split("/")[0];
      if (["app-state.js", "app.js", "control", "metrics", "output", "services"].includes(dependencyLayer)) {
        violations.push(`${moduleName(filename)} -> ${moduleName(dependency)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("node engine and capability libraries do not delegate into application internals", () => {
  const violations = [];
  for (const [filename, dependencies] of graph) {
    const owner = moduleName(filename);
    if (!owner.startsWith("libraries/")) continue;
    for (const dependency of dependencies) {
      const target = moduleName(dependency);
      if (!target.startsWith("libraries/") && !target.startsWith("vendor/")) {
        violations.push(`${owner} -> ${target}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("output and preview hot paths use node-owned algorithms without node-runtime overhead", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  const surfaceRuntime = readFileSync(resolve(jsRoot, "output/output-surface-runtime.js"), "utf8");
  const surfacePlanner = readFileSync(resolve(jsRoot, "output/surface-render-planner.js"), "utf8");
  const app = readFileSync(resolve(jsRoot, "app.js"), "utf8");
  const outputBranch = app.slice(app.indexOf('if (mode === "output"'), app.indexOf("} else {"));
  const hotPath = `${renderer}\n${surfaceRuntime}\n${surfacePlanner}\n${outputBranch}`;

  assert.doesNotMatch(hotPath, /\b(?:NodeInstance|NodeGraphProgram|NodeCompilerRegistry|createNodeInstance|createNodePacket|createVj1NodePackage)\b/);
  assert.doesNotMatch(hotPath, /(?:\.\.\/)+node\/node-runtime\.js|app-node-package\.js/);
  assert.match(surfacePlanner, /export const planSurfaceRoutes = createSurfaceCompositionEngine\(/);
  assert.match(renderer, /fuseLocalShaderSchedule\(logicalSchedule\)/);
  assert.match(renderer, /new SpecializedSourceRuntime\(/);
  assert.match(renderer, /createSharedFramebufferTarget\(/);
  assert.match(renderer, /stableComponentSignatures/);
});

test("visual nodes own their definitions instead of using aggregate manifests", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  for (const removed of [
    "graph/generator-source-manifest.js",
    "graph/visual-node-catalog.js",
    "shaders/effect-source-manifest.js",
    "shaders/generator-shaders.js",
  ]) assert.equal(moduleSet.has(resolve(jsRoot, removed)), false, `${removed} must not return`);
  const generatorNodes = collectModules(resolve(libraryRoot, "visual-nodes/generators"));
  const effectNodes = collectModules(resolve(libraryRoot, "visual-nodes/effects"));
  const generatorEntries = generatorNodes.filter((filename) => filename.endsWith(`${sep}index.js`));
  const effectEntries = effectNodes.filter((filename) => filename.endsWith(`${sep}index.js`));
  assert.equal(generatorEntries.length, listGeneratorNodeComponents().length);
  assert.equal(effectEntries.length, 33);
  // A node may split a substantial implementation into private sibling
  // modules, but every such module must remain inside a folder with one public
  // node entry point.
  for (const filename of [...generatorNodes, ...effectNodes]) {
    assert.equal(moduleSet.has(resolve(dirname(filename), "index.js")), true, `${moduleName(filename)} needs a sibling node entry point`);
  }
  assert.equal(moduleSet.has(resolve(jsRoot, "graph/visual-node-adapter.js")), false);
  assert.doesNotMatch(renderer, /return component\.chain \|\| \[\]/);
  assert.match(renderer, /VJ1_COMPONENT_PROGRAM_MISSING/);
});

test("every native generator owns executable node code", () => {
  const nativeGenerators = listGeneratorNodeComponents().filter((component) => component.nodeDefinition.metadata.nativeRenderer);
  assert.equal(nativeGenerators.length > 0, true);
  assert.deepEqual(
    nativeGenerators.filter((component) => component.nodeDefinition.metadata.nodeOwnedNativeModule !== true).map((component) => component.id),
    []
  );
  for (const component of nativeGenerators) {
    assert.ok(component.nodeDefinition.parts.some((part) => part.kind === "javascript"), `${component.id} needs editable JavaScript`);
  }
});

test("each reusable library and executable node has an explicit folder boundary", () => {
  const libraries = readdirSync(libraryRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(libraries.length > 0, true);
  for (const library of libraries) {
    assert.equal(moduleSet.has(resolve(libraryRoot, library.name, "index.js")), true, `${library.name} needs a public index.js`);
  }

  const violations = [];
  for (const filename of modules.filter((item) => item.startsWith(libraryRoot))) {
    const source = readFileSync(filename, "utf8");
    const declarations = [...source.matchAll(/export const \w+(?:Node|Group|VisualComponent)\s*=\s*define(?:Node|NodeGroup|GeneratorNode|EffectNode)\s*\(/g)];
    if (!declarations.length) continue;
    if (!filename.endsWith(`${sep}index.js`) || declarations.length !== 1) {
      violations.push(`${moduleName(filename)} (${declarations.length} executable definitions)`);
    }
  }
  assert.deepEqual(violations, []);
  assert.equal(modules.some((filename) => /(?:timing-nodes|source-manifest|shader-components-(?:image|motion|stylize))\.js$/.test(filename)), false);
});

test("the application composition root configures libraries through public entry points", () => {
  const source = readFileSync(resolve(jsRoot, "app-node-package.js"), "utf8");
  const imports = [...source.matchAll(/from "\.\/libraries\/([^"?]+)"/g)].map((match) => match[1]);
  assert.equal(imports.length > 0, true);
  assert.deepEqual(imports.filter((target) => !target.endsWith("/index.js")), []);
});

test("orchestration shells delegate extracted cache, shader-target, history, derived-asset, profiling, diagnostics, and rail ownership", () => {
  const renderer = readFileSync(resolve(jsRoot, "output/output-renderer.js"), "utf8");
  const projectService = readFileSync(resolve(jsRoot, "services/project-folder-service.js"), "utf8");
  const controlShell = readFileSync(resolve(jsRoot, "control/control-shell-controller.js"), "utf8");

  assert.match(renderer, /new OutputRenderCache\(\)/);
  assert.match(renderer, /new OutputRenderProfile\(/);
  assert.match(renderer, /from "\.\/shader-target-runtime\.js/);
  assert.doesNotMatch(renderer, /function (?:touchCacheEntry|pruneRenderCaches|beginProfile|finishProfile|drawShaderTarget|clearShaderTarget|applyShaderTarget|resetShaderTarget)\b/);
  assert.match(projectService, /createProjectHistoryStore\(/);
  assert.match(projectService, /new ProjectDerivedAssetStore\(/);
  assert.doesNotMatch(projectService, /(?:async )?function (?:listRevisionEntries|pruneRevisionEntries|readRedoIndex|writeRedoIndex|writeMediaRendition|loadIndexedRenditions|writeComponentThumbnail|loadComponentThumbnails)\b/);
  assert.match(controlShell, /createControlPerformanceSession\(/);
  assert.match(controlShell, /createControlDiagnosticsController\(/);
  assert.match(controlShell, /projectRailTemplate\(/);
  assert.doesNotMatch(controlShell, /function (?:railToolsTemplate|componentToolsTemplate|canvasToolsTemplate|sceneToolsTemplate|liveToolsTemplate|mappingToolsTemplate)\b/);
});

function collectModules(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectModules(filename));
    else if (entry.name.endsWith(".js")) result.push(filename);
  }
  return result.sort();
}

function localImports(filename) {
  const source = readFileSync(filename, "utf8");
  const dependencies = [];
  const pattern = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[1].startsWith(".")) continue;
    const dependency = resolve(dirname(filename), match[1].split("?")[0]);
    if (moduleSet.has(dependency)) dependencies.push(dependency);
  }
  return dependencies;
}

function findCycles(dependencies) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];
  const seenCycles = new Set();

  function visit(filename) {
    if (visited.has(filename)) return;
    active.add(filename);
    stack.push(filename);
    for (const dependency of dependencies.get(filename) || []) {
      if (!active.has(dependency)) visit(dependency);
      else {
        const start = stack.indexOf(dependency);
        const cycle = [...stack.slice(start), dependency];
        const key = canonicalCycleKey(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    active.delete(filename);
    visited.add(filename);
  }

  for (const filename of dependencies.keys()) visit(filename);
  return cycles;
}

function canonicalCycleKey(cycle) {
  const names = cycle.slice(0, -1).map(moduleName);
  const rotations = names.map((_, index) => [...names.slice(index), ...names.slice(0, index)].join("|"));
  return rotations.sort()[0] || "";
}

function moduleName(filename) {
  return relative(jsRoot, filename).split(sep).join("/");
}
