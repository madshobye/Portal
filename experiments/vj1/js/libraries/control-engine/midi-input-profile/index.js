const MIDIMIX_KNOB_CCS = Object.freeze([
  [16, 20, 24, 28, 46, 50, 54, 58],
  [17, 21, 25, 29, 47, 51, 55, 59],
  [18, 22, 26, 30, 48, 52, 56, 60],
]);
const MIDIMIX_FADER_CCS = Object.freeze([19, 23, 27, 31, 49, 53, 57, 61]);
const MIDIMIX_MUTE_NOTES = Object.freeze([1, 4, 7, 10, 13, 16, 19, 22]);
const MIDIMIX_ARM_NOTES = Object.freeze([3, 6, 9, 12, 15, 18, 21, 24]);

export const AKAI_MIDIMIX_PROFILE_KIND = "akai-midimix";
export const AKAI_MIDIMIX_PROFILE_ID = "midi-akai-midimix";

export function createAkaiMidiMixProfile() {
  return {
    id: AKAI_MIDIMIX_PROFILE_ID,
    kind: AKAI_MIDIMIX_PROFILE_KIND,
    name: "Akai MIDImix",
    enabled: true,
    inputId: "",
    outputId: "",
  };
}

export function normalizeMidiInputSettings(value = {}) {
  const midi = value?.midi && typeof value.midi === "object" ? value.midi : value;
  const profiles = (Array.isArray(midi?.profiles) ? midi.profiles : [])
    .filter((profile) => profile?.kind === AKAI_MIDIMIX_PROFILE_KIND)
    .map((profile) => ({
      ...createAkaiMidiMixProfile(),
      ...profile,
      id: String(profile.id || AKAI_MIDIMIX_PROFILE_ID),
      name: String(profile.name || "Akai MIDImix"),
      enabled: profile.enabled !== false,
      inputId: String(profile.inputId || ""),
      outputId: String(profile.outputId || ""),
    }));
  return { midi: { profiles } };
}

export function midiProfileControls(profile = createAkaiMidiMixProfile()) {
  const prefix = `profile:${String(profile.id || AKAI_MIDIMIX_PROFILE_ID)}`;
  const controls = [];
  for (let row = 0; row < MIDIMIX_KNOB_CCS.length; row++) {
    for (let column = 0; column < 8; column++) {
      controls.push({
        id: `knob-${row + 1}-${column + 1}`,
        label: `${profile.name} · Knob ${row + 1}.${column + 1}`,
        address: `${prefix}/knob/${row + 1}/${column + 1}`,
        message: "cc",
        number: MIDIMIX_KNOB_CCS[row][column],
        trigger: false,
        ...(row === 2 ? { liveSignificantSlot: column } : {}),
      });
    }
  }
  for (let column = 0; column < 8; column++) {
    controls.push({
      id: `fader-${column + 1}`,
      label: `${profile.name} · Fader ${column + 1}`,
      address: `${prefix}/fader/${column + 1}`,
      message: "cc",
      number: MIDIMIX_FADER_CCS[column],
      trigger: false,
    });
  }
  controls.push({
    id: "master",
    label: `${profile.name} · Master fader`,
    address: `${prefix}/master`,
    message: "cc",
    number: 62,
    trigger: false,
  });
  for (let column = 0; column < 8; column++) {
    controls.push({
      id: `scene-${column + 1}`,
      label: `${profile.name} · Scene button ${column + 1}`,
      address: `${prefix}/scene/${column + 1}`,
      message: "note",
      number: MIDIMIX_MUTE_NOTES[column],
      trigger: true,
      liveBank: "scene",
      slot: column,
    });
    controls.push({
      id: `component-${column + 1}`,
      label: `${profile.name} · Component button ${column + 1}`,
      address: `${prefix}/component/${column + 1}`,
      message: "note",
      number: MIDIMIX_ARM_NOTES[column],
      trigger: true,
      liveBank: "component",
      slot: column,
    });
  }
  return controls;
}

export function midiAnimationSources(inputs = {}, { triggers = false } = {}) {
  return normalizeMidiInputSettings(inputs).midi.profiles
    .filter((profile) => profile.enabled)
    .flatMap((profile) => midiProfileControls(profile)
      .filter((control) => triggers ? control.trigger : true)
      .map((control) => ({
        kind: "midi",
        address: control.address,
        label: triggers && control.trigger
          ? `${control.label} pressed`
          : control.label,
      })));
}

export function matchMidiMixControl(profile, decoded) {
  const type = String(decoded?.type || "");
  const number = Number(decoded?.number);
  return midiProfileControls(profile).find((control) =>
    control.message === type && control.number === number
  ) || null;
}

export function midiMixBankNote(direction = "") {
  return direction === "left" ? 25 : direction === "right" ? 26 : -1;
}

export function midiMixLedNotes() {
  return { scenes: MIDIMIX_MUTE_NOTES, components: MIDIMIX_ARM_NOTES };
}
