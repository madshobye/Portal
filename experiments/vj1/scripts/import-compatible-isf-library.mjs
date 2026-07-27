#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  createIsfNodeDefinition,
  materializeIsfNodeDefinition,
  materializeIsfTransitionDefinition,
} from "../js/libraries/isf-engine/isf-node.js";
import { parseIsfDocument } from "../js/libraries/isf-engine/isf-document.js";
import { currentIsfLibraryCompatibility } from "./isf-library-compatibility.mjs";

const UPSTREAM_COMMIT = "395072d48b3ce7351ccb20a5fda54470591324df";
const upstreamRoot = path.resolve(process.argv[2] || "");
const projectRoot = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(projectRoot, "visual-library", "visual-library.json");
const shaderRoot = path.join(projectRoot, "visual-library", "shaders", "isf");

if (!process.argv[2] || !fs.existsSync(upstreamRoot)) {
  console.error("Usage: node scripts/import-compatible-isf-library.mjs /path/to/ISF");
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const upstreamEntries = fs.readdirSync(upstreamRoot);
  const previousCompatibleArtifacts = (manifest.artifacts || []).filter((artifact) =>
    artifact.tags?.includes("isf-compatible-library")
  );
  for (const artifact of previousCompatibleArtifacts) {
    const resource = String(artifact.resource || "");
    if (!resource.startsWith("shaders/isf/")) {
      throw new Error(`ISF_IMPORT_UNSAFE_RECONCILE_RESOURCE:${resource}`);
    }
    const destination = path.join(projectRoot, "visual-library", resource);
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
  }
  manifest.artifacts = (manifest.artifacts || []).filter((artifact) =>
    !artifact.tags?.includes("isf-compatible-library")
  );
  const existingResources = new Set(
    (manifest.artifacts || []).map((artifact) => String(artifact.resource || "")),
  );
  const imported = [];
  const excluded = [];

  for (const filename of upstreamEntries.filter(isFragmentFile).sort()) {
    const sourcePath = path.join(upstreamRoot, filename);
    const source = normalizeFinalNewline(fs.readFileSync(sourcePath, "utf8"));
    const document = parseIsfDocument(source, { path: filename });
    const compatibility = currentIsfLibraryCompatibility(
      document,
      filename,
      upstreamEntries,
    );
    if (!compatibility.compatible) {
      excluded.push({ file: filename, reason: compatibility.reason });
      continue;
    }

    const basename = `${slug(filename.replace(/\.fs$/i, ""))}.fs`;
    const kindDirectory = `${document.kind}s`;
    const resource = `shaders/isf/${kindDirectory}/${basename}`;
    if (existingResources.has(resource)) continue;

    const destination = path.join(shaderRoot, kindDirectory, basename);
    if (fs.existsSync(destination)) {
      throw new Error(`ISF_IMPORT_UNMANIFESTED_RESOURCE:${resource}`);
    }

    const definition = createIsfNodeDefinition({
      path: resource,
      source,
      origin: "built-in",
    });
    const materialized = document.kind === "transition"
      ? materializeIsfTransitionDefinition(definition)
      : materializeIsfNodeDefinition(definition);
    const visualId = String(definition.metadata?.visualId || "");
    const artifact = {
      id: document.kind === "transition" ? materialized.id : definition.id,
      visualId,
      nodeId: definition.id,
      nodeVersion: definition.version,
      version: document.kind === "transition"
        ? materialized.version
        : definition.version,
      name: document.name,
      description: document.description,
      artifactType: document.kind,
      resource,
      categories: unique(["ISF", ...document.categories]),
      tags: unique([
        "isf",
        slug(filename.replace(/\.fs$/i, "")),
        document.kind,
        "isf-compatible-library",
      ]),
      attribution: {
        credit: document.credit || "VIDVOX",
        license: "MIT",
        source: "https://github.com/Vidvox/ISF-Files",
        upstreamCommit: UPSTREAM_COMMIT,
      },
    };
    imported.push({ artifact, destination, source });
    existingResources.add(resource);
  }

  for (const entry of imported) {
    fs.mkdirSync(path.dirname(entry.destination), { recursive: true });
    fs.writeFileSync(entry.destination, entry.source);
  }
  manifest.version = "2.0.0";
  manifest.artifacts.push(...imported.map((entry) => entry.artifact));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    upstreamRoot,
    upstreamCommit: UPSTREAM_COMMIT,
    imported: imported.length,
    importedKinds: countBy(imported, (entry) => entry.artifact.artifactType),
    excluded: excluded.length,
    excludedReasons: countBy(excluded, (entry) => entry.reason),
    totalArtifacts: manifest.artifacts.length,
  }, null, 2));
}

function isFragmentFile(filename) {
  return filename.toLowerCase().endsWith(".fs");
}

function normalizeFinalNewline(source) {
  return `${String(source).replace(/\s+$/u, "")}\n`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "isf-shader";
}

function unique(values) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function countBy(values, select) {
  return values.reduce((result, value) => {
    const key = select(value) || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}
