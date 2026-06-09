(() => {
  const script = document.currentScript;
  const guideRoot = new URL(".", script?.src || document.baseURI);
  const editorUrl = new URL("../index.html", guideRoot).href;

  const navItems = [
    ["overview", "Overview", "guide.html"],
    ["first-run", "Getting Started", "first-run.html"],
    ["wrench", "Script", "wrench-language.html"],
    ["api", "API", "api.html"],
    ["security", "Security", "security.html"],
    ["about", "About", "about.html"]
  ];

  function activeSection() {
    if (document.body.dataset.guideSection) return document.body.dataset.guideSection;
    const name = location.pathname.split("/").pop();
    if (name === "first-run.html") return "first-run";
    if (name === "wrench-language.html") return "wrench";
    if (name === "security.html") return "security";
    if (name === "about.html") return "about";
    if (location.pathname.includes("/api/")) return "api";
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
    footer.innerHTML = 'XOBIT guide for the browser editor, ESP32 firmware, script runtime, and project workflow. Keep the script and API pages in sync with <code>wrench_chat_context.md</code> when firmware APIs change.';
    document.querySelector("main")?.append(footer);
  }

  function installImagePopup() {
    document.getElementById("imagePopup")?.remove();
    if (!document.querySelector(".visual-media img")) return;

    const popup = document.createElement("div");
    popup.className = "image-popup";
    popup.id = "imagePopup";
    popup.setAttribute("role", "presentation");
    popup.setAttribute("aria-hidden", "true");
    popup.innerHTML = `
      <div class="image-popup-frame" role="dialog" aria-modal="true" aria-labelledby="imagePopupTitle">
        <div class="image-popup-body"><img alt=""></div>
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
    const closeButton = popup.querySelector(".image-popup-close");

    function closeImage() {
      popup.classList.remove("is-open");
      popup.setAttribute("aria-hidden", "true");
      popupImage.removeAttribute("src");
    }

    function openImage(image) {
      const caption = image.closest(".visual-card")?.querySelector("figcaption")?.textContent.trim() || image.alt || "Image preview";
      popupImage.src = image.currentSrc || image.src;
      popupImage.alt = image.alt;
      popupTitle.textContent = caption;
      popup.classList.add("is-open");
      popup.setAttribute("aria-hidden", "false");
    }

    document.querySelectorAll(".visual-media").forEach((media) => {
      const image = media.querySelector("img");
      if (!image) return;
      media.tabIndex = 0;
      media.setAttribute("role", "button");
      media.setAttribute("aria-label", `Open larger image: ${image.alt}`);
      media.addEventListener("click", () => openImage(image));
      media.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImage(image);
        }
      });
    });

    closeButton.addEventListener("click", closeImage);
    popup.addEventListener("click", (event) => {
      if (!popupFrame.contains(event.target)) closeImage();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && popup.classList.contains("is-open")) closeImage();
    });
  }

  installHeader();
  installFooter();
  installImagePopup();
})();
