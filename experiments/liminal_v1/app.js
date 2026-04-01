(() => {
  const mount = document.getElementById("app");
  if (!mount) return;

  const controller = window.LiminalV1Runtime.createAppController({
    mount,
  });

  controller.start();
})();
