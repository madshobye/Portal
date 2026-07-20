const vertexArrayApis = new WeakMap();

export function beginRawWebGlState(gl, label = "raw-webgl") {
  const vertexArrayApi = rawVertexArrayApi(gl);
  return {
    label,
    vertexArrayApi,
    vertexArray: vertexArrayApi ? gl.getParameter(vertexArrayApi.binding) : null,
    program: gl.getParameter(gl.CURRENT_PROGRAM),
    arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
    elementBuffer: gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING),
    viewport: gl.getParameter(gl.VIEWPORT),
    lineWidth: gl.getParameter(gl.LINE_WIDTH),
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    blend: gl.isEnabled(gl.BLEND),
    cullFace: gl.isEnabled(gl.CULL_FACE),
    polygonOffset: gl.isEnabled(gl.POLYGON_OFFSET_FILL),
    depthFunc: gl.getParameter(gl.DEPTH_FUNC),
    blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB),
    blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB),
    blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
    blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
    polygonFactor: gl.getParameter(gl.POLYGON_OFFSET_FACTOR),
    polygonUnits: gl.getParameter(gl.POLYGON_OFFSET_UNITS),
  };
}

export function bindRawWebGlVertexArray(gl, state, owner) {
  if (!state.vertexArrayApi) return;
  if (!owner.__vj1RawVertexArray) owner.__vj1RawVertexArray = state.vertexArrayApi.create();
  state.vertexArrayApi.bind(owner.__vj1RawVertexArray);
}

export function captureRawWebGlAttributes(gl, state, locations) {
  if (state.vertexArrayApi) return [];
  return locations.map((location) => captureVertexAttributeState(gl, location)).filter(Boolean);
}

export function restoreRawWebGlState(gl, state, attributeStates = []) {
  try {
    for (const attributeState of attributeStates) restoreVertexAttributeState(gl, attributeState);
    if (state.vertexArrayApi) state.vertexArrayApi.bind(state.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.elementBuffer);
    gl.useProgram(state.program);
    if (state.viewport?.length === 4) gl.viewport(...state.viewport);
    gl.lineWidth(state.lineWidth);
    gl.depthFunc(state.depthFunc);
    gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    gl.polygonOffset(state.polygonFactor, state.polygonUnits);
    restoreCapability(gl, gl.DEPTH_TEST, state.depthTest);
    restoreCapability(gl, gl.BLEND, state.blend);
    restoreCapability(gl, gl.CULL_FACE, state.cullFace);
    restoreCapability(gl, gl.POLYGON_OFFSET_FILL, state.polygonOffset);
  } catch (error) {
    console.error("[VJ1_RAW_GL_STATE_RESTORE_FAILED]", { label: state.label, error });
    throw error;
  }
}

export function disposeRawWebGlVertexArray(gl, owner) {
  if (!owner?.__vj1RawVertexArray) return;
  rawVertexArrayApi(gl)?.remove(owner.__vj1RawVertexArray);
  owner.__vj1RawVertexArray = null;
}

function rawVertexArrayApi(gl) {
  if (vertexArrayApis.has(gl)) return vertexArrayApis.get(gl);
  let api = null;
  if (typeof gl.createVertexArray === "function" && gl.VERTEX_ARRAY_BINDING != null) {
    api = {
      binding: gl.VERTEX_ARRAY_BINDING,
      create: () => gl.createVertexArray(),
      bind: (vertexArray) => gl.bindVertexArray(vertexArray),
      remove: (vertexArray) => gl.deleteVertexArray(vertexArray),
    };
  } else {
    const extension = gl.getExtension?.("OES_vertex_array_object");
    if (extension) {
      api = {
        binding: extension.VERTEX_ARRAY_BINDING_OES,
        create: () => extension.createVertexArrayOES(),
        bind: (vertexArray) => extension.bindVertexArrayOES(vertexArray),
        remove: (vertexArray) => extension.deleteVertexArrayOES(vertexArray),
      };
    }
  }
  vertexArrayApis.set(gl, api);
  return api;
}

function captureVertexAttributeState(gl, location) {
  if (location < 0) return null;
  return {
    location,
    enabled: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
    buffer: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
    size: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
    type: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_TYPE),
    normalized: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
    stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
    offset: gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER),
  };
}

function restoreVertexAttributeState(gl, state) {
  if (state.buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    gl.vertexAttribPointer(state.location, state.size, state.type, state.normalized, state.stride, state.offset);
  }
  state.enabled ? gl.enableVertexAttribArray(state.location) : gl.disableVertexAttribArray(state.location);
}

function restoreCapability(gl, capability, enabled) {
  enabled ? gl.enable(capability) : gl.disable(capability);
}
