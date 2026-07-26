import { clamp01 } from "../domain/models.js";
import { textureStateKey } from "../libraries/render-engine/render-node-contract.js";
import {
  isFullNodeBoundary,
  nodeBoundaryPixelRect,
  nodeRoiRequest,
  sameNodeBoundary,
} from "../libraries/render-engine/roi/index.js";
import { transitionKernelCacheKey } from "../libraries/transition-engine/index.js";
import {
  compileShaderSchedule,
  isFusibleShaderJob,
} from "../graph/shader-scheduler.js";
import { renderBufferKey } from "./component-render-state.js";
import {
  chainItemToShaderPass,
} from "./shader-target-runtime.js";
import {
  combineContentTransforms,
  isIdentityTransform,
} from "./preview-interaction-geometry.js";
import { renderRequestStateKey } from "./render-geometry.js";
import { renderSourceDetail } from "../libraries/render-engine/render-view/index.js";

// Direct executor for already-compiled visual plans. The compiler has resolved
// graph topology, definitions, ports, contracts, and hooks before this runtime
// is entered. This capability therefore performs a tight operation loop without
// generic node traversal or per-frame packet allocation.
export class VisualPlanRuntime {
  constructor(host) {
    this.host = host;
    this.planMediaOwnership = new WeakMap();
    this.valueRuntimeContext = Object.freeze({
      resolveMesh: (mediaId) => {
        const id = String(mediaId || "");
        if (!id) return null;
        const item = host.mediaRuntime?.acquireMediaById?.(id) || null;
        const mesh = item?.modelData || null;
        if (!mesh) host.mediaRuntime?.requestMissingMedia?.(id);
        return mesh;
      },
      resolveMeshStatus: (mediaId) => {
        const id = String(mediaId || "");
        return id ? host.media?.get?.(id) || null : null;
      },
    });
  }

  synchronizeExternalResourceRevisions(
    groupOperation,
    component,
  ) {
    for (const operation of groupOperation?.operations || []) {
      const revisions = operation.runtimeExternalRevisionInputs;
      revisions?.clear?.();
      for (
        const requirement of
        operation.externalResourceRequirements || []
      ) {
        const key = [
          String(requirement.kind || "capability"),
          String(requirement.id || "missing"),
          ...(requirement.sourceStepIds || []),
        ].join(":");
        const resolved =
          this.host.specializedSources.capabilityReadiness(
            requirement,
            {
              component,
              program: groupOperation,
              operation,
              valueProgram: groupOperation.valueProgram,
            },
          );
        revisions?.set(
          key,
          resolved
            ? [
                String(resolved.state || "error"),
                String(
                  resolved.revision ??
                  resolved.invalidationKey ??
                  resolved.state ??
                  "",
                ),
                String(resolved.error || ""),
              ].join("@")
            : "error@capability-readiness-unavailable",
        );
      }
    }
  }

  execute(
    plan,
    component,
    componentTime,
    renderRequest,
    scopeId = component.id,
  ) {
    if (
      plan?.format !== "vj1.visual-render-plan@1" ||
      !Array.isArray(plan.operations)
    ) {
      throw new Error(
        `VJ1_VISUAL_RENDER_PLAN_INVALID:${
          plan?.id || component.id || "unknown"
        }`,
      );
    }
    this.retainPlanMediaResources(plan);
    const restoreControls =
      plan.controlProgram?.apply({
        componentTime,
        timestamp: componentTime,
        renderRequest,
      }) || null;
    try {
      if (plan.executionModel === "texture-dag") {
        return this.executeTextureDag(
          plan,
          component,
          componentTime,
          renderRequest,
          scopeId,
        );
      }
      return this.renderOperations(
        component,
        plan.operations,
        componentTime,
        renderRequest,
        scopeId,
      );
    } finally {
      restoreControls?.();
    }
  }

  // A compiled plan owns the file resources declared by its active graph for
  // as long as that plan is evaluated, including frames where an individual
  // source operation returns a retained framebuffer. Cache the declaration by
  // the immutable operations array so ordinary frames perform only the small
  // lease-renewal loop; authored configuration replacement changes the array
  // identity and refreshes the declaration.
  retainPlanMediaResources(plan) {
    const host = this.host;
    let ownership = this.planMediaOwnership.get(plan);
    if (!ownership || ownership.operations !== plan.operations) {
      ownership = {
        operations: plan.operations,
        ids: Object.freeze([
          ...(plan.inspect?.().mediaDemand?.ids || []),
        ]),
      };
      this.planMediaOwnership.set(plan, ownership);
    }
    for (const mediaId of ownership.ids) {
      host.mediaRuntime?.retainMediaById?.(mediaId);
    }
    return ownership.ids;
  }

  executeTextureDag(
    plan,
    component,
    componentTime,
    renderRequest,
    scopeId = component.id,
    externalInputStates = null,
    inheritedTransform = {},
  ) {
    const host = this.host;
    const states = plan.runtimeStates;
    states.clear();
    const transparent = host.compositeRuntime.transparentChainState(
      component,
      renderRequest,
    );
    const completedFramebufferSequences = new Set();
    for (const operation of plan.operations) {
      const framebufferSequence = operation.framebufferSequence;
      if (
        framebufferSequence &&
        completedFramebufferSequences.has(framebufferSequence.sequenceId)
      ) {
        continue;
      }
      const item = operation.configuration || operation;
      let state;
      if (
        framebufferSequence?.phase === "begin"
      ) {
        const sequenceOperations = plan.operations.filter(
          (candidate) =>
            candidate.framebufferSequence?.sequenceId ===
            framebufferSequence.sequenceId,
        );
        const sequenceInputStates = new Map();
        for (const candidate of sequenceOperations) {
          sequenceInputStates.set(
            candidate.id,
            this.textureInputStates(
              plan,
              candidate,
              transparent,
              externalInputStates,
            ),
          );
        }
        state = host.sourceRuntime.renderFramebufferPassSequence(
          component,
          sequenceOperations,
          componentTime,
          renderRequest,
          renderBufferKey(scopeId, framebufferSequence.sequenceId),
          sequenceInputStates,
        );
        for (const candidate of sequenceOperations) {
          states.set(candidate.id, state || transparent);
        }
        completedFramebufferSequences.add(
          framebufferSequence.sequenceId,
        );
      } else if (item.enabled === false) {
        state = this.textureInputState(
          plan,
          operation,
          primaryTextureInputPort(operation),
          transparent,
          externalInputStates,
        );
      } else if (operation.opcode === "source") {
        const inputStates = this.textureInputStates(
          plan,
          operation,
          transparent,
          externalInputStates,
        );
        state = this.renderOperations(
          component,
          [operation],
          componentTime,
          renderRequest,
          renderBufferKey(scopeId, operation.id),
          inheritedTransform,
          transparent,
          inputStates,
        );
      } else if (
        operation.opcode === "effect" ||
        operation.opcode === "group"
      ) {
        const inputStates = this.textureInputStates(
          plan,
          operation,
          transparent,
          externalInputStates,
        );
        const firstPort = primaryTextureInputPort(operation);
        state = this.renderOperations(
          component,
          [operation],
          componentTime,
          renderRequest,
          renderBufferKey(scopeId, operation.id),
          inheritedTransform,
          inputStates.get(firstPort) || transparent,
          inputStates,
        );
      } else if (operation.opcode === "select") {
        state = this.textureInputState(
          plan,
          operation,
          item.params?.selection ? "b" : "a",
          transparent,
          externalInputStates,
        );
      } else {
        state = this.renderTextureOperator(
          plan,
          operation,
          component,
          componentTime,
          renderRequest,
          scopeId,
          transparent,
          externalInputStates,
        );
      }
      states.set(operation.id, state || transparent);
      if (operation.runtimeOutputStates?.size) {
        for (const [publicId, outputState] of operation.runtimeOutputStates) {
          const valueId =
            publicId === "texture"
              ? operation.id
              : `${operation.id}.${publicId}`;
          states.set(valueId, outputState || transparent);
        }
      }
    }
    return (
      states.get(plan.operations[plan.operations.length - 1]?.id) ||
      transparent
    );
  }

  textureInputState(
    plan,
    operation,
    port,
    fallback,
    externalInputStates = null,
  ) {
    const sourceId = operation.textureInputs?.[port];
    if (!sourceId) return fallback;
    if (String(sourceId).split(".")[0] === "$in") {
      const publicId =
        String(sourceId).split(".").slice(1).join(".") || "texture";
      return externalInputStates?.get(publicId) || fallback;
    }
    return (
      plan.runtimeStates.get(sourceId) ||
      plan.runtimeStates.get(String(sourceId).split(".")[0]) ||
      fallback
    );
  }

  textureInputStates(
    plan,
    operation,
    fallback,
    externalInputStates = null,
  ) {
    const states = operation.runtimeInputStates || new Map();
    states.clear();
    for (
      const port of
      operation.textureInputPorts ||
      Object.keys(operation.textureInputs || {})
    ) {
      states.set(
        port,
        this.textureInputState(
          plan,
          operation,
          port,
          fallback,
          externalInputStates,
        ),
      );
    }
    return states;
  }

  renderTextureOperator(
    plan,
    operation,
    component,
    componentTime,
    renderRequest,
    scopeId,
    transparent,
    externalInputStates = null,
  ) {
    const host = this.host;
    const item = operation.configuration || operation;
    const params = item.params || {};
    host.componentRenderRuntime.recordResolution(
      component,
      item,
      operation.opcode || "operator",
      renderRequest,
    );
    const aPort =
      operation.opcode === "transition"
        ? "startImage"
        : operation.opcode === "mask"
          ? "texture"
          : "a";
    const bPort =
      operation.opcode === "transition"
        ? "endImage"
        : operation.opcode === "mask"
          ? "mask"
          : "b";
    const current = this.textureInputState(
      plan,
      operation,
      operation.opcode === "feedback" || operation.opcode === "delay"
        ? "texture"
        : aPort,
      transparent,
      externalInputStates,
    );
    if (
      operation.opcode === "feedback" ||
      operation.opcode === "delay"
    ) {
      return host.textureOperatorRuntime.renderRetained(
        plan,
        operation,
        current,
        renderRequest,
        scopeId,
      );
    }
    const secondary = this.textureInputState(
      plan,
      operation,
      bPort,
      transparent,
      externalInputStates,
    );
    const amount =
      operation.opcode === "transition"
        ? clamp01(params.progress ?? 0)
        : clamp01(params.amount ?? 0.5);
    const transition =
      operation.opcode === "transition"
        ? host.transitionRuntime.resolve(
            params.transitionId,
            params.transitionParameters,
          )
        : null;
    const signature = stableStringify({
      a: textureStateKey(current),
      b: textureStateKey(secondary),
      opcode: operation.opcode,
      params,
      transitionKernel: transition
        ? transitionKernelCacheKey(transition.transitionKernel)
        : "",
      time: operation.opcode === "transition" ? componentTime : 0,
      request: renderRequestStateKey(renderRequest),
    });
    return host.renderEvaluationRuntime.evaluate(
      renderBufferKey(scopeId, operation.id),
      signature,
      renderRequest,
      (target) => {
        if (transition) {
          host.textureOperatorRuntime.drawTransition(
            target,
            current.buffer,
            secondary.buffer,
            transition,
            amount,
            componentTime,
          );
        } else {
          host.textureOperatorRuntime.draw(
            target,
            current.buffer,
            secondary.buffer,
            operation.opcode,
            params,
            amount,
          );
        }
      },
      `texture-${operation.opcode}`,
      {
        instanceInvariant:
          current.instanceInvariant === true &&
          secondary.instanceInvariant === true,
      },
    );
  }

  renderChainState(
    component,
    chain,
    componentTime,
    renderRequest,
    scopeId = component.id,
    inheritedTransform = {},
  ) {
    return this.renderOperations(
      component,
      chain,
      componentTime,
      renderRequest,
      scopeId,
      inheritedTransform,
    );
  }

  renderOperations(
    component,
    operations,
    componentTime,
    renderRequest,
    scopeId = component.id,
    inheritedTransform = {},
    initialState = null,
    externalInputStates = null,
  ) {
    const host = this.host;
    let state = host.compositeRuntime.transparentChainState(
      component,
      renderRequest,
    );
    if (initialState) state = initialState;
    for (let index = 0; index < (operations || []).length; index++) {
      const operation = operations[index];
      const item = operation?.configuration || operation;
      const opcode = operation?.opcode || item?.kind;
      if (item.enabled === false) continue;
      const effectComponent =
        opcode === "effect" && !operation?.transformDomain
          ? host.visualNodeRuntime.effect(item.componentId)
          : null;
      const effectRoi =
        operation?.roi ||
        operation?.compilerHook?.roi ||
        effectComponent?.runtime?.roi;
      const compiledEffectRoi = operation?.contract?.roi || effectRoi;
      const renderedItem = visualOperationRenderItem(
        operation,
        item,
        inheritedTransform,
        effectComponent,
      );
      const nodeId = renderBufferKey(
        component.id,
        scopeId,
        index,
        item.id || item.componentId || item.kind,
      );

      if (opcode === "source") {
        if (!isFullNodeBoundary(renderedItem.boundary)) {
          const sourceRoi = operation?.contract?.roi;
          const roiRequest = nodeRoiRequest(
            renderRequest,
            renderedItem.boundary,
            {
              renderIdentity: renderBufferKey(
                renderRequest.renderIdentity || component.id,
                renderedItem.id || nodeId,
              ),
              halo: sourceRoi?.halo,
              coordinateSpace: sourceRoi?.coordinateSpace,
              consumerGrid:
                sourceRoi?.coordinateSpace !== "full-frame",
            },
          );
          if (roiRequest.empty) continue;
          const sourceState = host.sourceRuntime.measureOperation(
            component,
            renderedItem,
            roiRequest,
            () =>
              host.sourceRuntime.renderItemState(
                component,
                renderedItem,
                componentTime,
                roiRequest,
                nodeId,
                operation,
                externalInputStates,
              ),
          );
          state = host.compositeRuntime.renderBoundedLayerNodeState(
            nodeId,
            state,
            sourceState,
            renderedItem,
            renderRequest,
            roiRequest.roi,
          );
          continue;
        }
        if (host.sourceRuntime.canDirectComposite(
          renderedItem,
          renderRequest,
          operation,
          component,
        )) {
          state = host.sourceRuntime.measureOperation(
            component,
            renderedItem,
            renderRequest,
            () =>
              host.sourceRuntime.renderDirectNodeState(
                nodeId,
                state,
                component,
                renderedItem,
                componentTime,
                renderRequest,
                operation,
              ),
          );
          continue;
        }
        const sourceState = host.sourceRuntime.measureOperation(
          component,
          renderedItem,
          renderRequest,
          () =>
            host.sourceRuntime.renderItemState(
              component,
              renderedItem,
              componentTime,
              renderRequest,
              nodeId,
              operation,
              externalInputStates,
            ),
        );
        state = host.compositeRuntime.renderLayerNodeState(
          nodeId,
          state,
          sourceState,
          { ...renderedItem, transform: {} },
          renderRequest,
        );
        continue;
      }

      if (opcode === "effect") {
        if (!isFullNodeBoundary(renderedItem.boundary)) {
          if (
            nodeBoundaryPixelRect(
              renderedItem.boundary,
              renderRequest,
            ).empty
          ) {
            continue;
          }
          if (compiledEffectRoi?.mode === "full-frame") {
            state = host.compositeRuntime.renderFullFrameEffectWithinBoundary(
              nodeId,
              state,
              renderedItem,
              componentTime,
              renderRequest,
              externalInputStates,
            );
            continue;
          }
          const run = [renderedItem];
          let runHalo = Math.max(
            0,
            Number(compiledEffectRoi?.halo) || 0,
          );
          let nextIndex = index + 1;
          while (nextIndex < (operations || []).length) {
            const nextOperation = operations[nextIndex];
            const nextItem =
              nextOperation?.configuration || nextOperation;
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if (
              (nextOperation?.opcode || nextItem?.kind) !== "effect"
            ) {
              break;
            }
            const nextEffectComponent = !nextOperation?.transformDomain
              ? host.visualNodeRuntime.effect(nextItem.componentId)
              : null;
            const nextEffectRoi =
              nextOperation?.contract?.roi ||
              nextOperation?.roi ||
              nextOperation?.compilerHook?.roi ||
              nextEffectComponent?.runtime?.roi;
            if (nextEffectRoi?.mode === "full-frame") break;
            const renderedNextItem = visualOperationRenderItem(
              nextOperation,
              nextItem,
              inheritedTransform,
              nextEffectComponent,
            );
            if (
              !sameNodeBoundary(
                renderedItem.boundary,
                renderedNextItem.boundary,
              )
            ) {
              break;
            }
            run.push(renderedNextItem);
            runHalo += Math.max(
              0,
              Number(nextEffectRoi?.halo) || 0,
            );
            nextIndex++;
          }
          state = host.compositeRuntime.renderBoundedEffectRunNodeState(
            nodeId,
            state,
            run,
            componentTime,
            renderRequest,
            runHalo,
            externalInputStates,
          );
          index = nextIndex - 1;
          continue;
        }

        const firstPass = chainItemToShaderPass(renderedItem);
        const firstJob = compileShaderSchedule(
          [firstPass],
          host.visualNodeRuntime.resolverOptions,
        )[0];
        if (isFusibleShaderJob(firstJob)) {
          const run = [renderedItem];
          let nextIndex = index + 1;
          while (nextIndex < (operations || []).length) {
            const nextOperation = operations[nextIndex];
            const nextItem =
              nextOperation?.configuration || nextOperation;
            if (nextItem?.enabled === false) {
              nextIndex++;
              continue;
            }
            if (
              (nextOperation?.opcode || nextItem?.kind) !== "effect"
            ) {
              break;
            }
            const nextEffectComponent = !nextOperation?.transformDomain
              ? host.visualNodeRuntime.effect(nextItem.componentId)
              : null;
            const renderedNextItem = visualOperationRenderItem(
              nextOperation,
              nextItem,
              inheritedTransform,
              nextEffectComponent,
            );
            const nextJob = compileShaderSchedule(
              [chainItemToShaderPass(renderedNextItem)],
              host.visualNodeRuntime.resolverOptions,
            )[0];
            if (!isFusibleShaderJob(nextJob)) break;
            run.push(renderedNextItem);
            nextIndex++;
          }
          if (run.length > 1) {
            state = host.shaderEffectRuntime.renderRunNodeState(
              renderBufferKey(nodeId, "fused", run.length),
              state,
              run,
              componentTime,
              renderRequest,
            );
            index = nextIndex - 1;
            continue;
          }
        }
        state = host.shaderEffectRuntime.renderNodeState(
          nodeId,
          state,
          renderedItem,
          componentTime,
          renderRequest,
          externalInputStates,
        );
        continue;
      }

      if (opcode === "group") {
        const bounded = !isFullNodeBoundary(renderedItem.boundary);
        const groupRequest = bounded
          ? nodeRoiRequest(renderRequest, renderedItem.boundary, {
              renderIdentity: renderBufferKey(
                renderRequest.renderIdentity || component.id,
                renderedItem.id || nodeId,
              ),
              halo: operation?.contract?.roi?.halo,
              coordinateSpace:
                operation?.contract?.roi?.coordinateSpace,
            })
          : renderRequest;
        if (groupRequest.empty) continue;
        host.componentRenderRuntime.recordResolution(
          component,
          renderedItem,
          "group",
          groupRequest,
        );
        const compoundPlacementTransform =
          combineContentTransforms(
            inheritedTransform,
            item.transform || {},
          );
        const restoreGroupControls =
          operation?.controlProgram?.apply({
            componentTime,
            timestamp: componentTime,
            renderRequest: groupRequest,
          }) || null;
        operation?.valueProgram?.evaluate({
          componentTime,
          timestamp: componentTime,
          renderRequest: groupRequest,
          sourceDetail: renderSourceDetail(
            groupRequest,
            groupRequest,
            {
              contentScale: compoundPlacementTransform.scale,
            },
          ),
          runtimeContext: this.valueRuntimeContext,
        });
        this.synchronizeExternalResourceRevisions(
          operation,
          component,
        );
        let groupState;
        try {
          const compiledGroup =
            operation?.backend === "compiled-visual-group";
          operation?.runtimeOutputStates?.clear?.();
          const groupInputStates = compiledGroup
            ? this.compiledGroupInputStates(
                operation,
                state,
                externalInputStates,
              )
            : null;
          const groupInitialState =
            groupInputStates?.get("texture") ||
            (groupInputStates?.size === 1
              ? groupInputStates.values().next().value
              : null);
          const groupScopeId = renderBufferKey(
            scopeId,
            item.id || index,
          );
          const lowersPlacementToTerminal =
            compiledGroup &&
            operation.placementLowering === "terminal-coordinate";
          const groupTransform =
            compiledGroup && !lowersPlacementToTerminal
              ? {}
              : compoundPlacementTransform;
          groupState =
            compiledGroup &&
            operation.executionModel === "texture-dag"
              ? this.executeTextureDag(
                  operation,
                  component,
                  componentTime,
                  groupRequest,
                  groupScopeId,
                  groupInputStates,
                  groupTransform,
                )
              : this.renderOperations(
                  component,
                  requiredGroupOperations(operation, nodeId),
                  componentTime,
                  groupRequest,
                  groupScopeId,
                  groupTransform,
                  groupInitialState,
                );
          if (compiledGroup) {
            const rawOutputs = this.compiledGroupOutputStates(
              operation,
              groupState,
            );
            for (const [publicId, rawOutputState] of rawOutputs) {
              const outputNodeId =
                rawOutputs.size === 1
                  ? nodeId
                  : renderBufferKey(nodeId, "output", publicId);
              const placement = {
                ...item,
                transform: lowersPlacementToTerminal
                  ? {}
                  : compoundPlacementTransform,
              };
              const outputState = bounded
                ? host.compositeRuntime.renderBoundedLayerNodeState(
                    outputNodeId,
                    state,
                    rawOutputState,
                    placement,
                    renderRequest,
                    groupRequest.roi,
                  )
                : host.compositeRuntime.renderLayerNodeState(
                    outputNodeId,
                    state,
                    rawOutputState,
                    placement,
                    renderRequest,
                  );
              operation.runtimeOutputStates.set(
                publicId,
                outputState,
              );
            }
            groupState =
              operation.runtimeOutputStates.get(operation.outputPort) ||
              operation.runtimeOutputStates.values().next().value ||
              groupState;
          }
        } finally {
          restoreGroupControls?.();
        }
        state =
          operation?.backend === "compiled-visual-group"
            ? groupState
            : bounded
              ? host.compositeRuntime.renderBoundedLayerNodeState(
                  nodeId,
                  state,
                  groupState,
                  { ...item, transform: {} },
                  renderRequest,
                  groupRequest.roi,
                )
              : host.compositeRuntime.renderLayerNodeState(
                  nodeId,
                  state,
                  groupState,
                  { ...item, transform: {} },
                  renderRequest,
                );
      }
    }
    return state;
  }

  compiledGroupInputStates(operation, fallback, provided = null) {
    const result = new Map();
    const publicIds = Object.keys(
      operation?.publicTextureInputs || {},
    );
    for (const publicId of publicIds) {
      const value =
        provided?.get(publicId) ||
        (publicId === "texture" || publicIds.length === 1
          ? fallback
          : null);
      if (value) result.set(publicId, value);
    }
    return result;
  }

  compiledGroupOutputStates(operation, fallback) {
    const result = new Map();
    for (
      const publicId of
      operation?.outputPorts ||
      [operation?.outputPort || "texture"]
    ) {
      const valueId = operation?.outputBindings?.[publicId] || "";
      const value =
        operation?.runtimeStates?.get(valueId) ||
        operation?.runtimeStates?.get(
          String(valueId).split(".")[0],
        ) ||
        fallback;
      if (value) result.set(publicId, value);
    }
    return result;
  }
}

export function visualOperationRenderItem(
  operation = {},
  item = {},
  inheritedTransform = {},
  effectComponent = null,
) {
  const opcode = operation?.opcode || item?.kind;
  const transformDomain =
    operation?.contract?.transform?.domain ||
    operation?.transformDomain ||
    operation?.compilerHook?.transformDomain ||
    "";
  const inheritsGroupTransform =
    opcode !== "effect" ||
    transformDomain === "group-field" ||
    (!transformDomain && effectComponent?.transformSource === false);
  if (
    isIdentityTransform(inheritedTransform) ||
    !inheritsGroupTransform
  ) {
    return item;
  }
  return {
    ...item,
    transform: combineContentTransforms(
      inheritedTransform,
      item.transform || {},
    ),
  };
}

export function primaryTextureInputPort(operation = {}) {
  const ports =
    operation.textureInputPorts ||
    Object.keys(operation.textureInputs || {});
  if (ports.includes("inputImage")) return "inputImage";
  if (ports.includes("texture")) return "texture";
  return ports[0] || "texture";
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    )
    .join(",")}}`;
}

function requiredGroupOperations(operation, nodeId) {
  if (Array.isArray(operation?.operations)) return operation.operations;
  throw new Error(`VJ1_COMPILED_GROUP_OPERATIONS_REQUIRED:${String(nodeId || "unknown")}`);
}
