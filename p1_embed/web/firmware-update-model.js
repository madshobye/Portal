export function firmwareCurrentVersion({ lastInfo = null, lastStatus = null } = {}) {
  return String(lastInfo?.firmwareVersion || lastStatus?.firmwareVersion || "").trim();
}

export function compareFirmwareVersions(left, right) {
  const a = String(left || "").split(".").map((part) => Number(part.replace(/\D+.*$/, "")));
  const b = String(right || "").split(".").map((part) => Number(part.replace(/\D+.*$/, "")));
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta) return delta;
  }
  return String(left || "").localeCompare(String(right || ""));
}

export function directFirmwareDeltaFor(manifest, currentVersion) {
  const deltas = Array.isArray(manifest?.deltas) ? manifest.deltas : [];
  const latest = String(manifest?.latest || "").trim();
  const candidates = deltas
    .filter((delta) => String(delta?.fromVersion || "").trim() === currentVersion)
    .filter((delta) => String(delta?.toVersion || "").trim())
    .sort((a, b) => compareFirmwareVersions(a.toVersion, b.toVersion));
  if (!candidates.length) return null;
  return candidates.find((delta) => String(delta.toVersion) === latest) || candidates[0];
}

export function firmwareUpdateCandidateFor({ manifest, currentVersion } = {}) {
  const latest = String(manifest?.latest || "").trim();
  if (!currentVersion || !latest || currentVersion === latest) return null;
  const delta = directFirmwareDeltaFor(manifest, currentVersion);
  if (!delta) return null;
  return {
    currentVersion,
    targetVersion: String(delta.toVersion || "").trim(),
    latestVersion: latest,
    delta,
  };
}

export function firmwarePanelState({
  connected,
  manifest,
  manifestLabel,
  currentVersion,
  candidate,
  formatBytes,
} = {}) {
  const latest = String(manifest?.latest || "").trim();
  if (!connected) {
    return {
      summary: "Connect a board to check OTA updates.",
      detail: latest ? `Latest release manifest: ${latest}` : "Release manifest not loaded.",
    };
  }
  if (!manifest) {
    return {
      summary: "Firmware release manifest is not loaded.",
      detail: manifestLabel,
    };
  }
  if (!currentVersion) {
    return {
      summary: "The connected board did not report a firmware version.",
      detail: "OTA is available only when the board reports an exact version.",
    };
  }
  if (currentVersion === latest) {
    return {
      summary: `Firmware ${currentVersion} is current.`,
      detail: "No delta update needed.",
    };
  }
  if (candidate) {
    const { targetVersion, latestVersion, delta } = candidate;
    const step = targetVersion === latestVersion ? "latest" : `next step toward ${latestVersion}`;
    return {
      summary: `Update ${currentVersion} -> ${targetVersion}`,
      detail: `${step} / ${formatBytes(delta.size || 0)} patch`,
    };
  }
  return {
    summary: `No delta update for firmware ${currentVersion}.`,
    detail: latest ? `Latest release: ${latest}. Use USB install if this board needs to jump versions.` : "",
  };
}

export function firmwareManifestUrl(value, baseUrl = window.location.href) {
  const text = String(value || "").trim();
  if (!text) return "";
  return new URL(text, baseUrl).toString();
}

export async function firmwareUpdatePayload(candidate, { baseUrl, fetchJson } = {}) {
  const delta = candidate.delta || {};
  let payload = {};
  let payloadBase = baseUrl;
  const prepareUrl = firmwareManifestUrl(delta.prepareUrl, baseUrl);
  if (prepareUrl) {
    payload = await fetchJson(prepareUrl);
    payloadBase = prepareUrl;
  }

  const url = firmwareManifestUrl(delta.absoluteUrl || payload.url || delta.url, payloadBase);
  return {
    kind: payload.kind || delta.kind || "delta",
    url,
    sha256: payload.sha256 || delta.sha256 || "",
    fromSha256: payload.fromSha256 || delta.fromSha256 || "",
    toSha256: payload.toSha256 || delta.toSha256 || "",
    fromSize: Number(payload.fromSize || delta.fromSize || 0),
    toSize: Number(payload.toSize || delta.toSize || 0),
    memorySize: Number(payload.memorySize || delta.memorySize || 0),
    segmentSize: Number(payload.segmentSize || delta.segmentSize || 0),
    reboot: true,
  };
}

export function firmwareUpdateFailureMessage(status = {}) {
  const phase = String(status.phase || "").trim();
  const lastError = String(status.lastError || "").trim();
  if (!lastError) return "";
  if (phase && !/fail|error/i.test(phase)) return "";
  return phase ? `${phase}: ${lastError}` : lastError;
}
