#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeVj1Project,
  compareVj1Metrics,
  reportVj1ComparisonMarkdown,
  reportVj1MetricsMarkdown,
} from "../js/metrics/composition-metrics.js";

const args = process.argv.slice(2);
const format = args.includes("--json") ? "json" : "markdown";
const projectPath = args.find((arg) => !arg.startsWith("--"));
const comparePath = valueAfter("--compare");
const runtimePath = valueAfter("--runtime");
const save = args.includes("--save");
const outPath = valueAfter("--out");

if (!projectPath) {
  console.error("Usage: node tests/metrics-runner.mjs <project.json> [--json] [--runtime <samples.json>] [--save] [--out <path>] [--compare <metrics.json>]");
  process.exit(1);
}

const project = JSON.parse(await readFile(projectPath, "utf8"));
const runtimeSamples = runtimePath
  ? JSON.parse(await readFile(runtimePath, "utf8"))
  : [];
const metrics = analyzeVj1Project(project, { runtimeSamples });
let comparison = null;
if (comparePath) {
  comparison = compareVj1Metrics(metrics, JSON.parse(await readFile(comparePath, "utf8")));
}
const markdown = [
  reportVj1MetricsMarkdown(metrics),
  comparison ? reportVj1ComparisonMarkdown(comparison) : "",
].filter(Boolean).join("\n\n");

if (format === "json") {
  console.log(JSON.stringify(comparison ? { metrics, comparison } : metrics, null, 2));
} else {
  console.log(markdown);
}

if (save || outPath) {
  const paths = await writeReports({ metrics, markdown, projectPath, outPath });
  console.error(`Saved metrics JSON: ${paths.jsonPath}`);
  console.error(`Saved metrics Markdown: ${paths.markdownPath}`);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] || "";
}

async function writeReports({ metrics, markdown, projectPath, outPath }) {
  const root = dirname(fileURLToPath(import.meta.url));
  const defaultDir = join(root, "..", "metrics-results", "runs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = safeLabel(metrics.project?.name || projectPath.split(/[\\/]/).pop() || "project");
  const basePath = outPath || join(defaultDir, `${timestamp}-${label}`);
  const jsonPath = basePath.endsWith(".json") ? basePath : `${basePath}.metrics.json`;
  const markdownPath = jsonPath.replace(/\.metrics\.json$/, ".metrics.md");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(metrics, null, 2));
  await writeFile(markdownPath, markdown);
  return { jsonPath, markdownPath };
}

function safeLabel(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "project";
}
