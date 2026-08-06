export function loadClassicBrowserScript(src, { document = globalThis.document } = {}) {
  const source = String(src || "");
  if (!source || !document) return Promise.reject(new Error("BROWSER_SCRIPT_SOURCE_REQUIRED"));
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vj1-script="${source}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = source;
    script.dataset.vj1Script = source;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${source}`));
    document.head.appendChild(script);
  });
}
