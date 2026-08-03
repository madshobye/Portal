import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";

export const SessionDeviceLifecycleNode = defineNode({
  id: "core.devices.session-lifecycle",
  name: "Session Device Lifecycle",
  version: "0.1.0",
  description: "Owns session-scoped MIDI, DMX, and interactive capture services outside the control UI lifecycle.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: { state: { type: "any", required: true } },
  outlets: { status: { type: "any", optional: true } },
  execution: { trigger: "input-change", domain: "main", stateful: true },
  capabilities: ["session-devices", "midi-input", "dmx-output", "screen-capture"],
  presentation: { hiddenFrom: ["component-catalog", "node-library"] },
});
