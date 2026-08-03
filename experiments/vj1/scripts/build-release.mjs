import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionEntries = Object.freeze([
  "index.html",
  "style.css",
  "dependency-lock.json",
  "THIRD_PARTY_NOTICES.md",
  "assets",
  "js",
  "models",
  "vendor",
  "visual-library",
]);

export async function buildReleaseArtifact({ root = projectRoot, outputPath = "" } = {}) {
  const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const version = String(packageMetadata.version || "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("VJ1_RELEASE_VERSION_REQUIRED");
  }
  const files = [];
  for (const entry of productionEntries) await collectFiles(root, resolve(root, entry), files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    formatVersion: 1,
    application: "vj1",
    version,
    entrypoint: "index.html",
    files: files.map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: sha256(bytes),
    })),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const archiveFiles = [
    ...files,
    { path: "release-manifest.json", bytes: manifestBytes },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const archive = createTar(archiveFiles.map((file) => ({
    path: `vj1/${file.path}`,
    bytes: file.bytes,
  })));
  const resolvedOutput = resolve(outputPath || resolve(root, "dist", `vj1-${version}.tar`));
  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, archive);
  const digest = sha256(archive);
  await writeFile(`${resolvedOutput}.sha256`, `${digest}  ${resolvedOutput.split(sep).at(-1)}\n`);
  return Object.freeze({ outputPath: resolvedOutput, sha256: digest, manifest });
}

async function collectFiles(root, candidate, files) {
  const entries = await readdir(candidate, { withFileTypes: true }).catch(async (error) => {
    if (error?.code !== "ENOTDIR") throw error;
    files.push({ path: relative(root, candidate).split(sep).join("/"), bytes: await readFile(candidate) });
    return null;
  });
  if (!entries) return;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = join(candidate, entry.name);
    if (entry.isDirectory()) await collectFiles(root, child, files);
    else if (entry.isFile()) files.push({ path: relative(root, child).split(sep).join("/"), bytes: await readFile(child) });
  }
}

function createTar(files) {
  const blocks = [];
  for (const file of files) {
    const header = tarHeader(file.path, file.bytes.length);
    blocks.push(header, file.bytes);
    const remainder = file.bytes.length % 512;
    if (remainder) blocks.push(Buffer.alloc(512 - remainder));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  const checksumValue = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 6, checksumValue);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: "" };
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`VJ1_RELEASE_PATH_TOO_LONG:${path}`);
}

function writeString(buffer, offset, width, value) {
  const bytes = Buffer.from(String(value));
  if (bytes.length > width) throw new Error(`VJ1_RELEASE_HEADER_FIELD_TOO_LONG:${value}`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, width, value) {
  writeString(buffer, offset, width, Number(value).toString(8).padStart(width - 1, "0"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildReleaseArtifact();
  console.log(`[VJ1_RELEASE_BUILT] ${result.outputPath} sha256=${result.sha256}`);
}
