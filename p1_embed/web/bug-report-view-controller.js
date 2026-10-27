import { filesFromDrop, messageText, messageTime, normalizeBugReport, recoverReportChat, reportsToMarkdown, reportText, revisionChat } from "./bug-report-model.js?v=0.1.87-ui762";

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(text, action, className = "button compact") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function dateLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.valueOf()) ? date.toLocaleString() : "Date not recorded";
}

function codeBlock(value) {
  return element("pre", reportText(value, "Not recorded"), "report-code");
}

// A small Markdown subset rendered with text nodes only. Imported reports
// cannot inject HTML, scripts, images, or active links.
function inlineText(node, text) {
  for (const part of text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)) {
    if (part.startsWith("`") && part.endsWith("`")) node.append(element("code", part.slice(1, -1)));
    else if (part.startsWith("**") && part.endsWith("**")) node.append(element("strong", part.slice(2, -2)));
    else node.append(document.createTextNode(part));
  }
}

function formattedText(text) {
  const body = element("div", "", "report-prose");
  let paragraph = [];
  let fence = "";
  let code = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) {
      const p = element("p");
      inlineText(p, paragraph.join("\n"));
      body.append(p);
      paragraph = [];
    }
  };
  for (const line of reportText(text).split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) {
        body.append(codeBlock(code.join("\n")));
        fence = ""; code = [];
      } else code.push(line);
      continue;
    }
    if (marker) { flush(); list = null; fence = marker[1]; continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    if (heading) {
      flush(); list = null;
      const h = element("h3"); inlineText(h, heading[1]); body.append(h);
    } else if (item) {
      flush();
      const tag = /^\s*\d+\./.test(line) ? "OL" : "UL";
      if (!list || list.tagName !== tag) { list = element(tag.toLowerCase()); body.append(list); }
      const li = element("li"); inlineText(li, item[1]); list.append(li);
    } else if (!line.trim()) {
      flush(); list = null;
    } else {
      list = null; paragraph.push(line);
    }
  }
  flush();
  if (fence) body.append(codeBlock(code.join("\n")));
  return body;
}

function disclosure(title, value) {
  const details = element("details", "", "report-disclosure");
  details.append(element("summary", title), codeBlock(value));
  return details;
}

export function createBugReportViewController({ dropZone, fileInput, summary, content, logLine } = {}) {
  let bound = false;
  let reports = [];
  let selected = 0;
  let tab = "Chat";
  let recoverEarlier = true;
  let importQueue = Promise.resolve();
  let importGeneration = 0;
  const fingerprints = new Set();
  let status;
  let folderInput;
  let reportList;
  let revisionList;
  let detail;
  let exportSelected;
  let exportAll;
  let exportHtml;

  function bind() {
    if (bound) return;
    bound = true;
    fileInput.multiple = true;
    dropZone.addEventListener("dragover", (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
      const captured = filesFromDrop(event.dataTransfer);
      enqueue(() => captured);
    });
    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files || []).map((file) => ({ file, path: file.name }));
      fileInput.value = "";
      enqueue(async () => ({ files, errors: [] }));
    });
    summary.replaceChildren();
    const controls = element("div", "", "report-import-controls");
    folderInput = element("input");
    folderInput.type = "file";
    folderInput.multiple = true;
    folderInput.setAttribute("webkitdirectory", "");
    folderInput.hidden = true;
    folderInput.addEventListener("change", () => {
      const files = Array.from(folderInput.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
      folderInput.value = "";
      enqueue(async () => ({ files, errors: [] }));
    });
    exportSelected = button("Download report .md", () => download([reports[selected]]));
    exportAll = button("Download all .md", () => download(reports));
    exportHtml = button("Open all as clean HTML", openCleanHtml);
    controls.append(button("Choose folder", () => folderInput.click()), folderInput,
      exportSelected, exportAll, exportHtml, button("Clear reports", () => {
        importGeneration++;
        reports = []; fingerprints.clear(); selected = 0; status.textContent = ""; render();
      }));
    status = element("p", "", "report-import-status");
    status.setAttribute("role", "status");
    summary.append(controls, status);
    content.replaceChildren();
    const sidebar = element("aside", "", "report-sidebar");
    sidebar.setAttribute("aria-label", "Reports and revisions");
    reportList = element("div", "", "report-list");
    revisionList = element("div", "", "report-revision-list");
    sidebar.append(element("h2", "Reports"), reportList, element("h2", "Revisions"), revisionList);
    detail = element("section", "", "report-detail");
    detail.setAttribute("aria-label", "Selected revision");
    content.append(sidebar, detail);
    render();
  }

  function enqueue(readFiles) {
    const generation = importGeneration;
    importQueue = importQueue.then(async () => {
      if (generation !== importGeneration) return;
      status.textContent = "Reading reports…";
      try {
        const { files, errors = [] } = await readFiles();
        if (generation !== importGeneration) return;
        let loaded = 0;
        let skipped = 0;
        let duplicates = 0;
        const firstNew = reports.length;
        for (const { file, path } of files) {
          if (!/\.json$/i.test(file.name)) { skipped++; continue; }
          try {
            const text = await file.text();
            if (generation !== importGeneration) return;
            if (fingerprints.has(text)) { duplicates++; continue; }
            const report = normalizeBugReport(JSON.parse(text), path);
            reports.push(report);
            fingerprints.add(text);
            loaded++;
          } catch (error) {
            errors.push(`${path}: ${error.message || error}`);
          }
        }
        if (loaded) selected = firstNew;
        status.textContent = `${loaded} loaded · ${duplicates} duplicates skipped · ${skipped} non-JSON files skipped${errors.length ? ` · ${errors.length} could not be read:\n${errors.join("\n")}` : ""}`;
        if (!files.length && !errors.length) status.textContent = "No files found. Try Choose folder or select JSON files.";
        render();
      } catch (error) {
        if (generation !== importGeneration) return;
        status.textContent = `Could not read files: ${error.message || error}`;
        logLine?.("error", status.textContent);
      }
    });
    return importQueue;
  }

  function render() {
    const reportScroll = reportList.scrollTop;
    const revisionScroll = revisionList.scrollTop;
    exportSelected.disabled = !reports.length;
    exportAll.disabled = !reports.length;
    exportHtml.disabled = !reports.length;
    reportList.replaceChildren();
    revisionList.replaceChildren();
    reports.forEach((report, index) => {
      const item = button("", () => { selected = index; render(); }, "report-list-button");
      item.setAttribute("aria-pressed", String(index === selected));
      item.append(element("strong", report.name),
        element("span", `${report.revisions.length} revisions · ${dateLabel(report.createdAt)}`),
        element("small", report.filename));
      reportList.append(item);
    });
    const report = reports[selected];
    if (report) {
      report.revisions.forEach((revision, index) => {
        const item = button("", () => { report.selectedIndex = index; render(); }, "report-list-button");
        item.setAttribute("aria-pressed", String(index === report.selectedIndex));
        item.append(element("strong", `${index + 1}. ${revision.name || "Untitled revision"}`),
          element("span", dateLabel(revision.createdAt)));
        if (index === report.activeIndex) item.append(element("small", "Active at capture", "report-active-badge"));
        revisionList.append(item);
      });
      if (!report.revisions.length) revisionList.append(element("p", "No revisions in this report."));
    } else reportList.append(element("p", "No reports loaded."));
    reportList.scrollTop = reportScroll;
    revisionList.scrollTop = revisionScroll;
    renderDetail();
  }

  function renderDetail() {
    detail.replaceChildren();
    const report = reports[selected];
    if (!report) {
      detail.append(element("h2", "Read a project’s conversation"),
        element("p", "Drop reports or a folder above. Choose a report and revision to read its chat, specification, code, or diagnostics."),
        element("p", "Files stay in this browser. Loading a report does not change your project or send anything to a board."));
      return;
    }
    const revision = report.revisions[report.selectedIndex] || {};
    const header = element("header", "", "report-detail-header");
    header.append(element("h2", revision.name || report.name),
      element("p", `${report.name} · ${dateLabel(revision.createdAt || report.createdAt)} · ${revisionChat(revision).length} messages`));
    const pager = element("div", "", "report-pager");
    const previous = button("← Previous", () => { report.selectedIndex--; render(); });
    const next = button("Next →", () => { report.selectedIndex++; render(); });
    previous.disabled = report.selectedIndex <= 0;
    next.disabled = report.selectedIndex >= report.revisions.length - 1;
    pager.append(previous, element("span", `${Math.max(0, report.selectedIndex + 1)} / ${report.revisions.length}`), next);
    header.append(pager);
    const tabs = element("nav", "", "report-tabs");
    tabs.setAttribute("aria-label", "Revision sections");
    for (const name of ["Prompts and specification", "Chat", "Specification", "Code", "Diagnostics"]) {
      const item = button(name, () => {
        tab = name; renderDetail();
        detail.querySelector(`[data-report-tab="${name}"]`)?.focus();
      });
      item.dataset.reportTab = name;
      item.setAttribute("aria-pressed", String(tab === name));
      tabs.append(item);
    }
    const body = element("div", "", "report-reading-pane");
    body.dataset.reportPane = tab;
    detail.append(header, tabs, body);
    if (tab === "Prompts and specification") {
      const toggle = element("label", "", "report-history-toggle");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = recoverEarlier;
      checkbox.addEventListener("change", () => {
        recoverEarlier = checkbox.checked;
        renderDetail();
        detail.querySelector(".report-history-toggle input")?.focus();
      });
      toggle.append(checkbox, document.createTextNode("Recover earlier prompts from matching transcripts"));
      body.append(toggle);
      const history = recoverEarlier ? recoverReportChat(report, report.selectedIndex)
        : { messages: revisionChat(revision), sources: [], ambiguous: false };
      let explanation = "Showing prompts saved in this revision.";
      if (recoverEarlier) {
        explanation = history.sources.length
          ? `Earlier context recovered from matching message text and timestamps in: ${history.sources.map((index) => report.revisions[index].name || "Untitled revision").join(", ")}. This is transcript overlap, not confirmed revision ancestry.`
          : "No additional earlier context could be recovered from matching transcripts. Revision numbers are not used as parent links.";
        if (history.ambiguous) explanation += " Conflicting histories were found; recovery stopped before combining them.";
        explanation += " Prompts absent from all saved transcripts cannot be recovered.";
      }
      body.append(element("p", explanation, "report-help"));
      const columns = element("div", "", "report-prompt-spec");
      const prompts = element("section", "", "report-prompts");
      prompts.setAttribute("aria-label", "User prompts");
      const users = history.messages.filter((message) => (message?.role || message?.type) === "user");
      prompts.append(element("h3", `User prompts (${users.length})`));
      if (!users.length) prompts.append(element("p", "No user prompts saved."));
      users.forEach((message) => {
        const card = element("article", "", "report-prompt");
        card.append(element("p", dateLabel(messageTime(message)), "report-prompt-time"),
          formattedText(messageText(message)));
        prompts.append(card);
      });
      const specification = element("section", "", "report-prompt-specification");
      specification.setAttribute("aria-label", "Selected revision specification");
      specification.append(element("h3", revision.name || "Specification"),
        formattedText(revision.specification ?? revision.spec ?? "No specification saved."));
      columns.append(prompts, specification);
      body.append(columns);
    } else if (tab === "Chat") {
      body.append(element("p", "Saved conversation for this revision. Earlier messages may also appear in other revisions.", "report-help"));
      const messages = revisionChat(revision);
      if (!messages.length) body.append(element("p", "No chat saved for this revision."));
      messages.forEach((message, index) => {
        const role = message?.role || message?.type || "message";
        const card = element("article", "", `report-message ${role === "user" ? "report-message-user" : role === "error" ? "report-message-error" : ""}`);
        card.append(element("h3", `${index + 1} · ${role === "user" ? "User" : role === "assistant" ? "AI" : role}`));
        const text = messageText(message);
        if (text) card.append(formattedText(text));
        const structured = message?.structured;
        if (structured && typeof structured === "object") {
          if (structured.code) card.append(disclosure("Generated code", structured.code));
          if (structured.notes) card.append(disclosure("Notes", structured.notes));
          if (structured.warnings) card.append(disclosure("Warnings", structured.warnings));
          const rest = Object.fromEntries(Object.entries(structured).filter(([key]) => !["code", "notes", "warnings"].includes(key)));
          if (Object.keys(rest).length) card.append(disclosure("Response details", rest));
        }
        body.append(card);
      });
    } else if (tab === "Specification") {
      body.append(formattedText(revision.specification ?? revision.spec ?? "No specification saved."));
      body.append(disclosure("Circuit data", revision.circuit || {}));
    } else if (tab === "Code") {
      body.append(codeBlock(revision.code || "No code saved."));
    } else {
      body.append(element("h3", "Report description"), formattedText(report.raw.description || "No description provided."),
        element("h3", "Captured state"),
        disclosure("App and interface", { app: report.raw.app, ui: report.raw.ui, ai: report.raw.ai }),
        disclosure("Connection and device", report.raw.connection || {}),
        disclosure("Project and revision details", {
          project: report.project.id, revision: revision.id, source: revision.source,
          createdAt: revision.createdAt, capturedAt: report.createdAt, sourceFile: report.filename,
        }),
        element("h3", "Console log"),
        codeBlock(Array.isArray(report.raw.logs) ? report.raw.logs.map((line) => reportText(line)).join("\n") : report.raw.logs || "No logs saved."));
    }
  }

  function openCleanHtml() {
    if (!reports.length) return;
    const page = window.open("about:blank", "_blank");
    if (!page) {
      status.textContent = "The browser blocked the new page. Allow pop-ups for this site and try again.";
      return;
    }
    page.opener = null;
    const doc = page.document;
    doc.title = "XOBIT prompts and specifications";
    doc.documentElement.lang = "en";
    const style = element("style", `
      body { margin: 32px; font: 11pt Arial, sans-serif; line-height: normal; color: #000; background: #fff; }
      h1 { font-size: 22pt; } h2 { font-size: 17pt; margin-top: 28px; }
      h3 { font-size: 13pt; margin-top: 20px; }
      p { margin: 0 0 6pt; white-space: pre-wrap; overflow-wrap: anywhere; }
      table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 12px 0 24px; }
      th, td { border: 1px solid #999; padding: 12px; vertical-align: top; text-align: left; width: 50%; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 10pt monospace; }
      li { margin-bottom: 3pt; } .prompt-time { font-size: 9pt; color: #555; }
      .context { font-size: 9pt; color: #555; }
      @media print { body { margin: 0; } h2, h3 { break-after: avoid; } }
    `);
    doc.head.append(style);
    const output = element("main");
    output.append(element("h1", "XOBIT prompts and specifications"));
    reports.forEach((report, reportIndex) => {
      output.append(element("h2", `Report ${reportIndex + 1} — ${report.name}`),
        element("p", `Source: ${report.filename}`));
      if (!report.revisions.length) output.append(element("p", "No revisions saved."));
      report.revisions.forEach((revision, index) => {
        output.append(element("h3", `Revision ${index + 1} — ${revision.name || "Untitled revision"}`),
          element("p", `Saved: ${dateLabel(revision.createdAt)}`));
        const history = recoverEarlier ? recoverReportChat(report, index)
          : { messages: revisionChat(revision), sources: [], ambiguous: false };
        if (history.sources.length) {
          output.append(element("p",
            `Earlier prompts recovered from matching transcripts in ${history.sources.map((i) => report.revisions[i].name || "Untitled revision").join(", ")}. Revision ancestry is not confirmed.`,
            "context"));
        }
        if (history.ambiguous) output.append(element("p", "Conflicting histories found; recovery stopped before combining them.", "context"));
        const table = element("table");
        table.setAttribute("border", "1");
        table.setAttribute("cellpadding", "12");
        table.setAttribute("cellspacing", "0");
        const head = element("thead");
        const headings = element("tr");
        for (const title of ["User prompts", "Specification"]) {
          const cell = element("th", title);
          cell.setAttribute("scope", "col");
          headings.append(cell);
        }
        head.append(headings);
        const tbody = element("tbody");
        const row = element("tr");
        const prompts = element("td");
        const specification = element("td");
        // Inline dimensions and alignment also survive copying into Word.
        for (const cell of [prompts, specification]) {
          cell.style.cssText = "width:50%;vertical-align:top;padding:12px;border:1px solid #999;";
        }
        const users = history.messages.filter((message) => (message?.role || message?.type) === "user");
        if (!users.length) prompts.append(element("p", "No user prompts saved."));
        users.forEach((message) => {
          const formatted = formattedText(messageText(message));
          const timestamp = element("span", dateLabel(messageTime(message)), "prompt-time");
          timestamp.style.cssText = "font-size:9pt;color:#555;line-height:normal;";
          // Keep the timestamp and first paragraph together. Nested block
          // wrappers accumulate spacing when pasted into document editors.
          if (formatted.firstElementChild?.tagName === "P") {
            formatted.firstElementChild.prepend(timestamp, element("br"));
          } else {
            const timeParagraph = element("p");
            timeParagraph.append(timestamp);
            formatted.prepend(timeParagraph);
          }
          prompts.append(...formatted.childNodes);
        });
        specification.append(...formattedText(revision.specification ?? revision.spec ?? "No specification saved.").childNodes);
        row.append(prompts, specification);
        tbody.append(row);
        table.append(head, tbody);
        output.append(table);
      });
    });
    // Clipboard importers may discard stylesheet rules. Carry compact paragraph
    // spacing on each block rather than relying on inherited browser defaults.
    output.querySelectorAll("p, li, pre, h1, h2, h3, ul, ol").forEach((block) => {
      block.style.lineHeight = "normal";
      block.style.marginTop = "0";
      block.style.marginBottom = "6pt";
      if (block.tagName === "P") block.style.fontSize = "11pt";
    });
    doc.body.replaceChildren(output);
    status.textContent = "Opened all reports and revisions as clean HTML. In the new tab, select all, copy, and paste into Word with source formatting.";
  }

  function download(selection) {
    if (!selection.length || !selection[0]) return;
    const blob = new Blob([reportsToMarkdown(selection)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    const name = selection.length === 1 ? selection[0].name : "all-reports";
    link.download = `xobit-${name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "report"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderReport(raw, filename = "Report") {
    bind();
    const report = normalizeBugReport(raw, filename);
    reports.push(report);
    selected = reports.length - 1;
    render();
  }

  return { bind, renderReport };
}
