class ProjectionMapper {
  constructor() {
    this.surfaces = [];
    this.font = null;
  }

  followDebugOverlayVisibility() {}

  setFont(font) {
    this.font = font || null;
    for (const surface of this.surfaces) {
      if (this.font && typeof surface.textFont === "function") {
        surface.textFont(this.font);
      }
    }
  }

  add(w, h, name = "") {
    const surface = createGraphics(w, h);
    surface.pixelDensity(1);
    surface.imageMode(CORNER);
    surface._noMappingName = name;
    if (this.font && typeof surface.textFont === "function") {
      surface.textFont(this.font);
    }
    this.surfaces.push(surface);
    return surface;
  }

  removeLastSurface() {
    if (this.surfaces.length > 1) this.surfaces.pop();
  }

  loadAll() {}

  saveAll() {}

  resetAll() {}

  toggleCalibrate() {}

  isCalibrating() {
    return false;
  }

  isActive() {
    return false;
  }

  screenToSurface(x, y) {
    const surface = this.surfaces[0];
    if (!surface || width <= 0 || height <= 0) return null;
    if (x < 0 || y < 0 || x > width || y > height) return null;
    return {
      surfaceIndex: 0,
      x: constrain((x / width) * surface.width, 0, surface.width),
      y: constrain((y / height) * surface.height, 0, surface.height),
    };
  }

  render() {
    if (!this.surfaces.length) return;
    push();
    imageMode(CORNER);
    for (const surface of this.surfaces) {
      image(surface, 0, 0, width, height);
    }
    pop();
  }
}
