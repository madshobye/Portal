(() => {
  function createTodoList({ title, items = [], onItemsChange = () => {} }) {
    let todoItems = items.map(copyItem);
    let countText;
    let list;
    let form;

    const emptyState = window.AppStructureBase.createText("Nothing here.", "ui-empty");

    function copyItem(item) {
      return { ...item };
    }

    function copyItems(nextItems) {
      return nextItems.map(copyItem);
    }

    function create(parent) {
      const card = parent.addCard("todo-list");
      card.addHeader(title, {
        titleClassName: "todo-title",
      });

      countText = card.addMeta("", "todo-count");

      card.addActionButton("Clear done").onClick(clearDone);
      card.addActionButton("Clear list").onClick(clearAll);

      form = card.addFormRow({
        placeholder: "Add a task",
        buttonLabel: "Add",
        buttonClassName: "ui-button-primary",
      });

      form.onSubmit(handleSubmit);

      list = card.addList();
      syncUi();
      return card;
    }

    function update({ items: nextItems = todoItems } = {}) {
      todoItems = copyItems(nextItems);
      syncUi();
    }

    function handleSubmit(value) {
      const label = value.trim();
      if (!label) return;

      addItem(label);
      form.input.setValue("");
    }

    function setItems(nextItems) {
      todoItems = copyItems(nextItems);
      onItemsChange(copyItems(todoItems));
      syncUi();
    }

    function addItem(label) {
      setItems([
        ...todoItems,
        {
          id: `todo-${Date.now()}`,
          label,
          done: false,
        },
      ]);
    }

    function toggleItem(id, done) {
      setItems(
        todoItems.map((item) =>
          item.id === id ? { ...item, done } : item
        )
      );
    }

    function clearDone() {
      setItems(todoItems.filter((item) => !item.done));
    }

    function clearAll() {
      setItems([]);
    }

    function syncCount() {
      const remaining = todoItems.filter((item) => !item.done).length;
      countText.setText(`${remaining} left`);
    }

    function syncList() {
      list.clear();

      if (todoItems.length === 0) {
        list.append(emptyState);
        return;
      }

      for (const item of todoItems) {
        const row = list.addCheckboxItem(item.label, item.done, {
          rowClassName: "todo-item",
          labelClassName: "todo-label",
        });

        row.setDone(item.done);
        row.onToggle((done) => toggleItem(item.id, done));
      }
    }

    function syncUi() {
      syncCount();
      syncList();
    }

    return {
      create,
      update,
      destroy() {
        list?.element?.closest(".todo-list")?.remove();
      },
    };
  }

  window.AppStructureTodoList = {
    createTodoList,
  };
})();
