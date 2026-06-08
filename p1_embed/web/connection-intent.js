export function createConnectionIntentStore({
  intentKey,
  reconnectKey,
} = {}) {
  function wanted() {
    const explicit = localStorage.getItem(intentKey);
    if (explicit === "connected") return true;
    if (explicit === "disconnected") return false;
    return localStorage.getItem(reconnectKey) === "1";
  }

  function setWanted(nextWanted) {
    localStorage.setItem(intentKey, nextWanted ? "connected" : "disconnected");
    localStorage.setItem(reconnectKey, nextWanted ? "1" : "0");
  }

  return {
    setWanted,
    wanted,
  };
}
