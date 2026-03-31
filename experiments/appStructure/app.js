(() => {
  const app = document.getElementById("app");

  if (!app) return;
  const controller = window.AppStructureRuntime.createAppController({
    mount: app,
  });
  controller.start();
})();
