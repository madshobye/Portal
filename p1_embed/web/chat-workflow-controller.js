export function createChatWorkflowController({
  fields,
  getChatMessages,
  setChatMessages,
  getChatBusy,
  setChatBusy,
  getCurrentProjectDescription,
  getCurrentProjectSpecificationMode,
  hasChatApiKey,
  isDeviceConnected,
  readSpecificationMarkdown,
  shelveEditorSketchIfNeeded,
  captureActiveRevisionContext,
  isCurrentRevisionContext,
  saveChatForRevisionContext,
  saveRevisionFieldsForContext,
  revisionFieldsFromChatResult,
  getProjectById,
  ensureProjectForWrite,
  saveProject,
  openRevision,
  uploadScriptCode,
  requestChatCompletion,
  buildSpecificationGeneratePrompt,
  runUiAction,
  renderChatTranscript,
  setProjectSpecification,
  updateChatEnabledState,
  updateCircuitView,
  logLine,
  activeRevision,
  buildRevision,
  findGeneratedRevisionMatch,
  mergeGeneratedRevision,
  inferCircuitLayout,
  nextRevisionName,
  normalizeChatMessages,
  normalizeProjectRecord,
  normalizeSketchName,
  normalizeSpecificationMode,
} = {}) {
  async function applyChatCode(index) {
    const message = getChatMessages()[index];
    const code = message?.structured?.code;
    if (!code) return;
    await replaceEditorFromChat(
      code,
      "chat code applied to editor",
      message.structured?.sketch_name || "",
      null,
      message.structured?.project_specification || "",
      message.structured?.specification_mode || "",
    );
  }

  async function runChatCode(index) {
    const message = getChatMessages()[index];
    const code = message?.structured?.code;
    if (!code) return;
    await runUiAction(async () => {
      const name = message.structured?.sketch_name || "";
      await replaceEditorFromChat(
        code,
        "chat code prepared",
        name,
        null,
        message.structured?.project_specification || "",
        message.structured?.specification_mode || "",
      );
      await uploadScriptCode(code, { run: true, save: true, name });
      logLine("info", "chat code saved and running");
    }, "uploading");
  }

  async function replaceEditorFromChat(code, message, name = "", layout = null, specification = "", specificationMode = "", {
    allowMerge = true,
    targetContext = null,
  } = {}) {
    if (!targetContext?.projectId || !targetContext?.revisionId) targetContext = null;
    const nextSpecification = String(specification || targetContext?.specification || getCurrentProjectDescription() || "");
    const nextMode = normalizeSpecificationMode(specificationMode || targetContext?.specificationMode || getCurrentProjectSpecificationMode());
    const current = String(code ?? "");
    if (!targetContext || isCurrentRevisionContext(targetContext)) {
      const visibleChatMessages = getChatMessages();
      if (targetContext?.sourceChat) setChatMessages(normalizeChatMessages(targetContext.sourceChat));
      try {
        await shelveEditorSketchIfNeeded({ incomingCode: current });
      } finally {
        setChatMessages(visibleChatMessages);
      }
    }
    let project = targetContext?.projectId ? await getProjectById(targetContext.projectId) : null;
    if (!project) project = await ensureProjectForWrite({ code: current, nameHint: name });
    project = normalizeProjectRecord(project);
    const revision = buildRevision({
      name: normalizeSketchName(name) || nextRevisionName(project),
      code: current,
      specification: nextSpecification,
      specificationMode: nextMode,
      circuit: inferCircuitLayout(current, null),
      chat: targetContext?.chat || getChatMessages(),
      source: "generative",
    });
    const previous = targetContext?.revisionId
      ? project.revisions.find((item) => item.id === targetContext.revisionId)
      : activeRevision(project);
    let saved = project;
    let selected = revision;
    const shouldOpen = !targetContext || isCurrentRevisionContext(targetContext);
    const existing = allowMerge ? findGeneratedRevisionMatch(project, revision, previous) : null;
    if (existing) {
      selected = mergeGeneratedRevision(existing, revision);
      project.revisions = project.revisions.map((item) => item.id === selected.id ? selected : item);
      project.activeRevisionId = selected.id;
      saved = await saveProject(project, { makeActive: shouldOpen });
      selected = saved.revisions.find((item) => item.id === selected.id) || selected;
    } else {
      project.revisions.unshift(revision);
      project.activeRevisionId = revision.id;
      saved = await saveProject(project, { makeActive: shouldOpen });
    }
    if (shouldOpen) {
      await openRevision(saved, selected, { saveCurrent: false });
      setProjectSpecification?.(selected.specification || nextSpecification, selected.specificationMode || nextMode, { markSaved: true });
      updateCircuitView("inferred from code");
    } else {
      logLine("info", `${message}; saved to original revision`);
    }
    if (shouldOpen) logLine("info", message);
    return { project: saved, revision: selected, opened: shouldOpen };
  }

  async function sendChatPrompt() {
    const prompt = fields.chatInput.value.trim();
    if (!prompt || getChatBusy() || !hasChatApiKey()) return;

    await shelveEditorSketchIfNeeded();
    const requestContext = captureActiveRevisionContext();
    if (!requestContext.projectId || !requestContext.revisionId) {
      logLine("warn", "chat response will not be persisted until a revision exists");
    }
    setChatBusy(true);
    setAiSubmitWorking(fields.chatSend, true);
    updateChatEnabledState();
    const userMessage = { role: "user", content: prompt, at: new Date().toISOString() };
    const requestMessages = [...requestContext.chat, userMessage];
    setChatMessages(requestMessages.slice());
    fields.chatInput.value = "";
    renderChatTranscript();

    try {
      const result = await requestChatCompletion(prompt);
      const content = result.reply || "Done.";
      const assistantMessage = {
        role: "assistant",
        content,
        structured: result,
        at: new Date().toISOString(),
      };
      if (result.code_action === "replace" && result.code.trim()) {
        const applied = await replaceEditorFromChat(
          result.code,
          "chat code replaced editor",
          result.sketch_name,
          null,
          result.project_specification,
          result.specification_mode,
          { targetContext: { ...requestContext, chat: requestMessages, sourceChat: requestContext.chat } },
        );
        const finalMessages = [...requestMessages, assistantMessage];
        await saveChatForRevisionContext({
          projectId: applied.project.id,
          revisionId: applied.revision.id,
        }, finalMessages);
        if (applied.opened) setChatMessages(finalMessages);
        if (isDeviceConnected() && applied.opened) {
          await uploadScriptCode(result.code, { run: true, save: true, name: result.sketch_name || "" });
          logLine("info", "chat code deployed");
        } else if (isDeviceConnected()) {
          logLine("info", "chat code saved to original revision; not deployed because active revision changed");
        } else {
          logLine("info", "chat code ready; connect to deploy");
        }
      } else {
        const finalMessages = [...requestMessages, assistantMessage];
        const savedFields = await saveRevisionFieldsForContext(requestContext, revisionFieldsFromChatResult(result, finalMessages));
        if (isCurrentRevisionContext(requestContext)) {
          if (savedFields) await openRevision(savedFields.project, savedFields.revision, { saveCurrent: false });
        }
      }
    } catch (error) {
      const finalMessages = [...requestMessages, { role: "error", content: error.message || String(error), at: new Date().toISOString() }];
      await saveChatForRevisionContext(requestContext, finalMessages);
      if (isCurrentRevisionContext(requestContext)) setChatMessages(finalMessages);
    } finally {
      setChatBusy(false);
      setAiSubmitWorking(fields.chatSend, false);
      renderChatTranscript();
      updateChatEnabledState();
    }
  }

  async function generateCodeFromSpecification() {
    const specification = readSpecificationMarkdown().trim();
    if (!specification || getChatBusy() || !hasChatApiKey()) return;

    await shelveEditorSketchIfNeeded();
    const requestContext = captureActiveRevisionContext();
    setChatBusy(true);
    setAiSubmitWorking(fields.specificationGenerate, true);
    updateChatEnabledState();
    try {
      const result = await requestChatCompletion(buildSpecificationGeneratePrompt(specification), {
        purpose: "specification",
        specification,
        specificationMode: getCurrentProjectSpecificationMode(),
      });
      const assistantMessage = {
        role: "assistant",
        content: result.reply || "Generated from specification.",
        structured: result,
        at: new Date().toISOString(),
      };
      if (result.code.trim()) {
        const name = result.sketch_name || "";
        const generatedSpecification = result.project_specification || specification;
        const applied = await replaceEditorFromChat(
          result.code,
          "generated code from specification",
          name,
          null,
          generatedSpecification,
          result.specification_mode || getCurrentProjectSpecificationMode(),
          { allowMerge: false, targetContext: { ...requestContext, chat: requestContext.chat } },
        );
        await saveChatForRevisionContext({
          projectId: applied.project.id,
          revisionId: applied.revision.id,
        }, [...requestContext.chat, assistantMessage]);
        if (applied.opened) setChatMessages([...requestContext.chat, assistantMessage]);
        if (isDeviceConnected() && applied.opened) {
          await uploadScriptCode(result.code, { run: true, save: true, name });
          logLine("info", "generated code deployed");
        } else if (isDeviceConnected()) {
          logLine("info", "generated code saved to original revision; not deployed because active revision changed");
        } else {
          logLine("info", "generated code ready; connect to deploy");
        }
      } else {
        logLine("warn", "specification generate returned no code");
        const finalMessages = [...requestContext.chat, assistantMessage];
        const savedFields = await saveRevisionFieldsForContext(requestContext, revisionFieldsFromChatResult(result, finalMessages));
        if (isCurrentRevisionContext(requestContext)) {
          if (savedFields) await openRevision(savedFields.project, savedFields.revision, { saveCurrent: false });
        }
      }
      renderChatTranscript();
    } catch (error) {
      const finalMessages = [...requestContext.chat, { role: "error", content: error.message || String(error), at: new Date().toISOString() }];
      await saveChatForRevisionContext(requestContext, finalMessages);
      if (isCurrentRevisionContext(requestContext)) setChatMessages(finalMessages);
      renderChatTranscript();
    } finally {
      setChatBusy(false);
      setAiSubmitWorking(fields.specificationGenerate, false);
      updateChatEnabledState();
    }
  }

  function setAiSubmitWorking(button, working) {
    if (!button) return;
    button.classList.toggle("is-ai-working", Boolean(working));
    button.setAttribute("aria-busy", working ? "true" : "false");
  }

  return {
    applyChatCode,
    generateCodeFromSpecification,
    replaceEditorFromChat,
    runChatCode,
    sendChatPrompt,
    setAiSubmitWorking,
  };
}
