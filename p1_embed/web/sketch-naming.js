export function createSketchNaming({ normalizeSketchName } = {}) {
  function autoSketchName(code, history = []) {
    const base = inferSketchBaseName(code);
    const existing = history.some((item) => normalizeSketchName(item?.name || "").toLowerCase() === base.toLowerCase());
    return existing ? nextSketchVersionName(base, history) : base;
  }

  function inferSketchBaseName(code) {
    const source = String(code || "");
    const uiTitle = source.match(/\buiBegin\s*\(\s*["']([^"']{2,48})["']/);
    if (uiTitle) return normalizeSketchName(uiTitle[1]) || "Untitled Sketch";

    const printReady = source.match(/\bprintln\s*\(\s*["']([^"']{2,48}?\bready)\b[^"']*["']/i);
    if (printReady) {
      const name = wordsToSketchName(printReady[1].replace(/\bready\b/i, ""));
      if (isMeaningfulAutoSketchName(name)) return name;
    }

    const comment = source.match(/^\s*\/\/\s*([^\n.]{4,90})/m);
    if (comment) {
      const name = wordsToSketchName(comment[1]);
      if (isMeaningfulAutoSketchName(name)) return name;
    }

    if (/\bfetchJson\b|\bgetJsonValue\b|\bhttpGet\b|openweathermap|weather/i.test(source)) return uniqueGenericName("Weather LEDs");
    if (/\bui(Button|Toggle|Slider|Value|Graph|Begin)\b/.test(source)) return uniqueGenericName("UI Controls");
    if (/\bledSetHsv\b|rainbow|hsv|sparkle|chase/i.test(source)) return uniqueGenericName("LED Animation");
    if (/\bledConfig\b|\bledFill\b|\bledSet\b/.test(source)) return uniqueGenericName("LED Sketch");
    if (/\bdigitalRead\b|INPUT_PULLUP|button/i.test(source)) return uniqueGenericName("Button Input");
    if (/\banalogRead\b|sensor|pot/i.test(source)) return uniqueGenericName("Sensor Read");
    return generatedSketchName(source);
  }

  function uniqueGenericName(name) {
    return normalizeSketchName(name) || "Untitled Sketch";
  }

  function wordsToSketchName(text) {
    const stop = new Set(["a", "an", "and", "around", "by", "for", "from", "of", "on", "the", "to", "with", "shows", "show", "simple", "using"]);
    const words = String(text || "")
      .replace(/[_/.-]+/g, " ")
      .replace(/[^\w ]+/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .filter((word) => !stop.has(word.toLowerCase()))
      .slice(0, 4);
    if (!words.length) return "";
    return normalizeSketchName(words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" "));
  }

  function isMeaningfulAutoSketchName(name) {
    const normalized = normalizeSketchName(name).toLowerCase();
    if (!normalized) return false;
    return ![
      "new sketch",
      "new xobit sketch",
      "xobit sketch",
      "sketch",
      "untitled sketch",
    ].includes(normalized);
  }

  function generatedSketchName(code) {
    const syllables = [
      "ba", "be", "bo", "da", "de", "do", "fa", "fe", "fi", "go", "la", "le",
      "li", "lo", "ma", "me", "mi", "na", "ne", "no", "ra", "re", "ri", "sa",
      "se", "so", "ta", "te", "to", "va", "ve", "vi", "za", "ze", "zo",
    ];
    let hash = 0x811c9dc5;
    const bytes = new TextEncoder().encode(String(code || `${Date.now()}`));
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    const makeWord = (count) => {
      let word = "";
      for (let i = 0; i < count; i += 1) {
        hash = Math.imul(hash ^ (i + 17), 0x01000193) >>> 0;
        word += syllables[hash % syllables.length];
      }
      return word[0].toUpperCase() + word.slice(1);
    };
    return normalizeSketchName(`${makeWord(4)} ${makeWord(3)}`);
  }

  function nextSketchVersionName(name, history = []) {
    const parts = splitSketchVersion(name);
    if (!parts.base) return "";
    let maxVersion = parts.version;
    history.forEach((item) => {
      const itemParts = splitSketchVersion(item?.name || "");
      if (itemParts.base.toLowerCase() === parts.base.toLowerCase()) {
        maxVersion = Math.max(maxVersion, itemParts.version);
      }
    });
    return formatSketchVersion(parts.base, maxVersion + 1);
  }

  function splitSketchVersion(name) {
    const normalized = normalizeSketchName(name);
    const match = normalized.match(/^(.*?)\s+v(\d+)$/i);
    if (!match) return { base: normalized, version: normalized ? 1 : 0 };
    const base = normalizeSketchName(match[1]);
    const version = Math.max(1, Number(match[2]) || 1);
    return { base, version };
  }

  function formatSketchVersion(base, version) {
    const suffix = ` v${version}`;
    const room = Math.max(1, 32 - suffix.length);
    return normalizeSketchName(`${normalizeSketchName(base).slice(0, room).trim()}${suffix}`);
  }

  return {
    autoSketchName,
    formatSketchVersion,
    generatedSketchName,
    inferSketchBaseName,
    isMeaningfulAutoSketchName,
    nextSketchVersionName,
    splitSketchVersion,
    wordsToSketchName,
  };
}
