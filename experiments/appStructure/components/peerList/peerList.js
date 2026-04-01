(() => {
  function createPeerList({ title }) {
    let list;
    let emptyState;
    let card;

    function create(parent) {
      card = parent.addCard("peer-list");
      card.addHeader(title, {
        titleClassName: "peer-list-title",
      });
      list = card.addList();
      emptyState = window.AppStructureBase.createText("No peers yet.", "ui-empty");
      return card;
    }

    function update({ peers = [] } = {}) {
      list.clear();

      if (peers.length === 0) {
        list.append(emptyState);
        return;
      }

      for (const peer of peers) {
        const row = list.addRow({
          className: "peer-row",
        });
        row.addText(peer.name, "peer-name");
        row.addText(peer.status, "peer-status");
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

  window.AppStructurePeerList = {
    createPeerList,
  };
})();
