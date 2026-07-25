import { RenderNodeRuntime } from "../libraries/render-engine/render-node-contract.js";
import { renderBufferKey } from "./component-render-state.js?v=async-media-dirty-1";
import {
  instanceInvariantRenderRequest,
  renderRequestKey,
} from "./render-geometry.js?v=fit-geometry-demand-1";

export class RenderEvaluationRuntime {
  constructor(host) {
    this.host = host;
    this.nodes = new Map();
  }

  evaluate(
    nodeId,
    signature,
    renderRequest,
    render,
    dirtyReason,
    options = {},
  ) {
    const host = this.host;
    const instanceInvariant = options.instanceInvariant === true;
    const evaluationRequest = instanceInvariant
      ? instanceInvariantRenderRequest(renderRequest)
      : renderRequest;
    const bufferId = renderBufferKey("node", nodeId);
    const runtimeKey = renderBufferKey(
      bufferId,
      renderRequestKey(evaluationRequest),
    );
    const output = host.renderTargetRuntime.gpu(bufferId, evaluationRequest);
    let runtime = this.nodes.get(runtimeKey);
    if (!runtime) {
      runtime = new RenderNodeRuntime(runtimeKey);
      this.nodes.set(runtimeKey, runtime);
    }
    runtime.bindOutput(output);
    const result = runtime.evaluate(signature, () => {
      render(output);
      return output;
    }, {
      frame: host.frameRuntime.frameIndex,
      dirtyReason,
    });
    if (!result.rendered) host.profileRuntime.frameProfile.stageCacheHits++;
    else host.profileRuntime.frameProfile.stageRenders++;
    return {
      buffer: result.output,
      outputVersion: result.outputVersion,
      nodeKey: runtimeKey,
      dirtyReason: result.dirtyReason,
      instanceInvariant,
    };
  }

  prune() {
    const host = this.host;
    for (const key of this.nodes.keys()) {
      const hasGpuEntry = host.renderTargetRuntime.hasGpuContaining(key);
      if (!host.renderTargetRuntime.hasCpu(key) && !hasGpuEntry) {
        this.nodes.delete(key);
      }
    }
  }

  dispose() {
    this.nodes.clear();
  }
}
