export function createOnlineAuthListRenderer({ list, onRemove }) {
  function render(users = []) {
    if (!list) return;
    const onlineUsers = Array.isArray(users) ? users : [];
    list.replaceChildren();
    if (!onlineUsers.length) {
      const empty = document.createElement("div");
      empty.className = "settings-muted";
      empty.textContent = "No online sign-in users";
      list.append(empty);
      return;
    }
    for (const user of onlineUsers) {
      const username = user?.username || "user";
      const row = document.createElement("div");
      row.className = "online-auth-row";

      const name = document.createElement("span");
      name.className = "wifi-network-name";
      name.textContent = username;

      const remove = document.createElement("button");
      remove.className = "button compact icon-buttonish";
      remove.type = "button";
      remove.title = "Remove online user";
      remove.innerHTML = '<span class="material-symbols-rounded">close</span>';
      remove.addEventListener("click", () => onRemove(username));

      row.append(name, remove);
      list.append(row);
    }
  }

  return { render };
}
