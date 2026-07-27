#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseIsfDocument } from "../js/libraries/isf-engine/isf-document.js";
import {
  assertIsfWebgl2Profile,
  assertIsfWebgl2VertexProfile,
  canonicalizeIsfWebgl2Source,
  canonicalizeIsfWebgl2VertexSource,
  VJ1_ISF_WEBGL2_PROFILE,
} from "../js/libraries/isf-engine/isf-webgl2-profile.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const shaderRoot = path.join(
  projectRoot,
  "visual-library",
  "shaders",
);
const manifestPath = path.join(
  projectRoot,
  "visual-library",
  "visual-library.json",
);
const write = process.argv.includes("--write");
const shaderPaths = collectFiles(shaderRoot, ".fs");
const vertexPaths = collectFiles(shaderRoot, ".vs");
const changed = [];

for (const shaderPath of shaderPaths) {
  const source = fs.readFileSync(shaderPath, "utf8");
  const canonical = canonicalizeIsfWebgl2Source(source, {
    path: path.relative(projectRoot, shaderPath),
  });
  assertIsfWebgl2Profile(
    parseIsfDocument(canonical, {
      path: path.relative(projectRoot, shaderPath),
    }),
  );
  if (canonical === source) continue;
  changed.push(path.relative(projectRoot, shaderPath));
  if (write) fs.writeFileSync(shaderPath, canonical);
}

for (const vertexPath of vertexPaths) {
  const source = fs.readFileSync(vertexPath, "utf8");
  const relativePath = path.relative(projectRoot, vertexPath);
  const canonical = canonicalizeIsfWebgl2VertexSource(source, {
    path: relativePath,
  });
  assertIsfWebgl2VertexProfile(canonical, { path: relativePath });
  if (canonical === source) continue;
  changed.push(relativePath);
  if (write) fs.writeFileSync(vertexPath, canonical);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
let manifestChanged = false;
for (const artifact of manifest.artifacts || []) {
  if (!String(artifact.resource || "").endsWith(".fs")) continue;
  if (artifact.shaderProfile === VJ1_ISF_WEBGL2_PROFILE) continue;
  artifact.shaderProfile = VJ1_ISF_WEBGL2_PROFILE;
  manifestChanged = true;
}
if (write && manifestChanged) {
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

console.log(JSON.stringify({
  profile: VJ1_ISF_WEBGL2_PROFILE,
  mode: write ? "write" : "check",
  shaders: shaderPaths.length,
  vertexStages: vertexPaths.length,
  changed: changed.length,
  manifestChanged,
  paths: changed,
}, null, 2));

if (!write && (changed.length || manifestChanged)) process.exitCode = 1;

function collectFiles(root, extension) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(target, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) {
      result.push(target);
    }
  }
  return result.sort();
}
