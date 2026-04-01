(() => {
  function el(tagName, options = {}) {
    const element = document.createElement(tagName);
    const {
      className,
      text,
      type,
      name,
      placeholder,
      autocomplete,
    } = options;

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    if (type) element.type = type;
    if (name) element.name = name;
    if (placeholder) element.placeholder = placeholder;
    if (autocomplete) element.autocomplete = autocomplete;

    return element;
  }

  class UiText {
    constructor(element) {
      this.element = element;
    }

    setText(value) {
      this.element.textContent = value;
      return this;
    }
  }

  class UiSection {
    constructor(element) {
      this.element = element;
    }

    addText(text = "", className = "") {
      const node = el("p", {
        className: ["ui-meta", className].filter(Boolean).join(" "),
        text,
      });
      this.element.append(node);
      return new UiText(node);
    }

    addList(className = "") {
      const list = el("div", {
        className: ["ui-list", className].filter(Boolean).join(" "),
      });
      this.element.append(list);
      return new UiList(list);
    }

    append(node) {
      this.element.append(node);
      return this;
    }
  }

  class UiButton {
    constructor(element) {
      this.element = element;
    }

    onClick(handler) {
      this.element.addEventListener("click", handler);
      return this;
    }
  }

  class UiInput {
    constructor(element) {
      this.element = element;
    }

    getValue() {
      return this.element.value;
    }

    setValue(value) {
      this.element.value = value;
      return this;
    }
  }

  class UiCheckboxRow {
    constructor(root, checkbox, label) {
      this.element = root;
      this.checkbox = checkbox;
      this.label = label;
    }

    onToggle(handler) {
      this.checkbox.addEventListener("change", () => {
        handler(this.checkbox.checked);
      });
      return this;
    }

    setChecked(checked) {
      this.checkbox.checked = checked;
      return this;
    }

    setDone(done) {
      this.label.classList.toggle("ui-label-done", done);
      this.label.classList.toggle("todo-label-done", done);
      return this;
    }

    remove() {
      this.element.remove();
    }
  }

  class UiList {
    constructor(element) {
      this.element = element;
    }

    clear() {
      this.element.replaceChildren();
      return this;
    }

    append(node) {
      this.element.append(node);
      return this;
    }

    addCheckboxItem(label, checked = false, options = {}) {
      const row = el("label", {
        className: ["ui-row", options.rowClassName].filter(Boolean).join(" "),
      });
      const checkbox = el("input", { type: "checkbox" });
      checkbox.checked = checked;
      const text = el("span", {
        className: ["ui-label", options.labelClassName].filter(Boolean).join(" "),
        text: label,
      });

      row.append(checkbox, text);
      this.element.append(row);

      const item = new UiCheckboxRow(row, checkbox, text);
      item.setDone(checked);
      return item;
    }

    addRow(options = {}) {
      const row = el("div", {
        className: ["ui-row", options.className].filter(Boolean).join(" "),
      });
      this.element.append(row);
      return new UiSection(row);
    }
  }

  class UiFormRow {
    constructor(form, input, button) {
      this.element = form;
      this.input = input;
      this.button = button;
    }

    onSubmit(handler) {
      this.element.addEventListener("submit", (event) => {
        event.preventDefault();
        handler(this.input.getValue());
      });
      return this;
    }
  }

  class UiCard {
    constructor(element) {
      this.element = element;
      this.header = null;
      this.titleGroup = null;
    }

    addHeader(title, options = {}) {
      this.header = el("div", { className: "ui-header" });
      this.titleGroup = el("div", { className: "ui-title-group" });

      const titleEl = el(`h${options.level || 2}`, {
        className: ["ui-title", options.titleClassName].filter(Boolean).join(" "),
        text: title,
      });

      this.titleGroup.append(titleEl);
      this.header.append(this.titleGroup);
      this.element.append(this.header);

      return new UiText(titleEl);
    }

    addMeta(text = "", className = "") {
      const meta = el("p", {
        className: ["ui-meta", className].filter(Boolean).join(" "),
        text,
      });

      if (this.titleGroup) {
        this.titleGroup.append(meta);
      } else {
        this.element.append(meta);
      }

      return new UiText(meta);
    }

    addButton(text, className = "") {
      const button = el("button", {
        className: ["ui-button", className].filter(Boolean).join(" "),
        text,
        type: "button",
      });
      this.element.append(button);
      return new UiButton(button);
    }

    addActionButton(text, className = "") {
      if (!this.header) {
        this.addHeader("");
      }

      let actions = this.header.querySelector(".ui-actions");
      if (!actions) {
        actions = el("div", { className: "ui-actions" });
        this.header.append(actions);
      }

      const button = el("button", {
        className: ["ui-button", className].filter(Boolean).join(" "),
        text,
        type: "button",
      });
      actions.append(button);
      return new UiButton(button);
    }

    addInput(options = {}) {
      const input = el("input", {
        className: ["ui-input", options.className].filter(Boolean).join(" "),
        type: options.type || "text",
        name: options.name,
        placeholder: options.placeholder,
        autocomplete: options.autocomplete,
      });
      this.element.append(input);
      return new UiInput(input);
    }

    addFormRow({ placeholder = "", buttonLabel = "Submit", buttonClassName = "" } = {}) {
      const form = el("form", { className: "ui-form-row" });
      const input = el("input", {
        className: "ui-input",
        type: "text",
        name: "field",
        placeholder,
        autocomplete: "off",
      });
      const button = el("button", {
        className: ["ui-button", buttonClassName].filter(Boolean).join(" "),
        text: buttonLabel,
        type: "submit",
      });

      form.append(input, button);
      this.element.append(form);
      return new UiFormRow(form, new UiInput(input), new UiButton(button));
    }

    addList() {
      const list = el("div", { className: "ui-list" });
      this.element.append(list);
      return new UiList(list);
    }

    addSection(className = "") {
      const section = el("div", {
        className: ["ui-section", className].filter(Boolean).join(" "),
      });
      this.element.append(section);
      return new UiSection(section);
    }

    append(node) {
      this.element.append(node);
      return this;
    }
  }

  class UiRoot {
    constructor(element) {
      this.element = element;
    }

    addCard(className = "") {
      const card = el("section", {
        className: ["ui-card", className].filter(Boolean).join(" "),
      });
      this.element.append(card);
      return new UiCard(card);
    }
  }

  function createRoot(element) {
    return new UiRoot(element);
  }

  function createText(text = "", className = "") {
    return el("p", {
      className: ["ui-meta", className].filter(Boolean).join(" "),
      text,
    });
  }

  window.AppStructureBase = {
    createRoot,
    createText,
  };
})();
