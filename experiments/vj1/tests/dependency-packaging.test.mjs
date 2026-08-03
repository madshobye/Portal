import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleaseArtifact } from "../scripts/build-release.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("vendored browser dependencies match the reproducible lock", () => {
  const lock = JSON.parse(readFileSync(resolve(projectRoot, "dependency-lock.json"), "utf8"));
  assert.equal(lock.formatVersion, 1);
  assert.equal(lock.dependencies.length > 0, true);
  for (const dependency of lock.dependencies) {
    const bytes = readFileSync(resolve(projectRoot, dependency.path));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, dependency.sha256, `${dependency.name}@${dependency.version}`);
  }
});

test("production startup has no Portal or remote runtime dependency", () => {
  const sources = [
    "index.html",
    "js/constants.js",
    "js/output/font-loader.js",
    "js/output/output-app.js",
    "js/output/embedded-preview-app.js",
    "js/output/shared-input-runtime.js",
    "js/output/specialized/mobilenet-morph-service.js",
  ].map((path) => readFileSync(resolve(projectRoot, path), "utf8")).join("\n");
  assert.doesNotMatch(sources, /https?:\/\/(?:cdn|cdnjs|fonts\.|unpkg|esm\.)/i);
  assert.doesNotMatch(sources, /P1\/portal|portalScript|setupWebcamera|\bpSetup\b|baseMonoFont/);
});

test("browser verification pages use the vendored runtime package", () => {
  const browserTestRoot = resolve(projectRoot, "tests/browser");
  const sources = readdirSync(browserTestRoot)
    .filter((path) => path.endsWith(".html"))
    .map((path) => readFileSync(resolve(browserTestRoot, path), "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /https?:\/\//i);
  assert.doesNotMatch(sources, /fonts\.googleapis|cdn\.jsdelivr/i);
});

test("production release artifact is deterministic and content-addressed", async () => {
  const outputDirectory = mkdtempSync(resolve(tmpdir(), "vj1-release-"));
  const first = await buildReleaseArtifact({
    root: projectRoot,
    outputPath: resolve(outputDirectory, "first.tar"),
  });
  const second = await buildReleaseArtifact({
    root: projectRoot,
    outputPath: resolve(outputDirectory, "second.tar"),
  });
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(readFileSync(first.outputPath), readFileSync(second.outputPath));
  assert.equal(first.manifest.entrypoint, "index.html");
  assert.ok(first.manifest.files.some((file) => file.path === "dependency-lock.json"));
  assert.ok(first.manifest.files.some((file) => file.path === "vendor/p5/p5-2.2.0.min.js"));
  const checksum = readFileSync(`${first.outputPath}.sha256`, "utf8");
  assert.ok(checksum.startsWith(first.sha256));
});
