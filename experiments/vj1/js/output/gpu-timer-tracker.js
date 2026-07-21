export class GpuTimerTracker {
  constructor({ sampleInterval = 6, maxPending = 12, maxQueryAgeFrames = 60 } = {}) {
    this.apis = new WeakMap();
    this.pending = [];
    this.frames = new Map();
    this.latestMs = 0;
    this.latestFrameId = -1;
    this.sampleId = 0;
    this.supported = false;
    this.sampleInterval = Math.max(1, Math.floor(Number(sampleInterval) || 1));
    this.maxPending = Math.max(1, Math.floor(Number(maxPending) || 1));
    this.maxQueryAgeFrames = Math.max(1, Math.floor(Number(maxQueryAgeFrames) || 1));
    this.reportedFailures = new Set();
  }

  begin(target, frameId) {
    if (frameId % this.sampleInterval !== 0 || this.pending.length >= this.maxPending) return null;
    const gl = webglContextFrom(target);
    const api = this.apiFor(gl);
    if (!api || api.active) return null;
    const query = api.createQuery();
    if (!query) return null;
    try {
      api.begin(query);
    } catch (error) {
      this.reportFailure("begin", error, "skip GPU timing sample");
      api.deleteQuery(query);
      return null;
    }
    api.active = true;
    const frame = this.frameRecord(frameId);
    frame.expected++;
    return { api, query, frameId };
  }

  end(token) {
    if (!token) return;
    try {
      token.api.end();
      this.pending.push(token);
    } catch (error) {
      this.reportFailure("end", error, "discard GPU timing sample");
      const frame = this.frameRecord(token.frameId);
      frame.resolved++;
      frame.invalid = true;
      token.api.deleteQuery(token.query);
    } finally {
      token.api.active = false;
    }
  }

  sealFrame(frameId) {
    this.frameRecord(frameId).sealed = true;
    this.resolveFrames();
  }

  poll(currentFrame = 0) {
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const token = this.pending[index];
      let available = false;
      try {
        available = token.api.available(token.query);
      } catch (error) {
        this.reportFailure("availability", error, "discard GPU timing query as invalid");
        available = true;
      }
      if (!available && currentFrame - token.frameId < this.maxQueryAgeFrames) continue;
      const frame = this.frameRecord(token.frameId);
      try {
        if (available && !token.api.disjoint()) {
          frame.queryNs.push(Number(token.api.result(token.query)) || 0);
        } else frame.invalid = true;
      } catch (error) {
        this.reportFailure("result", error, "discard GPU timing query as invalid");
        frame.invalid = true;
      }
      frame.resolved++;
      token.api.deleteQuery(token.query);
      this.pending.splice(index, 1);
    }
    this.resolveFrames();
  }

  reportFailure(operation, error, fallback) {
    if (this.reportedFailures.has(operation)) return;
    this.reportedFailures.add(operation);
    console.warn("[VJ1_GPU_TIMER_QUERY_FAILED]", { operation, fallback, message: error?.message || String(error) });
  }

  apiFor(gl) {
    if (!gl || typeof gl.getExtension !== "function") return null;
    if (this.apis.has(gl)) return this.apis.get(gl);
    let api = null;
    const webgl2Ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (webgl2Ext && typeof gl.createQuery === "function") {
      api = {
        active: false,
        createQuery: () => gl.createQuery(),
        deleteQuery: (query) => gl.deleteQuery(query),
        begin: (query) => gl.beginQuery(webgl2Ext.TIME_ELAPSED_EXT, query),
        end: () => gl.endQuery(webgl2Ext.TIME_ELAPSED_EXT),
        available: (query) => !!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        result: (query) => gl.getQueryParameter(query, gl.QUERY_RESULT),
        disjoint: () => !!gl.getParameter(webgl2Ext.GPU_DISJOINT_EXT),
      };
    } else {
      const webgl1Ext = gl.getExtension("EXT_disjoint_timer_query");
      if (webgl1Ext) {
        api = {
          active: false,
          createQuery: () => webgl1Ext.createQueryEXT(),
          deleteQuery: (query) => webgl1Ext.deleteQueryEXT(query),
          begin: (query) => webgl1Ext.beginQueryEXT(webgl1Ext.TIME_ELAPSED_EXT, query),
          end: () => webgl1Ext.endQueryEXT(webgl1Ext.TIME_ELAPSED_EXT),
          available: (query) => !!webgl1Ext.getQueryObjectEXT(query, webgl1Ext.QUERY_RESULT_AVAILABLE_EXT),
          result: (query) => webgl1Ext.getQueryObjectEXT(query, webgl1Ext.QUERY_RESULT_EXT),
          disjoint: () => !!gl.getParameter(webgl1Ext.GPU_DISJOINT_EXT),
        };
      }
    }
    this.apis.set(gl, api);
    if (api) this.supported = true;
    else if (!this.reportedFailures.has("unsupported")) {
      this.reportedFailures.add("unsupported");
      console.warn("[VJ1_GPU_TIMER_UNAVAILABLE]", {
        fallback: "report CPU render timing without GPU query timing",
        message: "EXT_disjoint_timer_query is unavailable for this WebGL context",
      });
    }
    return api;
  }

  frameRecord(frameId) {
    let frame = this.frames.get(frameId);
    if (!frame) {
      frame = { expected: 0, resolved: 0, queryNs: [], sealed: false, invalid: false };
      this.frames.set(frameId, frame);
    }
    return frame;
  }

  resolveFrames() {
    for (const [frameId, frame] of this.frames) {
      if (!frame.sealed || frame.resolved < frame.expected) continue;
      if (!frame.invalid && frame.expected > 0 && frameId > this.latestFrameId) {
        this.latestMs = averageGpuQueryNanoseconds(frame.queryNs) / 1000000;
        this.latestFrameId = frameId;
        this.sampleId++;
      }
      this.frames.delete(frameId);
    }
  }

  dispose() {
    for (const token of this.pending) token.api.deleteQuery(token.query);
    this.pending.length = 0;
    this.frames.clear();
  }
}

export function averageGpuQueryNanoseconds(queryTimes = []) {
  const values = Array.from(queryTimes, Number).filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function webglContextFrom(target) {
  if (!target) return null;
  if (typeof target.getExtension === "function") return target;
  return target?._renderer?.GL || target?.drawingContext || null;
}
