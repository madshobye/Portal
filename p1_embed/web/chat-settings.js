export function createChatSettings({
  storageKeys,
  modelSelect,
  maxOutputTokensInput,
  defaultModel,
  builtInModels,
  defaultMaxOutputTokens = 8000,
  minMaxOutputTokens = 1024,
  hardMaxOutputTokens = 32000,
} = {}) {
  function modelOptions() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKeys.modelList) || "[]");
      if (Array.isArray(stored)) {
        const cleaned = cleanModelList(stored);
        if (cleaned.length) return cleaned;
      }
    } catch {
    }
    return builtInModels.slice();
  }

  function renderModelOptions() {
    const current = modelSelect?.value || localStorage.getItem(storageKeys.model) || defaultModel;
    const options = modelOptions();
    modelSelect.replaceChildren(...options.map((model) => new Option(model, model)));
    if (options.includes(current)) modelSelect.value = current;
  }

  function restoreSelectedModel() {
    const savedModel = localStorage.getItem(storageKeys.model);
    const options = modelOptions();
    modelSelect.value = options.includes(savedModel) ? savedModel : defaultModel;
    if (!modelSelect.value) modelSelect.value = options[0] || "";
  }

  function setSelectedModel(value) {
    localStorage.setItem(storageKeys.model, value);
  }

  function cleanModelList(models = []) {
    const ids = [...new Set(models.map((model) => String(model?.id || model || "").trim()).filter(Boolean))]
      .filter(isSupportedModelId)
      .sort(compareModelIds);
    return ids.length ? ids : [];
  }

  function isSupportedModelId(id = "") {
    if (/\d{4}-\d{2}-\d{2}/.test(id)) return false;
    return /^gpt-(?:5(?:\.\d+)?(?:-(?:mini|nano|pro))?|4\.1(?:-(?:mini|nano))?)$/i.test(id);
  }

  function compareModelIds(a, b) {
    const score = (id) => {
      const version = id.match(/^gpt-(\d+(?:\.\d+)?)/i)?.[1] || "0";
      const [major, minor = "0"] = version.split(".").map(Number);
      const size = id.includes("-nano") ? 0 : id.includes("-mini") ? 1 : id.includes("-pro") ? 3 : 2;
      return major * 10000 + minor * 100 + size;
    };
    return score(b) - score(a) || a.localeCompare(b);
  }

  function storeModelList(models = []) {
    localStorage.setItem(storageKeys.modelList, JSON.stringify(models));
  }

  function ensureSelectedModelInList(models = []) {
    if (models.includes(modelSelect.value)) return;
    modelSelect.value = models.includes(defaultModel) ? defaultModel : models[0];
    localStorage.setItem(storageKeys.model, modelSelect.value);
  }

  function maxOutputTokens() {
    const raw = Number(maxOutputTokensInput?.value || localStorage.getItem(storageKeys.maxOutputTokens));
    if (!Number.isFinite(raw) || raw <= 0) return defaultMaxOutputTokens;
    return Math.max(minMaxOutputTokens, Math.min(hardMaxOutputTokens, Math.round(raw)));
  }

  function restoreMaxOutputTokens() {
    maxOutputTokensInput.value = String(maxOutputTokens());
  }

  function storeMaxOutputTokens(value = maxOutputTokens()) {
    const next = Math.max(minMaxOutputTokens, Math.min(hardMaxOutputTokens, Math.round(Number(value) || defaultMaxOutputTokens)));
    maxOutputTokensInput.value = String(next);
    localStorage.setItem(storageKeys.maxOutputTokens, String(next));
    return next;
  }

  return {
    cleanModelList,
    ensureSelectedModelInList,
    maxOutputTokens,
    modelOptions,
    renderModelOptions,
    restoreMaxOutputTokens,
    restoreSelectedModel,
    setSelectedModel,
    storeMaxOutputTokens,
    storeModelList,
  };
}
