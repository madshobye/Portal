(() => {
  const script = document.currentScript;
  const guideRoot = new URL(".", script?.src || document.baseURI);
  const editorUrl = new URL("../index.html", guideRoot).href;

  const navItems = [
    ["overview", "Overview", "guide.html"],
    ["first-run", "Getting Started", "first-run.html"],
    ["wrench", "Script", "wrench-language.html"],
    ["modules", "Modules", "modules.html"],
    ["custom-llm", "Own LLM", "custom-llm.html"],
    ["security", "Security", "security.html"],
    ["system-log", "Change Log", "system-log.html"],
    ["about", "About", "about.html"]
  ];

  function activeSection() {
    if (document.body.dataset.guideSection) return document.body.dataset.guideSection;
    const name = location.pathname.split("/").pop();
    if (name === "first-run.html") return "first-run";
    if (name === "wrench-language.html") return "wrench";
    if (name === "custom-llm.html") return "custom-llm";
    if (name === "security.html") return "security";
    if (name === "system-log.html") return "system-log";
    if (name === "about.html") return "about";
    if (location.pathname.includes("/modules/")) return "modules";
    return "overview";
  }

  function guideUrl(path) {
    return new URL(path, guideRoot).href;
  }

  function installHeader() {
    document.querySelector(".topbar")?.remove();
    const section = activeSection();
    const header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML = `
      <div class="brand"><strong><span class="brand-xo">XO</span><span class="brand-bit">BIT</span></strong></div>
      <nav class="topnav" aria-label="Guide sections">
        ${navItems.map(([id, label, href]) => `<a${id === section ? " class=\"is-active\"" : ""} href="${guideUrl(href)}">${label}</a>`).join("")}
      </nav>
      <a class="back-link" href="${editorUrl}" target="_blank" rel="noopener">Open Editor</a>
    `;
    document.body.prepend(header);
  }

  function installFooter() {
    document.querySelector("footer")?.remove();
    const footer = document.createElement("footer");
    footer.innerHTML = 'XOBIT guide for the browser editor, ESP32 firmware, script runtime, and project workflow. Keep the script and module pages in sync with <code>wrench_chat_context.md</code> when firmware modules change.';
    document.querySelector("main")?.append(footer);
  }

  function installImagePopup() {
    document.getElementById("imagePopup")?.remove();
    if (!document.querySelector(".visual-media img, .image-focus")) return;

    const popup = document.createElement("div");
    popup.className = "image-popup";
    popup.id = "imagePopup";
    popup.setAttribute("role", "presentation");
    popup.setAttribute("aria-hidden", "true");
    popup.innerHTML = `
      <div class="image-popup-frame" role="dialog" aria-modal="true" aria-labelledby="imagePopupTitle">
        <div class="image-popup-body">
          <div class="image-popup-image-wrap">
            <img alt="">
            <div class="image-popup-marker" aria-hidden="true"></div>
            <div class="image-popup-note"></div>
          </div>
        </div>
        <div class="image-popup-titlebar">
          <div class="image-popup-title" id="imagePopupTitle"></div>
          <button class="image-popup-close" type="button" aria-label="Close image preview">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      </div>
    `;
    document.body.append(popup);

    const popupFrame = popup.querySelector(".image-popup-frame");
    const popupImage = popup.querySelector(".image-popup-body img");
    const popupTitle = popup.querySelector(".image-popup-title");
    const popupMarker = popup.querySelector(".image-popup-marker");
    const popupNote = popup.querySelector(".image-popup-note");
    const closeButton = popup.querySelector(".image-popup-close");

    function closeImage() {
      popup.classList.remove("is-open");
      popup.setAttribute("aria-hidden", "true");
      popupImage.removeAttribute("src");
      popupMarker.hidden = true;
      popupNote.hidden = true;
    }

    function readCrop(source) {
      const crop = source?.crop || source;
      if (!crop) return null;
      const normalized = {
        x: Number(crop.x),
        y: Number(crop.y),
        w: Number(crop.w),
        h: Number(crop.h)
      };
      if ([normalized.x, normalized.y, normalized.w, normalized.h].some((value) => !Number.isFinite(value))) return null;
      return normalized;
    }

    function expandCrop(crop, image, scale = 1.65, minimumSize = 34) {
      if (!crop) return null;
      const imageWidth = image.naturalWidth || 1;
      const imageHeight = image.naturalHeight || 1;
      const centerX = imageWidth * (crop.x + (crop.w / 2)) / 100;
      const centerY = imageHeight * (crop.y + (crop.h / 2)) / 100;
      const cropWidth = imageWidth * crop.w * scale / 100;
      const cropHeight = imageHeight * crop.h * scale / 100;
      const minimumSide = Math.min(imageWidth, imageHeight) * minimumSize / 100;
      const side = Math.min(Math.max(cropWidth, cropHeight, minimumSide), imageWidth, imageHeight);
      const x = Math.max(0, Math.min(imageWidth - side, centerX - (side / 2)));
      const y = Math.max(0, Math.min(imageHeight - side, centerY - (side / 2)));
      return {
        x: x * 100 / imageWidth,
        y: y * 100 / imageHeight,
        w: side * 100 / imageWidth,
        h: side * 100 / imageHeight
      };
    }

    function applyPreviewCrop(button, image, crop) {
      const previewCrop = expandCrop(crop, image);
      if (!previewCrop) return;
      button.style.setProperty("--crop-x", previewCrop.x);
      button.style.setProperty("--crop-y", previewCrop.y);
      button.style.setProperty("--crop-w", previewCrop.w);
      button.style.setProperty("--crop-h", previewCrop.h);
    }

    function paddedMarker(crop, padding = 2.5) {
      if (!crop) return null;
      const x = Math.max(0, crop.x - padding);
      const y = Math.max(0, crop.y - padding);
      const right = Math.min(100, crop.x + crop.w + padding);
      const bottom = Math.min(100, crop.y + crop.h + padding);
      return { x, y, w: right - x, h: bottom - y };
    }

    function openImage({ src, alt, title, crop = null, note = "" }) {
      popupImage.src = src;
      popupImage.alt = alt || title || "Image preview";
      popupTitle.textContent = title || alt || "Image preview";
      if (crop) {
        const markerCrop = paddedMarker(crop);
        popupMarker.hidden = false;
        popupMarker.style.left = `${markerCrop.x}%`;
        popupMarker.style.top = `${markerCrop.y}%`;
        popupMarker.style.width = `${markerCrop.w}%`;
        popupMarker.style.height = `${markerCrop.h}%`;
        popupNote.hidden = !note;
        popupNote.textContent = note;
        popupNote.style.left = `${markerCrop.x}%`;
        popupNote.style.top = `${Math.min(94, markerCrop.y + markerCrop.h)}%`;
      } else {
        popupMarker.hidden = true;
        popupNote.hidden = true;
      }
      popup.classList.add("is-open");
      popup.setAttribute("aria-hidden", "false");
    }

    document.querySelectorAll(".visual-media").forEach((media) => {
      const image = media.querySelector("img");
      if (!image) return;
      media.tabIndex = 0;
      media.setAttribute("role", "button");
      media.setAttribute("aria-label", `Open larger image: ${image.alt}`);
      media.addEventListener("click", () => openImage({
        src: image.currentSrc || image.src,
        alt: image.alt,
        title: image.closest(".visual-card")?.querySelector("figcaption")?.textContent.trim() || image.alt
      }));
      media.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImage({
            src: image.currentSrc || image.src,
            alt: image.alt,
            title: image.closest(".visual-card")?.querySelector("figcaption")?.textContent.trim() || image.alt
          });
        }
      });
    });

    document.querySelectorAll(".image-focus").forEach((focus) => {
      const configNode = focus.querySelector('script[type="application/json"]');
      let config = {};
      try {
        config = configNode ? JSON.parse(configNode.textContent || "{}") : {};
      } catch {
        config = {};
      }
      const imageUrl = focus.dataset.imageUrl || config.imageUrl || "";
      const title = config.title || "";
      const alt = config.alt || title || "Guide image";
      const note = config.note || "";
      const caption = config.caption || "";
      const crop = readCrop(config.crop);
      const button = document.createElement("button");
      const image = document.createElement("img");
      const captionNode = document.createElement("figcaption");

      focus.textContent = "";
      focus.classList.add("image-focus-card");
      button.className = "image-focus-button";
      button.type = "button";
      button.setAttribute("aria-label", `Open full image: ${title || alt}`);
      image.src = imageUrl;
      image.alt = alt;
      button.append(image);
      focus.append(button);
      if (caption) {
        captionNode.textContent = caption;
        focus.append(captionNode);
      }

      if (crop) {
        if (image.complete && image.naturalWidth) {
          applyPreviewCrop(button, image, crop);
        } else {
          image.addEventListener("load", () => applyPreviewCrop(button, image, crop), { once: true });
        }
      }
      button.addEventListener("click", () => openImage({
        src: image.currentSrc || image.src,
        alt,
        title,
        crop,
        note
      }));
    });

    closeButton.addEventListener("click", closeImage);
    popup.addEventListener("click", (event) => {
      if (!popupFrame.contains(event.target)) closeImage();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && popup.classList.contains("is-open")) closeImage();
    });
  }

  function installCodeCopyButtons() {
    document.querySelectorAll("pre").forEach((block) => {
      if (block.closest(".code-copy-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-copy-wrap";
      const button = document.createElement("button");
      button.className = "code-copy-button";
      button.type = "button";
      button.title = "Copy";
      button.setAttribute("aria-label", "Copy code");
      button.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">content_copy</span>';
      block.before(wrap);
      wrap.append(block, button);
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(block.textContent || "");
          button.classList.add("is-copied");
          button.title = "Copied";
          button.setAttribute("aria-label", "Copied");
          button.querySelector(".material-symbols-rounded").textContent = "check";
          window.setTimeout(() => {
            button.classList.remove("is-copied");
            button.title = "Copy";
            button.setAttribute("aria-label", "Copy code");
            button.querySelector(".material-symbols-rounded").textContent = "content_copy";
          }, 1200);
        } catch {
          button.title = "Copy failed";
          button.setAttribute("aria-label", "Copy failed");
        }
      });
    });
  }

  function formatLogDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function normalizeTopic(value) {
    return String(value || "").trim().toLowerCase();
  }

  function topicLabel(topic, entries) {
    for (const entry of entries) {
      for (const icon of entry.icons || []) {
        if (normalizeTopic(icon.type || icon.name) === topic) return icon.label || icon.type || icon.name;
      }
    }
    return topic.replaceAll("-", " ");
  }

  function entrySearchText(entry) {
    return [
      entry.date,
      entry.scope,
      entry.title,
      entry.summary,
      ...(entry.icons || []).flatMap((icon) => [icon.name, icon.label, icon.type])
    ].join(" ").toLowerCase();
  }

  function renderLogIcons(icons, activeTopic, onTopicClick) {
    const wrap = document.createElement("div");
    wrap.className = "log-icons";
    for (const icon of icons || []) {
      const topic = normalizeTopic(icon.type || icon.name);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "log-icon";
      item.title = icon.label || icon.type || icon.name;
      item.setAttribute("aria-label", item.title);
      item.dataset.topic = topic;
      item.classList.toggle("is-active", activeTopic === topic);
      item.addEventListener("click", () => onTopicClick(topic));
      const symbol = document.createElement("span");
      symbol.className = "material-symbols-rounded";
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = icon.name || "label";
      item.append(symbol);
      wrap.append(item);
    }
    return wrap;
  }

  function renderChangeLog(entries, activeTopic = "all", query = "", onTopicClick = () => {}) {
    const list = document.querySelector("[data-log-list]");
    if (!list) return;
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      const topics = (entry.icons || []).map((icon) => normalizeTopic(icon.type || icon.name));
      const topicMatch = activeTopic === "all" || topics.includes(activeTopic);
      const searchMatch = !normalizedQuery || entrySearchText(entry).includes(normalizedQuery);
      return topicMatch && searchMatch;
    });

    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("article");
      empty.className = "log-entry";
      const text = document.createElement("p");
      text.textContent = "No changes match that search.";
      empty.append(text);
      list.append(empty);
      return;
    }

    for (const entry of filtered) {
      const article = document.createElement("article");
      article.className = "log-entry";

      const header = document.createElement("header");
      const tag = document.createElement("span");
      tag.className = "log-tag";
      tag.textContent = entry.scope || "Update";
      const time = document.createElement("time");
      time.dateTime = entry.date || "";
      time.textContent = formatLogDate(entry.date || "");
      header.append(tag, time, renderLogIcons(entry.icons, activeTopic, onTopicClick));

      const title = document.createElement("h3");
      title.textContent = entry.title || "Untitled change";
      const summary = document.createElement("p");
      summary.textContent = entry.summary || "";

      article.append(header, title, summary);
      list.append(article);
    }
  }

  function installChangeLog() {
    const list = document.querySelector("[data-log-list]");
    const tools = document.querySelector("[data-log-tools]");
    const search = document.querySelector("[data-log-search]");
    if (!list || !tools || !search) return;

    fetch(guideUrl("system-log.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Change log failed to load: ${response.status}`);
        return response.json();
      })
      .then((entries) => {
        let activeTopic = "all";
        const render = () => renderChangeLog(entries, activeTopic, search.value, (topic) => {
          activeTopic = activeTopic === topic ? "all" : topic;
          render();
        });
        search.addEventListener("input", render);
        tools.hidden = false;
        render();
      })
      .catch((error) => {
        list.replaceChildren();
        const entry = document.createElement("article");
        entry.className = "log-entry";
        const text = document.createElement("p");
        text.textContent = error.message || "The change log could not be loaded.";
        entry.append(text);
        list.append(entry);
      });
  }

  function renderQrCanvas(text, targetSize = 82) {
    if (typeof window.createQRCode !== "function") return null;
    const qr = window.createQRCode(text);
    const quiet = 3;
    const scale = Math.max(2, Math.floor(targetSize / (qr.size + quiet * 2)));
    const pixels = (qr.size + quiet * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "QR code for Signal group invite");
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.getModule(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return canvas;
  }

  function installQrLinks() {
    document.querySelectorAll("[data-qr-link]").forEach((link) => {
      const target = link.querySelector("[data-qr-target]");
      if (!target) return;
      try {
        const canvas = renderQrCanvas(link.href);
        target.replaceChildren(canvas || document.createTextNode("QR"));
      } catch (error) {
        target.textContent = "QR";
      }
    });
  }

  installHeader();
  installFooter();
  installImagePopup();
  installCodeCopyButtons();
  installChangeLog();
  installQrLinks();
})();
