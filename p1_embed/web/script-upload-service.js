import {
  chunkBytesForWebRtc,
  chunkScriptForWebRtc,
  fnv1aHex,
  uploadChunkPauseMs,
  uploadTextChunkEnvelopeBytes,
} from "./script-chunking.js?v=0.1.87-ui587";

export function createScriptUploadService({
  getEditorValue,
  getTransport,
  saveActiveRevisionFromEditor,
  openRevision,
  getUploadStatusController,
  getGuinoController,
  setUploadState,
  uploadErrorLabel,
  clearEditorError,
  markEditorError,
  persistProjectMetadataToDevice,
  updateScriptState,
  refreshStatus,
  sendCommand,
  settle,
  logLine,
  isMqttKind,
  isBinaryTransportKind,
  onSuccessfulUpload,
} = {}) {
  async function setScript({ run, save }) {
    await uploadScriptCode(getEditorValue(), { run, save });
  }

  async function uploadScriptCode(code, { run, save, name = "" }) {
    let data;
    if (String(code ?? "") !== getEditorValue()) {
      throw new Error("Upload refused because requested code does not match the editor");
    }
    const savedState = await saveActiveRevisionFromEditor({ source: "upload", nameHint: name, updateInterface: false });
    await openRevision(savedState.project, savedState.revision, { saveCurrent: false });
    getUploadStatusController().markLocalActive();
    getGuinoController().clear();
    setUploadState("uploading", "Uploading code", 8);
    try {
      clearEditorError();
      data = await uploadScriptCodeChunked(code, { run, save });
    } catch (error) {
      setUploadState("error", uploadErrorLabel(error.message), 100, { autoClear: true });
      markEditorError(error.message);
      throw error;
    }
    onSuccessfulUpload?.();
    await persistProjectMetadataToDevice(savedState.project, savedState.revision);
    updateScriptState(data);
    try {
      await refreshStatus({ quiet: true, timeoutMs: 8000 });
    } catch {
      // Status events arrive periodically; a missed post-upload poll should not
      // look like a failed upload when the script is already running.
    }
  }

  async function uploadScriptCodeChunked(code, { run, save }) {
    const transport = getTransport();
    const encoder = new TextEncoder();
    const codeData = encoder.encode(code);
    const codeBytes = codeData.length;
    const codeHash = fnv1aHex(code);
    const binaryChunkSize = isMqttKind(transport?.kind) ? 3000 : 320;
    const textChunkSize = uploadTextChunkEnvelopeBytes(transport?.kind);
    const chunkPauseMs = uploadChunkPauseMs(transport?.kind, isMqttKind);
    const chunks = isBinaryTransportKind(transport?.kind) && transport?.sendBytes
      ? chunkBytesForWebRtc(codeData, binaryChunkSize)
      : chunkScriptForWebRtc(code, textChunkSize);
    setUploadState("uploading", "Uploading code", 5);
    logLine("debug", `uploading script in ${chunks.length} chunks`);
    await sendCommand("script.chunk.begin", {
      codeBytes,
      codeHash,
      run,
      save,
    }, { quiet: true, timeoutMs: 10000 });

    let offset = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const isBinaryChunk = chunk instanceof Uint8Array;
      const response = await sendCommand("script.chunk.add", isBinaryChunk ? {
        offset,
        chunkBytes: chunk,
      } : {
        offset,
        chunk,
      }, { quiet: true, timeoutMs: 10000 });
      const received = Number(response.received);
      offset = Number.isFinite(received) ? received : offset + (isBinaryChunk ? chunk.length : encoder.encode(chunk).length);
      setUploadState("uploading", `Uploading ${index + 1}/${chunks.length}`, Math.round(((index + 1) / chunks.length) * 82));
      if (chunkPauseMs > 0) await settle(chunkPauseMs);
    }

    setUploadState("uploading", "Finalizing upload", 88);
    const response = await sendCommand("script.chunk.commit", {}, { timeoutMs: 10000 });
    if (response.state === "queued") {
      logLine("debug", "script upload received; queued on device");
      setUploadState("queued", "Upload received", 90);
      updateScriptState({ state: "queued", scriptBytes: response.scriptBytes });
    } else {
      logLine("debug", "script upload complete");
      setUploadState(run ? "running" : "saved", run ? "Running" : "Saved", 100, { autoClear: true });
    }
    return response;
  }

  return {
    setScript,
    uploadScriptCode,
    uploadScriptCodeChunked,
  };
}
