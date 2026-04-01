(() => {
  function createAppController({ mount }) {
    const { STORAGE_KEY, NETWORK_NAME, DEFAULT_ROOM_NAME } = window.AppStructureConfig;
    const defaultState = {
      network: {
        name: NETWORK_NAME,
        status: "idle",
        peerCount: 0,
        clientId: "client-local",
      },
      user: {
        name: "Local User",
      },
      ui: {
        statusText: "",
      },
      rooms: {
        [DEFAULT_ROOM_NAME]: {
          name: DEFAULT_ROOM_NAME,
          todoItems: [
            { id: "todo-1", label: "Buy oats", done: true },
            { id: "todo-2", label: "Call Lea", done: false },
            { id: "todo-3", label: "Water plants", done: false },
          ],
          peers: [],
          messages: [],
        },
      },
    };

    const persistence = window.AppStructureServices.createPersistenceService({
      storageKey: STORAGE_KEY,
    });

    const appState = window.AppStructureModel.createAppState({
      defaultState,
      persistence,
    });

    const actions = window.AppStructureActions.createAppActions({ appState });
    const networkService = window.AppStructureServices.createMockNetworkService();

    const root = window.AppStructureBase.createRoot(mount);
    const shell = window.AppStructureGui.createGuiShell({
      title: "Today",
    });
    const peerList = window.AppStructurePeerList.createPeerList({
      title: "Peers",
    });
    const messageList = window.AppStructureMessageList.createMessageList({
      title: "Messages",
    });
    const todoList = window.AppStructureTodoList.createTodoList({
      title: "Todo",
      items: appState.getState().rooms[DEFAULT_ROOM_NAME].todoItems,
      onItemsChange(nextItems) {
        actions.setTodoItems(nextItems);
      },
    });

    let disposeStateSubscription = null;
    let disposeNetworkSubscription = null;

    function start() {
      mount.className = "stack";
      shell.create(root);
      peerList.create(root);
      messageList.create(root);
      todoList.create(root);

      disposeStateSubscription = appState.subscribe((state) => {
        shell.update({
          subtitle: `${state.network.name} / ${state.rooms[DEFAULT_ROOM_NAME].name}`,
          status: formatNetworkStatus(state.network),
        });

        todoList.update({
          items: state.rooms[DEFAULT_ROOM_NAME].todoItems,
        });

        peerList.update({
          peers: state.rooms[DEFAULT_ROOM_NAME].peers,
        });

        messageList.update({
          messages: state.rooms[DEFAULT_ROOM_NAME].messages,
        });
      });

      disposeNetworkSubscription = networkService.subscribe((networkState) => {
        actions.setNetworkStatus(networkState.status);
        actions.setPeerCount(networkState.peerCount);
        actions.setPeers(networkState.peers);
        actions.setMessages(networkState.messages);
      });

      networkService.start();
    }

    function stop() {
      if (disposeStateSubscription) {
        disposeStateSubscription();
        disposeStateSubscription = null;
      }
      if (disposeNetworkSubscription) {
        disposeNetworkSubscription();
        disposeNetworkSubscription = null;
      }
      networkService.stop();
      shell.destroy();
      peerList.destroy();
      messageList.destroy();
      todoList.destroy();
    }

    function formatNetworkStatus(network) {
      if (network.status === "connected") {
        return `${network.peerCount} peers connected`;
      }

      if (network.status === "connecting") {
        return `Connecting to ${NETWORK_NAME}`;
      }

      return "Disconnected";
    }

    return {
      start,
      stop,
    };
  }

  window.AppStructureRuntime = {
    createAppController,
  };
})();
