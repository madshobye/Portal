import test from "node:test";
import assert from "node:assert/strict";

import {
  defineNode,
  defineNodePackage,
  serializeNodePackage,
} from "../js/libraries/node-engine/index.js";
import {
  assertNodePackageUpdateSafe,
  collectNodePackageManifests,
  createNodePackageLock,
  exportNodePackageDirectory,
  importNodePackageDirectory,
  loadNodePackageRepository,
  loadReferencedNodePackages,
  resolveReferencedNodePackages,
  writeNodePackageManifest,
} from "../js/services/node-package-repository.js";

function fileHandle(text, name = "file") {
  return {
    kind: "file",
    name,
    async getFile() {
      const bytes = new TextEncoder().encode(text);
      return {
        name,
        size: bytes.byteLength,
        async text() { return text; },
        async arrayBuffer() { return bytes.buffer.slice(0); },
      };
    },
  };
}

function binaryFileHandle(values, name = "file") {
  const bytes = Uint8Array.from(values);
  return {
    kind: "file",
    name,
    async getFile() {
      return {
        name,
        size: bytes.byteLength,
        async text() { return new TextDecoder().decode(bytes); },
        async arrayBuffer() { return bytes.buffer.slice(0); },
      };
    },
  };
}

function directoryHandle(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    kind: "directory",
    async *entries() {
      yield* values.entries();
    },
    async getDirectoryHandle(name) {
      const value = values.get(name);
      if (!value || value.kind !== "directory") throw namedError("NotFoundError", name);
      return value;
    },
    async getFileHandle(name) {
      const value = values.get(name);
      if (!value || value.kind !== "file") throw namedError("NotFoundError", name);
      return value;
    },
  };
}

function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

function writableDirectory(entries = new Map(), behavior = {}) {
  return {
    kind: "directory",
    async *entries() {
      yield* entries.entries();
    },
    async getDirectoryHandle(name, handleOptions = {}) {
      const value = entries.get(name);
      if (value?.kind === "directory") return value;
      if (!handleOptions.create) throw namedError("NotFoundError", name);
      const created = writableDirectory(new Map(), behavior);
      entries.set(name, created);
      return created;
    },
    async getFileHandle(name, handleOptions = {}) {
      const value = entries.get(name);
      if (value?.kind === "file") return value;
      if (!handleOptions.create) throw namedError("NotFoundError", name);
      let bytes = new Uint8Array();
      const created = {
        kind: "file",
        async createWritable() {
          return {
            async write(value) {
              if (behavior.failWrites?.has(name)) throw new Error(`WRITE_FAILED:${name}`);
              if (typeof value === "string") {
                bytes = new TextEncoder().encode(value);
              } else if (typeof value?.arrayBuffer === "function") {
                bytes = new Uint8Array(await value.arrayBuffer());
              } else {
                bytes = new TextEncoder().encode(String(value));
              }
            },
            async close() {},
          };
        },
        async getFile() {
          return {
            name,
            size: bytes.byteLength,
            async text() { return new TextDecoder().decode(bytes); },
            async arrayBuffer() {
              return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
          };
        },
      };
      entries.set(name, created);
      return created;
    },
    async removeEntry(name) {
      if (!entries.has(name)) throw namedError("NotFoundError", name);
      entries.delete(name);
    },
  };
}

function transitionPackageTree({ includeUnreferenced = false } = {}) {
  const source = `/*{
    "ISFVSN": "2.0",
    "LABEL": "Package Wipe",
    "VJ1": {
      "ID": "org.example.transition.package-wipe",
      "VERSION": "1.0.0",
      "PROFILE": "vj1-isf-webgl2@1"
    },
    "INPUTS": [
      { "NAME": "startImage", "TYPE": "image" },
      { "NAME": "endImage", "TYPE": "image" },
      { "NAME": "progress", "TYPE": "float" }
    ]
  }*/
  void main() {
    isf_FragColor = mix(
      IMG_THIS_NORM_PIXEL(startImage),
      IMG_THIS_NORM_PIXEL(endImage),
      progress
    );
  }`;
  const nodePackage = defineNodePackage({
    id: "org.example.transitions",
    version: "1.0.0",
    resources: [{
      id: "package-wipe-source",
      kind: "shader",
      path: "shaders/package-wipe.fs",
      mediaType: "text/x-isf",
    }],
    visualLibrary: [{
      id: "org.example.transition.package-wipe",
      version: "1.0.0",
      name: "Package Wipe",
      artifactType: "transition",
      implementation: {
        format: "isf",
        resourceId: "package-wipe-source",
      },
    }],
  });
  const packageDirectory = directoryHandle({
    "node-package.json": fileHandle(JSON.stringify(serializeNodePackage(nodePackage)), "node-package.json"),
    shaders: directoryHandle({
      "package-wipe.fs": fileHandle(source, "package-wipe.fs"),
    }),
  });
  const libraries = {
      "org.example.transitions": directoryHandle({
        "1.0.0": packageDirectory,
      }),
  };
  if (includeUnreferenced) {
    const unrelated = defineNodePackage({
      id: "org.example.unrelated",
      version: "1.0.0",
    });
    libraries["org.example.unrelated"] = directoryHandle({
      "1.0.0": directoryHandle({
        "node-package.json": fileHandle(
          JSON.stringify(serializeNodePackage(unrelated)),
          "node-package.json",
        ),
      }),
    });
  }
  return directoryHandle({
    libraries: directoryHandle(libraries),
  });
}

test("project package repository discovers manifests only below libraries", async () => {
  const root = transitionPackageTree();
  const manifests = await collectNodePackageManifests(root);
  assert.deepEqual(manifests.map((entry) => entry.path), [
    "libraries/org.example.transitions/1.0.0/node-package.json",
  ]);
});

test("package repository exposes every exact available version without activating it", async () => {
  const packages = await loadNodePackageRepository(transitionPackageTree({
    includeUnreferenced: true,
  }));
  assert.deepEqual(packages.map((nodePackage) => `${nodePackage.id}@${nodePackage.version}`), [
    "org.example.transitions@1.0.0",
    "org.example.unrelated@1.0.0",
  ]);
});

test("package export writes a new exact manifest and refuses to overwrite it", async () => {
  const root = writableDirectory();
  const nodePackage = defineNodePackage({
    id: "org.example.exported",
    name: "Exported Package",
    version: "0.1.0",
  });
  assert.equal(
    await writeNodePackageManifest(root, JSON.stringify(serializeNodePackage(nodePackage))),
    "libraries/org.example.exported/0.1.0/node-package.json",
  );
  const repository = await loadNodePackageRepository(root);
  assert.deepEqual(repository.map((item) => `${item.id}@${item.version}`), [
    "org.example.exported@0.1.0",
  ]);
  await assert.rejects(
    () => writeNodePackageManifest(root, JSON.stringify(serializeNodePackage(nodePackage))),
    /NODE_PACKAGE_MANIFEST_ALREADY_EXISTS:org\.example\.exported@0\.1\.0/,
  );
});

test("package-folder import validates and copies every declared resource before publishing its manifest", async () => {
  const nodePackage = defineNodePackage({
    id: "org.example.portable",
    name: "Portable Package",
    version: "1.2.0",
    resources: [{
      id: "configuration",
      kind: "data",
      path: "data/config.json",
      mediaType: "application/json",
    }],
  });
  const source = directoryHandle({
    "node-package.json": fileHandle(JSON.stringify(serializeNodePackage(nodePackage)), "node-package.json"),
    data: directoryHandle({
      "config.json": fileHandle('{"gain":0.75}', "config.json"),
    }),
  });
  const target = writableDirectory();
  const imported = await importNodePackageDirectory(target, source);

  assert.deepEqual(imported, {
    id: "org.example.portable",
    version: "1.2.0",
    path: "libraries/org.example.portable/1.2.0/node-package.json",
  });
  assert.deepEqual((await loadNodePackageRepository(target)).map((item) => item.id), [
    "org.example.portable",
  ]);
  const versionDirectory = await (await (await target.getDirectoryHandle("libraries"))
    .getDirectoryHandle("org.example.portable")).getDirectoryHandle("1.2.0");
  const copied = await (await (await versionDirectory.getDirectoryHandle("data"))
    .getFileHandle("config.json")).getFile();
  assert.equal(await copied.text(), '{"gain":0.75}');
  await assert.rejects(
    () => importNodePackageDirectory(target, source),
    /NODE_PACKAGE_IMPORT_ALREADY_EXISTS:org\.example\.portable@1\.2\.0/,
  );
});

test("failed package-folder import never publishes a partial manifest", async () => {
  const nodePackage = defineNodePackage({
    id: "org.example.failing",
    version: "1.0.0",
    resources: [{
      id: "configuration",
      kind: "data",
      path: "config.json",
    }],
  });
  const source = directoryHandle({
    "node-package.json": fileHandle(JSON.stringify(serializeNodePackage(nodePackage)), "node-package.json"),
    "config.json": fileHandle("{}", "config.json"),
  });
  const target = writableDirectory(new Map(), {
    failWrites: new Set(["config.json"]),
  });
  await assert.rejects(
    () => importNodePackageDirectory(target, source),
    /NODE_PACKAGE_IMPORT_FAILED:org\.example\.failing@1\.0\.0:WRITE_FAILED:config\.json/,
  );
  assert.deepEqual(await loadNodePackageRepository(target), []);
});

test("resource-complete package export preserves binary files and refuses destination collisions", async () => {
  const nodePackage = defineNodePackage({
    id: "org.example.binary",
    version: "2.0.0",
    resources: [{
      id: "lookup-texture",
      kind: "media",
      path: "media/lookup.bin",
      mediaType: "application/octet-stream",
    }],
  });
  const source = directoryHandle({
    "node-package.json": fileHandle(JSON.stringify(serializeNodePackage(nodePackage)), "node-package.json"),
    media: directoryHandle({
      "lookup.bin": binaryFileHandle([0, 1, 127, 128, 254, 255], "lookup.bin"),
    }),
  });
  const project = writableDirectory();
  await importNodePackageDirectory(project, source);
  const destination = writableDirectory();
  const exported = await exportNodePackageDirectory(
    project,
    destination,
    "org.example.binary",
    "2.0.0",
  );
  assert.deepEqual(exported, {
    id: "org.example.binary",
    version: "2.0.0",
    path: "org.example.binary/2.0.0/node-package.json",
  });
  const versionDirectory = await (await destination.getDirectoryHandle("org.example.binary"))
    .getDirectoryHandle("2.0.0");
  const copied = await (await (await versionDirectory.getDirectoryHandle("media"))
    .getFileHandle("lookup.bin")).getFile();
  assert.deepEqual([...new Uint8Array(await copied.arrayBuffer())], [0, 1, 127, 128, 254, 255]);
  await assert.rejects(
    () => exportNodePackageDirectory(project, destination, "org.example.binary", "2.0.0"),
    /NODE_PACKAGE_EXPORT_ALREADY_EXISTS:org\.example\.binary@2\.0\.0/,
  );
});

test("referenced file-backed ISF packages hydrate exact executable definitions", async () => {
  const packages = await loadReferencedNodePackages(transitionPackageTree({
    includeUnreferenced: true,
  }), [{
    id: "org.example.transitions",
    version: "1.0.0",
    enabled: true,
  }]);
  const nodePackage = packages[0];
  const artifact = nodePackage.visualLibrary[0];
  const definition = nodePackage.definitions.find((item) => item.id === artifact.implementation.nodeId);

  assert.equal(packages.length, 1);
  assert.equal(packages.some((item) => item.id === "org.example.unrelated"), false);
  assert.equal(definition.metadata.isf.kind, "transition");
  assert.equal(artifact.implementation.visualId, artifact.id);
  assert.equal(definition.parts[0].source.includes("IMG_THIS_NORM_PIXEL"), true);
  assert.equal(JSON.stringify(serializeNodePackage(nodePackage)).includes("isf_FragColor"), true);
});

test("referenced packages fail closed when the exact manifest or resource is unavailable", async () => {
  await assert.rejects(
    () => loadReferencedNodePackages(transitionPackageTree(), [{
      id: "org.example.transitions",
      version: "2.0.0",
    }]),
    /NODE_PROJECT_PACKAGE_UNAVAILABLE:org\.example\.transitions@2\.0\.0/,
  );
  const missingResourceRoot = transitionPackageTree();
  const packageDirectory = await (await (await missingResourceRoot.getDirectoryHandle("libraries"))
    .getDirectoryHandle("org.example.transitions")).getDirectoryHandle("1.0.0");
  packageDirectory.getDirectoryHandle = async () => {
    throw namedError("NotFoundError", "shaders missing");
  };
  await assert.rejects(
    () => loadReferencedNodePackages(missingResourceRoot, [{
      id: "org.example.transitions",
      version: "1.0.0",
    }]),
    /NODE_PACKAGE_RESOURCE_UNAVAILABLE/,
  );
});

test("project package locks reject same-version executable resource replacement", async () => {
  const originalRepository = await loadNodePackageRepository(transitionPackageTree());
  const references = [{
    id: "org.example.transitions",
    version: "1.0.0",
    enabled: true,
  }];
  const lock = createNodePackageLock(resolveReferencedNodePackages(references, originalRepository));
  const changedTree = transitionPackageTree();
  const versionDirectory = await (await (await changedTree.getDirectoryHandle("libraries"))
    .getDirectoryHandle("org.example.transitions")).getDirectoryHandle("1.0.0");
  const originalShaderDirectory = await versionDirectory.getDirectoryHandle("shaders");
  const changedShaderDirectory = directoryHandle({
    "package-wipe.fs": fileHandle(`/*{
      "ISFVSN":"2.0",
      "LABEL":"Package Wipe",
      "VJ1":{
        "ID":"org.example.transition.package-wipe",
        "VERSION":"1.0.0",
        "PROFILE":"vj1-isf-webgl2@1"
      },
      "INPUTS":[
        {"NAME":"startImage","TYPE":"image"},
        {"NAME":"endImage","TYPE":"image"},
        {"NAME":"progress","TYPE":"float"}
      ]
    }*/
    void main(){ isf_FragColor=IMG_THIS_NORM_PIXEL(endImage); }`),
  });
  versionDirectory.getDirectoryHandle = async (name) => {
    if (name === "shaders") return changedShaderDirectory;
    return originalShaderDirectory.getDirectoryHandle(name);
  };
  const changedRepository = await loadNodePackageRepository(changedTree);

  assert.notEqual(
    originalRepository[0].metadata.repositoryContentIntegrity,
    changedRepository[0].metadata.repositoryContentIntegrity,
  );
  assert.throws(
    () => resolveReferencedNodePackages(references, changedRepository, lock),
    /NODE_PACKAGE_CONTENT_INTEGRITY_MISMATCH:org\.example\.transitions@1\.0\.0/,
  );
});

test("project package locks pin the complete transitive dependency closure", async () => {
  const core = defineNodePackage({
    id: "org.example.core",
    version: "1.0.0",
    metadata: { repositoryContentIntegrity: `sha256-${"1".repeat(64)}` },
  });
  const app = defineNodePackage({
    id: "org.example.app",
    version: "1.0.0",
    dependencies: [{ id: core.id, range: "^1.0.0" }],
    metadata: { repositoryContentIntegrity: `sha256-${"2".repeat(64)}` },
  });
  const references = [{ id: app.id, version: app.version, enabled: true }];
  const resolved = resolveReferencedNodePackages(references, [app, core]);
  const lock = createNodePackageLock(resolved);
  assert.deepEqual(lock.map((item) => item.id), [app.id, core.id].sort());

  const changedCore = defineNodePackage({
    ...core,
    metadata: { repositoryContentIntegrity: `sha256-${"3".repeat(64)}` },
  });
  assert.throws(
    () => resolveReferencedNodePackages(references, [app, changedCore], lock),
    /NODE_PACKAGE_CONTENT_INTEGRITY_MISMATCH:org\.example\.core@1\.0\.0/,
  );
});

test("installed project packages reject external URL resources", async () => {
  const nodePackage = defineNodePackage({
    id: "org.example.external",
    version: "1.0.0",
    resources: [{
      id: "remote-shader",
      kind: "shader",
      url: "https://example.invalid/shader.fs",
    }],
  });
  const root = directoryHandle({
    libraries: directoryHandle({
      "org.example.external": directoryHandle({
        "1.0.0": directoryHandle({
          "node-package.json": fileHandle(JSON.stringify(serializeNodePackage(nodePackage))),
        }),
      }),
    }),
  });
  await assert.rejects(
    () => loadNodePackageRepository(root),
    /NODE_PACKAGE_REPOSITORY_EXTERNAL_RESOURCE_UNSUPPORTED/,
  );
});

test("package updates reject removal of exact node versions still used by the project graph", () => {
  const previousDefinition = defineNode({
    id: "org.example.control",
    name: "Example Control",
    description: "A reusable control.",
    version: "1.0.0",
    outlets: { value: { type: "number" } },
    process: () => ({ value: 1 }),
  });
  const nextDefinition = defineNode({
    ...previousDefinition,
    version: "2.0.0",
  });
  const previousPackage = defineNodePackage({
    id: "org.example.controls",
    version: "1.0.0",
    definitions: [previousDefinition],
  });
  const nextPackage = defineNodePackage({
    id: "org.example.controls",
    version: "2.0.0",
    definitions: [nextDefinition],
  });
  const projectState = {
    nodes: {
      groups: [{
        id: "project.graph",
        nodes: [{
          id: "control",
          nodeId: previousDefinition.id,
          nodeVersion: previousDefinition.version,
        }],
      }],
    },
  };

  assert.throws(
    () => assertNodePackageUpdateSafe(projectState, previousPackage, [nextPackage]),
    /NODE_PACKAGE_UPDATE_REQUIRES_NODE_MIGRATION/,
  );
  const compatibilityPackage = defineNodePackage({
    id: "org.example.controls",
    version: "2.0.0",
    definitions: [previousDefinition, nextDefinition],
  });
  assert.equal(
    assertNodePackageUpdateSafe(projectState, previousPackage, [compatibilityPackage]),
    true,
  );
});
