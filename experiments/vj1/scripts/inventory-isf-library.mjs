#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseIsfDocument } from "../js/libraries/isf-engine/isf-document.js";

const root = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(root)) {
  console.error("Usage: node scripts/inventory-isf-library.mjs /path/to/ISF");
  process.exitCode = 1;
} else {
  const entries = fs.readdirSync(root);
  const sources = entries.filter((name) => name.toLowerCase().endsWith(".fs")).sort();
  const rows = sources.map((filename) => inspectSource(root, filename, entries));
  const summary = summarize(rows);
  console.log(JSON.stringify({ root, summary, shaders: rows }, null, 2));
}

function inspectSource(rootPath, filename, entries) {
  const fullPath = path.join(rootPath, filename);
  const stem = filename.slice(0, -3);
  const base = {
    file: filename,
    pairedVertexShader: entries.includes(`${stem}.vs`),
  };
  try {
    const document = parseIsfDocument(fs.readFileSync(fullPath, "utf8"), { path: fullPath });
    const inputCounts = Object.fromEntries(
      [...new Set(document.inputs.map((input) => input.type))]
        .sort()
        .map((type) => [type, document.inputs.filter((input) => input.type === type).length]),
    );
    return {
      ...base,
      name: document.name,
      kind: document.kind,
      inputCounts,
      imageInputs: inputCounts.image || 0,
      passes: document.passes.length,
      persistent: document.passes.some((pass) => pass.persistent),
      float: document.passes.some((pass) => pass.float),
      importedResources: Object.keys(document.metadata.IMPORTED || {}).length,
      compatibleFragmentCandidate: (
        !base.pairedVertexShader
        && !inputCounts.audio
        && !inputCounts.audioFFT
        && !inputCounts.event
        && (inputCounts.image || 0) <= (document.kind === "transition" ? 2 : 1)
        && !Object.keys(document.metadata.IMPORTED || {}).length
      ),
    };
  } catch (error) {
    return {
      ...base,
      parseError: String(error?.message || error),
      compatibleFragmentCandidate: false,
    };
  }
}

function summarize(rows) {
  const parsed = rows.filter((row) => !row.parseError);
  return {
    total: rows.length,
    parsed: parsed.length,
    parseErrors: rows.length - parsed.length,
    kinds: countBy(parsed, (row) => row.kind),
    compatibleFragmentCandidates: parsed.filter((row) => row.compatibleFragmentCandidate).length,
    pairedVertexShaders: parsed.filter((row) => row.pairedVertexShader).length,
    persistent: parsed.filter((row) => row.persistent).length,
    float: parsed.filter((row) => row.float).length,
    multipass: parsed.filter((row) => row.passes > 1).length,
    events: parsed.filter((row) => row.inputCounts.event).length,
    audio: parsed.filter((row) => row.inputCounts.audio).length,
    audioFFT: parsed.filter((row) => row.inputCounts.audioFFT).length,
    importedResources: parsed.filter((row) => row.importedResources).length,
    multipleImageInputs: parsed.filter((row) => row.imageInputs > (row.kind === "transition" ? 2 : 1)).length,
  };
}

function countBy(values, select) {
  return values.reduce((result, value) => {
    const key = select(value) || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}
