export function compileRawShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[VJ1_RAW_SHADER_COMPILE_FAILED]", {
      type: type === gl.VERTEX_SHADER ? "vertex" : "fragment",
      info: gl.getShaderInfoLog?.(shader) || "No shader compiler log was provided.",
    });
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function linkSpecializedProgram(gl, vertex, fragment) {
  if (!vertex || !fragment) {
    console.error("[VJ1_RAW_PROGRAM_SHADER_MISSING]", {
      vertex: !!vertex,
      fragment: !!fragment,
    });
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.detachShader?.(program, vertex);
  gl.detachShader?.(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[VJ1_RAW_PROGRAM_LINK_FAILED]", {
      info: gl.getProgramInfoLog?.(program) || "No program linker log was provided.",
    });
    gl.deleteProgram(program);
    return null;
  }
  return program;
}
