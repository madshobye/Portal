import {
  matchMidiMixControl,
  midiMixBankNote,
  midiMixLedNotes,
  normalizeMidiInputSettings,
} from "../libraries/control-engine/midi-input-profile/index.js";
import { sortCatalogItems } from "../domain/catalog-marker.js";
import { thumbnailAccentColor } from "./thumbnail-accent-color.js";

export function createMidiInputService({
  requestAccess = () => navigator.requestMIDIAccess(),
  queryPermission = midiPermissionState,
  onSignal = () => {},
  onSelectScene = () => {},
  onSelectComponent = () => {},
  onAdjustSignificantParameter = () => {},
  resolveSignificantParameters = () => [],
  onStatus = () => {},
  now = () => Date.now(),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
} = {}) {
  let access = null;
  let accessPromise = null;
  let autoConnectPromise = null;
  let autoConnectProfileSignature = "";
  let autoConnectAttempted = false;
  let connectionGeneration = 0;
  let state = {};
  let page = 0;
  let sequence = 0;
  let error = "";
  let statusSignature = "";
  let ledSignature = "";
  const inputs = new Set();
  const outputs = new Set();
  const accentById = new Map();
  const accentSourceById = new Map();

  async function connect() {
    if (access) return access;
    if (accessPromise) return accessPromise;
    error = "";
    publishStatus();
    accessPromise = Promise.resolve().then(requestAccess).then((next) => {
      access = next;
      access.onstatechange = reconcile;
      reconcile();
      return access;
    }).catch((cause) => {
      error = cause?.message || String(cause);
      publishStatus();
      return null;
    }).finally(() => {
      accessPromise = null;
      publishStatus();
    });
    return accessPromise;
  }

  async function autoConnect() {
    if (access || accessPromise) return access || accessPromise;
    if (!enabledProfiles().length) return null;
    if (autoConnectAttempted) return autoConnectPromise;
    if (autoConnectPromise) return autoConnectPromise;
    autoConnectAttempted = true;
    const generation = connectionGeneration;
    autoConnectPromise = Promise.resolve()
      .then(queryPermission)
      .then((permission) =>
        permission === "granted" &&
        generation === connectionGeneration &&
        enabledProfiles().length
          ? connect()
          : null
      )
      .catch(() => null)
      .finally(() => {
        autoConnectPromise = null;
      });
    return autoConnectPromise;
  }

  function reconcile() {
    const current = new Set();
    for (const input of access?.inputs?.values?.() || []) {
      if (!input || input.state === "disconnected") continue;
      current.add(input);
      if (inputs.has(input)) continue;
      input.onmidimessage = (event) => receive(input, event);
      input.open?.().catch?.(() => {});
      inputs.add(input);
    }
    for (const input of inputs) {
      if (current.has(input)) continue;
      input.onmidimessage = null;
      inputs.delete(input);
    }
    const currentOutputs = new Set();
    for (const output of access?.outputs?.values?.() || []) {
      if (!output || output.state === "disconnected") continue;
      currentOutputs.add(output);
      if (outputs.has(output)) continue;
      outputs.add(output);
      Promise.resolve(output.open?.()).then(() => {
        ledSignature = "";
        refreshLeds();
      }).catch(() => {});
    }
    for (const output of outputs) {
      if (currentOutputs.has(output)) continue;
      output.close?.().catch?.(() => {});
      outputs.delete(output);
    }
    publishStatus();
    refreshLeds();
  }

  function receive(input, event) {
    const message = decodeMessage(event?.data);
    if (!message) return;
    const profiles = enabledProfiles().filter((profile) => profileMatchesInput(profile, input));
    if (!profiles.length) return;
    const values = {};
    let significantParameterHandled = false;
    for (const profile of profiles) {
      const control = matchMidiMixControl(profile, message);
      if (control) {
        values[control.address] = message.value;
        if (
          !significantParameterHandled &&
          Number.isInteger(control.liveSignificantSlot)
        ) {
          significantParameterHandled = true;
          activateSignificantParameter(control.liveSignificantSlot, message.value);
        }
        if (control.liveBank && message.value > 0) activateBankSlot(control.liveBank, control.slot);
        if (control.liveBank && message.value === 0) {
          // MIDImix momentary buttons can clear their own lamp on release.
          // Reassert the authoritative Live selection after that release has
          // completed so the selected Scene/Component remains illuminated.
          schedule(() => {
            ledSignature = "";
            refreshLeds();
          }, 0);
        }
      }
      if (message.type === "note" && message.value > 0) {
        if (message.number === midiMixBankNote("left")) setPage(page - 1);
        if (message.number === midiMixBankNote("right")) setPage(page + 1);
      }
    }
    values[`${input.id}/${message.channel}:${message.type}:${message.number}`] = message.value;
    onSignal({
      kind: "midi",
      values,
      sequence: ++sequence,
      timestamp: Number(event?.receivedTime) || now(),
    });
  }

  function activateBankSlot(kind, slot) {
    const assignments = bankAssignments(state, page);
    const item = assignments[kind === "scene" ? "scenes" : "components"][slot];
    if (!item) return;
    if (kind === "scene") onSelectScene(item.id);
    else onSelectComponent(item.id);
  }

  function activateSignificantParameter(slot, unitValue) {
    const assignment = significantParameterAssignments()[slot];
    if (!assignment) return;
    onAdjustSignificantParameter({
      assignment,
      unitValue: Math.min(1, Math.max(0, Number(unitValue) || 0)),
    });
  }

  function setPage(nextPage) {
    const maxPage = Math.max(0, bankPageCount(state) - 1);
    page = Math.max(0, Math.min(maxPage, Number(nextPage) || 0));
    ledSignature = "";
    loadAssignmentAccents();
    publishStatus();
    refreshLeds();
  }

  function syncState(nextState = {}) {
    state = nextState;
    const profileSignature = enabledProfiles()
      .map((profile) => `${profile.id}:${profile.inputId}:${profile.outputId}`)
      .join("|");
    if (profileSignature !== autoConnectProfileSignature) {
      autoConnectProfileSignature = profileSignature;
      autoConnectAttempted = false;
    }
    page = Math.min(page, Math.max(0, bankPageCount(state) - 1));
    loadAssignmentAccents();
    publishStatus();
    refreshLeds();
    void autoConnect();
  }

  function loadAssignmentAccents() {
    const assignments = bankAssignments(state, page);
    for (const item of [...assignments.scenes, ...assignments.components]) {
      if (!item?.thumbnail || accentSourceById.get(item.id) === item.thumbnail) continue;
      accentSourceById.set(item.id, item.thumbnail);
      accentById.set(item.id, "#777777");
      thumbnailAccentColor(item.thumbnail).then((color) => {
        if (accentById.get(item.id) === color) return;
        accentById.set(item.id, color);
        statusSignature = "";
        publishStatus();
      });
    }
  }

  function snapshot() {
    const assignments = bankAssignments(state, page);
    const decorate = (item) => item ? { ...item, accent: accentById.get(item.id) || "#777777" } : null;
    return {
      state: access ? "ready" : accessPromise ? "requesting" : error ? "error" : "idle",
      error,
      inputCount: inputs.size,
      outputCount: outputs.size,
      feedbackOutputCount: matchingOutputs().length,
      outputs: [...outputs].map((output) => ({
        id: String(output.id || ""),
        name: String(output.name || output.id || "MIDI output"),
        manufacturer: String(output.manufacturer || ""),
        connection: String(output.connection || ""),
      })),
      page,
      pageCount: bankPageCount(state),
      profiles: enabledProfiles(),
      scenes: assignments.scenes.map(decorate),
      components: assignments.components.map(decorate),
      parameters: significantParameterAssignments(),
    };
  }

  function publishStatus() {
    const value = snapshot();
    const signature = JSON.stringify(value);
    if (signature === statusSignature) return;
    statusSignature = signature;
    onStatus(value);
  }

  function refreshLeds() {
    if (!access) return;
    const assignments = bankAssignments(state, page);
    const profileActive = enabledProfiles().length > 0;
    const activeTargetId = profileActive ? activeMidiLiveTargetId(state) : "";
    const signature = `${page}|${activeTargetId}|${assignments.scenes.map((item) => item?.id).join(",")}|${assignments.components.map((item) => item?.id).join(",")}`;
    if (signature === ledSignature) return;
    ledSignature = signature;
    const notes = midiMixLedNotes();
    for (const output of matchingOutputs()) {
      try {
        notes.scenes.forEach((note, index) => output.send([0x90, note, assignments.scenes[index]?.id === activeTargetId ? 127 : 0]));
        notes.components.forEach((note, index) => output.send([0x90, note, assignments.components[index]?.id === activeTargetId ? 127 : 0]));
      } catch {
        // A disconnected output is reconciled by the next MIDI state change.
      }
    }
  }

  function matchingOutputs() {
    const profiles = enabledProfiles();
    return [...outputs].filter((output) =>
      profiles.length
        ? profiles.some((profile) => profileMatchesOutput(profile, output))
        : isMidiMixPort(output)
    );
  }

  function disconnect() {
    connectionGeneration++;
    for (const input of inputs) {
      input.onmidimessage = null;
      input.close?.().catch?.(() => {});
    }
    inputs.clear();
    if (access) access.onstatechange = null;
    for (const output of outputs) output.close?.().catch?.(() => {});
    outputs.clear();
    access = null;
    accessPromise = null;
    autoConnectPromise = null;
    autoConnectAttempted = false;
    error = "";
    statusSignature = "";
    publishStatus();
  }

  function enabledProfiles() {
    return normalizeMidiInputSettings(state?.inputs).midi.profiles.filter((profile) => profile.enabled);
  }

  function significantParameterAssignments() {
    try {
      const assignments = resolveSignificantParameters(state);
      return Array.isArray(assignments) ? assignments.slice(0, 8) : [];
    } catch {
      return [];
    }
  }

  function testLeds() {
    const notes = midiMixLedNotes();
    const ports = matchingOutputs();
    if (!ports.length) return false;
    for (const output of ports) {
      try {
        [...notes.scenes, ...notes.components].forEach((note) => output.send([0x90, note, 127]));
      } catch {}
    }
    schedule(() => {
      for (const output of ports) {
        try {
          [...notes.scenes, ...notes.components].forEach((note) => output.send([0x90, note, 0]));
        } catch {}
      }
      ledSignature = "";
      refreshLeds();
    }, 500);
    return true;
  }

  return Object.freeze({ autoConnect, connect, disconnect, setPage, snapshot, syncState, testLeds });
}

async function midiPermissionState() {
  const permissions = globalThis.navigator?.permissions;
  if (typeof permissions?.query !== "function") return "unknown";
  try {
    const permission = await permissions.query({ name: "midi", sysex: false });
    return String(permission?.state || "unknown");
  } catch {
    return "unknown";
  }
}

export function bankAssignments(state = {}, page = 0) {
  const components = (state.components || []).filter((item) => !item.systemRole);
  const sortMode = state.ui?.catalogSortModes?.live || "recent";
  const project = (item) => ({
    id: String(item.id || ""),
    name: String(item.name || item.id || ""),
    activity: item.activity || {},
    thumbnail: String(item.thumbnail || ""),
  });
  const scenes = sortMidiTargets(
    components.filter((item) => item.type === "scene"),
    sortMode,
  ).map(project);
  const ordinary = sortMidiTargets(
    components.filter((item) => item.type !== "scene"),
    sortMode,
  ).map(project);
  const offset = Math.max(0, Number(page) || 0) * 8;
  return {
    scenes: Array.from({ length: 8 }, (_, index) => scenes[offset + index] || null),
    components: Array.from({ length: 8 }, (_, index) => ordinary[offset + index] || null),
  };
}

export function sortMidiTargets(items = [], mode = "recent") {
  return sortCatalogItems(items, mode);
}

export function activeMidiLiveTargetId(state = {}) {
  const live = state.ui?.live || {};
  const surfaceId = String(live.previewSurfaceId || "__mapping__");
  if (surfaceId !== "__mapping__") {
    return String(
      live.patchSourceId
      || live.surfacePatches?.[surfaceId]
      || (live.overallSourceCleared === true ? "" : live.selectedComponentId || live.selectedSceneId)
      || "",
    );
  }
  if (live.overallSourceCleared === true) return "";
  return String(live.selectedComponentId || live.selectedSceneId || "");
}

function bankPageCount(state) {
  const components = (state?.components || []).filter((item) => !item.systemRole);
  const scenes = components.filter((item) => item.type === "scene").length;
  const ordinary = components.length - scenes;
  return Math.max(1, Math.ceil(Math.max(scenes, ordinary) / 8));
}

function profileMatchesInput(profile, input) {
  if (profile.inputId) return profile.inputId === input?.id;
  return isMidiMixPort(input);
}

function profileMatchesOutput(profile, output) {
  if (profile.outputId) return profile.outputId === output?.id;
  return isMidiMixPort(output);
}

function isMidiMixPort(port) {
  return `${port?.manufacturer || ""}${port?.name || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .includes("midimix");
}

function decodeMessage(data) {
  if (!data || data.length < 2) return null;
  const command = Number(data[0]) & 0xf0;
  const channel = (Number(data[0]) & 0x0f) + 1;
  const number = Number(data[1]) || 0;
  const raw = Number(data[2]) || 0;
  if (command === 0xb0) return { type: "cc", channel, number, value: raw / 127 };
  if (command === 0x90 || command === 0x80) {
    return { type: "note", channel, number, value: command === 0x80 ? 0 : raw / 127 };
  }
  return null;
}
