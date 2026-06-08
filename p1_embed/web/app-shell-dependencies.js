export function createAppShellDependencies({
  fields,
  getChatShellController,
  getConsoleController,
  getFirmwareUpdateController,
  getProjectStore,
  narrowGenerativeQuery,
  storage,
} = {}) {
  return {
    fields,
    getChatShellController,
    getConsoleController,
    getFirmwareUpdateController,
    getProjectStore,
    narrowGenerativeQuery,
    storage,
  };
}
