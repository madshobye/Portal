(() => {
  function cloneItems(items) {
    return items.map((item) => ({ ...item }));
  }

  function createAppActions({ appState }) {
    function setNetworkStatus(status) {
      appState.update((state) => ({
        ...state,
        network: {
          ...state.network,
          status,
        },
      }));
    }

    function setPeerCount(peerCount) {
      appState.update((state) => ({
        ...state,
        network: {
          ...state.network,
          peerCount,
        },
      }));
    }

    function setMessages(messages) {
      appState.update((state) => ({
        ...state,
        rooms: {
          ...state.rooms,
          theLounge: {
            ...state.rooms.theLounge,
            messages: cloneItems(messages),
          },
        },
      }));
    }

    function addMessage(message) {
      appState.update((state) => ({
        ...state,
        rooms: {
          ...state.rooms,
          theLounge: {
            ...state.rooms.theLounge,
            messages: [...state.rooms.theLounge.messages, { ...message }],
          },
        },
      }));
    }

    function setPeers(peers) {
      appState.update((state) => ({
        ...state,
        rooms: {
          ...state.rooms,
          theLounge: {
            ...state.rooms.theLounge,
            peers: cloneItems(peers),
          },
        },
      }));
    }

    function setTodoItems(todoItems) {
      appState.update((state) => ({
        ...state,
        rooms: {
          ...state.rooms,
          theLounge: {
            ...state.rooms.theLounge,
            todoItems: cloneItems(todoItems),
          },
        },
      }));
    }

    return {
      setNetworkStatus,
      setPeerCount,
      setMessages,
      addMessage,
      setPeers,
      setTodoItems,
    };
  }

  window.AppStructureActions = {
    createAppActions,
  };
})();
