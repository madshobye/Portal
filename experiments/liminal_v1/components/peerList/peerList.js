(() => {
  function createPeerList() {
    let shell;
    let card;
    let list;

    function create(parent) {
      shell = parent.addAppShell();
      card = window.LiminalV1Base.createCardSection({
        className: "rtcchat-peer-list",
        title: "Peers",
      });
      list = window.LiminalV1Base.createListView({
        className: "rtcchat-peer-items",
        emptyText: "No peers discovered yet.",
        emptyClassName: "rtcchat-text rtcchat-peer-empty",
      });
      card.append(list);
      shell.element.append(card.element);
      return card.element;
    }

    function update({ peers = [] } = {}) {
      list.setItems(peers.map(createPeerRow));
    }

    function destroy() {
      card?.remove();
    }

    function createPeerRow(peer) {
      return window.LiminalV1Base.createAvatarMetaItem({
        rowClassName: "rtcchat-peer-row",
        avatarClassName: "rtcchat-peer-avatar",
        contentClassName: "rtcchat-peer-content",
        titleClassName: "rtcchat-peer-name",
        metaClassName: "rtcchat-peer-meta",
        avatarText: peer.name,
        avatarColor: peer.color,
        title: peer.name,
        meta: [
          peer.presence,
          peer.connected ? "connected" : peer.connectionState,
          peer.retrying ? "retrying" : null,
        ].filter(Boolean).join("  |  "),
      });
    }

    return {
      create,
      update,
      destroy,
    };
  }

  window.LiminalV1PeerList = {
    createPeerList,
  };
})();
