import {
  createVisualNode,
  normalizeParamValues,
  paramValue,
} from "../libraries/visual-nodes/shared/component-schema.js";
import {
  getEffectNodeComponent as getShaderComponent,
} from "../libraries/visual-nodes/index.js";

export function compileShaderSchedule(chain = [], {
  getEffectComponent = getShaderComponent,
} = {}) {
  return (chain || [])
    .map((pass, index) => {
      const component = getEffectComponent(pass.id);
      if (!component) return null;
      const params = passParams(component, pass);
      return {
        index,
        id: `shader:${index}:${pass.id}`,
        component,
        node: createVisualNode(component, {
          id: `shader:${index}:${pass.id}`,
          role: "effect",
          enabled: pass.enabled !== false,
          params,
        }),
        pass: {
          ...pass,
          enabled: pass.enabled !== false,
          params,
          amount: Number(paramValue(component, params, "amount", 0)) || 0,
        },
      };
    })
    .filter((job) => job?.pass.enabled);
}

export function fuseLocalShaderSchedule(schedule = []) {
  const fused = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) fused.push(run[0]);
    else if (run.length > 1) {
      fused.push({
        fused: true,
        jobs: run,
        component: {
          name: run.map((job) => job.component.name).join(" + "),
          sampling: "local",
        },
        pass: {
          id: `fused:${run.map((job) => job.pass.id).join("+")}`,
          amount: 1,
          params: {},
        },
      });
    }
    run = [];
  };
  for (const job of schedule || []) {
    if (isFusibleShaderJob(job)) run.push(job);
    else {
      flush();
      fused.push(job);
    }
  }
  flush();
  return fused;
}

export function isFusibleShaderJob(job) {
  if (!job?.component?.fusible || job.pass?.amount <= 0.0001) return false;
  if (
    (job.pass?.blend || "normal") !== "normal" ||
    Math.abs((job.pass?.opacity ?? 1) - 1) > 0.0001
  ) {
    return false;
  }
  const transform = job.pass?.transform || {};
  return Math.abs(Number(transform.x) || 0) < 1e-9 &&
    Math.abs(Number(transform.y) || 0) < 1e-9 &&
    Math.abs((Number(transform.scale) || 1) - 1) < 1e-9 &&
    Math.abs(Number(transform.rotation) || 0) < 1e-9;
}

export function passParams(component, pass = {}) {
  return normalizeParamValues(
    component,
    pass.params && typeof pass.params === "object" ? pass.params : {},
  );
}
