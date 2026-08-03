import { loadProjectDirectoryHandle } from "../../services/directory-handle-store.js";

const CACHE_ROOT = "vj1-cache";
const CACHE_DIRECTORY = "models";
// The format includes the automatic LOD policy. V5 normalizes inconsistent
// triangle winding before simplification, so older derived geometry must be
// regenerated rather than retaining topology-locked LODs.
const CACHE_FORMAT = "meshopt-0.25-qem-v5";
const MAGIC = new Uint8Array([86, 74, 49, 77, 79, 68, 76, 49]); // VJ1MODL1
const HEADER_OFFSET = 12;

let readUnavailableReported = false;
let writeUnavailableReported = false;

export function modelDerivedCacheKey({ type = "model", sourceKey = "", levels = [] } = {}) {
  const levelKey = Array.isArray(levels) && levels.length
    ? levels.map((value) => Math.max(1, Math.floor(Number(value) || 0))).join("-")
    : "automatic";
  return `${CACHE_FORMAT}:${String(type)}:${String(sourceKey)}:${levelKey}`;
}

export async function readDerivedModelCache(cacheKey) {
  if (!cacheKey) return null;
  const directory = await modelCacheDirectory("read");
  if (!directory) return null;
  try {
    const handle = await directory.getFileHandle(modelCacheFilename(cacheKey));
    const file = await handle.getFile();
    const mesh = deserializeDerivedModel(await file.arrayBuffer(), cacheKey);
    return mesh;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    console.warn("[VJ1_MODEL_CACHE_READ_FAILED]", {
      cacheKey,
      fallback: "regenerate the derived model once",
      message: error?.message || String(error),
    });
    return null;
  }
}

export async function writeDerivedModelCache(cacheKey, mesh) {
  if (!cacheKey || !mesh) return false;
  const directory = await modelCacheDirectory("readwrite");
  if (!directory) return false;
  try {
    const payload = serializeDerivedModel(mesh, cacheKey);
    const handle = await directory.getFileHandle(modelCacheFilename(cacheKey), { create: true });
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
    return true;
  } catch (error) {
    console.warn("[VJ1_MODEL_CACHE_WRITE_FAILED]", {
      cacheKey,
      fallback: "keep the generated model for this session only",
      message: error?.message || String(error),
    });
    return false;
  }
}

export function serializeDerivedModel(mesh = {}, cacheKey = "") {
  const lods = Array.from(mesh?.lods || [mesh]).filter((lod) =>
    lod?.positions instanceof Float32Array && lod?.faceNormals instanceof Float32Array
  );
  if (!lods.length) throw new Error("Derived model cache contained no renderable LODs");
  const header = {
    version: 1,
    format: CACHE_FORMAT,
    cacheKey,
    sourceTriangleCount: Math.max(0, Math.floor(Number(mesh.sourceTriangleCount) || Number(lods[0].sourceTriangleCount) || 0)),
    lods: lods.map((lod) => ({
      positionsLength: lod.positions.length,
      normalsLength: lod.faceNormals.length,
      triangleCount: Math.max(0, Math.floor(Number(lod.triangleCount) || lod.positions.length / 9)),
      bounds: lod.bounds,
      sourceBounds: lod.sourceBounds,
      simplification: lod.simplification || "",
      simplificationError: Math.max(0, Number(lod.simplificationError) || 0),
      requestedTriangleCount: Math.max(0, Math.floor(Number(lod.requestedTriangleCount) || 0)),
      topologyLimited: lod.topologyLimited === true,
      lodLevel: Math.max(0, Math.floor(Number(lod.lodLevel) || 0)),
    })),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const dataOffset = align4(HEADER_OFFSET + headerBytes.length);
  const arrayBytes = lods.reduce((total, lod) => total + lod.positions.byteLength + lod.faceNormals.byteLength, 0);
  const buffer = new ArrayBuffer(dataOffset + arrayBytes);
  const bytes = new Uint8Array(buffer);
  bytes.set(MAGIC, 0);
  new DataView(buffer).setUint32(MAGIC.length, headerBytes.length, true);
  bytes.set(headerBytes, HEADER_OFFSET);
  let offset = dataOffset;
  for (const lod of lods) {
    bytes.set(new Uint8Array(lod.positions.buffer, lod.positions.byteOffset, lod.positions.byteLength), offset);
    offset += lod.positions.byteLength;
    bytes.set(new Uint8Array(lod.faceNormals.buffer, lod.faceNormals.byteOffset, lod.faceNormals.byteLength), offset);
    offset += lod.faceNormals.byteLength;
  }
  return buffer;
}

export function deserializeDerivedModel(buffer, expectedCacheKey = "") {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_OFFSET) throw new Error("Derived model cache is truncated");
  const bytes = new Uint8Array(buffer);
  if (!MAGIC.every((value, index) => bytes[index] === value)) throw new Error("Derived model cache has an unknown format");
  const headerLength = new DataView(buffer).getUint32(MAGIC.length, true);
  const dataOffset = align4(HEADER_OFFSET + headerLength);
  if (headerLength <= 0 || dataOffset > buffer.byteLength) throw new Error("Derived model cache header is invalid");
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER_OFFSET, HEADER_OFFSET + headerLength)));
  if (header.format !== CACHE_FORMAT || header.version !== 1) throw new Error("Derived model cache version is stale");
  if (expectedCacheKey && header.cacheKey !== expectedCacheKey) throw new Error("Derived model cache key does not match its source");
  let offset = dataOffset;
  const lods = (header.lods || []).map((metadata, index) => {
    const positionsLength = positiveArrayLength(metadata.positionsLength);
    const normalsLength = positiveArrayLength(metadata.normalsLength);
    const positionsBytes = positionsLength * Float32Array.BYTES_PER_ELEMENT;
    const normalsBytes = normalsLength * Float32Array.BYTES_PER_ELEMENT;
    if (offset + positionsBytes + normalsBytes > buffer.byteLength) throw new Error("Derived model cache geometry is truncated");
    const positions = new Float32Array(buffer, offset, positionsLength);
    offset += positionsBytes;
    const faceNormals = new Float32Array(buffer, offset, normalsLength);
    offset += normalsBytes;
    const triangleCount = Math.floor(positionsLength / 9);
    if (!triangleCount || triangleCount !== Math.floor(Number(metadata.triangleCount) || 0)) {
      throw new Error("Derived model cache triangle metadata is invalid");
    }
    return {
      positions,
      faceNormals,
      triangleCount,
      bounds: metadata.bounds,
      sourceBounds: metadata.sourceBounds,
      simplification: metadata.simplification || "",
      simplificationError: Math.max(0, Number(metadata.simplificationError) || 0),
      requestedTriangleCount: Math.max(0, Math.floor(Number(metadata.requestedTriangleCount) || 0)),
      topologyLimited: metadata.topologyLimited === true,
      lodLevel: Math.max(0, Math.floor(Number(metadata.lodLevel) || index)),
      sourceTriangleCount: Math.max(0, Math.floor(Number(header.sourceTriangleCount) || 0)),
      derivedCache: true,
    };
  });
  if (!lods.length) throw new Error("Derived model cache contains no LODs");
  return { ...lods[0], lods, sourceTriangleCount: Math.max(0, Math.floor(Number(header.sourceTriangleCount) || 0)), derivedCache: true };
}

async function modelCacheDirectory(mode) {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;
  try {
    const project = await loadProjectDirectoryHandle();
    if (!project) return null;
    const permission = await project.queryPermission?.({ mode }) || "prompt";
    if (permission !== "granted") {
      reportUnavailable(mode, `project folder permission is ${permission}`);
      return null;
    }
    const root = await project.getDirectoryHandle(CACHE_ROOT, { create: mode === "readwrite" });
    return await root.getDirectoryHandle(CACHE_DIRECTORY, { create: mode === "readwrite" });
  } catch (error) {
    if (mode === "read" && isNotFoundError(error)) return null;
    reportUnavailable(mode, error?.message || String(error));
    return null;
  }
}

function reportUnavailable(mode, message) {
  if (mode === "read" && readUnavailableReported) return;
  if (mode === "readwrite" && writeUnavailableReported) return;
  if (mode === "read") readUnavailableReported = true;
  else writeUnavailableReported = true;
  console.warn("[VJ1_MODEL_CACHE_UNAVAILABLE]", {
    mode,
    fallback: "process this model for the current session",
    message,
  });
}

function modelCacheFilename(cacheKey) {
  return `${stableHash(cacheKey, 0x811c9dc5)}${stableHash(cacheKey, 0x9e3779b9)}.vj1model`;
}

function stableHash(value, seed) {
  let hash = seed >>> 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function positiveArrayLength(value) {
  const length = Math.floor(Number(value) || 0);
  if (length <= 0 || length > 1_000_000_000) throw new Error("Derived model cache array length is invalid");
  return length;
}

function align4(value) {
  return (value + 3) & ~3;
}

function isNotFoundError(error) {
  return error?.name === "NotFoundError" || /not found/i.test(String(error?.message || error || ""));
}
