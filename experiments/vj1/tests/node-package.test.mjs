import test from "node:test";
import assert from "node:assert/strict";

import {
  checkNodeCompatibility,
  createNodePackageFromProject,
  createNodeInstance,
  createProjectNodeFork,
  defineNode,
  defineNodePackage,
  exportNodePackage,
  importNodePackage,
  installNodePackage,
  installNodePackageIntoProject,
  migrateNodeData,
  NodeRegistry,
  NODE_PART_KINDS,
  resolveNodeDependencies,
  resolveNodePackageDependencies,
  resolveNodeVersion,
  satisfiesNodeVersion,
  upgradeProjectNodeFork,
} from "../js/libraries/node-engine/index.js";

function valueNode(version, additions = {}) {
  return defineNode({
    id: "test.package.value",
    name: "Packaged value",
    version,
    description: "Package transport fixture.",
    inlets: { value: "number" },
    outlets: { value: "number" },
    parts: [
      {
        id: "helper",
        kind: NODE_PART_KINDS.JAVASCRIPT,
        export: "doubleValue",
        source: "function doubleValue(value) { return value * 2; }",
      },
      {
        id: "entry",
        kind: NODE_PART_KINDS.JAVASCRIPT,
        export: "valueProcess",
        entry: "process",
        dependsOn: ["helper"],
        source: "function valueProcess({ value }) { return { value: doubleValue(value) }; }",
      },
    ],
    process: ({ value }) => ({ value: value * 2 }),
    ...additions,
  });
}

test("node dependency resolution honors ranges and project pins", () => {
  const utility1 = defineNode({ id: "test.utility", name: "Utility", version: "1.2.0", description: "Dependency fixture.", process: () => ({}) });
  const utility2 = defineNode({ id: "test.utility", name: "Utility", version: "1.8.0", description: "Dependency fixture.", process: () => ({}) });
  const utility3 = defineNode({ id: "test.utility", name: "Utility", version: "2.0.0", description: "Dependency fixture.", process: () => ({}) });
  const consumer = defineNode({
    id: "test.consumer",
    name: "Consumer",
    description: "Consumes a compatible utility.",
    dependencies: [{ id: "test.utility", range: "^1.2.0" }],
    process: () => ({}),
  });
  const registry = new NodeRegistry([utility1, utility2, utility3, consumer]);
  const unorderedRegistry = new NodeRegistry([utility3, utility1, utility2]);

  assert.equal(satisfiesNodeVersion("1.8.0", "^1.2.0"), true);
  assert.equal(satisfiesNodeVersion("2.0.0", "^1.2.0"), false);
  assert.equal(resolveNodeVersion(registry, "test.utility", { range: "^1.2.0" }).version, "1.8.0");
  assert.equal(unorderedRegistry.get("test.utility").version, "2.0.0", "latest is semantic rather than registration order");
  assert.equal(resolveNodeVersion(registry, "test.utility", {
    range: "^1.2.0",
    pins: [{ nodeId: "test.utility", version: "1.2.0" }],
  }).version, "1.2.0");
  assert.deepEqual(resolveNodeDependencies(consumer, registry).map((definition) => definition.id), ["test.utility", "test.consumer"]);
  assert.throws(() => resolveNodeVersion(registry, "test.utility", {
    range: "^1.2.0",
    pins: [{ nodeId: "test.utility", version: "2.0.0" }],
  }), /NODE_PIN_RANGE_CONFLICT/);
});

test("node packages export import install and execute linked source modules", async () => {
  const definition = valueNode("1.0.0");
  const original = defineNodePackage({
    id: "test.value-package",
    name: "Value package",
    version: "1.0.0",
    definitions: [definition],
    metadata: { reusable: true },
  });
  const encoded = exportNodePackage(original);
  const imported = importNodePackage(encoded);
  const registry = new NodeRegistry();
  installNodePackage(imported, { registry });
  const installed = registry.get(definition.id, definition.version);

  assert.equal(imported.id, original.id);
  assert.equal(imported.metadata.reusable, true);
  assert.deepEqual(await createNodeInstance(installed).run({ value: 6 }), { value: 12 });
  assert.equal(installed.moduleExports.doubleValue(5), 10);
  assert.deepEqual(installNodePackage(imported, { registry }).definitions, [], "identical package installation is idempotent");
  assert.equal(encoded.includes("moduleBindings"), false);
  assert.equal(encoded.includes("moduleExports"), false);
  assert.equal(encoded.includes("process\""), true, "the process entry metadata is transported with its source part");
});

test("project packages transport reusable group topology with explicit external node requirements", () => {
  const utility = defineNode({
    id: "test.project.utility",
    name: "Project utility",
    version: "1.0.0",
    description: "External utility required by the reusable group.",
    outlets: { value: "number" },
    process: () => ({ value: 1 }),
  });
  const groupDefinition = defineNode({
    id: "test.project.group",
    name: "Project group",
    version: "1.0.0",
    description: "Reusable project-authored topology.",
    implementation: "group",
    dependencies: [{ id: utility.id, range: "^1.0.0" }],
    parts: [{
      id: "graph",
      kind: NODE_PART_KINDS.GRAPH,
      nodes: [{ id: "utility", nodeId: utility.id, nodeVersion: utility.version }],
      connections: [],
    }],
  });
  const group = {
    id: "test.project.group-topology",
    nodeId: groupDefinition.id,
    nodeVersion: groupDefinition.version,
    nodes: [{ id: "utility", nodeId: utility.id, nodeVersion: utility.version }],
    connections: [],
  };
  const artifact = {
    id: "test.project.group-artifact",
    name: "Reusable group",
    artifactType: "utility",
    implementation: { nodeType: groupDefinition.id, nodeVersion: groupDefinition.version },
  };
  const utilityFork = {
    ...createProjectNodeFork(utility, { forkId: "shared-utility" }),
    active: true,
  };
  const project = {
    definitions: [utility, groupDefinition],
    groups: [group],
    artifacts: [artifact],
    forks: [utilityFork],
  };
  const bundled = createNodePackageFromProject(project, {
    id: "test.project-package",
    version: "1.0.0",
    nodeIds: [groupDefinition.id],
    groupIds: [group.id],
    artifactIds: [artifact.id],
    forkIds: [utilityFork.id],
  });
  const imported = importNodePackage(exportNodePackage(bundled));

  assert.deepEqual(imported.definitions.map((definition) => definition.id), [groupDefinition.id]);
  assert.deepEqual(imported.groups.map((item) => item.id), [group.id]);
  assert.deepEqual(imported.forks.map((item) => item.id), [utilityFork.id]);
  assert.deepEqual(imported.nodeDependencies, [{ id: utility.id, range: utility.version, optional: false }]);
  assert.throws(
    () => installNodePackageIntoProject(imported, {}),
    /NODE_PACKAGE_NODE_DEPENDENCY_UNRESOLVED/
  );

  const installed = installNodePackageIntoProject(imported, { definitions: [utility] }, { pinVersions: true });
  assert.equal(installed.project.groups.some((item) => item.id === group.id), true);
  assert.equal(installed.project.artifacts.some((item) => item.id === artifact.id), true);
  assert.equal(installed.project.forks.some((item) => item.id === utilityFork.id && item.active), true);
  assert.equal(installed.project.pins.find((pin) => pin.nodeId === groupDefinition.id)?.version, "1.0.0");
  assert.throws(
    () => installNodePackageIntoProject(imported, {
      definitions: [utility],
      groups: [{ ...group, connections: [{ from: "a", to: "b" }] }],
    }),
    /NODE_PACKAGE_GROUP_CONFLICT/
  );
  assert.throws(
    () => installNodePackageIntoProject(imported, {
      definitions: [utility],
      forks: [{ ...utilityFork, definition: { ...utilityFork.definition, name: "Conflicting fork" } }],
    }),
    /NODE_PACKAGE_FORK_CONFLICT/
  );
});

test("legacy package format imports through the additive package migration", () => {
  const imported = importNodePackage({
    formatVersion: 1,
    id: "test.legacy-package",
    version: "1.0.0",
    definitions: [],
    artifacts: [],
  });
  assert.equal(imported.formatVersion, 2);
  assert.deepEqual(imported.nodeDependencies, []);
  assert.deepEqual(imported.groups, []);
  assert.deepEqual(imported.forks, []);
});

test("package dependencies resolve in dependency-first order", () => {
  const core1 = defineNodePackage({ id: "test.core", version: "1.0.0" });
  const core2 = defineNodePackage({ id: "test.core", version: "2.0.0" });
  const app = defineNodePackage({ id: "test.app", version: "1.0.0", dependencies: [{ id: "test.core", range: "^1.0.0" }] });
  assert.deepEqual(resolveNodePackageDependencies(app, [core1, core2]).map((item) => `${item.id}@${item.version}`), [
    "test.core@1.0.0",
    "test.app@1.0.0",
  ]);
});

test("compatibility reports and migrations rebase project forks explicitly", () => {
  const previous = valueNode("1.0.0");
  const next = valueNode("2.0.0", {
    inlets: { amount: "number" },
    migrations: [{
      from: "1.0.0",
      to: "2.0.0",
      migrate: (definition) => ({
        ...definition,
        parts: definition.parts.map((part) => part.id === "entry"
          ? { ...part, source: part.source.replace("{ value }", "{ amount }").replace("doubleValue(value)", "doubleValue(amount)") }
          : part),
      }),
    }],
  });
  const fork = createProjectNodeFork(previous, { forkId: "local" });
  const compatibility = checkNodeCompatibility(previous, next);
  const migrated = migrateNodeData(fork.definition, previous.version, next);
  const upgraded = upgradeProjectNodeFork(fork, previous, next);
  const transported = importNodePackage(exportNodePackage(defineNodePackage({
    id: "test.migration-package",
    version: "2.0.0",
    definitions: [next],
  }))).definitions[0];
  const transportedMigration = migrateNodeData(fork.definition, previous.version, transported);
  const installedUpgrade = installNodePackageIntoProject(defineNodePackage({
    id: "test.fork-upgrade-package",
    version: "2.0.0",
    definitions: [next],
  }), {
    definitions: [previous],
    forks: [fork],
  }, { upgradeForks: true });

  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.issues.some((issue) => issue.code === "inlet-removed"), true);
  assert.deepEqual(migrated.applied, ["1.0.0->2.0.0"]);
  assert.equal(upgraded.fork.base.version, "2.0.0");
  assert.deepEqual(upgraded.fork.upgradedFrom.applied, ["1.0.0->2.0.0"]);
  assert.deepEqual(transportedMigration.applied, ["1.0.0->2.0.0"], "migration code survives package JSON transport");
  assert.equal(installedUpgrade.project.forks[0].base.version, "2.0.0");
  assert.deepEqual(installedUpgrade.installed.upgradedForks[0], {
    id: fork.id,
    nodeId: previous.id,
    from: "1.0.0",
    to: "2.0.0",
    compatible: false,
    migrations: ["1.0.0->2.0.0"],
  });
});
