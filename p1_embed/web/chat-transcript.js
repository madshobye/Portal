export function createChatTranscript({
  transcript,
  hasApiKey,
  messages,
  onRunCode,
} = {}) {
  function render() {
    transcript.replaceChildren();

    if (!hasApiKey()) {
      transcript.append(emptyState("Set an API key to start."));
      return;
    }

    const items = messages();
    if (items.length === 0) {
      transcript.append(emptyState("Ready."));
      return;
    }

    items.forEach((message, index) => {
      transcript.append(renderMessage(message, index));
    });
    transcript.scrollTop = transcript.scrollHeight;
  }

  function emptyState(text) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = text;
    return empty;
  }

  function renderMessage(message, index) {
    const article = document.createElement("article");
    article.className = `chat-message chat-${message.role}`;

    if (message.content) {
      const body = document.createElement("p");
      body.textContent = message.content;
      article.append(body);
    }

    const structured = message.structured || null;
    if (structured?.notes?.length) article.append(renderList("notes", structured.notes));
    if (structured?.warnings?.length) article.append(renderList("warnings", structured.warnings));

    if (structured?.code) {
      article.append(renderCodeTools(index, structured.code));
    }

    return article;
  }

  function renderCodeTools(index, code) {
    const fragment = document.createDocumentFragment();
    const codeHeader = document.createElement("div");
    codeHeader.className = "chat-code-header";
    const toggle = document.createElement("button");
    toggle.className = "button compact icon-buttonish";
    toggle.type = "button";
    toggle.title = "Show code";
    toggle.setAttribute("aria-label", "Show code");
    toggle.innerHTML = '<span class="material-symbols-rounded">code</span>';
    const run = document.createElement("button");
    run.className = "button compact icon-buttonish";
    run.type = "button";
    run.title = "Save and run on board";
    run.setAttribute("aria-label", "Save and run on board");
    run.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
    run.addEventListener("click", () => onRunCode(index));
    codeHeader.append(toggle, run);

    const pre = document.createElement("pre");
    pre.className = "chat-code is-hidden";
    pre.textContent = code;
    toggle.addEventListener("click", () => {
      const hidden = pre.classList.toggle("is-hidden");
      toggle.title = hidden ? "Show code" : "Hide code";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.querySelector(".material-symbols-rounded").textContent = hidden ? "code" : "code_off";
    });
    fragment.append(codeHeader, pre);
    return fragment;
  }

  function renderList(label, values) {
    const wrap = document.createElement("div");
    wrap.className = "chat-list";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const ul = document.createElement("ul");
    values.slice(0, 8).forEach((value) => {
      const li = document.createElement("li");
      li.textContent = String(value);
      ul.append(li);
    });
    wrap.append(strong, ul);
    return wrap;
  }

  return { render };
}
