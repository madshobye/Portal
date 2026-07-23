export const NODE_COMPILER_TARGETS = Object.freeze({
  DIRECT: "direct",
  VISUAL: "visual",
  CONTROL: "control",
  ROUTING: "routing",
  SERVICE: "service",
  TRANSITION: "transition",
  SCENE_3D: "scene-3d",
});

export function defineNodeCompiler({ id, target = NODE_COMPILER_TARGETS.DIRECT, accepts = null, compile } = {}) {
  const compilerId = String(id || "").trim();
  if (!compilerId) throw new Error("NODE_COMPILER_MISSING_ID");
  if (typeof compile !== "function") throw new Error(`NODE_COMPILER_MISSING_COMPILE:${compilerId}`);
  const compilerTarget = String(target || NODE_COMPILER_TARGETS.DIRECT);
  if (!Object.values(NODE_COMPILER_TARGETS).includes(compilerTarget)) {
    throw new Error(`NODE_COMPILER_TARGET_UNKNOWN:${compilerId}:${compilerTarget}`);
  }
  return Object.freeze({
    id: compilerId,
    target: compilerTarget,
    accepts: typeof accepts === "function" ? accepts : () => true,
    compile,
  });
}

// Compilation is an authoring/state-boundary operation. The returned program
// is deliberately opaque to the generic node runtime: a visual backend may
// fuse shader jobs, retain render targets, and call specialized renderers
// without allocating packets or traversing editor topology inside a frame.
export class NodeCompilerRegistry {
  constructor(compilers = []) {
    this.compilers = new Map();
    for (const compiler of compilers) this.register(compiler);
  }

  register(compiler) {
    if (!compiler?.id || typeof compiler.compile !== "function") throw new Error("NODE_COMPILER_INVALID");
    this.compilers.set(compiler.id, compiler);
    return compiler;
  }

  get(id) {
    const compiler = this.compilers.get(String(id || ""));
    if (!compiler) throw new Error(`NODE_COMPILER_UNKNOWN:${id || "missing"}`);
    return compiler;
  }

  compile(group, context = {}) {
    if (!group?.id) throw new Error("NODE_COMPILER_GROUP_INVALID");
    const requestedId = group.compiler?.id || context.compilerId;
    const candidates = requestedId
      ? [this.get(requestedId)]
      : [...this.compilers.values()].filter((compiler) => !context.target || compiler.target === context.target);
    const compiler = candidates.find((item) => item.accepts(group, context));
    if (!compiler) throw new Error(`NODE_COMPILER_UNAVAILABLE:${group.id}:${context.target || "any"}`);
    const program = compiler.compile(group, context);
    if (!program || typeof program.execute !== "function") throw new Error(`NODE_COMPILER_PROGRAM_INVALID:${compiler.id}:${group.id}`);
    return program;
  }
}
