import { createEnumParam, createNumberParam } from "../visual-nodes/shared/component-schema.js";

export const DMX_PROBE_VISUAL_ID = "dmxProbe";
export const DMX_CHANNEL_ROLES = Object.freeze([
  "brightness",
  "red",
  "green",
  "blue",
  "white",
  "strobe",
  "rotation",
  "program",
  "speed",
  "raw",
]);
export const DMX_SAMPLE_FEATURES = Object.freeze([
  "brightness",
  "r",
  "g",
  "b",
  "alpha",
  "none",
]);

const BUILT_IN_PROFILES = Object.freeze([
  profile("dmx-dimmer", "Dimmer", [
    channel("brightness", "Brightness", "brightness"),
  ]),
  profile("dmx-rgb", "RGB", [
    channel("red", "Red", "red"),
    channel("green", "Green", "green"),
    channel("blue", "Blue", "blue"),
  ]),
  profile("dmx-dimmer-rgb", "Brightness + RGB", [
    channel("brightness", "Brightness", "brightness", { sampleFeature: "none", defaultValue: 1 }),
    channel("red", "Red", "red"),
    channel("green", "Green", "green"),
    channel("blue", "Blue", "blue"),
  ]),
  profile("dmx-rgbw", "RGBW", [
    channel("red", "Red", "red"),
    channel("green", "Green", "green"),
    channel("blue", "Blue", "blue"),
    channel("white", "White", "white", { sampleFeature: "brightness" }),
  ]),
  profile("dmx-uking-zq01003-11ch", "U’King ZQ01003 · 11CH", [
    channel("master", "Master dimmer", "brightness", { sampleFeature: "none", defaultValue: 1 }),
    channel("strobe", "Strobe", "strobe"),
    channel("program", "Built-in program", "program"),
    channel("program-speed", "Program speed / sound sensitivity", "speed"),
    channel("main-red", "Main LED red", "red", { zone: "spot-rgb", sampleCell: { x: 0, y: 0 } }),
    channel("main-green", "Main LED green", "green", { zone: "spot-rgb", sampleCell: { x: 0, y: 0 } }),
    channel("main-blue", "Main LED blue", "blue", { zone: "spot-rgb", sampleCell: { x: 0, y: 0 } }),
    channel("main-white", "Main LED white", "white", { zone: "spot-white", sampleCell: { x: 0, y: 0 } }),
    channel("ring-red", "Outer ring red", "red", { zone: "outer-ring", sampleCell: { x: 1, y: 0 } }),
    channel("ring-green", "Outer ring green", "green", { zone: "outer-ring", sampleCell: { x: 1, y: 0 } }),
    channel("ring-blue", "Outer ring blue", "blue", { zone: "outer-ring", sampleCell: { x: 1, y: 0 } }),
  ], {
    description: "11-channel profile for the 60 W RGBW Bean Aviation Par. Main RGBW and outer RGB use separate probe cells; program speed may act as sound sensitivity in some modes.",
    sampleResolution: { width: 2, height: 1 },
    zones: [
      { id: "spot-rgb", name: "Spot RGB" },
      { id: "spot-white", name: "Spot white" },
      { id: "outer-ring", name: "Outer ring" },
    ],
  }),
]);

export function createDmxDeviceSettings() {
  return {
    enabled: false,
    refreshRate: 40,
    profiles: BUILT_IN_PROFILES.map(clone),
    fixtures: [],
  };
}

export function normalizeDmxDeviceSettings(value = {}) {
  const source = value?.dmx && typeof value.dmx === "object" ? value.dmx : value;
  const profiles = (Array.isArray(source?.profiles) && source.profiles.length
    ? source.profiles
    : BUILT_IN_PROFILES).map((entry, index) =>
      normalizeDmxFixtureProfile(upgradeBuiltInProfile(entry), index)
    );
  const profileIds = new Set(profiles.map((entry) => entry.id));
  const fixtures = (Array.isArray(source?.fixtures) ? source.fixtures : [])
    .map((entry, index) => normalizeDmxFixture(entry, index, profiles))
    .filter((entry) => profileIds.has(entry.profileId));
  return {
    enabled: source?.enabled === true,
    refreshRate: clampNumber(source?.refreshRate, 20, 40, 40),
    profiles,
    fixtures,
  };
}

export function normalizeDeviceSettings(value = {}) {
  return { dmx: normalizeDmxDeviceSettings(value?.dmx) };
}

export function createDmxFixture(profileId = "dmx-dimmer-rgb", index = 0) {
  return {
    id: `dmx-fixture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Fixture ${index + 1}`,
    profileId,
    startChannel: 1,
    enabled: true,
  };
}

export function normalizeDmxFixtureProfile(value = {}, index = 0) {
  const zones = (Array.isArray(value?.zones) ? value.zones : [])
    .map((entry, zoneIndex) => ({
      id: safeId(entry?.id, `zone-${zoneIndex + 1}`),
      name: String(entry?.name || `Zone ${zoneIndex + 1}`),
    }));
  const zoneIds = new Set(zones.map((entry) => entry.id));
  const normalizedChannels = (Array.isArray(value?.channels) && value.channels.length
    ? value.channels
    : [channel("brightness", "Brightness", "brightness")])
    .slice(0, 512)
    .map((entry, channelIndex) => normalizeDmxFixtureChannel(entry, channelIndex, zoneIds));
  const sampleWidth = Math.max(
    1,
    ...normalizedChannels.map((entry) => entry.sampleCell.x + 1),
  );
  const sampleHeight = Math.max(
    1,
    ...normalizedChannels.map((entry) => entry.sampleCell.y + 1),
  );
  const sampleResolution = {
    width: clampInteger(value?.sampleResolution?.width, 1, 32, sampleWidth),
    height: clampInteger(value?.sampleResolution?.height, 1, 32, sampleHeight),
  };
  const channels = normalizedChannels.map((entry) => ({
    ...entry,
    sampleCell: {
      x: Math.min(sampleResolution.width - 1, entry.sampleCell.x),
      y: Math.min(sampleResolution.height - 1, entry.sampleCell.y),
    },
  }));
  return {
    id: safeId(value?.id, `dmx-profile-${index + 1}`),
    name: String(value?.name || `Fixture profile ${index + 1}`),
    description: String(value?.description || ""),
    zones,
    channels,
    sampleResolution,
  };
}

export function normalizeDmxFixtureChannel(value = {}, index = 0, zoneIds = new Set()) {
  const role = DMX_CHANNEL_ROLES.includes(value?.role) ? value.role : "raw";
  const fallbackFeature = sampleFeatureForRole(role);
  const sampleFeature = DMX_SAMPLE_FEATURES.includes(value?.sampleFeature)
    ? value.sampleFeature
    : fallbackFeature;
  return {
    id: safeId(value?.id, `${role}-${index + 1}`),
    name: String(value?.name || roleLabel(role, index)),
    offset: index,
    role,
    zone: zoneIds.has(String(value?.zone || "")) ? String(value.zone) : "",
    sampleFeature,
    sampleCell: {
      x: clampInteger(value?.sampleCell?.x, 0, 31, 0),
      y: clampInteger(value?.sampleCell?.y, 0, 31, 0),
    },
    defaultValue: clamp01(value?.defaultValue),
    blackoutValue: clamp01(value?.blackoutValue),
  };
}

export function dmxFixtureProfile(settings = {}, fixtureId = "") {
  const normalized = normalizeDmxDeviceSettings(settings);
  const fixture = normalized.fixtures.find((entry) => entry.id === fixtureId) || null;
  const profile = fixture
    ? normalized.profiles.find((entry) => entry.id === fixture.profileId) || null
    : null;
  return { fixture, profile };
}

export function dmxFixtureFootprint(profile = {}) {
  return Math.max(1, (profile?.channels || []).length);
}

export function dmxFixtureEndChannel(fixture = {}, profile = {}) {
  return Math.min(512, Math.max(1, Number(fixture.startChannel) || 1) + dmxFixtureFootprint(profile) - 1);
}

export function dmxFixtureChannelParameterId(channelId = "") {
  return `dmx_${safeId(channelId, "channel").replace(/-/g, "_")}`;
}

export function dmxProbeComponentForState(baseComponent, state = {}, item = {}) {
  if (!baseComponent || baseComponent.id !== DMX_PROBE_VISUAL_ID) return baseComponent;
  const settings = normalizeDmxDeviceSettings(state?.devices?.dmx);
  const requestedFixtureId = String(item?.params?.fixtureId || "");
  const fixtureId = settings.fixtures.some((entry) => entry.id === requestedFixtureId)
    ? requestedFixtureId
    : settings.fixtures[0]?.id || "";
  const { profile } = dmxFixtureProfile(settings, fixtureId);
  const fixtureIds = settings.fixtures.map((entry) => entry.id);
  const fixtureNames = new Map(settings.fixtures.map((entry) => [entry.id, entry.name]));
  const fixtureParam = {
    ...createEnumParam("fixtureId", "Fixture", fixtureIds, fixtureIds.includes(fixtureId) ? fixtureId : fixtureIds[0] || ""),
    optionLabels: fixtureNames,
  };
  const zoneIds = ["all", ...(profile?.zones || []).map((entry) => entry.id)];
  const zoneNames = new Map([
    ["all", "Both / all zones"],
    ...(profile?.zones || []).map((entry) => [entry.id, entry.name]),
  ]);
  const zoneParam = {
    ...createEnumParam(
      "zone",
      "Output zone",
      zoneIds,
      zoneIds.includes(item?.params?.zone) ? item.params.zone : "all",
    ),
    optionLabels: zoneNames,
  };
  const channelParams = (profile?.channels || []).map((entry) => createNumberParam(
    dmxFixtureChannelParameterId(entry.id),
    entry.name,
    {
      min: 0,
      max: 1,
      step: 0.01,
      defaultValue: entry.defaultValue,
    },
  ));
  return Object.freeze({
    ...baseComponent,
    params: Object.freeze([
      fixtureParam,
      ...(zoneIds.length > 1 ? [zoneParam] : []),
      ...channelParams,
      ...baseComponent.params.filter((entry) => !["fixtureId", "zone"].includes(entry.id)),
    ]),
    primaryParamIds: Object.freeze([
      "fixtureId",
      ...(zoneIds.length > 1 ? ["zone"] : []),
      ...channelParams.map((entry) => entry.id),
      "mode",
    ]),
    detailParamIds: Object.freeze([]),
  });
}

export function dmxProbeFixtureValues(item = {}, profile = {}, samples = []) {
  const mode = item?.params?.mode === "control" ? "control" : "canvas";
  const zoneIds = new Set((profile?.zones || []).map((entry) => entry.id));
  const selectedZone = zoneIds.has(String(item?.params?.zone || ""))
    ? String(item.params.zone)
    : "all";
  const fallbackSample = samples[0] || {};
  return Object.fromEntries((profile?.channels || []).flatMap((entry) => {
    if (selectedZone !== "all" && entry.zone && entry.zone !== selectedZone) {
      return [];
    }
    const authored = clamp01(item?.params?.[dmxFixtureChannelParameterId(entry.id)] ?? entry.defaultValue);
    if (mode === "control" || entry.sampleFeature === "none") return [[entry.id, authored]];
    const width = Math.max(1, Number(profile?.sampleResolution?.width) || 1);
    const sampleIndex = selectedZone === "all"
      ? entry.sampleCell.y * width + entry.sampleCell.x
      : 0;
    const sampled = samples[sampleIndex] || fallbackSample;
    return [[entry.id, clamp01(sampled?.[entry.sampleFeature] ?? authored)]];
  }));
}

export function dmxProbeSampleResolution(item = {}, profile = {}) {
  const zoneIds = new Set((profile?.zones || []).map((entry) => entry.id));
  return zoneIds.has(String(item?.params?.zone || ""))
    ? { width: 1, height: 1 }
    : profile?.sampleResolution || { width: 1, height: 1 };
}

export function writeDmxFixtureValues(frame, fixture = {}, profile = {}, values = {}, blackout = false) {
  if (!(frame instanceof Uint8Array) || fixture?.enabled === false) return frame;
  const start = clampInteger(fixture.startChannel, 1, 512, 1) - 1;
  for (const entry of profile?.channels || []) {
    const index = start + entry.offset;
    if (index < 0 || index >= frame.length) continue;
    const unit = blackout ? entry.blackoutValue : clamp01(values?.[entry.id] ?? entry.defaultValue);
    frame[index] = Math.round(unit * 255);
  }
  return frame;
}

export function dmxPatchWarnings(settings = {}) {
  const normalized = normalizeDmxDeviceSettings(settings);
  const occupied = new Map();
  const warnings = [];
  for (const fixture of normalized.fixtures) {
    const profile = normalized.profiles.find((entry) => entry.id === fixture.profileId);
    if (!profile) continue;
    const end = Number(fixture.startChannel) + dmxFixtureFootprint(profile) - 1;
    if (end > 512) warnings.push(`${fixture.name} exceeds channel 512.`);
    for (let channelNumber = fixture.startChannel; channelNumber <= Math.min(512, end); channelNumber++) {
      const previous = occupied.get(channelNumber);
      if (previous) warnings.push(`${fixture.name} overlaps ${previous} at channel ${channelNumber}.`);
      else occupied.set(channelNumber, fixture.name);
    }
  }
  return [...new Set(warnings)];
}

export function dmxUniverseLength(settings = {}) {
  const normalized = normalizeDmxDeviceSettings(settings);
  return Math.max(1, ...normalized.fixtures.map((fixture) => {
    const profile = normalized.profiles.find((entry) => entry.id === fixture.profileId);
    return profile ? dmxFixtureEndChannel(fixture, profile) : 1;
  }));
}

function profile(id, name, channels, additions = {}) {
  return normalizeDmxFixtureProfile({ id, name, channels, ...additions });
}

function upgradeBuiltInProfile(value = {}) {
  const canonical = BUILT_IN_PROFILES.find((entry) => entry.id === value?.id);
  if (!canonical || value === canonical) return value;
  const authoredChannels = Array.isArray(value?.channels) ? value.channels : [];
  const canonicalById = new Map(canonical.channels.map((entry) => [entry.id, entry]));
  const carriesCurrentChannelIds = canonical.channels.every((entry) =>
    authoredChannels.some((candidate) => candidate?.id === entry.id)
  );
  if (!carriesCurrentChannelIds) return clone(canonical);
  return {
    ...value,
    zones: Array.isArray(value.zones) && value.zones.length
      ? value.zones
      : clone(canonical.zones),
    sampleResolution: value.sampleResolution || clone(canonical.sampleResolution),
    channels: authoredChannels.map((entry) => {
      const canonicalChannel = canonicalById.get(entry?.id);
      return canonicalChannel && !entry?.zone
        ? { ...entry, zone: canonicalChannel.zone }
        : entry;
    }),
  };
}

function channel(id, name, role, additions = {}) {
  return { id, name, role, ...additions };
}

function sampleFeatureForRole(role) {
  if (role === "red") return "r";
  if (role === "green") return "g";
  if (role === "blue") return "b";
  if (role === "brightness" || role === "white") return "brightness";
  return "none";
}

function roleLabel(role, index) {
  return role === "raw" ? `Channel ${index + 1}` : `${role[0].toUpperCase()}${role.slice(1)}`;
}

function normalizeDmxFixture(value = {}, index = 0, profiles = BUILT_IN_PROFILES) {
  const fallbackProfileId = profiles[0]?.id || "";
  return {
    id: safeId(value?.id, `dmx-fixture-${index + 1}`),
    name: String(value?.name || `Fixture ${index + 1}`),
    profileId: profiles.some((entry) => entry.id === value?.profileId) ? value.profileId : fallbackProfileId,
    startChannel: clampInteger(value?.startChannel, 1, 512, 1),
    enabled: value?.enabled !== false,
  };
}

function safeId(value, fallback) {
  const id = String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return id || fallback;
}

function clamp01(value) {
  const number = Number(value);
  return Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
