
const hostname = window.location.hostname;
const isPrivateIpv4 =
  /^10\./.test(hostname) ||
  /^192\.168\./.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

const local =
  window.location.protocol === "file:" ||
  ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname) ||
  hostname.endsWith(".local") ||
  isPrivateIpv4;

const portalLoadPromises = (window.__portalLoadPromises ??= {});
const loadedPortalScripts = (window.__loadedPortalScripts ??= new Set());

async function loadPortal(version, refresh = false) {
  let baseSrc = "";
  if (local) {
    baseSrc = `/${version}/portal/portal.js`;
  } else {
    baseSrc = `https://madshobye.github.io/Portal/${version}/portal/portal.js`;
  }

  if (portalLoadPromises[baseSrc]) return portalLoadPromises[baseSrc];
  if (loadedPortalScripts.has(baseSrc) && typeof window.pSetup === "function") {
    return Promise.resolve();
  }

  const loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    let src = baseSrc;
    if (refresh) src += `?refresh=${Date.now()}`;
    s.src = src;
    s.onload = () => {
      loadedPortalScripts.add(baseSrc);
      const originalSetup = setup;

      setup = async function() {
        await pSetup();
        await originalSetup();
      };
  
      resolve();
	  
    };
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });

  portalLoadPromises[baseSrc] = loadPromise;
  return loadPromise;
}

loadPortal("P1");
