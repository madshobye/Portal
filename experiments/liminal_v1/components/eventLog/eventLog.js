(() => {
  function createEventLog() {
    let shell;
    let card;
    let list;

    function create(parent) {
      shell = parent.addAppShell();
      card = window.LiminalV1Base.createCardSection({
        className: "rtcchat-event-log",
        title: "Events",
      });
      list = window.LiminalV1Base.createListView({
        className: "rtcchat-event-items",
        emptyText: "No events yet.",
        emptyClassName: "rtcchat-text rtcchat-event-empty",
      });
      card.append(list);
      shell.element.append(card.element);
      return card.element;
    }

    function update({ events = [] } = {}) {
      list.setItems(events.map(createEventRow));
    }

    function destroy() {
      card?.remove();
    }

    function createEventRow(event) {
      return window.LiminalV1Base.createMetaItem({
        rowClassName: "rtcchat-event-row",
        titleClassName: "rtcchat-event-title",
        metaClassName: "rtcchat-event-meta",
        title: event.label,
        meta: event.detail || "",
      });
    }

    return {
      create,
      update,
      destroy,
    };
  }

  window.LiminalV1EventLog = {
    createEventLog,
  };
})();
