import { extractResponseText, parseChatStructuredText as parseChatStructuredTextFor } from "./chat-response-model.js?v=0.1.87-ui624";
import {
  buildChatRequestPayload,
  buildSpecificationGeneratePrompt as buildSpecificationGeneratePromptFor,
  chatPromptDebugMarkdown,
} from "./chat-prompt-model.js?v=0.1.87-ui624";

export function createChatCompletionService({
  fields,
  fetchRef,
  getApiKey,
  getProjectCache,
  getCurrentProjectId,
  getCurrentSketchName,
  getCurrentProjectDescription,
  getCurrentProjectSpecificationMode,
  getChatMessages,
  getEditorValue,
  getRecentLog,
  getLastError,
  getLastInfo,
  getLastStatus,
  chatMaxOutputTokens,
  chatDebugPromptEnabled,
  activeRevision,
  isGenericRevisionName,
  nextNamedRevisionName,
  normalizeProjectName,
  normalizeSketchName,
  normalizeSpecificationMode,
  specificationModeLabel,
  specificationModePrompt,
  defaultModel,
  chatHistoryLimit,
  downloadText,
} = {}) {
  let wrenchChatContext = "";

  function buildSpecificationGeneratePrompt(specification) {
    return buildSpecificationGeneratePromptFor(specification, {
      specificationMode: getCurrentProjectSpecificationMode(),
      specificationModeLabel,
    });
  }

  async function requestChatCompletion(prompt, options = {}) {
    const apiKey = getApiKey();
    const model = fields.chatModel.value || defaultModel;
    const context = await getWrenchChatContext();
    const purpose = options.purpose || "chat";
    const activeProject = getProjectCache().find((item) => item.id === getCurrentProjectId()) || null;
    const activeProjectRevision = activeRevision(activeProject);
    const rawRevisionName = normalizeSketchName(getCurrentSketchName() || activeProjectRevision?.name || "");
    const currentRevisionName = isGenericRevisionName(rawRevisionName) ? "" : rawRevisionName;
    const namingContext = {
      projectName: normalizeProjectName(activeProject?.name || ""),
      currentRevisionName,
      suggestedSmallIterationName: currentRevisionName
        ? nextNamedRevisionName(activeProject, currentRevisionName)
        : "choose a short descriptive name",
      maxNameChars: 32,
      rule: "Small iterations keep the current base name and increment the trailing number. Larger reframings may use a new short descriptive name.",
    };
    const conversation = purpose === "specification" ? [] : getChatMessages().slice(-chatHistoryLimit).map((message) => ({
      role: message.role,
      content: message.content,
      code: message.structured?.code ? "[code omitted from transcript; current code is provided separately]" : undefined,
    }));
    const {
      body,
      instructions,
      payloadContext,
      userInputText,
    } = buildChatRequestPayload({
      model,
      prompt,
      purpose,
      context,
      currentCode: getEditorValue(),
      recentLog: getRecentLog(),
      lastError: getLastError(),
      deviceInfo: getLastInfo() || {},
      deviceStatus: getLastStatus() || {},
      projectSpecification: options.specification ?? getCurrentProjectDescription(),
      specificationMode: normalizeSpecificationMode(options.specificationMode || getCurrentProjectSpecificationMode()),
      naming: namingContext,
      conversation,
      maxOutputTokens: chatMaxOutputTokens(),
      specificationModeLabel,
      specificationModePrompt,
    });

    if (chatDebugPromptEnabled()) {
      downloadChatPromptDebug({ model, prompt, instructions, userInputText, payloadContext, body });
    }

    const response = await fetchRef("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `OpenAI request failed (${response.status})`);
    }

    const text = extractResponseText(data);
    return parseChatStructuredText(text);
  }

  async function getWrenchChatContext() {
    if (wrenchChatContext) return wrenchChatContext;
    try {
      const response = await fetchRef("wrench_chat_context.md", { cache: "no-cache" });
      wrenchChatContext = await response.text();
    } catch {
      wrenchChatContext = "P1E Wrench context unavailable.";
    }
    return wrenchChatContext;
  }

  function downloadChatPromptDebug({ model, prompt, instructions, userInputText, payloadContext, body }) {
    const md = chatPromptDebugMarkdown({ model, prompt, instructions, userInputText, payloadContext, body });
    downloadText(md, `p1e-chat-prompt-${timestampForFilename()}.md`, "text/markdown;charset=utf-8");
  }

  function timestampForFilename() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  }

  function parseChatStructuredText(text) {
    return parseChatStructuredTextFor(text, {
      currentSpecificationMode: getCurrentProjectSpecificationMode(),
      normalizeSketchName,
      normalizeSpecificationMode,
    });
  }

  return {
    buildSpecificationGeneratePrompt,
    requestChatCompletion,
  };
}
