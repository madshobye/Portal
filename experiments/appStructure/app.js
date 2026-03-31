(() => {
  const STORAGE_KEY = "appStructure.state.v1";
  const app = document.getElementById("app");

  if (!app) return;

  const defaultState = {
    todoItems: [
      { id: "todo-1", label: "Buy oats", done: true },
      { id: "todo-2", label: "Call Lea", done: false },
      { id: "todo-3", label: "Water plants", done: false },
    ],
  };

  const appState = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState, todoItems: [...defaultState.todoItems] };

      const parsed = JSON.parse(raw);
      return {
        ...defaultState,
        ...parsed,
        todoItems: Array.isArray(parsed.todoItems)
          ? parsed.todoItems.map((item) => ({ ...item }))
          : [...defaultState.todoItems],
      };
    } catch (_error) {
      return { ...defaultState, todoItems: [...defaultState.todoItems] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }

  app.className = "stack";
  const root = window.AppStructureBase.createRoot(app);

  const shell = window.AppStructureGui.createGuiShell({
    title: "Today",
  });
  shell.create(root);

  const todoList = window.AppStructureTodoList.createTodoList({
    title: "Todo",
    items: appState.todoItems,
    onItemsChange(nextItems) {
      appState.todoItems = nextItems.map((item) => ({ ...item }));
      saveState();
    },
  });
  todoList.create(root);
})();
