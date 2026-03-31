(() => {
  function appendChild(parent, child) {
    if (child == null) return;
    if (Array.isArray(child)) {
      child.forEach((entry) => appendChild(parent, entry));
      return;
    }
    if (child instanceof Node) {
      parent.appendChild(child);
      return;
    }
    parent.appendChild(document.createTextNode(String(child)));
  }

  function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);

    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = String(options.text);
    if (options.html != null) node.innerHTML = String(options.html);
    if (options.hidden != null) node.hidden = !!options.hidden;

    for (const [key, value] of Object.entries(options.attrs || {})) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }

    for (const [key, value] of Object.entries(options.dataset || {})) {
      if (value == null) continue;
      node.dataset[key] = String(value);
    }

    for (const [key, value] of Object.entries(options.props || {})) {
      node[key] = value;
    }

    for (const [key, handler] of Object.entries(options.on || {})) {
      if (typeof handler === "function") {
        node.addEventListener(key, handler);
      }
    }

    appendChild(node, children);
    return node;
  }

  window.RtcChatV3DomUi = {
    el,
  };
})();
