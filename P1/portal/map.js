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

function _portalMapTileLayer(url, attribution) {
  const options = { attribution };
  const origin = window.location.origin;
  // p5's cloud editor uses blob documents, whose image requests lack a Referer.
  // Fetch with the document's actual HTTP origin (never a fabricated identity).
  if (window.location.protocol !== "blob:" || !/^https?:\/\//.test(origin)) {
    return window.L.tileLayer(url, options);
  }

  const ReferrerTileLayer = window.L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("img");
      tile.alt = "";
      const controller = new AbortController();
      let objectUrl;
      const release = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      };
      tile._portalCancel = () => { controller.abort(); release(); };
      tile.onload = () => { release(); done(null, tile); };
      tile.onerror = () => { release(); done(new Error("Map tile could not be decoded"), tile); };
      fetch(this.getTileUrl(coords), {
        referrer: `${origin}/`,
        referrerPolicy: "strict-origin-when-cross-origin",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error(`Map tile request failed: ${response.status}`);
        return response.blob();
      }).then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        tile.src = objectUrl;
      }).catch((error) => {
        release();
        if (!controller.signal.aborted) done(error, tile);
      });
      return tile;
    },
  });
  const layer = new ReferrerTileLayer(url, options);
  layer.on("tileunload", ({ tile }) => tile._portalCancel?.());
  return layer;
}

class PortalMap {
  constructor({
    lat = 55.6761,
    lng = 12.5683,
    zoom = 10,
    style = "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
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
    this.wrapper = null;
    this.ready = false;
    this._resizeObserver = null;
    this._syncListenersInstalled = false;
    this._invalidateTimers = [];
    this._rafId = 0;
    this._lastCanvasRectKey = "";
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
      // Add tiles ourselves once Leaflet is ready, with attribution and the
      // blob-document referrer fix. Mappa does not forward tile attribution.
      style: this.options.provider === "Leaflet" ? "" : this.options.style,
      attribution: this.options.attribution,
    });

    const canvasHost = this.canvas.parentElement;
    const canvasNextSibling = this.canvas.nextSibling;
    await new Promise((resolve) => {
      this.tileMap.overlay(this.canvasP5 || this.canvas, resolve);
    });
    if (this.options.style && this.options.provider === "Leaflet") {
      this.tileMap.tiles = _portalMapTileLayer(this.options.style, this.options.attribution);
      this.tileMap.tiles.addTo(this.tileMap.map);
    }
    this.container = this.tileMap?.map?.getContainer?.() || null;
    // Mappa moves the canvas inside the map. Restore it before wrapping the
    // map and canvas as siblings; otherwise the wrapper would contain itself.
    if (canvasHost) canvasHost.insertBefore(this.canvas, canvasNextSibling);
    this._ensureStackedWrapper();
    if (overlay && this.canvas) {
      const parent = this.canvas.parentElement;
      if (parent && getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
      }
      Object.assign(this.canvas.style, {
        position: "relative",
        zIndex: "1",
        background: "transparent",
        pointerEvents: "none",
      });
      // Mappa compensates for map-pane panning; our sibling canvas stays fixed.
      this.tileMap?.map?.on?.("move", () => { this.canvas.style.transform = "none"; });
    }

    this._installPortalSync();
    this._startCanvasRectMonitor();
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
    this._syncContainerToCanvas();
    this.tileMap.map.invalidateSize();
  }

  _installPortalSync() {
    if (this._syncListenersInstalled || !this.canvas) return;
    this._syncListenersInstalled = true;

    const schedule = () => this._scheduleInvalidateSequence();

    window.addEventListener("resize", schedule);
    document.addEventListener("fullscreenchange", schedule);

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", schedule);
    }

    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => {
        schedule();
      });
      this._resizeObserver.observe(this.canvas);
    }

    schedule();
  }

  _startCanvasRectMonitor() {
    if (!this.canvas || this._rafId) return;

    const tick = () => {
      if (!this.canvas || !this.ready) {
        this._rafId = 0;
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      const key = [
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
      ].join(":");

      if (key !== this._lastCanvasRectKey) {
        this._lastCanvasRectKey = key;
        this._scheduleInvalidateSequence();
      }

      this._rafId = window.requestAnimationFrame(tick);
    };

    this._lastCanvasRectKey = "";
    this._rafId = window.requestAnimationFrame(tick);
  }

  _scheduleInvalidateSequence() {
    for (const timer of this._invalidateTimers) {
      clearTimeout(timer);
    }
    this._invalidateTimers = [];

    const run = () => {
      this._syncContainerToCanvas();
      this.invalidateSize();
    };
    run();
    this._invalidateTimers.push(setTimeout(run, 80));
    this._invalidateTimers.push(setTimeout(run, 240));
    this._invalidateTimers.push(setTimeout(run, 500));
  }

  _ensureStackedWrapper() {
    if (!this.canvas || !this.container) return;

    const existingWrapper = this.canvas.parentElement;
    if (existingWrapper?.dataset?.portalMapWrapper === "true") {
      this.wrapper = existingWrapper;
      return;
    }

    const host = this.canvas.parentElement;
    if (!host) return;

    const wrapper = document.createElement("div");
    wrapper.dataset.portalMapWrapper = "true";
    Object.assign(wrapper.style, {
      position: "relative",
      display: "inline-block",
      lineHeight: "0",
      verticalAlign: "top",
      overflow: "hidden",
    });

    host.insertBefore(wrapper, this.canvas);
    wrapper.appendChild(this.container);
    wrapper.appendChild(this.canvas);
    this.wrapper = wrapper;
    this._syncContainerToCanvas();
  }

  _syncContainerToCanvas() {
    if (!this.container || !this.canvas) return;

    const canvasRect = this.canvas.getBoundingClientRect();
    const parent = this.wrapper || this.canvas.parentElement || this.container.parentElement;

    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    if (this.wrapper) {
      Object.assign(this.wrapper.style, {
        width: `${canvasRect.width}px`,
        height: `${canvasRect.height}px`,
      });
    }

    Object.assign(this.container.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: `${canvasRect.width}px`,
      height: `${canvasRect.height}px`,
      zIndex: "0",
    });
  }
}

async function createPortalMap(options = {}, initOptions = {}) {
  return await new PortalMap(options).init(initOptions);
}

window.PortalMap = PortalMap;
window.createPortalMap = createPortalMap;
