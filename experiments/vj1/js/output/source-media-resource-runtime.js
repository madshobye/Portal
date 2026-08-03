import { normalizeParamValues } from "../libraries/visual-nodes/shared/component-schema.js";
import { visitVisualParameterReferences } from "../libraries/visual-nodes/shared/parameter-references.js";
import { sourceWithNodeParams } from "./component-patch-adapter.js";
import { globalVisualTimeScale, qualityScaledRenderRequest } from "./render-runtime-math.js";

const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|ogv)$/i;

// Owns source dependency discovery and media leases. Backend execution stays
// in SourceRenderRuntime and placement stays in SourcePlacementRuntime; this
// class has no framebuffer or draw methods.
export class SourceMediaResourceRuntime {
  constructor(host, {
    mediaRuntime = host?.mediaRuntime,
    runtimeValueMediaResources = () => [],
    mediaSourceDemandWidth = () => 1,
    resolveStageContract = () => null,
  } = {}) {
    this.host = host;
    this.mediaRuntime = mediaRuntime;
    this.runtimeValueMediaResources = runtimeValueMediaResources;
    this.mediaSourceDemandWidth = mediaSourceDemandWidth;
    this.resolveStageContract = resolveStageContract;
    this.componentVideoPresence = new WeakMap();
  }

  dispose() {
    this.componentVideoPresence = new WeakMap();
  }

  invalidateStructure() {
    this.componentVideoPresence = new WeakMap();
  }

  videoPlaybackOptions(source = {}, component = {}) {
    const host = this.host;
    return {
      start: source.start,
      end: source.end,
      speed: (host.frameRuntime.isPlaybackActive() ? 1 : 0) *
        globalVisualTimeScale(host.state?.global) *
        (Number(source.speed) || 1) *
        Math.max(0, Number(component.speed) || 0),
    };
  }

  drawableResourcePlaybackOptions(descriptor = {}, component = {}) {
    if (descriptor?.kind !== "project-media-resource") return null;
    return this.videoPlaybackOptions({
      start: descriptor.start,
      end: descriptor.end,
      speed: descriptor.speed,
    }, component);
  }

  mediaIsVideo(mediaId) {
    const host = this.host;
    const runtimeItem = host.media.get(mediaId);
    const mediaMeta = (host.state?.media || []).find((entry) => entry.id === mediaId);
    return mediaMeta?.type === "video" || !!runtimeItem?.video || VIDEO_EXTENSION.test(mediaId);
  }

  visualMediaResourceIds(generatorId = "", authoredParameters = {}, normalizedParameters = null) {
    const component = this.host.visualNodeRuntime.generator(generatorId);
    const graph = component?.nodeDefinition?.parts?.find((part) => part.kind === "graph");
    const normalized = normalizedParameters || (component
      ? normalizeParamValues(component, authoredParameters || {})
      : { ...(authoredParameters || {}) });
    const ids = new Set();
    visitVisualParameterReferences(normalized, ({ kind, id }) => {
      if (kind === "media" && id) ids.add(id);
    });
    for (const node of graph?.nodes || []) {
      const definition = this.host.visualNodeRuntime.definition(node.type);
      if (!definition?.capabilities?.includes("media-resource")) continue;
      const stage = this.resolveStageContract(
        generatorId,
        node.id,
        authoredParameters,
        normalized,
      );
      const mediaId = String(stage?.params?.mediaId || "");
      if (mediaId) ids.add(mediaId);
    }
    return [...ids];
  }

  componentContainsVideo(component = {}, visiting = new Set()) {
    const host = this.host;
    if (!component?.id) return false;
    const cached = this.componentVideoPresence.get(component);
    if (cached != null) return cached;
    if (visiting.has(component.id)) return false;
    visiting.add(component.id);
    const inspection = host.componentProgramRuntime.programs.get(component.id)?.inspect();
    if (!inspection) {
      visiting.delete(component.id);
      throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
    }
    let containsVideo = false;
    for (const dependencyId of inspection.dependencies.components || []) {
      const dependency = host.state?.components?.find((candidate) => candidate.id === dependencyId);
      if (dependency && this.componentContainsVideo(dependency, visiting)) {
        containsVideo = true;
        break;
      }
    }
    if (!containsVideo) {
      containsVideo = (inspection.mediaDemand.ids || []).some((mediaId) => this.mediaIsVideo(mediaId));
    }
    visiting.delete(component.id);
    this.componentVideoPresence.set(component, containsVideo);
    return containsVideo;
  }

  claimRetainedComponentMedia(component = {}, visiting = new Set()) {
    const host = this.host;
    if (!component?.id || visiting.has(component.id)) return;
    visiting.add(component.id);
    const program = host.componentProgramRuntime.programs.get(component.id);
    if (!program) {
      visiting.delete(component.id);
      throw new Error(`VJ1_COMPONENT_PROGRAM_MISSING:${component.id}`);
    }
    const inspection = program.inspect();
    for (const mediaId of inspection.mediaDemand.ids || []) {
      if (!this.mediaIsVideo(mediaId)) this.mediaRuntime.retainMediaById(mediaId);
    }
    for (const dependencyId of inspection.dependencies.components || []) {
      const dependency = host.state?.components?.find((candidate) => candidate.id === dependencyId);
      if (dependency) this.claimRetainedComponentMedia(dependency, visiting);
    }
    if (!this.componentContainsVideo(component)) {
      visiting.delete(component.id);
      return;
    }
    const claimedVideoIds = new Set();
    program.forEachOperation((operation) => {
      if (
        operation.configuration?.enabled === false ||
        (operation.opcode !== "source" && operation.backend !== "compiled-visual-group")
      ) return;
      const source = sourceWithNodeParams(operation.configuration?.source, {}, operation.id);
      if (source.type === "component") return;
      for (const descriptor of this.runtimeValueMediaResources(operation.runtimeValueInputs)) {
        const mediaId = String(descriptor.mediaId || "");
        if (!mediaId || claimedVideoIds.has(mediaId) || !this.mediaIsVideo(mediaId)) continue;
        claimedVideoIds.add(mediaId);
        this.mediaRuntime.acquireMediaById(mediaId, {
          playback: this.drawableResourcePlaybackOptions(descriptor, component),
        });
      }
      if (source.type !== "generator") return;
      const generator = host.visualNodeRuntime.generator(source.generatorId);
      const params = generator
        ? normalizeParamValues(generator, source.params || {})
        : { ...(source.params || {}) };
      for (const mediaId of this.visualMediaResourceIds(source.generatorId, source.params || {}, params)) {
        if (claimedVideoIds.has(mediaId) || !this.mediaIsVideo(mediaId)) continue;
        claimedVideoIds.add(mediaId);
        this.mediaRuntime.acquireMediaById(mediaId, {
          playback: this.videoPlaybackOptions(params, component),
        });
      }
    });
    visiting.delete(component.id);
  }

  claimRetainedSourceMedia(source = {}, component = {}, renderRequest = {}, declaredMediaIds = null) {
    const host = this.host;
    if (source.type !== "generator") return [];
    const generator = host.visualNodeRuntime.generator(source.generatorId);
    const params = generator
      ? normalizeParamValues(generator, source.params || {})
      : { ...(source.params || {}) };
    const qualityRequest = qualityScaledRenderRequest(renderRequest, params);
    const mediaIds = declaredMediaIds
      ? Array.from(declaredMediaIds)
      : this.visualMediaResourceIds(source.generatorId, source.params || {}, params);
    return mediaIds.map((mediaId) => this.mediaIsVideo(mediaId)
      ? this.mediaRuntime.acquireMediaById(mediaId, {
          playback: this.videoPlaybackOptions(params, component),
          width: this.mediaSourceDemandWidth(qualityRequest, source),
        })
      : this.mediaRuntime.retainMediaById(mediaId));
  }
}
