(() => {
  function createGuiShell({ title }) {
    let card;
    let subtitleText;
    let statusText;

    function create(parent) {
      card = parent.addCard("gui-shell");
      card.addHeader(title, {
        level: 1,
        titleClassName: "app-title",
      });
      subtitleText = card.addMeta("", "gui-subtitle");
      statusText = card.addMeta("", "gui-status");
      return card;
    }

    function update({ subtitle = "", status = "" }) {
      if (subtitleText) subtitleText.setText(subtitle);
      if (statusText) statusText.setText(status);
    }

    return {
      create,
      update,
      destroy() {
        if (card?.element) {
          card.element.remove();
        }
      },
    };
  }

  window.AppStructureGui = {
    createGuiShell,
  };
})();
