export function createCommandConsoleService({
  fields,
  getClient,
  logLine,
} = {}) {
  async function sendRaw() {
    try {
      const line = fields.raw.value.trim();
      const parsed = JSON.parse(line);
      const client = getClient();
      if (client?.canUseMsgPack?.(parsed?.name) && parsed?.type === "cmd" && parsed.name) {
        const data = { ...(parsed.data || {}) };
        for (const [key, value] of Object.entries(parsed)) {
          if (!["type", "id", "name", "data"].includes(key)) data[key] = value;
        }
        await sendCommand(parsed.name, data, { encoding: "msgpack" });
        logLine("debug", `> ${parsed.name} msgpack`);
        return;
      }
      await client?.sendRaw(line);
      logLine("debug", `> ${line}`);
    } catch (error) {
      logLine("error", error.message);
    }
  }

  async function sendCommand(name, data = {}, options = {}) {
    const client = getClient();
    if (!client) throw new Error("No device connection");
    const { quiet = false, ...requestOptions } = options;
    try {
      const encoding = client.preferredEncoding(name, requestOptions);
      const response = await client.request(name, data, requestOptions);
      if (encoding === "msgpack" && !quiet) logLine("debug", `< ${name} msgpack ok`);
      if (!quiet) logLine("debug", `< ${name} ok`);
      return response;
    } catch (error) {
      if (error.code === "request_canceled") throw error;
      if (!quiet) logLine("error", `${name}: ${error.message}`);
      throw error;
    }
  }

  return {
    sendCommand,
    sendRaw,
  };
}
