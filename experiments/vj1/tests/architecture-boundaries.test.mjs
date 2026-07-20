import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../js");
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
