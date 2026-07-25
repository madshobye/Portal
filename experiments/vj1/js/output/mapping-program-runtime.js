import {
  activeMappingProgramSurfaces,
  compileMappingRenderPrograms,
  compileOutputRenderProgram,
} from "../libraries/composition-engine/index.js?v=compiled-capability-revision-1";

// Retained compiler boundary for Mapping and Output graph programs. Surface
// presentation consumes the resolved program directly; authored Mapping state
// remains the semantic authority.
export class MappingProgramRuntime {
  constructor({ getState }) {
    this.getState = getState;
    this.programs = new Map();
    this.output = null;
    this.cache = new WeakMap();
  }

  rebuild(state = this.getState()) {
    const groups = state?.nodes?.groups || [];
    this.programs = compileMappingRenderPrograms(state || {}, groups);
    this.output = compileOutputRenderProgram(groups);
    if (state && typeof state === "object") {
      this.cache.set(state, {
        mappings: this.programs,
        output: this.output,
      });
    }
    return this.programs;
  }

  surfaces(state = this.getState()) {
    if (!state || typeof state !== "object") return [];
    if (state === this.getState()) {
      return activeMappingProgramSurfaces(
        state,
        this.programs,
        this.output,
      );
    }
    let compiled = this.cache.get(state);
    if (!compiled) {
      const groups = state.nodes?.groups || [];
      compiled = {
        mappings: compileMappingRenderPrograms(state, groups),
        output: compileOutputRenderProgram(groups),
      };
      this.cache.set(state, compiled);
    }
    return activeMappingProgramSurfaces(
      state,
      compiled.mappings,
      compiled.output,
    );
  }

  clear() {
    this.programs = new Map();
    this.output = null;
    this.cache = new WeakMap();
  }
}
