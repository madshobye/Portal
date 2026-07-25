import {
  createProjectVisualNodeResolver,
  VisualStageNodeDefinitions,
} from "../libraries/visual-nodes/index.js?v=node-roi-placement-1";
import { TextureOperatorNodeDefinitions } from "../libraries/composition-engine/index.js?v=node-roi-placement-1";
import { RenderDemandNode } from "../libraries/render-engine/index.js";
import {
  ComposableScene3dGroup,
  Transform3dNode,
} from "../libraries/mesh-engine/index.js?v=node-roi-placement-1";
import { TerrainFlightControllerNode } from "../libraries/terrain-engine/index.js";

const COMPILED_VISUAL_CORE_DEFINITIONS = new Map([
  ...TextureOperatorNodeDefinitions,
  ...VisualStageNodeDefinitions,
  RenderDemandNode,
  Transform3dNode,
  TerrainFlightControllerNode,
  ComposableScene3dGroup,
].map((definition) => [definition.id, definition]));

// Owns the executable visual catalog seen by every compiled render capability.
// Project forks and installed packages change this catalog between frames;
// render-plan execution only performs direct lookups against the retained
// resolver and never traverses package or editor graphs.
export class VisualNodeRuntime {
  constructor(host, { installedPackages = [] } = {}) {
    this.host = host;
    this.installedPackages = Object.freeze([...(installedPackages || [])]);
    this.installedPackageSignature = installedNodePackageSignature(
      this.installedPackages,
    );
    this.projectSignature = "";
    this.nodes = createProjectVisualNodeResolver({}, {
      coreDefinitions: COMPILED_VISUAL_CORE_DEFINITIONS.values(),
      installedPackages: this.installedPackages,
    });
    this.resolverOptions = Object.freeze({
      getEffectComponent: (id) => this.effect(id),
      getGeneratorComponent: (id) => this.generator(id),
    });
  }

  coreDefinition(id) {
    return COMPILED_VISUAL_CORE_DEFINITIONS.get(id);
  }

  definition(id) {
    return this.nodes.definition(id);
  }

  effect(id) {
    return this.nodes.effect(id);
  }

  generator(id) {
    return this.nodes.generator(id);
  }

  generatorShader(id) {
    return this.nodes.generatorShader(id);
  }

  rebuild(state = this.host.state) {
    const signature = projectVisualNodeSignature(state);
    if (signature === this.projectSignature) return false;
    this.projectSignature = signature;
    this.nodes = createProjectVisualNodeResolver(state || {}, {
      coreDefinitions: COMPILED_VISUAL_CORE_DEFINITIONS.values(),
      installedPackages: this.installedPackages,
    });
    this.host.sourceRuntime?.invalidateStructure();
    this.host.isfRuntime?.dispose();
    // Shader objects are context-bound and keyed by source. Clear only when
    // project node code changes, never during ordinary frames or parameter
    // scrubs.
    this.host.shaderEffectRuntime?.clear();
    return true;
  }

  setInstalledPackages(packages = []) {
    const next = Object.freeze([...(packages || [])]);
    const signature = installedNodePackageSignature(next);
    if (signature === this.installedPackageSignature) return false;
    this.installedPackages = next;
    this.installedPackageSignature = signature;
    this.projectSignature = "";
    this.host.transitionRuntime.invalidate();
    this.rebuild();
    this.host.transitionRuntime.rebuild();
    if (this.host.state) this.host.componentProgramRuntime.rebuild();
    this.host.sourceRuntime.invalidateStructure();
    this.host.invalidatePresentation("node-packages");
    return true;
  }
}

function projectVisualNodeSignature(state = {}) {
  return JSON.stringify({
    forks: (state?.nodes?.forks || []).map((fork) => [
      fork?.id,
      fork?.active !== false,
      fork?.base?.id,
      fork?.base?.version,
      fork?.definition,
    ]),
    projectDefinitions: (state?.nodes?.definitions || [])
      .filter((definition) => definition?.persistence !== "package")
      .map((definition) => [
        definition?.id,
        definition?.version,
        definition?.metadata?.isf?.sourceHash || "",
        definition?.parts || [],
      ]),
    packages: (state?.nodes?.packages || []).map((reference) => [
      reference?.id,
      reference?.version,
      reference?.enabled !== false,
    ]),
  });
}

function installedNodePackageSignature(packages = []) {
  return JSON.stringify((packages || []).map((nodePackage) => ({
    id: nodePackage?.id || "",
    version: nodePackage?.version || "",
    definitions: (nodePackage?.definitions || []).map((definition) => ({
      id: definition?.id || "",
      version: definition?.version || "",
      parts: (definition?.parts || []).map((part) => [
        part?.id || "",
        part?.source || "",
      ]),
    })),
    visualLibrary: nodePackage?.visualLibrary || [],
    resources: nodePackage?.resources || [],
  })));
}
