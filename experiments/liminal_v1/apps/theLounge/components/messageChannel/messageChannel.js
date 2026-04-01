(() => {
  function createMessageChannel({ onSend = () => {} } = {}) {
    let shell;
    let card;
    let messagesList;
    let composer;

    function create(parent) {
      shell = parent.addAppShell();
      card = window.LiminalV1Base.createCardSection({
        className: "rtcchat-channel",
        title: "Channel",
      });
      messagesList = window.LiminalV1Base.createListView({
        className: "rtcchat-channel-messages",
        emptyText: "No messages yet.",
        emptyClassName: "rtcchat-text rtcchat-channel-empty",
      });
      composer = window.LiminalV1Base.createComposer({
        className: "rtcchat-channel-form",
        inputClassName: "rtcchat-channel-input",
        buttonClassName: "rtcchat-btn",
        placeholder: "Send a message",
        buttonLabel: "Send",
        onSubmit(value) {
          const text = value.trim();
          if (!text) {
            return;
          }
          onSend(text);
          composer.input.setValue("");
        },
      });

      card.append(messagesList, composer);
      shell.element.append(card.element);
      return card.element;
    }

    function update({ title = "Channel", messages = [], disabled = false } = {}) {
      card.setTitle(title);
      composer.input.setDisabled(disabled);
      composer.button.setDisabled(disabled);
      messagesList.setItems(messages.map(createMessageRow));
      messagesList.element.scrollTop = messagesList.element.scrollHeight;
    }

    function destroy() {
      card?.remove();
    }

    function createMessageRow(message) {
      return window.LiminalV1Base.createMessageItem({
        kind: message.kind === "self" ? "self" : "peer",
        author: message.author,
        text: message.text,
        avatarText: message.authorInitial || message.author || "?",
        avatarColor: message.authorColor || "#1f6fff",
      });
    }

    return {
      create,
      update,
      destroy,
    };
  }

  window.TheLoungeComponents = {
    createMessageChannel,
  };
})();
