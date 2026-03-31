(() => {
  function createAppController({ mount }) {
    const STORAGE_KEY = "appStructure.state.v2";
    const defaultState = {
      network: {
        name: "liminalNet",
        status: "idle",
        peerCount: 0,
        clientId: "client-local",
      },
      rooms: {
        theLounge: {
          name: "theLounge",
          todoItems: [
            { id: "todo-1", label: "Buy oats", done: true },
            { id: "todo-2", label: "Call Lea", done: false },
            { id: "todo-3", label: "Water plants", done: false },
          ],
        },
      },
    };

    const appState = window.AppStructureModel.createAppState({
      storageKey: STORAGE_KEY,
      defaultState,
    });

    const networkService = window.AppStructureServices.createMockNetworkService({
      appState,
    });

    const root = window.AppStructureBase.createRoot(mount);
    const shell = window.AppStructureGui.createGuiShell({
      title: "Today",
    });
    const todoList = window.AppStructureTodoList.createTodoList({
      title: "Todo",
      items: appState.getState().rooms.theLounge.todoItems,
      onItemsChange(nextItems) {
        appState.update((state) => ({
          ...state,
          rooms: {
            ...state.rooms,
            theLounge: {
              ...state.rooms.theLounge,
              todoItems: nextItems.map((item) => ({ ...item })),
            },
          },
        }));
      },
    });

    let disposeStateSubscription = null;

    function start() {
      mount.className = "stack";
      shell.create(root);
      todoList.create(root);

      disposeStateSubscription = appState.subscribe((state) => {
        shell.update({
          subtitle: `${state.network.name} / ${state.rooms.theLounge.name}`,
          status: formatNetworkStatus(state.network),
        });

        todoList.update({
          items: state.rooms.theLounge.todoItems,
        });
      });

      networkService.start();
    }

    function stop() {
      if (disposeStateSubscription) {
        disposeStateSubscription();
        disposeStateSubscription = null;
      }
      networkService.stop();
    }

    function formatNetworkStatus(network) {
      if (network.status === "connected") {
        return `${network.peerCount} peers connected`;
      }

      if (network.status === "connecting") {
        return "Connecting to liminalNet";
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
