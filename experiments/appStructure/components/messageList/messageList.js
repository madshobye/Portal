(() => {
  function createMessageList({ title }) {
    let list;
    let emptyState;
    let card;

    function create(parent) {
      card = parent.addCard("message-list");
      card.addHeader(title, {
        titleClassName: "message-list-title",
      });
      list = card.addList();
      emptyState = window.AppStructureBase.createText("No messages yet.", "ui-empty");
      return card;
    }

    function update({ messages = [] } = {}) {
      list.clear();

      if (messages.length === 0) {
        list.append(emptyState);
        return;
      }

      for (const message of messages) {
        const row = list.addRow({
          className: "message-row",
        });
        row.addText(message.author, "message-author");
        row.addText(message.text, "message-text");
      }
    }

    function destroy() {
      if (card?.element) {
        card.element.remove();
      }
    }

    return {
      create,
      update,
      destroy,
    };
  }

  window.AppStructureMessageList = {
    createMessageList,
  };
})();
