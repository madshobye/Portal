(() => {
  function createGuiShell({ title }) {
    function create(parent) {
      const card = parent.addCard("gui-shell");
      card.addHeader(title, {
        level: 1,
        titleClassName: "app-title",
      });
      return card;
    }

    return {
      create,
    };
  }

  window.AppStructureGui = {
    createGuiShell,
  };
})();
