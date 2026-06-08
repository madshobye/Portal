export function createScriptDownloadService({
  getTransport,
  sendCommand,
  applyFetchedScript,
  isMqttKind,
} = {}) {
  async function getScript(options = {}) {
    const data = await getScriptChunked(options);
    await applyFetchedScript(data);
  }

  async function getScriptChunked(options = {}) {
    let offset = 0;
    let code = "";
    let last = {};
    const maxBytes = isMqttKind(getTransport()?.kind) ? 1024 : 512;
    for (let guard = 0; guard < 80; guard += 1) {
      const data = await sendCommand("script.chunk.get", { offset, maxBytes }, options);
      const chunk = String(data.chunk ?? "");
      const nextOffset = Number(data.nextOffset ?? (offset + chunk.length));
      code += chunk;
      last = data;
      if (data.done || nextOffset <= offset) break;
      offset = nextOffset;
    }
    return {
      ...last,
      code,
      stored: true,
    };
  }

  return {
    getScript,
    getScriptChunked,
  };
}
