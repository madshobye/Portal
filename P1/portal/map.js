const PORTAL_MAP_MAPPA_JS =
  "https://unpkg.com/mappa-mundi@0.0.4/dist/mappa.min.js";
const PORTAL_MAP_LEAFLET_CSS =
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

function _portalEnsureStylesheet(url) {
  const href = String(url || "");
  if (!href) return Promise.resolve();

  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(
    (node) => node.href === href
  );
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`Failed to load stylesheet: ${href}`));
    document.head.appendChild(link);
  });
}

async function _portalEnsureMapDeps() {
  await _portalEnsureStylesheet(PORTAL_MAP_LEAFLET_CSS);
  if (typeof window.Mappa === "undefined") {
    await loadScript(PORTAL_MAP_MAPPA_JS);
  }
  if (typeof window.Mappa === "undefined") {
    throw new Error("PortalMap: Mappa failed to load");
  }
}

class PortalMap {
  constructor({
    lat = 55.6761,
    lng = 12.5683,
    zoom = 10,
    style = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    provider = "Leaflet",
    containerId = null,
  } = {}) {
    this.options = {
      lat,
      lng,
      zoom,
      style,
      attribution,
      provider,
      containerId,
    };

    this.mappa = null;
    this.tileMap = null;
    this.canvas = null;
    this.container = null;
    this.ready = false;
  }

  async init({ canvas = null, overlay = true } = {}) {
    await _portalEnsureMapDeps();

    this.canvasP5 = canvas?.elt ? canvas : null;
    this.canvas = canvas?.elt ? canvas.elt : canvas;
    if (!this.canvas) {
      throw new Error("PortalMap: canvas is required in init({ canvas })");
    }

    this.mappa = new window.Mappa(this.options.provider);
    this.tileMap = await this.mappa.tileMap({
      lat: this.options.lat,
      lng: this.options.lng,
      zoom: this.options.zoom,
      style: this.options.style,
      attribution: this.options.attribution,
    });

    this.tileMap.overlay(this.canvasP5 || this.canvas);
    if (overlay && this.canvas) {
      Object.assign(this.canvas.style, {
        position: "relative",
        zIndex: "1",
        background: "transparent",
      });
    }

    this.ready = true;
    return this;
  }

  setCenter(lat, lng) {
    this.options.lat = Number(lat);
    this.options.lng = Number(lng);
    if (this.tileMap?.map) {
      this.tileMap.map.setView([this.options.lat, this.options.lng], this.tileMap.map.getZoom());
    }
  }

  setZoom(zoom) {
    this.options.zoom = Number(zoom);
    if (this.tileMap?.map) {
      this.tileMap.map.setZoom(this.options.zoom);
    }
  }

  getCenter() {
    if (this.tileMap?.map) {
      const center = this.tileMap.map.getCenter();
      return { latitude: center.lat, longitude: center.lng };
    }
    return { latitude: this.options.lat, longitude: this.options.lng };
  }

  latLngToPixel(lat, lng) {
    if (!this.tileMap) return null;
    return this.tileMap.latLngToPixel(Number(lat), Number(lng));
  }

  pixelToLatLng(x, y) {
    if (!this.tileMap?.map) return null;
    const latLng = this.tileMap.map.containerPointToLatLng([Number(x), Number(y)]);
    return { latitude: latLng.lat, longitude: latLng.lng };
  }

  drawMarker(lat, lng, size = 20, fillColor = "#ff2d55", strokeColor = "#ffffff") {
    const pos = this.latLngToPixel(lat, lng);
    if (!pos) return null;
    push();
    stroke(strokeColor);
    strokeWeight(2);
    fill(fillColor);
    circle(pos.x, pos.y, size);
    pop();
    return pos;
  }

  invalidateSize() {
    if (!this.tileMap?.map) return;
    this.tileMap.map.invalidateSize();
  }
}

async function createPortalMap(options = {}, initOptions = {}) {
  return await new PortalMap(options).init(initOptions);
}

window.PortalMap = PortalMap;
window.createPortalMap = createPortalMap;
