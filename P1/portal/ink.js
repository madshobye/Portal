// Particle-chain brush engine for Portal sketches.
//
// User-facing controls:
// - size
// - wildness
// - opacity
// - movement
// - fluidity
// - chain

const BRUTAL_DEBUG_DRAW = false;

class InkDrawing {
  constructor({
    layer = null,
    width = null,
    height = null,
    background = 0,
    foreground = 255,
    recipe = "calligraphy",
    controls = {},
  } = {}) {
    this.layer = layer || null;
    this.width = width;
    this.height = height;
    this.backgroundColor = background;
    this.foregroundColor = foreground;
    this.recipeName = String(recipe || "calligraphy");
    this.pointerState = new Map();
    this.noiseSeed = random(10000);
    this.ready = false;

    this.recipes = this._buildRecipes();
    this.controls = this._mergeControls({
      size: 1.0,
      wildness: 0.25,
      opacity: 0.85,
      movement: 0.55,
      fluidity: 0.45,
      chain: 0.25,
    }, controls);
  }

  async init() {
    if (!this.layer) {
      const w = Math.max(1, Number(this.width) || width || windowWidth || 1);
      const h = Math.max(1, Number(this.height) || height || windowHeight || 1);
      this.layer = createGraphics(w, h);
    }

    if (typeof this.layer.pixelDensity === "function") this.layer.pixelDensity(1);
    this.clear();

    if (typeof simplexNoise === "undefined" && typeof OpenSimplexNoise !== "undefined") {
      simplexNoise = new OpenSimplexNoise(Date.now());
    }

    if (!this.recipes[this.recipeName]) this.recipeName = "calligraphy";
    this.ready = true;
    return this;
  }

  getLayer() {
    return this.layer;
  }

  getRecipes() {
    return Object.keys(this.recipes);
  }

  getRecipeEntries() {
    return this.getRecipes().map((key) => ({
      key,
      label: this.recipes[key].label,
      family: this.recipes[key].family,
    }));
  }

  getRecipe() {
    return this.recipes[this.recipeName];
  }

  setRecipe(name) {
    const key = String(name || "").trim();
    if (!this.recipes[key]) throw new Error(`InkDrawing: unknown recipe "${name}"`);
    this.recipeName = key;
    return this.getRecipe();
  }

  setMode(name) {
    return this.setRecipe(name);
  }

  patchControls(patch = {}) {
    this.controls = this._mergeControls(this.controls, patch || {});
    return this.getControls();
  }

  patchParams(patch = {}) {
    return this.patchControls(patch);
  }

  resetPointers() {
    this.pointerState.clear();
  }

  getControls() {
    return { ...this.controls };
  }

  clear(background = this.backgroundColor) {
    if (!this.layer) return;
    this.layer.push();
    if (background == null) this.layer.clear();
    else this.layer.background(background);
    this.layer.pop();
  }

  fade(amount = 0.03, color = this.backgroundColor) {
    if (!this.layer) return;
    const a = this._clamp01(amount);
    this.layer.push();
    this.layer.noStroke();
    this.layer.fill(this._colorWithAlpha(color, a * 255));
    this.layer.rect(0, 0, this.layer.width, this.layer.height);
    this.layer.pop();
  }

  resize(w, h, preserve = true) {
    const nextW = Math.max(1, Number(w) || 1);
    const nextH = Math.max(1, Number(h) || 1);
    if (!this.layer) {
      this.width = nextW;
      this.height = nextH;
      return;
    }

    const old = this.layer;
    const next = createGraphics(nextW, nextH);
    if (typeof next.pixelDensity === "function") next.pixelDensity(1);
    next.background(this.backgroundColor);
    if (preserve) next.image(old, 0, 0);
    this.layer = next;
  }

  draw(x = 0, y = 0, w = null, h = null) {
    if (!this.layer || typeof image !== "function") return;
    if (w == null || h == null) image(this.layer, x, y);
    else image(this.layer, x, y, w, h);
  }

  getDebugSnapshot() {
    const pointers = [];
    for (const state of this.pointerState.values()) {
      pointers.push({
        id: state.id,
        x: state.hx,
        y: state.hy,
        hold: state.hold,
        speed: state.speed,
        chains: (state.chains || []).map((chain) =>
          chain.particles.map((p) => ({
            x: p.x,
            y: p.y,
            ink: p.ink,
          }))
        ),
      });
    }
    return {
      recipe: this.recipeName,
      controls: this.getControls(),
      pointerCount: pointers.length,
      pointers,
    };
  }

  drawDebug(target = null) {
    const g = target || this.layer;
    if (!g) return;
    const snapshot = this.getDebugSnapshot();

    g.push();
    for (const pointer of snapshot.pointers) {
      g.noFill();
      g.stroke(0, 255, 255, 180);
      g.strokeWeight(1);
      g.circle(pointer.x, pointer.y, 16);

      for (const chain of pointer.chains) {
        for (let i = 0; i < chain.length; i++) {
          const p = chain[i];
          if (i > 0) {
            const prev = chain[i - 1];
            g.stroke(255, 180, 0, 120);
            g.line(prev.x, prev.y, p.x, p.y);
          }
          g.noStroke();
          g.fill(255, 0, 120, 180);
          g.circle(p.x, p.y, Math.max(2.5, 5.5 - i * 0.2));
        }
      }
    }
    g.pop();
  }

  beginStroke(id, x, y) {
    const key = String(id);
    const nx = Number(x);
    const ny = Number(y);
    this.pointerState.set(key, {
      id: key,
      x: nx,
      y: ny,
      hx: nx,
      hy: ny,
      heading: 0,
      speed: 0,
      accel: 0,
      hold: 0,
      age: 0,
      history: [
        { x: nx, y: ny },
        { x: nx, y: ny },
        { x: nx, y: ny },
        { x: nx, y: ny },
      ],
      chains: [],
      started: false,
    });
  }

  endStroke(id) {
    this.pointerState.delete(String(id));
  }

  updatePointers(pointers = []) {
    const list = Array.isArray(pointers) ? pointers : [];
    const active = new Set();

    for (const p of list) {
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
      const id = String(p.id ?? `p${active.size}`);
      active.add(id);
      this.strokeTo(id, Number(p.x), Number(p.y), p);
    }

    for (const id of Array.from(this.pointerState.keys())) {
      if (!active.has(id)) this.endStroke(id);
    }
  }

  updateMouse(pressed = mouseIsPressed, x = mouseX, y = mouseY) {
    if (pressed) this.updatePointers([{ id: "mouse", x, y }]);
    else this.updatePointers([]);
  }

  strokeTo(id, x, y, extra = {}) {
    if (!this.ready || !this.layer) return;

    const key = String(id);
    if (!this.pointerState.has(key)) this.beginStroke(key, x, y);
    const state = this.pointerState.get(key);
    const recipe = this.getRecipe();
    const dyn = this._deriveDynamics(recipe, state, extra);

    const nx = Number(x);
    const ny = Number(y);
    if (BRUTAL_DEBUG_DRAW) {
      this._debugMark(this.layer, "square", nx, ny, 18, [255, 0, 0, 240]);
    }
    const dtMs = this._clamp(Number(typeof deltaTime !== "undefined" ? deltaTime : 16.6667) || 16.6667, 4, 40);
    const dtFrames = dtMs / 16.6667;
    const prevSpeed = state.speed;
    const rawDx = nx - state.x;
    const rawDy = ny - state.y;
    const rawDist = Math.hypot(rawDx, rawDy);

    state.hx = this._lerp(state.hx, nx, dyn.follow);
    state.hy = this._lerp(state.hy, ny, dyn.follow);
    if (BRUTAL_DEBUG_DRAW) {
      this._debugMark(this.layer, "circle", state.hx + 22, state.hy, 18, [0, 255, 120, 240]);
      this.layer.push();
      this.layer.stroke(0, 120, 255, 220);
      this.layer.strokeWeight(4);
      this.layer.line(nx, ny, state.hx + 22, state.hy);
      this.layer.pop();
    }

    const filteredDx = state.hx - state.x;
    const filteredDy = state.hy - state.y;
    const filteredDist = Math.hypot(filteredDx, filteredDy);
    const nextHeading = filteredDist > 0.0001 ? Math.atan2(filteredDy, filteredDx) : state.heading;
    const normalizedSpeed = filteredDist / Math.max(0.2, dtFrames);
    state.speed = this._lerp(state.speed, normalizedSpeed, 0.28 + dyn.movement * 0.2);
    state.accel = this._lerp(state.accel, Math.abs(state.speed - prevSpeed), 0.22);
    state.heading = this._lerpAngle(state.heading, nextHeading, 0.35);
    state.hold = rawDist < dyn.holdThreshold ? Math.min(1, state.hold + 0.09) : Math.max(0, state.hold - 0.16);
    state.age += 1;

    state.history.push({ x: state.hx, y: state.hy });
    if (state.history.length > 4) state.history.shift();

    if (!state.chains.length) {
      this._resetChains(state, dyn);
      if (BRUTAL_DEBUG_DRAW) {
        this._debugMark(this.layer, "diamond", state.hx, state.hy + 22, 20, [0, 140, 255, 240]);
      }
    }

    if (!state.started) {
      if (BRUTAL_DEBUG_DRAW) {
        this._debugMark(this.layer, "cross", state.hx - 22, state.hy, 20, [255, 255, 255, 240]);
      }
      state.x = state.hx;
      state.y = state.hy;
      state.started = true;
      return;
    }

    if (BRUTAL_DEBUG_DRAW) {
      this._debugDrawPath(state, dyn);
    }

    this._renderStroke(state, dyn, dtFrames);
    state.x = state.hx;
    state.y = state.hy;
  }

  _debugDrawPath(state, dyn) {
    const r = random(40, 255);
    const g = random(40, 255);
    const b = random(40, 255);
    const alpha = 180;
    const radius = Math.max(6, dyn.size * 0.28);

    this.layer.push();
    this.layer.stroke(r, g, b, alpha);
    this.layer.strokeWeight(Math.max(2, radius * 0.35));
    this.layer.line(state.x, state.y, state.hx, state.hy);
    this.layer.noStroke();
    this.layer.fill(r, g, b, alpha);
    this.layer.circle(state.hx, state.hy, radius * 2);
    this.layer.pop();
  }

  _renderStroke(state, dyn, dtFrames) {
    const history = state.history;
    const p0 = history[0];
    const p1 = history[1];
    const p2 = history[2];
    const p3 = history[3];
    const moved = Math.hypot(p3.x - p2.x, p3.y - p2.y);

    if (moved < dyn.moveFloor && state.hold < 0.02) return;

    const substeps = Math.max(
      1,
      Math.floor((moved + dyn.size * 0.2) / Math.max(0.8, dyn.spacing))
    );
    const speed01 = this._clamp01(state.speed / dyn.speedRef);
    const accel01 = this._clamp01(state.accel / dyn.accelRef);

    for (let i = 1; i <= substeps; i++) {
      const t = i / substeps;
      const root = this._catmullRomPoint(p0, p1, p2, p3, t);
      if (BRUTAL_DEBUG_DRAW) {
        this._debugMark(this.layer, "triangle", root.x, root.y - 22, 18, [255, 180, 0, 240]);
      }
      const heading = this._catmullRomTangent(p0, p1, p2, p3, t);
      const ang = Math.atan2(heading.y, heading.x || 0.0001);
      this._stepBrushChains(state, dyn, root, ang, speed01, accel01, t, dtFrames / substeps);
    }
  }

  _stepBrushChains(state, dyn, root, ang, speed01, accel01, t, dtStep) {
    const forceDt = Math.max(0.85, dtStep);
    const posDt = Math.max(0.6, dtStep);
    const normalX = Math.cos(ang + HALF_PI);
    const normalY = Math.sin(ang + HALF_PI);
    const tangentX = Math.cos(ang);
    const tangentY = Math.sin(ang);
    const rough = this._paperNoise(root.x * dyn.paperScale, root.y * dyn.paperScale, state.age * 0.03 + t);
    const holdCollapse = state.hold * dyn.collapse;

    if (BRUTAL_DEBUG_DRAW) {
      this._debugMark(this.layer, "cross", root.x, root.y, 10, [255, 255, 255, 180]);
    }

    for (let c = 0; c < state.chains.length; c++) {
      const chain = state.chains[c];
      const offset = this._brushLayoutOffset(dyn, c, state.chains.length, normalX, normalY, tangentX, tangentY);
      const chainNoise = this._noise3(
        root.x * dyn.motionNoiseScale + c * 0.13,
        root.y * dyn.motionNoiseScale - c * 0.07,
        state.age * 0.02
      );
      const slosh = dyn.fluidity * (0.8 + speed01 * 1.2);

      const targetX =
        root.x +
        offset.x * (1 - holdCollapse) +
        tangentX * dyn.flow * speed01 * dyn.size +
        chainNoise * dyn.wild * slosh * dyn.size * 0.9;
      const targetY =
        root.y +
        offset.y * (1 - holdCollapse) +
        tangentY * dyn.flow * speed01 * dyn.size +
        chainNoise * dyn.wild * slosh * dyn.size * 0.9;

      for (let p = 0; p < chain.particles.length; p++) {
        const particle = chain.particles[p];
        particle.px = particle.x;
        particle.py = particle.y;
      }

      const head = chain.particles[0];
      head.vx += (targetX - head.x) * dyn.rootPull * forceDt;
      head.vy += (targetY - head.y) * dyn.rootPull * forceDt;

      for (let p = 1; p < chain.particles.length; p++) {
        const prev = chain.particles[p - 1];
        const cur = chain.particles[p];
        const dx = prev.x - cur.x;
        const dy = prev.y - cur.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const rest = cur.rest * (1 - holdCollapse * 0.55);
        const stretch = dist - rest;
        const pull = stretch * dyn.spring;
        cur.vx += (dx / dist) * pull * forceDt;
        cur.vy += (dy / dist) * pull * forceDt;

        if (dyn.align > 0.001 && p > 1) {
          const prevPrev = chain.particles[p - 2];
          const ax = prevPrev.x - prev.x;
          const ay = prevPrev.y - prev.y;
          const bx = prev.x - cur.x;
          const by = prev.y - cur.y;
          cur.vx += (ax - bx) * dyn.align * forceDt;
          cur.vy += (ay - by) * dyn.align * forceDt;
        }
      }

      for (let p = 0; p < chain.particles.length; p++) {
        const particle = chain.particles[p];
        const depth01 = p / Math.max(1, chain.particles.length - 1);
        const depthLag = 1 + depth01 * dyn.dragChain;
        const grit = rough * dyn.gritBounce * (0.3 + depth01 * 0.8);
        const rollNoise = this._noise3(
          particle.x * dyn.rollScale + c * 0.31,
          particle.y * dyn.rollScale - p * 0.17,
          state.age * 0.04
        );

        particle.vx += (normalX * grit + tangentX * rollNoise * dyn.roll) * forceDt;
        particle.vy += (normalY * grit + tangentY * rollNoise * dyn.roll) * forceDt;
        const dragMul = Math.max(0.05, 1 - dyn.drag * depthLag * posDt);
        particle.vx *= dragMul;
        particle.vy *= dragMul;
        particle.x += particle.vx * posDt;
        particle.y += particle.vy * posDt;
      }

      for (let iter = 0; iter < dyn.constraintIters; iter++) {
        head.x = this._lerp(head.x, targetX, dyn.headLock * (iter === 0 ? 1 : 0.7));
        head.y = this._lerp(head.y, targetY, dyn.headLock * (iter === 0 ? 1 : 0.7));

        for (let p = 1; p < chain.particles.length; p++) {
          const prev = chain.particles[p - 1];
          const cur = chain.particles[p];
          const dx = cur.x - prev.x;
          const dy = cur.y - prev.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          const rest = cur.rest * (1 - holdCollapse * 0.55);
          const error = (dist - rest) / dist;
          const stiffness = dyn.constraintStiffness * (1 - (p / Math.max(2, chain.particles.length)) * 0.12);
          const corrX = dx * error * 0.5 * stiffness;
          const corrY = dy * error * 0.5 * stiffness;

          if (p === 1) {
            cur.x -= corrX * 2;
            cur.y -= corrY * 2;
          } else {
            prev.x += corrX;
            prev.y += corrY;
            cur.x -= corrX;
            cur.y -= corrY;
          }
        }
      }

      for (let p = 0; p < chain.particles.length; p++) {
        const particle = chain.particles[p];
        particle.vx = (particle.x - particle.px) / Math.max(0.5, posDt);
        particle.vy = (particle.y - particle.py) / Math.max(0.5, posDt);
      }

      for (let p = 0; p < chain.particles.length; p++) {
        const particle = chain.particles[p];
        const depth01 = p / Math.max(1, chain.particles.length - 1);

        this._depositParticle(state, dyn, chain, particle, depth01, speed01, accel01, rough);
      }
    }
  }

  _depositParticle(state, dyn, chain, particle, depth01, speed01, accel01, rough) {
    const dx = particle.x - particle.px;
    const dy = particle.y - particle.py;
    const travel = Math.hypot(dx, dy);
    const moving = travel > 0.001;

    particle.ink = this._clamp(
      particle.ink +
        dyn.reload * (0.004 + state.hold * 0.01) -
        dyn.depositRate * (0.01 + speed01 * 0.008 + depth01 * 0.004),
      0.05,
      1.4
    );

    if (!moving && state.hold < 0.02) return;

    const gritBreak = this._clamp01(Math.abs(rough) * dyn.grit * (0.5 + depth01 * 0.7));
    const alpha =
      255 *
      dyn.opacity *
      this._lerp(0.35, 1.0, particle.ink) *
      this._lerp(0.55, 1.0 + state.hold * 0.5, depth01 * 0.35 + 0.3) *
      (0.8 - gritBreak * 0.25);

    const radius =
      dyn.particleRadius *
      this._lerp(1.05, 0.45, depth01) *
      (1 + dyn.slosh * speed01 * 0.5 + dyn.wild * 0.25);

    if (dyn.strokeLineAlpha > 0.001 && travel > 0.02) {
      this.layer.push();
      this.layer.stroke(this._colorWithAlpha(this.foregroundColor, alpha * dyn.strokeLineAlpha));
      this.layer.strokeWeight(Math.max(0.5, radius * (0.45 + dyn.strokeLineWeight)));
      this.layer.line(particle.px, particle.py, particle.x, particle.y);
      this.layer.pop();
    }

    const stampSteps = moving
      ? Math.max(1, Math.floor(travel / Math.max(0.6, radius * 0.32)))
      : 1;
    this.layer.push();
    this.layer.noStroke();
    this.layer.fill(this._colorWithAlpha(this.foregroundColor, alpha));
    for (let i = 1; i <= stampSteps; i++) {
      const tt = stampSteps === 1 ? 1 : i / stampSteps;
      const sx = this._lerp(particle.px, particle.x, tt);
      const sy = this._lerp(particle.py, particle.y, tt);
      this.layer.circle(sx, sy, Math.max(0.8, radius * 2));
    }
    this.layer.pop();

    if (dyn.bleed > 0.001) {
      this.layer.push();
      this.layer.noStroke();
      this.layer.fill(this._colorWithAlpha(this.foregroundColor, alpha * dyn.bleed * 0.18));
      this.layer.circle(particle.x, particle.y, Math.max(1, radius * (2.4 + dyn.bleed * 2.4)));
      this.layer.pop();
    }

    if (dyn.grit > 0.001) {
      const specks = Math.floor((1 + radius * 0.4) * dyn.grit * (0.5 + speed01 * 0.4));
      this.layer.push();
      this.layer.stroke(this._colorWithAlpha(this.foregroundColor, alpha * 0.24));
      this.layer.strokeWeight(1);
      for (let i = 0; i < specks; i++) {
        const a = random(TWO_PI);
        const r = random(0, radius * (1.3 + dyn.grit));
        this.layer.point(particle.x + Math.cos(a) * r, particle.y + Math.sin(a) * r);
      }
      this.layer.pop();
    }

    if (dyn.splatter > 0.001 && random() < dyn.splatter * (0.05 + speed01 * 0.14 + accel01 * 0.12)) {
      const burst = Math.floor(2 + dyn.splatter * 7 + dyn.wild * 5);
      this.layer.push();
      this.layer.noStroke();
      for (let i = 0; i < burst; i++) {
        const a = random(TWO_PI);
        const throwDist = random(radius, radius * (4 + dyn.fluidity * 3 + dyn.wild * 4));
        const px = particle.x + Math.cos(a) * throwDist;
        const py = particle.y + Math.sin(a) * throwDist;
        const r = random(0.8, radius * (0.6 + dyn.splatter));
        this.layer.fill(this._colorWithAlpha(this.foregroundColor, alpha * random(0.15, 0.45)));
        this.layer.circle(px, py, r * 2);
      }
      this.layer.pop();
    }
  }

  _debugMark(target, shape, x, y, size, rgba) {
    if (!target || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const [r, g, b, a] = rgba;
    const s = Math.max(2, size);
    target.push();
    target.stroke(r, g, b, a);
    target.fill(r, g, b, a);
    target.strokeWeight(1.5);
    if (shape === "square") {
      target.rectMode(CENTER);
      target.rect(x, y, s, s);
    } else if (shape === "circle") {
      target.circle(x, y, s);
    } else if (shape === "diamond") {
      target.beginShape();
      target.vertex(x, y - s * 0.6);
      target.vertex(x + s * 0.6, y);
      target.vertex(x, y + s * 0.6);
      target.vertex(x - s * 0.6, y);
      target.endShape(CLOSE);
    } else if (shape === "triangle") {
      target.triangle(x, y - s * 0.65, x + s * 0.6, y + s * 0.5, x - s * 0.6, y + s * 0.5);
    } else if (shape === "cross") {
      target.line(x - s * 0.5, y, x + s * 0.5, y);
      target.line(x, y - s * 0.5, x, y + s * 0.5);
    }
    target.pop();
  }

  _resetChains(state, dyn) {
    state.chains = [];
    const root = { x: state.hx, y: state.hy };
    for (let c = 0; c < dyn.chainCount; c++) {
      const chain = {
        particles: [],
      };
      for (let p = 0; p < dyn.particlesPerChain; p++) {
        const depth01 = p / Math.max(1, dyn.particlesPerChain - 1);
        const normal = this._brushLayoutOffset(dyn, c, dyn.chainCount, 1, 0, 0, 1);
        const px = root.x + normal.x - depth01 * dyn.restLength * dyn.particlesPerChain;
        const py = root.y + normal.y;
        chain.particles.push({
          x: px,
          y: py,
          px,
          py,
          vx: 0,
          vy: 0,
          ink: random(0.7, 1.15),
          rest: dyn.restLength * this._lerp(0.85, 1.25, random()),
        });
      }
      state.chains.push(chain);
    }
  }

  _brushLayoutOffset(dyn, chainIndex, chainCount, nx, ny, tx, ty) {
    if (dyn.layout === "circle") {
      const angle = ((chainIndex / Math.max(1, chainCount)) * TWO_PI) + dyn.layoutRotation;
      const rx = Math.cos(angle) * dyn.bundleRadius;
      const ry = Math.sin(angle) * dyn.bundleRadius;
      return {
        x: nx * rx + tx * ry * 0.28,
        y: ny * rx + ty * ry * 0.28,
      };
    }

    const span = (chainCount - 1) * 0.5;
    const offset = (chainIndex - span) * dyn.bundleGap;
    return {
      x: nx * offset,
      y: ny * offset,
    };
  }

  _deriveDynamics(recipe, state, extra = {}) {
    const controls = this.controls;
    const pressure = this._clamp(Number(extra.pressure ?? 1), 0.25, 2.0);
    const wild = controls.wildness;
    const movement = controls.movement;
    const fluidity = controls.fluidity;
    const chain = controls.chain;
    const size = recipe.baseSize * controls.size * pressure;
    const longChain = this._lerp(recipe.chainLengthMin, recipe.chainLengthMax, this._clamp01(chain * 0.55 + wild * 0.75));

    return {
      family: recipe.family,
      layout: recipe.layout,
      layoutRotation: recipe.layoutRotation || 0,
      size,
      wild,
      movement,
      fluidity,
      chain,
      opacity: this._lerp(0.04, 1.0, controls.opacity) * recipe.opacity,
      follow: this._clamp((Number(recipe.follow) || 0.45) * (0.45 + movement * 0.75), 0.03, 0.92),
      speedRef: recipe.speedRef,
      accelRef: recipe.accelRef,
      holdThreshold: recipe.holdThreshold,
      moveFloor: recipe.moveFloor,
      spacing: Math.max(0.5, recipe.spacing / (0.55 + movement * 0.8)),
      chainCount: Math.max(1, Math.round(recipe.chainCount * this._lerp(0.85, 1.7, size / 30))),
      particlesPerChain: Math.max(2, Math.round(recipe.particlesPerChain + chain * recipe.chainParticleGain)),
      restLength: Math.max(1.2, (longChain * size) / Math.max(2, recipe.particlesPerChain + chain * recipe.chainParticleGain)),
      spring: recipe.spring * (0.9 - wild * 0.42) * (0.55 + movement * 0.25 + (1 - fluidity) * 0.55),
      drag: recipe.drag * (0.3 + (1 - movement) * 0.35 + fluidity * 0.3 + wild * 0.18),
      dragChain: recipe.dragChain * (0.3 + chain * 1.25),
      rootPull: recipe.rootPull * (0.85 - wild * 0.4) * (0.45 + movement * 0.55),
      headLock: this._clamp(0.22 + movement * 0.18 + (1 - wild) * 0.08, 0.16, 0.42),
      constraintStiffness: this._clamp(0.42 + movement * 0.16 + chain * 0.12 + (1 - fluidity) * 0.08, 0.35, 0.82),
      constraintIters: 3,
      align: recipe.align * (0.35 + movement * 0.3 + chain * 0.25 + (1 - wild) * 0.35),
      collapse: recipe.collapse * (0.25 + fluidity * 0.55 + (1 - movement) * 0.25),
      roll: recipe.roll * (0.08 + wild * 0.32 + fluidity * 0.12),
      flow: recipe.flow * (0.18 + movement * 0.4 + fluidity * 1.1),
      slosh: recipe.slosh * (0.2 + fluidity * 1.2 + wild * 0.3),
      particleRadius: recipe.particleRadius * size * this._lerp(0.7, 1.25, fluidity),
      bundleGap: recipe.bundleGap * size,
      bundleRadius: recipe.bundleRadius * size * (0.75 + wild * 0.45 + fluidity * 0.25),
      grit: recipe.grit * (0.1 + wild * 1.35),
      gritBounce: recipe.gritBounce * (0.08 + wild * 0.35 + fluidity * 0.12),
      bleed: recipe.bleed * (0.08 + fluidity * 1.2 + wild * 0.25),
      splatter: recipe.splatter * (0.06 + wild * 1.0 + fluidity * 0.55),
      strokeLineAlpha: 0,
      strokeLineWeight: recipe.strokeLineWeight,
      depositRate: recipe.depositRate * (0.16 + controls.opacity * 0.22 + movement * 0.12),
      reload: recipe.reload * (0.4 + fluidity * 0.7),
      paperScale: recipe.paperScale,
      motionNoiseScale: recipe.motionNoiseScale,
      rollScale: recipe.rollScale,
    };
  }

  _buildRecipes() {
    return {
      calligraphy: {
        label: "Calligraphy",
        family: "common",
        layout: "row",
        baseSize: 18,
        chainCount: 3,
        particlesPerChain: 5,
        chainParticleGain: 4,
        chainLengthMin: 2.2,
        chainLengthMax: 5.5,
        spring: 0.28,
        drag: 0.12,
        dragChain: 0.3,
        rootPull: 0.22,
        align: 0.2,
        collapse: 0.55,
        roll: 0.03,
        flow: 0.1,
        slosh: 0.12,
        particleRadius: 0.16,
        bundleGap: 0.42,
        bundleRadius: 0.28,
        grit: 0.04,
        gritBounce: 0.06,
        bleed: 0.02,
        splatter: 0.0,
        strokeLineAlpha: 0.35,
        strokeLineWeight: 0.16,
        depositRate: 0.22,
        reload: 0.18,
        opacity: 0.85,
        spacing: 2.4,
        holdThreshold: 0.4,
        moveFloor: 0.03,
        speedRef: 18,
        accelRef: 7,
        paperScale: 0.012,
        motionNoiseScale: 0.006,
        rollScale: 0.01,
      },
      chisel_black: {
        label: "Chisel Black",
        family: "common",
        layout: "row",
        baseSize: 26,
        chainCount: 5,
        particlesPerChain: 4,
        chainParticleGain: 3,
        chainLengthMin: 1.8,
        chainLengthMax: 4.0,
        spring: 0.35,
        drag: 0.16,
        dragChain: 0.22,
        rootPull: 0.26,
        align: 0.32,
        collapse: 0.65,
        roll: 0.02,
        flow: 0.05,
        slosh: 0.08,
        particleRadius: 0.22,
        bundleGap: 0.38,
        bundleRadius: 0.2,
        grit: 0.02,
        gritBounce: 0.03,
        bleed: 0.01,
        splatter: 0.0,
        strokeLineAlpha: 0.42,
        strokeLineWeight: 0.24,
        depositRate: 0.28,
        reload: 0.18,
        opacity: 0.95,
        spacing: 2.1,
        holdThreshold: 0.35,
        moveFloor: 0.02,
        speedRef: 20,
        accelRef: 8,
        paperScale: 0.012,
        motionNoiseScale: 0.004,
        rollScale: 0.008,
      },
      fine_liner: {
        label: "Fine Liner",
        family: "common",
        layout: "circle",
        layoutRotation: 0.2,
        baseSize: 10,
        chainCount: 1,
        particlesPerChain: 3,
        chainParticleGain: 2,
        chainLengthMin: 1.0,
        chainLengthMax: 2.0,
        spring: 0.42,
        drag: 0.18,
        dragChain: 0.12,
        rootPull: 0.3,
        align: 0.4,
        collapse: 0.75,
        roll: 0.01,
        flow: 0.04,
        slosh: 0.04,
        particleRadius: 0.2,
        bundleGap: 0.2,
        bundleRadius: 0.08,
        grit: 0.0,
        gritBounce: 0.0,
        bleed: 0.0,
        splatter: 0.0,
        strokeLineAlpha: 0.7,
        strokeLineWeight: 0.08,
        depositRate: 0.18,
        reload: 0.14,
        opacity: 0.65,
        spacing: 1.2,
        holdThreshold: 0.3,
        moveFloor: 0.01,
        speedRef: 16,
        accelRef: 6,
        paperScale: 0.016,
        motionNoiseScale: 0.004,
        rollScale: 0.008,
      },
      dry_marker: {
        label: "Dry Marker",
        family: "common",
        layout: "row",
        baseSize: 22,
        chainCount: 4,
        particlesPerChain: 5,
        chainParticleGain: 3,
        chainLengthMin: 2.0,
        chainLengthMax: 5.0,
        spring: 0.26,
        drag: 0.18,
        dragChain: 0.38,
        rootPull: 0.2,
        align: 0.22,
        collapse: 0.45,
        roll: 0.08,
        flow: 0.08,
        slosh: 0.12,
        particleRadius: 0.18,
        bundleGap: 0.34,
        bundleRadius: 0.24,
        grit: 0.4,
        gritBounce: 0.22,
        bleed: 0.0,
        splatter: 0.03,
        strokeLineAlpha: 0.24,
        strokeLineWeight: 0.12,
        depositRate: 0.3,
        reload: 0.08,
        opacity: 0.72,
        spacing: 2.2,
        holdThreshold: 0.45,
        moveFloor: 0.02,
        speedRef: 20,
        accelRef: 8,
        paperScale: 0.02,
        motionNoiseScale: 0.01,
        rollScale: 0.016,
      },
      felt_tip: {
        label: "Felt Tip",
        family: "common",
        layout: "circle",
        baseSize: 18,
        chainCount: 3,
        particlesPerChain: 4,
        chainParticleGain: 2,
        chainLengthMin: 1.5,
        chainLengthMax: 3.2,
        spring: 0.3,
        drag: 0.14,
        dragChain: 0.2,
        rootPull: 0.24,
        align: 0.26,
        collapse: 0.55,
        roll: 0.04,
        flow: 0.1,
        slosh: 0.18,
        particleRadius: 0.22,
        bundleGap: 0.28,
        bundleRadius: 0.24,
        grit: 0.04,
        gritBounce: 0.05,
        bleed: 0.1,
        splatter: 0.0,
        strokeLineAlpha: 0.28,
        strokeLineWeight: 0.16,
        depositRate: 0.2,
        reload: 0.14,
        opacity: 0.72,
        spacing: 1.8,
        holdThreshold: 0.4,
        moveFloor: 0.02,
        speedRef: 18,
        accelRef: 7,
        paperScale: 0.014,
        motionNoiseScale: 0.006,
        rollScale: 0.01,
      },
      bleeding_felt: {
        label: "Bleeding Felt",
        family: "interesting",
        layout: "circle",
        baseSize: 24,
        chainCount: 5,
        particlesPerChain: 5,
        chainParticleGain: 3,
        chainLengthMin: 2.2,
        chainLengthMax: 5.0,
        spring: 0.2,
        drag: 0.12,
        dragChain: 0.26,
        rootPull: 0.18,
        align: 0.12,
        collapse: 0.48,
        roll: 0.08,
        flow: 0.16,
        slosh: 0.3,
        particleRadius: 0.24,
        bundleGap: 0.34,
        bundleRadius: 0.34,
        grit: 0.08,
        gritBounce: 0.08,
        bleed: 0.42,
        splatter: 0.04,
        strokeLineAlpha: 0.1,
        strokeLineWeight: 0.1,
        depositRate: 0.15,
        reload: 0.16,
        opacity: 0.45,
        spacing: 2.4,
        holdThreshold: 0.48,
        moveFloor: 0.02,
        speedRef: 16,
        accelRef: 6,
        paperScale: 0.016,
        motionNoiseScale: 0.008,
        rollScale: 0.012,
      },
      ghost_marker: {
        label: "Ghost Marker",
        family: "interesting",
        layout: "row",
        baseSize: 20,
        chainCount: 3,
        particlesPerChain: 7,
        chainParticleGain: 4,
        chainLengthMin: 3.0,
        chainLengthMax: 7.0,
        spring: 0.14,
        drag: 0.08,
        dragChain: 0.48,
        rootPull: 0.16,
        align: 0.08,
        collapse: 0.24,
        roll: 0.14,
        flow: 0.2,
        slosh: 0.3,
        particleRadius: 0.16,
        bundleGap: 0.34,
        bundleRadius: 0.24,
        grit: 0.06,
        gritBounce: 0.08,
        bleed: 0.08,
        splatter: 0.02,
        strokeLineAlpha: 0.08,
        strokeLineWeight: 0.08,
        depositRate: 0.1,
        reload: 0.12,
        opacity: 0.25,
        spacing: 2.8,
        holdThreshold: 0.4,
        moveFloor: 0.02,
        speedRef: 16,
        accelRef: 6,
        paperScale: 0.016,
        motionNoiseScale: 0.01,
        rollScale: 0.014,
      },
      splatter_marker: {
        label: "Splatter Marker",
        family: "interesting",
        layout: "circle",
        baseSize: 20,
        chainCount: 4,
        particlesPerChain: 5,
        chainParticleGain: 4,
        chainLengthMin: 2.0,
        chainLengthMax: 5.5,
        spring: 0.22,
        drag: 0.12,
        dragChain: 0.3,
        rootPull: 0.22,
        align: 0.12,
        collapse: 0.4,
        roll: 0.14,
        flow: 0.22,
        slosh: 0.24,
        particleRadius: 0.18,
        bundleGap: 0.32,
        bundleRadius: 0.28,
        grit: 0.12,
        gritBounce: 0.12,
        bleed: 0.04,
        splatter: 0.24,
        strokeLineAlpha: 0.2,
        strokeLineWeight: 0.12,
        depositRate: 0.18,
        reload: 0.14,
        opacity: 0.4,
        spacing: 2.0,
        holdThreshold: 0.38,
        moveFloor: 0.02,
        speedRef: 18,
        accelRef: 7,
        paperScale: 0.018,
        motionNoiseScale: 0.01,
        rollScale: 0.014,
      },
      spray_paint: {
        label: "Spray Paint",
        family: "interesting",
        layout: "circle",
        baseSize: 16,
        chainCount: 7,
        particlesPerChain: 2,
        chainParticleGain: 2,
        chainLengthMin: 0.8,
        chainLengthMax: 2.0,
        spring: 0.12,
        drag: 0.06,
        dragChain: 0.1,
        rootPull: 0.14,
        align: 0.02,
        collapse: 0.14,
        roll: 0.18,
        flow: 0.26,
        slosh: 0.38,
        particleRadius: 0.14,
        bundleGap: 0.28,
        bundleRadius: 0.7,
        grit: 0.22,
        gritBounce: 0.14,
        bleed: 0.0,
        splatter: 0.4,
        strokeLineAlpha: 0.0,
        strokeLineWeight: 0.0,
        depositRate: 0.08,
        reload: 0.1,
        opacity: 0.22,
        spacing: 1.0,
        holdThreshold: 0.35,
        moveFloor: 0.01,
        speedRef: 14,
        accelRef: 5,
        paperScale: 0.02,
        motionNoiseScale: 0.012,
        rollScale: 0.018,
      },
      drag_brush: {
        label: "Drag Brush",
        family: "interesting",
        layout: "row",
        baseSize: 22,
        chainCount: 3,
        particlesPerChain: 10,
        chainParticleGain: 8,
        chainLengthMin: 4.0,
        chainLengthMax: 15.0,
        spring: 0.075,
        drag: 0.045,
        dragChain: 0.75,
        rootPull: 0.095,
        align: 0.18,
        collapse: 0.12,
        roll: 0.035,
        flow: 0.28,
        slosh: 0.18,
        particleRadius: 0.16,
        bundleGap: 0.36,
        bundleRadius: 0.24,
        grit: 0.08,
        gritBounce: 0.08,
        bleed: 0.02,
        splatter: 0.08,
        strokeLineAlpha: 0.12,
        strokeLineWeight: 0.12,
        depositRate: 0.055,
        reload: 0.12,
        opacity: 0.24,
        spacing: 2.2,
        holdThreshold: 0.38,
        moveFloor: 0.02,
        speedRef: 18,
        accelRef: 7,
        paperScale: 0.02,
        motionNoiseScale: 0.012,
        rollScale: 0.02,
      },
    };
  }

  _mergeControls(base, patch) {
    const next = Object.assign({}, base || {}, patch || {});
    next.size = this._clamp(Number(next.size) || 1, 0.15, 4);
    next.wildness = this._clamp01(Number(next.wildness) || 0);
    next.opacity = this._clamp01(Number(next.opacity) || 0);
    next.movement = this._clamp01(Number(next.movement) || 0);
    next.fluidity = this._clamp01(Number(next.fluidity) || 0);
    next.chain = this._clamp01(Number(next.chain) || 0);
    return next;
  }

  _catmullRomPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x:
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y:
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
  }

  _catmullRomTangent(p0, p1, p2, p3, t) {
    const t2 = t * t;
    return {
      x:
        0.5 *
        ((-p0.x + p2.x) +
          2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t +
          3 * (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t2),
      y:
        0.5 *
        ((-p0.y + p2.y) +
          2 * (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t +
          3 * (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t2),
    };
  }

  _paperNoise(x, y, z = 0) {
    return this._noise3(x, y, z);
  }

  _noise2(x, y) {
    if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise2D === "function") {
      return simplexNoise.noise2D(x + this.noiseSeed, y + this.noiseSeed * 0.31);
    }
    return this._map(noise(x, y), 0, 1, -1, 1);
  }

  _noise3(x, y, z) {
    if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise3D === "function") {
      return simplexNoise.noise3D(x + this.noiseSeed, y + this.noiseSeed * 0.31, z + this.noiseSeed * 0.17);
    }
    return this._map(noise(x, y, z), 0, 1, -1, 1);
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _lerpAngle(a, b, t) {
    let d = b - a;
    while (d > PI) d -= TWO_PI;
    while (d < -PI) d += TWO_PI;
    return a + d * t;
  }

  _map(v, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    const n = (v - inMin) / (inMax - inMin);
    return outMin + (outMax - outMin) * n;
  }

  _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  _clamp01(v) {
    return this._clamp(v, 0, 1);
  }

  _colorWithAlpha(value, alpha = 255) {
    const c = color(value);
    return color(red(c), green(c), blue(c), alpha);
  }
}
