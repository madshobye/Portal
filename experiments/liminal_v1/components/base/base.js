(() => {
  function el(tagName, options = {}) {
    const node = document.createElement(tagName);
    const { className, text, hidden, type } = options;

    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (hidden) node.hidden = true;
    if (type) node.type = type;

    return node;
  }

  function createRoot(mount) {
    let shell = null;

    function addAppShell() {
      if (shell) {
        return shell;
      }

      const app = el("div", { className: "rtcchat-app" });
      const panel = el("div", { className: "rtcchat-panel" });
      const topRow = el("div", { className: "rtcchat-top-row" });
      app.append(panel);
      mount.append(app);
      panel.append(topRow);

      shell = {
        element: panel,
        addToggleButton(label) {
          const button = el("button", {
            className: "rtcchat-top-toggle",
            text: label,
            type: "button",
          });
          topRow.append(button);
          return {
            element: button,
            setText(value) {
              button.textContent = value;
            },
            onClick(handler) {
              button.addEventListener("click", handler);
            },
          };
        },
        addTopButton(label, className = "rtcchat-top-action") {
          const button = el("button", {
            className,
            text: label,
            type: "button",
          });
          topRow.append(button);
          return {
            element: button,
            setText(value) {
              button.textContent = value;
            },
            onClick(handler) {
              button.addEventListener("click", handler);
            },
          };
        },
        addInfoCard() {
          const card = el("section", {
            className: "rtcchat-card rtcchat-status",
            hidden: true,
          });
          const title = el("h2", { className: "rtcchat-title", text: "" });
          const text = el("p", { className: "rtcchat-text", text: "" });
          const detail = el("pre", { className: "rtcchat-detail", text: "" });
          const actions = el("div", { className: "rtcchat-actions" });

          card.append(title, text, detail, actions);
          panel.append(card);

          return {
            element: card,
            setVisible(isVisible) {
              card.hidden = !isVisible;
            },
            setTitle(value) {
              title.textContent = value;
            },
            setText(value) {
              text.textContent = value;
            },
            setDetail(value) {
              detail.textContent = value;
            },
            setActions(buttons) {
              actions.replaceChildren(...buttons.map((button) => button.element));
            },
          };
        },
        addSpacer() {
          const spacer = el("div", { className: "liminal-spacer" });
          panel.append(spacer);
          return spacer;
        },
      };

      return shell;
    }

    return {
      addAppShell,
    };
  }

  function createText(tagName, className, text = "") {
    const node = el(tagName, { className, text });
    return {
      element: node,
      setText(value) {
        node.textContent = value;
      },
    };
  }

  function createCardSection({
    className = "",
    title = "",
    titleTag = "h2",
    titleClassName = "rtcchat-title",
  } = {}) {
    const card = el("section", {
      className: ["rtcchat-card", className].filter(Boolean).join(" "),
    });
    const titleNode = createText(titleTag, titleClassName, title);
    card.append(titleNode.element);

    return {
      element: card,
      title: titleNode,
      setTitle(value) {
        titleNode.setText(value);
      },
      append(...items) {
        card.append(...items.map(unwrapElement));
      },
      remove() {
        card.remove();
      },
    };
  }

  function createListView({
    className = "",
    emptyText = "",
    emptyClassName = "rtcchat-text",
  } = {}) {
    const list = el("div", { className });
    const emptyNode = emptyText
      ? el("p", { className: emptyClassName, text: emptyText })
      : null;

    return {
      element: list,
      setItems(items) {
        list.replaceChildren();
        if (!items.length) {
          if (emptyNode) {
            list.append(emptyNode);
          }
          return;
        }
        list.append(...items.map(unwrapElement));
      },
      append(...items) {
        list.append(...items.map(unwrapElement));
      },
      clear() {
        list.replaceChildren();
      },
    };
  }

  function createAvatarBadge({
    text = "?",
    color = "#1f6fff",
    className = "rtcchat-avatar",
  } = {}) {
    const avatar = el("div", {
      className,
      text: String(text).slice(0, 1).toUpperCase(),
    });
    avatar.style.setProperty("--rtcchat-avatar-bg", color);

    return {
      element: avatar,
      setText(value) {
        avatar.textContent = String(value).slice(0, 1).toUpperCase();
      },
      setColor(value) {
        avatar.style.setProperty("--rtcchat-avatar-bg", value || "#1f6fff");
      },
    };
  }

  function createComposer({
    className = "rtcchat-channel-form",
    inputClassName = "rtcchat-channel-input",
    buttonClassName = "rtcchat-btn",
    placeholder = "",
    buttonLabel = "Send",
    onSubmit = () => {},
  } = {}) {
    const form = el("form", { className });
    const input = el("input", {
      className: inputClassName,
      type: "text",
    });
    input.placeholder = placeholder;
    input.autocomplete = "off";

    const button = el("button", {
      className: buttonClassName,
      text: buttonLabel,
      type: "submit",
    });

    form.append(input, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      onSubmit(input.value);
    });

    return {
      element: form,
      input: {
        element: input,
        getValue() {
          return input.value;
        },
        setValue(value) {
          input.value = value;
        },
        setDisabled(disabled) {
          input.disabled = !!disabled;
        },
      },
      button: {
        element: button,
        setDisabled(disabled) {
          button.disabled = !!disabled;
        },
      },
    };
  }

  function createMessageItem({
    kind = "peer",
    author = "",
    text = "",
    avatarText = "?",
    avatarColor = "#1f6fff",
  } = {}) {
    const row = el("div", {
      className: ["rtcchat-channel-message", kind].join(" "),
    });
    const avatar = createAvatarBadge({
      text: avatarText,
      color: avatarColor,
    });
    const bubble = el("div", { className: "rtcchat-channel-bubble" });
    const meta = createText("div", "rtcchat-channel-meta", author);
    const body = createText("div", "rtcchat-channel-text", text);

    bubble.append(meta.element, body.element);
    row.append(avatar.element, bubble);

    return {
      element: row,
    };
  }

  function createMetaItem({
    rowClassName = "",
    titleClassName = "",
    metaClassName = "",
    title = "",
    meta = "",
  } = {}) {
    const row = el("div", { className: rowClassName });
    const titleNode = createText("div", titleClassName, title);
    const metaNode = createText("div", metaClassName, meta);
    row.append(titleNode.element, metaNode.element);

    return {
      element: row,
    };
  }

  function createAvatarMetaItem({
    rowClassName = "",
    avatarClassName = "",
    contentClassName = "",
    titleClassName = "",
    metaClassName = "",
    avatarText = "?",
    avatarColor = "#1f6fff",
    title = "",
    meta = "",
  } = {}) {
    const row = el("div", { className: rowClassName });
    const avatar = createAvatarBadge({
      className: avatarClassName || "rtcchat-avatar",
      text: avatarText,
      color: avatarColor,
    });
    const content = el("div", { className: contentClassName });
    const titleNode = createText("div", titleClassName, title);
    const metaNode = createText("div", metaClassName, meta);

    content.append(titleNode.element, metaNode.element);
    row.append(avatar.element, content);

    return {
      element: row,
    };
  }

  function createActionButton(label, className = "rtcchat-btn secondary") {
    const button = el("button", {
      className,
      text: label,
      type: "button",
    });

    return {
      element: button,
      setText(value) {
        button.textContent = value;
      },
      setDisabled(disabled) {
        button.disabled = !!disabled;
      },
      onClick(handler) {
        button.addEventListener("click", handler);
      },
    };
  }

  function unwrapElement(item) {
    return item?.element || item;
  }

  window.LiminalV1Base = {
    el,
    createRoot,
    createText,
    createCardSection,
    createListView,
    createAvatarBadge,
    createComposer,
    createMessageItem,
    createMetaItem,
    createAvatarMetaItem,
    createActionButton,
  };
})();
