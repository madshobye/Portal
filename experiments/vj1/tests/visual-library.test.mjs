import test from "node:test";
import assert from "node:assert/strict";

import {
  defineVisualLibraryLayer,
  resolveVisualLibrary,
  VISUAL_LIBRARY_LAYER_KINDS,
} from "../js/libraries/visual-library/index.js";
import {
  BuiltInIsfRepository,
  loadBuiltInIsfRepository,
} from "../js/libraries/visual-library/built-in-isf-repository.js";
import {
  BuiltInVisualLibrary,
  BuiltInVisualLibraryLayer,
  DefaultBuiltInTransition,
  listBuiltInVisualArtifacts,
} from "../js/libraries/visual-nodes/catalog.js";
import { createIsfNodeDefinition, evaluateIsfDimension } from "../js/libraries/isf-engine/index.js";
import { resolveProjectVisualLibrary } from "../js/libraries/visual-nodes/project-visual-library.js";
import {
  createProjectVisualNodeResolver,
  resolveProjectVisualTransitionEntries,
} from "../js/libraries/visual-nodes/project-visual-node-resolver.js";
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
  assert.equal(dissolve?.implementation.format, "isf");
  assert.equal(
    dissolve?.implementation.resourceId,
    "shaders/transitions/dissolve.fs",
  );
  assert.equal(
    dissolve?.implementation.transitionKernelId,
    "vj1.transition.dissolve",
  );
  assert.equal(dissolve?.capabilities.includes("direct-mapper-pass"), true);
  assert.strictEqual(DefaultBuiltInTransition.kernel.implementation, "isf");
});

test("the built-in proving set is file-backed ISF with stable node identity and explicit lowering", () => {
  assert.equal(BuiltInIsfRepository.id, BuiltInVisualLibraryLayer.id);
  assert.equal(BuiltInIsfRepository.records.length, 50);
  const black = BuiltInIsfRepository.records.find((record) => record.visualId === "black");
  const invert = BuiltInIsfRepository.records.find((record) => record.visualId === "invert");
  const gray = BuiltInIsfRepository.records.find((record) => record.visualId === "gray");
  const threshold = BuiltInIsfRepository.records.find((record) => record.visualId === "threshold");
  const dissolve = BuiltInIsfRepository.records.find(
    (record) => record.visualId === "vj1.transition.dissolve",
  );
  const artifacts = listBuiltInVisualArtifacts();
  const blackArtifact = artifacts.find((item) => item.implementation.visualId === "black");
  const invertArtifact = artifacts.find((item) => item.implementation.visualId === "invert");
  const grayArtifact = artifacts.find((item) => item.implementation.visualId === "gray");
  const thresholdArtifact = artifacts.find((item) => item.implementation.visualId === "threshold");

  assert.equal(black?.definition.id, "vj1.visual.generator.black");
  assert.equal(black?.definition.metadata.builtInAssetDefinition, true);
  assert.equal(black?.definition.parts[0].language, "isf");
  assert.match(black?.definition.parts[0].source || "", /"LOWERING": "fragment-generator"/);
  assert.equal(black?.component.type, "fragment");
  assert.equal(invert?.definition.id, "vj1.visual.effect.invert");
  assert.equal(invert?.component.fusible, true);
  assert.equal(invert?.component.sampling, "local");
  assert.match(invert?.component.code || "", /vec4 runEffect/);
  assert.equal(gray?.definition.id, "vj1.visual.effect.gray");
  assert.equal(gray?.component.fusible, true);
  assert.equal(gray?.component.sampling, "local");
  assert.match(gray?.definition.parts[0].source || "", /float luminance/);
  assert.equal(threshold?.definition.id, "vj1.visual.effect.threshold");
  assert.equal(threshold?.component.fusible, true);
  assert.equal(
    threshold?.component.params.find((param) => param.id === "cutoff")?.defaultValue,
    0.5,
  );
  assert.equal(
    dissolve?.definition.id,
    "vj1.visual.transition.vj1.transition.dissolve",
  );
  assert.equal(dissolve?.definition.version, "0.1.0");
  assert.equal(dissolve?.component, null);
  assert.equal(dissolve?.transition.id, "vj1.transition.dissolve");
  assert.equal(dissolve?.transition.version, "1.0.0");
  assert.equal(dissolve?.transition.kernel.implementation, "isf");
  assert.strictEqual(dissolve?.transition.definition, dissolve?.definition);
  assert.equal(
    dissolve?.transition.resource,
    "shaders/transitions/dissolve.fs",
  );
  assert.equal(dissolve?.resource, "shaders/transitions/dissolve.fs");
  assert.deepEqual(
    [blackArtifact, invertArtifact, grayArtifact, thresholdArtifact].map((item) => ({
      format: item?.implementation.format,
      resourceId: item?.implementation.resourceId,
      lowering: item?.implementation.lowering,
    })),
    [
      {
        format: "isf",
        resourceId: "shaders/generators/black.fs",
        lowering: "fragment-generator",
      },
      {
        format: "isf",
        resourceId: "shaders/effects/invert.fs",
        lowering: "local-effect",
      },
      {
        format: "isf",
        resourceId: "shaders/effects/gray.fs",
        lowering: "local-effect",
      },
      {
        format: "isf",
        resourceId: "shaders/effects/threshold.fs",
        lowering: "local-effect",
      },
    ],
  );
});

test("the curated ISF collection is fragment-only, attributed, and catalogued by capability", () => {
  const collection = BuiltInIsfRepository.records.filter((record) =>
    record.resource.startsWith("shaders/isf/")
  );
  const proof = collection.filter((record) =>
    !record.tags.includes("isf-tranche-2") &&
    !record.tags.includes("isf-multipass-comparison")
  );
  const tranche2 = collection.filter((record) =>
    record.tags.includes("isf-tranche-2")
  );
  const multipassComparison = collection.filter((record) =>
    record.tags.includes("isf-multipass-comparison")
  );
  assert.equal(collection.length, 45);
  assert.equal(proof.length, 26);
  assert.equal(tranche2.length, 17);
  assert.equal(multipassComparison.length, 2);
  assert.deepEqual(
    Object.fromEntries(["generator", "effect", "transition"].map((kind) => [
      kind,
      collection.filter((record) => record.artifactType === kind).length,
    ])),
    { generator: 12, effect: 20, transition: 13 },
  );
  for (const record of collection) {
    const sourcePart = record.definition.parts.find((part) =>
      part.id === "isf-source"
    );
    const document = record.component?.isf ||
      record.transition?.definition?.metadata?.isf;
    assert.equal(record.resource.endsWith(".fs"), true, record.resource);
    assert.equal(sourcePart?.stage, "fragment", record.resource);
    assert.doesNotMatch(sourcePart?.source || "", /"IMPORTED"\s*:/, record.resource);
    assert.equal(document?.inputs?.some((input) =>
      input.type === "event"
    ), false, record.resource);
    assert.equal(
      document?.inputs?.filter((input) => input.type === "image").length <=
        (record.artifactType === "transition" ? 2 : 1),
      true,
      record.resource,
    );
    assert.equal(record.categories.includes("ISF"), true, record.resource);
    assert.equal(record.tags.includes("isf"), true, record.resource);
    assert.equal(record.attribution?.license, "MIT", record.resource);
    assert.equal(
      record.attribution?.upstreamCommit,
      "395072d48b3ce7351ccb20a5fda54470591324df",
      record.resource,
    );
    const dimensionValues = { WIDTH: 1920, HEIGHT: 1080 };
    for (const param of record.component?.params || []) {
      if (Number.isInteger(param.isfVectorIndex)) continue;
      dimensionValues[param.id] = Number(param.defaultValue) || 0;
    }
    for (const pass of document?.passes || []) {
      assert.doesNotThrow(
        () => evaluateIsfDimension(pass.width, dimensionValues),
        `${record.resource} pass ${pass.index} width`,
      );
      assert.doesNotThrow(
        () => evaluateIsfDimension(pass.height, dimensionValues),
        `${record.resource} pass ${pass.index} height`,
      );
    }
  }
  assert.equal(collection.filter((record) =>
    record.component?.isf?.inputs?.some((input) =>
      ["audio", "audioFFT"].includes(input.type)
    )
  ).length, 3);
  for (const record of proof) {
    const document = record.component?.isf ||
      record.transition?.definition?.metadata?.isf;
    assert.equal(document?.passes?.length, 1, record.resource);
    assert.equal(document?.passes?.some((pass) =>
      pass.persistent || pass.float || pass.target
    ), false, record.resource);
  }
  assert.deepEqual(
    tranche2.filter((record) =>
      record.component?.isf?.passes?.some((pass) => pass.persistent)
    ).map((record) => record.name).sort(),
    ["Comet Tails", "Freeze Frame", "Slit Scan"],
  );
  assert.deepEqual(
    tranche2.filter((record) =>
      (record.component?.isf?.passes?.length || 0) > 1
    ).map((record) => record.name),
    ["Ghosting"],
  );
  assert.deepEqual(
    multipassComparison.map((record) => [
      record.name,
      record.component?.isf?.passes?.length,
      record.component?.isf?.passes?.filter((pass) => pass.target).length,
      record.component?.isf?.passes?.some((pass) => pass.persistent),
    ]),
    [
      ["Dilate", 2, 1, false],
      ["Erode", 2, 1, false],
    ],
  );
  const proofArtifacts = listBuiltInVisualArtifacts().filter((artifact) =>
    artifact.implementation.resourceId?.startsWith("shaders/isf/")
  );
  assert.equal(proofArtifacts.length, 45);
  assert.equal(
    proofArtifacts.every((artifact) =>
      artifact.implementation.format === "isf" &&
      artifact.attribution?.license === "MIT"
    ),
    true,
  );
});

test("built-in repository manifests fail closed when header identity or version diverges", async () => {
  const manifestUrl = new URL("https://example.test/visual-library.json");
  const manifest = {
    formatVersion: 1,
    id: "test.visuals",
    version: "1.0.0",
    artifacts: [{
      id: "vj1.visual.generator.expected",
      visualId: "expected",
      version: "1.0.0",
      name: "Expected",
      artifactType: "generator",
      resource: "shaders/expected.fs",
    }],
  };
  const shader = `/*{
    "ISFVSN": "2.0",
    "LABEL": "Expected",
    "VJ1": {
      "ID": "different",
      "VERSION": "2.0.0",
      "LOWERING": "fragment-generator"
    },
    "INPUTS": []
  }*/
  void main() { gl_FragColor = vec4(0.0); }`;
  const readText = async (url) =>
    url.pathname.endsWith("visual-library.json")
      ? JSON.stringify(manifest)
      : shader;

  await assert.rejects(
    loadBuiltInIsfRepository({ manifestUrl, readText }),
    /BUILT_IN_VISUAL_NODE_ID_MISMATCH/,
  );
  manifest.artifacts[0].id = "vj1.visual.generator.different";
  manifest.artifacts[0].visualId = "different";
  await assert.rejects(
    loadBuiltInIsfRepository({ manifestUrl, readText }),
    /BUILT_IN_VISUAL_NODE_VERSION_MISMATCH/,
  );
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

test("installed transitions join the same active transition entries used by runtime and editor", () => {
  const definition = createIsfNodeDefinition({
    path: "shaders/transitions/package-wipe.fs",
    origin: "package",
    source: `/*{
      "ISFVSN": "2.0",
      "LABEL": "Package Wipe",
      "VJ1": { "ID": "org.example.transition.package-wipe", "VERSION": "1.0.0" },
      "INPUTS": [
        { "NAME": "startImage", "TYPE": "image" },
        { "NAME": "endImage", "TYPE": "image" },
        { "NAME": "progress", "TYPE": "float" }
      ]
    }*/
    void main() {
      gl_FragColor = mix(
        IMG_THIS_NORM_PIXEL(startImage),
        IMG_THIS_NORM_PIXEL(endImage),
        step(isf_FragNormCoord.x, progress)
      );
    }`,
  });
  const nodePackage = defineNodePackage({
    id: "org.example.transition-library",
    version: "1.0.0",
    definitions: [definition],
    resources: [{
      id: "shaders/transitions/package-wipe.fs",
      kind: "shader",
      path: "shaders/transitions/package-wipe.fs",
    }],
    visualLibrary: [{
      id: "org.example.transition.package-wipe",
      version: "1.0.0",
      name: "Package Wipe",
      artifactType: "transition",
      implementation: {
        format: "isf",
        nodeId: definition.id,
        nodeVersion: definition.version,
        resourceId: "shaders/transitions/package-wipe.fs",
      },
    }],
  });
  const installation = installNodePackageIntoProject(nodePackage, {});
  const state = { nodes: installation.project };
  const entries = resolveProjectVisualTransitionEntries(state, {
    installedPackages: [nodePackage],
  });
  const resolver = createProjectVisualNodeResolver(state, {
    installedPackages: [nodePackage],
  });

  assert.deepEqual(
    entries.slice(0, BuiltInIsfRepository.transitions.length)
      .map((entry) => entry.id),
    BuiltInIsfRepository.transitions.map((entry) => entry.id),
  );
  const installed = entries.find((entry) =>
    entry.id === "org.example.transition.package-wipe"
  );
  const resolvedInstalled = resolver.transitionEntries.find((entry) =>
    entry.id === installed.id
  );
  assert.strictEqual(resolvedInstalled.kernel, installed.kernel);
  assert.equal(installed.origin.kind, "installed");
  assert.equal(installed.origin.id, nodePackage.id);
  assert.equal(installed.kernel.implementation, "isf");
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
