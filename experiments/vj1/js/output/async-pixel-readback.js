// WebGL readPixels into a typed array is synchronous: it flushes queued GPU
// work and blocks the main thread until the sampled framebuffer is complete.
// Pixel-pack buffers let probes enqueue the same tiny transfer and collect it
// on a later frame only after a fence reports that the data is ready.
export class AsyncPixelReadback {
  constructor() {
    this.streams = new Map();
  }

  read(target, key, width, height, revision = "") {
    const gl = target?.drawingContext;
    const framebuffer = target?.framebuffer;
    const streamKey = String(key || "default");
    const sampleWidth = Math.max(1, Math.round(Number(width) || 1));
    const sampleHeight = Math.max(1, Math.round(Number(height) || 1));
    if (!supportsAsyncReadback(gl, framebuffer)) {
      return { supported: false, pixels: null };
    }

    let stream = this.streams.get(streamKey);
    if (
      stream &&
      (stream.gl !== gl || stream.width !== sampleWidth || stream.height !== sampleHeight)
    ) {
      disposeStream(stream);
      this.streams.delete(streamKey);
      stream = null;
    }
    if (!stream) {
      stream = createStream(gl, sampleWidth, sampleHeight);
      if (!stream) return { supported: false, pixels: null };
      this.streams.set(streamKey, stream);
    }

    const completed = collectCompleted(stream);
    const requestedRevision = String(revision);
    if (
      !stream.pending &&
      !stream.failed &&
      requestedRevision !== stream.lastSubmittedRevision
    ) {
      enqueueReadback(stream, framebuffer, requestedRevision);
    }
    if (stream.failed) {
      disposeStream(stream);
      this.streams.delete(streamKey);
      return { supported: false, pixels: null };
    }
    return {
      supported: true,
      pixels: completed?.pixels || null,
      revision: completed?.revision || "",
      pending: stream.pending,
    };
  }

  dispose() {
    for (const stream of this.streams.values()) disposeStream(stream);
    this.streams.clear();
  }
}

export function supportsAsyncReadback(gl, framebuffer) {
  return !!(
    gl &&
    framebuffer?.begin &&
    framebuffer?.end &&
    gl.PIXEL_PACK_BUFFER !== undefined &&
    typeof gl.createBuffer === "function" &&
    typeof gl.bindBuffer === "function" &&
    typeof gl.bufferData === "function" &&
    typeof gl.readPixels === "function" &&
    typeof gl.fenceSync === "function" &&
    typeof gl.clientWaitSync === "function" &&
    typeof gl.getBufferSubData === "function"
  );
}

function createStream(gl, width, height) {
  const buffer = gl.createBuffer();
  if (!buffer) return null;
  return {
    gl,
    width,
    height,
    byteLength: width * height * 4,
    buffer,
    sync: null,
    pending: false,
    failed: false,
    pendingRevision: "",
    lastSubmittedRevision: null,
  };
}

function collectCompleted(stream) {
  if (!stream.pending || !stream.sync) return null;
  const { gl } = stream;
  const status = gl.clientWaitSync(stream.sync, 0, 0);
  if (status === gl.WAIT_FAILED) {
    stream.failed = true;
    return null;
  }
  if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
    return null;
  }
  const pixels = new Uint8Array(stream.byteLength);
  const revision = stream.pendingRevision;
  try {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, stream.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
  } catch {
    stream.failed = true;
    return null;
  } finally {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync?.(stream.sync);
    stream.sync = null;
    stream.pending = false;
    stream.pendingRevision = "";
  }
  return { pixels, revision };
}

function enqueueReadback(stream, framebuffer, revision) {
  const { gl } = stream;
  let began = false;
  try {
    framebuffer.begin();
    began = true;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, stream.buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, stream.byteLength, gl.STREAM_READ);
    gl.readPixels(
      0,
      0,
      stream.width,
      stream.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      0,
    );
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    stream.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    stream.pending = !!stream.sync;
    stream.pendingRevision = stream.pending ? revision : "";
    stream.lastSubmittedRevision = revision;
    stream.failed = !stream.pending;
    gl.flush?.();
  } catch {
    stream.failed = true;
  } finally {
    gl.bindBuffer?.(gl.PIXEL_PACK_BUFFER, null);
    if (began) framebuffer.end();
  }
}

function disposeStream(stream) {
  if (!stream?.gl) return;
  if (stream.sync) stream.gl.deleteSync?.(stream.sync);
  if (stream.buffer) stream.gl.deleteBuffer?.(stream.buffer);
  stream.sync = null;
  stream.buffer = null;
  stream.pending = false;
  stream.pendingRevision = "";
}
