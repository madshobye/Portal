import test from "node:test";
import assert from "node:assert/strict";

import {
  defineVisualLibraryLayer,
  resolveVisualLibrary,
  VISUAL_LIBRARY_LAYER_KINDS,
} from "../js/libraries/visual-library/index.js";
import {
  BuiltInVisualLibrary,
  BuiltInVisualLibraryLayer,
  listBuiltInVisualArtifacts,
} from "../js/libraries/visual-nodes/catalog.js";
import { createIsfNodeDefinition } from "../js/libraries/isf-engine/index.js";
import { resolveProjectVisualLibrary } from "../js/libraries/visual-nodes/project-visual-library.js";
import { createProjectVisualNodeResolver } from "../js/libraries/visual-nodes/project-visual-node-resolver.js";
import {
  defineNode,
  defineNodePackage,
  installNodePackageIntoProject,
} from "../js/libraries/node-engine/index.js";

function artifact(id, version, additions = {}) {
  return {
    id,
    version,
    name: id,
    artifactType: "effect",
    implementation: { format: "isf", resourceId: `${id}-source` },
    ...additions,
  };
}

test("visual-library layers reject accidental ID collisions and honor explicit overrides", () => {
  const builtIn = defineVisualLibraryLayer({
    id: "vj1.built-in",
    kind: VISUAL_LIBRARY_LAYER_KINDS.BUILT_IN,
    artifacts: [artifact("org.vj1.effect.blur", "1.0.0")],
  });
  const installed = defineVisualLibraryLayer({
    id: "org.example.visuals",
    kind: VISUAL_LIBRARY_LAYER_KINDS.INSTALLED,
    artifacts: [artifact("org.vj1.effect.blur", "2.0.0")],
  });
  const project = defineVisualLibraryLayer({
    id: "project",
    kind: VISUAL_LIBRARY_LAYER_KINDS.PROJECT,
    artifacts: [artifact("org.vj1.effect.blur", "3.0.0", {
      replaces: ["org.vj1.effect.blur@1.0.0"],
    })],
  });
  const resolved = resolveVisualLibrary([project, installed, builtIn]);

  assert.equal(resolved.get("org.vj1.effect.blur").version, "3.0.0");
  assert.deepEqual(resolved.diagnostics.map((item) => item.code), [
    "id-collision",
    "explicit-override",
  ]);
  assert.equal(resolved.get("org.vj1.effect.blur").origin.kind, "project");
});

test("same-origin library revisions upgrade semantically and catalog filters remain implementation-neutral", () => {
  const earlier = defineVisualLibraryLayer({
    id: "org.example.visuals",
    priority: 100,
    artifacts: [artifact("org.example.effect.glow", "1.2.0", {
      categories: ["Color"],
      tags: ["glow"],
      capabilities: ["visual-effect"],
    })],
  });
  const later = defineVisualLibraryLayer({
    id: "org.example.visuals",
    priority: 101,
    artifacts: [artifact("org.example.effect.glow", "1.10.0", {
      categories: ["Color"],
      tags: ["glow"],
      capabilities: ["visual-effect"],
    })],
  });
  const resolved = resolveVisualLibrary([later, earlier]);

  assert.equal(resolved.get("org.example.effect.glow").version, "1.10.0");
  assert.equal(resolved.diagnostics[0].code, "version-upgrade");
  assert.equal(resolved.list({ artifactType: "effect", implementation: "isf", tag: "glow" }).length, 1);
  assert.equal(resolved.list({ capability: "visual-effect", category: "Color" }).length, 1);
});

test("the static built-in catalog is projected into the common visual-library model", () => {
  assert.equal(BuiltInVisualLibraryLayer.kind, "built-in");
  assert.equal(BuiltInVisualLibraryLayer.artifacts.length > 60, true);
  assert.equal(BuiltInVisualLibrary.list().length, BuiltInVisualLibraryLayer.artifacts.length);
  const noise = listBuiltInVisualArtifacts().find((item) => item.implementation.visualId === "noise");

  assert.equal(noise?.artifactType, "generator");
  assert.equal(noise?.implementation.format, "node");
  assert.equal(noise?.origin.id, BuiltInVisualLibraryLayer.id);
  assert.equal(typeof noise?.implementation.nodeId, "string");
  const dissolve = listBuiltInVisualArtifacts({ artifactType: "transition" })[0];
  assert.equal(dissolve?.id, "vj1.transition.dissolve");
  assert.equal(dissolve?.capabilities.includes("direct-mapper-pass"), true);
});

test("project ISF transitions join the same layered catalog without becoming effects", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/transitions/wipe.fs",
    source: `/*{
      "ISFVSN": "2.0",
      "LABEL": "Wipe",
      "VJ1": { "ID": "org.example.transition.wipe", "VERSION": "1.0.0" },
      "INPUTS": [
        { "NAME": "startImage", "TYPE": "image" },
        { "NAME": "endImage", "TYPE": "image" },
        { "NAME": "progress", "TYPE": "float" }
      ]
    }*/
    void main() { gl_FragColor = mix(IMG_THIS_NORM_PIXEL(startImage), IMG_THIS_NORM_PIXEL(endImage), progress); }`,
  });
  const library = resolveProjectVisualLibrary({ nodes: { definitions: [definition] } });
  const transition = library.get("org.example.transition.wipe");

  assert.equal(transition.artifactType, "transition");
  assert.equal(transition.implementation.format, "isf");
  assert.equal(transition.origin.kind, "project");
  assert.equal(library.list({ artifactType: "effect" }).some((item) => item.id === transition.id), false);
});

test("runtime visual resolution follows the layered library instead of bypassing it with static maps", () => {
  const resolver = createProjectVisualNodeResolver({ nodes: { definitions: [] } });
  const artifact = resolver.visualLibrary.list({ artifactType: "generator" })
    .find((item) => item.implementation.visualId === "terrainFlyover");

  assert.equal(artifact?.implementation.nodeId, "vj1.visual.generator.terrainFlyover");
  assert.equal(resolver.generator("terrainFlyover")?.nodeDefinition.id, artifact.implementation.nodeId);
  assert.equal(resolver.diagnostics, resolver.visualLibrary.diagnostics);
});

test("project visual libraries activate only exact declared node-package versions", () => {
  const oldPackage = defineNodePackage({
    id: "org.example.visuals",
    version: "1.0.0",
    visualLibrary: [artifact("org.example.effect.package-glow", "1.0.0", {
      implementation: { format: "native", visualId: "package-glow" },
    })],
  });
  const currentPackage = defineNodePackage({
    id: "org.example.visuals",
    version: "2.0.0",
    visualLibrary: [artifact("org.example.effect.package-glow", "2.0.0", {
      implementation: { format: "native", visualId: "package-glow" },
    })],
  });
  const installation = installNodePackageIntoProject(currentPackage, {});
  const state = { nodes: installation.project };
  const resolver = createProjectVisualNodeResolver(state, {
    installedPackages: [oldPackage, currentPackage],
  });

  const installed = resolver.visualLibrary.get("org.example.effect.package-glow");
  assert.equal(installed.version, "2.0.0");
  assert.equal(installed.origin.kind, "installed");
  assert.equal(installed.origin.id, "org.example.visuals");
  assert.equal(resolver.visualLibrary.layers.some((layer) => layer.metadata.packageVersion === "1.0.0"), false);

  state.nodes = {
    ...state.nodes,
    packages: state.nodes.packages.map((item) => ({ ...item, enabled: false })),
  };
  const disabled = createProjectVisualNodeResolver(state, {
    installedPackages: [oldPackage, currentPackage],
  });
  assert.equal(disabled.visualLibrary.has("org.example.effect.package-glow"), false);
});

test("loaded node-package visual definitions become executable resolver components", () => {
  const definition = defineNode({
    id: "org.example.node.package-generator",
    name: "Package Generator",
    version: "1.1.0",
    description: "Executable visual supplied by a loaded node package.",
    implementation: { kind: "native", language: "javascript" },
    parameters: {
      amount: { type: "number", defaultValue: 0.5 },
    },
    outlets: { texture: { type: "texture" } },
    capabilities: ["visual-node", "visual-generator", "compiled-fast-path"],
    metadata: {
      visualId: "packageGenerator",
      visualKind: "generator",
      visualFamily: "package",
      visualType: "native",
      processor: "generator",
      visualCompilerHook: {
        id: "vj1.visual.native-source",
        renderer: "output/specialized:package-generator",
      },
      renderInvalidation: { mode: "stable" },
    },
    process: () => ({ texture: null }),
  });
  const nodePackage = defineNodePackage({
    id: "org.example.executable-visuals",
    version: "1.0.0",
    definitions: [definition],
    visualLibrary: [{
      id: "org.example.generator.package",
      version: "1.0.0",
      name: "Package Generator",
      artifactType: "generator",
      implementation: {
        format: "node",
        nodeId: definition.id,
        nodeVersion: definition.version,
        visualId: "packageGenerator",
      },
    }],
  });
  const installation = installNodePackageIntoProject(nodePackage, {});
  const resolver = createProjectVisualNodeResolver({ nodes: installation.project }, {
    installedPackages: [nodePackage],
  });
  const component = resolver.generator("packageGenerator");

  assert.equal(component?.nodeDefinition.id, definition.id);
  assert.equal(component?.nodeDefinition.version, definition.version);
  assert.equal(typeof component?.nodeDefinition.process, "function");
  assert.equal(component?.renderAuthority, "installed-node-package");
  assert.equal(component?.packageId, nodePackage.id);
  assert.equal(resolver.definition(definition.id)?.id, definition.id);
});
