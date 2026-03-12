// ChainBrush
//
// A brush engine organized around three abstractions:
// - shape: how the brush roots are distributed
// - chain: how linked particles move and straighten
// - paint: how motion is deposited to the page
//
// Public controls:
// - size
// - opacity
// - wetness
// - wildness

class ChainBrush {
  constructor({
    layer = null,
    width = null,
    height = null,
    background = null,
    foreground = 0,
    recipe = "round_brush",
    controls = {},
  } = {}) {
    this.layer = layer || null;
    this.width = width;
    this.height = height;
    this.backgroundColor = background;
    this.foreground = foreground;
    this.recipeName = String(recipe || "round_brush");
    this.controls = this._mergeControls({
      size: 0.22,
      opacity: 0.18,
      wetness: 0.45,
      wildness: 0.3,
    }, controls);
    this.pointerState = new Map();
    this.time = 0;
    this.noiseSeed = Math.random() * 1000;
    this.ready = false;
    this.recipes = this._buildRecipes();
  }

  async init() {
    if (!this.layer) {
      const w = Math.max(1, Number(this.width) || windowWidth || width || 1);
      const h = Math.max(1, Number(this.height) || windowHeight || height || 1);
      this.layer = createGraphics(w, h);
    }
    if (typeof this.layer.pixelDensity === "function") this.layer.pixelDensity(1);
    this.clear();
    this.ready = true;
    return this;
  }

  clear(background = this.backgroundColor) {
    if (!this.layer) return;
    this.layer.push();
    if (background == null) this.layer.clear();
    else this.layer.background(background);
    this.layer.pop();
  }

  resize(w, h, preserve = true) {
    const nextW = Math.max(1, Number(w) || 1);
    const nextH = Math.max(1, Number(h) || 1);
    const prev = this.layer;
    const next = createGraphics(nextW, nextH);
    if (typeof next.pixelDensity === "function") next.pixelDensity(1);
    if (this.backgroundColor == null) next.clear();
    else next.background(this.backgroundColor);
    if (preserve && prev) next.image(prev, 0, 0);
    this.layer = next;
  }

  draw(x = 0, y = 0, w = null, h = null) {
    if (!this.layer) return;
    if (w == null || h == null) image(this.layer, x, y);
    else image(this.layer, x, y, w, h);
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

  _getRecipeByName(name = null) {
    const key = String(name || this.recipeName || "round_brush").trim();
    return this.recipes[key] || this.recipes[this.recipeName];
  }

  setRecipe(name) {
    const key = String(name || "").trim();
    if (!this.recipes[key]) throw new Error(`ChainBrush: unknown recipe "${name}"`);
    this.recipeName = key;
    this.pointerState.clear();
    return this.getRecipe();
  }

  patchControls(patch = {}) {
    this.controls = this._mergeControls(this.controls, patch || {});
    return this.getControls();
  }

  getControls() {
    return { ...this.controls };
  }

  resetPointers() {
    this.pointerState.clear();
  }

  updatePointers(pointers = []) {
    if (!this.ready || !this.layer) return;

    const live = new Set();
    for (const ptr of pointers) {
      const id = String(ptr.id);
      const x = Number(ptr.x);
      const y = Number(ptr.y);
      const rawX = Number(ptr.rawX ?? ptr.x);
      const rawY = Number(ptr.rawY ?? ptr.y);
      const forceStart = !!(ptr.forceStart || ptr.auto);
      const recipeKey = ptr.recipe ? String(ptr.recipe) : this.recipeName;
      const controlPatch = ptr.controls && typeof ptr.controls === "object" ? ptr.controls : null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;
      live.add(id);
      this._updatePointer(id, x, y, rawX, rawY, forceStart, recipeKey, controlPatch);
    }

    for (const id of this.pointerState.keys()) {
      if (!live.has(id)) this.pointerState.delete(id);
    }

    this.time += deltaTime > 0 ? deltaTime * 0.001 : 1 / 60;
  }

  _updatePointer(id, x, y, rawX = x, rawY = y, forceStart = false, recipeKey = this.recipeName, controlPatch = null) {
    let state = this.pointerState.get(id);
    if (!state) {
      state = this._createPointerState(id, x, y, rawX, rawY, recipeKey, controlPatch);
      this.pointerState.set(id, state);
      return;
    }

    if (state.recipeKey !== recipeKey) {
      state = this._createPointerState(id, x, y, rawX, rawY, recipeKey, controlPatch);
      state.started = true;
      this.pointerState.set(id, state);
    } else {
      state.controlPatch = controlPatch ? this._mergeControls(this.controls, controlPatch) : this.controls;
    }

    const rawDx = rawX - state.rawTx;
    const rawDy = rawY - state.rawTy;
    const rawMove = Math.hypot(rawDx, rawDy);
    if (!forceStart && !state.started && rawMove < 2.0) {
      state.tx = x;
      state.ty = y;
      state.rawTx = rawX;
      state.rawTy = rawY;
      return;
    }
    state.started = true;
    const steps = constrain(Math.ceil(rawMove / 10), 1, 6);

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const tx = lerp(state.tx, x, t);
      const ty = lerp(state.ty, y, t);
      const rtx = lerp(state.rawTx, rawX, t);
      const rty = lerp(state.rawTy, rawY, t);
      this._stepPointer(state, tx, ty, rtx, rty);
    }

    state.tx = x;
    state.ty = y;
    state.rawTx = rawX;
    state.rawTy = rawY;
  }

  _createPointerState(id, x, y, rawX = x, rawY = y, recipeKey = this.recipeName, controlPatch = null) {
    const recipe = this._getRecipeByName(recipeKey);
    const roots = this._makeRoots(recipe.shape, recipe.chain.count);
    return {
      id,
      recipeKey,
      controlPatch: controlPatch ? this._mergeControls(this.controls, controlPatch) : this.controls,
      tx: x,
      ty: y,
      rawTx: rawX,
      rawTy: rawY,
      age: 0,
      started: false,
      vx: 0,
      vy: 0,
      rawVx: 0,
      rawVy: 0,
      speed: 0,
      turn: 0,
      lastAngle: 0,
      dirX: 1,
      dirY: 0,
      chains: roots.map((root) => ({
        ox: root.x,
        oy: root.y,
        points: Array.from({ length: recipe.chain.points }, () => ({
          x,
          y,
          px: x,
          py: y,
          vx: 0,
          vy: 0,
        })),
      })),
    };
  }

  _stepPointer(state, tx, ty, rawTx, rawTy) {
    const recipe = this._getRecipeByName(state.recipeKey);
    const dyn = this._deriveDynamics(recipe, state, tx, ty, rawTx, rawTy, state.controlPatch || this.controls);
    const g = this.layer;
    state.age += 1;

    g.push();
    g.noFill();

    for (let chainIndex = 0; chainIndex < state.chains.length; chainIndex++) {
      const chain = state.chains[chainIndex];
      const rootNoiseA = this._noise2(chainIndex * 0.21 + this.noiseSeed, this.time * dyn.noiseSpeed);
      const rootNoiseB = this._noise2(chainIndex * 0.21 + this.noiseSeed + 100, this.time * dyn.noiseSpeed + 100);
      const warpMul = 1 + rootNoiseA * dyn.radiusWarp;
      const warpedScale = {
        x: dyn.brushScale.x * warpMul,
        y: dyn.brushScale.y * warpMul,
      };

      let rootX = chain.ox * warpedScale.x * dyn.rootSpreadFade;
      let rootY = chain.oy * warpedScale.y * dyn.rootSpreadFade;

      if (dyn.alignRootsToStroke) {
        const rx = rootX;
        const ry = rootY;
        rootX = rx * dyn.cosA - ry * dyn.sinA;
        rootY = rx * dyn.sinA + ry * dyn.cosA;
      }

      const headTargetX = tx + rootX + dyn.leadX + rootNoiseA * dyn.rootJitter;
      const headTargetY = ty + rootY + dyn.leadY + rootNoiseB * dyn.rootJitter;

      const head = chain.points[0];
      this._integratePoint(head, headTargetX, headTargetY, dyn.headSpring, dyn.headDrag);

      for (let i = 1; i < chain.points.length; i++) {
        const prev = chain.points[i - 1];
        const p = chain.points[i];
        const t = i / Math.max(1, chain.points.length - 1);
        const segSpring = this._sample(recipe.chain.spring, t, dyn.wildCurve);
        const segDrag = this._sample(recipe.chain.drag, t, dyn.wildCurve);
        const segSlip = this._sample(recipe.chain.slip, t, dyn.wildCurve);
        const straighten = this._sample(recipe.chain.straighten, t, dyn.wildCurve);
        const rest = dyn.restLength * this._sample(recipe.chain.restBias, t, dyn.wildCurve);

        const straightX = prev.x - dyn.dirX * rest;
        const straightY = prev.y - dyn.dirY * rest;
        const targetX = lerp(prev.x - state.vx * segSlip * dyn.startFade, straightX, straighten);
        const targetY = lerp(prev.y - state.vy * segSlip * dyn.startFade, straightY, straighten);
        this._integratePoint(p, targetX, targetY, segSpring, segDrag);
      }

      for (let i = 0; i < chain.points.length; i++) {
        const p = chain.points[i];
        const t = i / Math.max(1, chain.points.length - 1);
        const width = dyn.strokeSize * this._sample(recipe.paint.widthProfile, t, 0);
        const alpha = dyn.alpha * this._sample(recipe.paint.alphaProfile, t, 0);
        this._deposit(g, dyn, recipe.paint, state, chainIndex, i, p, width, alpha);
        p.px = p.x;
        p.py = p.y;
      }
    }

    g.pop();
  }

  _integratePoint(point, tx, ty, spring, drag) {
    point.vx = point.vx * drag + (tx - point.x) * spring;
    point.vy = point.vy * drag + (ty - point.y) * spring;
    const maxVel = 12;
    point.vx = constrain(point.vx, -maxVel, maxVel);
    point.vy = constrain(point.vy, -maxVel, maxVel);
    point.x += point.vx;
    point.y += point.vy;
  }

  _deposit(g, dyn, paint, state, chainIndex, pointIndex, point, width, alpha) {
    if (state.age < dyn.depositDelaySteps) return;
    const move = Math.hypot(point.x - point.px, point.y - point.py);
    const moveThreshold = Math.max(0.12, width * 0.08);
    if (move < moveThreshold) return;
    const steps = constrain(Math.ceil(move / dyn.spacing), 1, 6);
    const dotAlpha = alpha * dyn.dotAlpha;
    const bridgeAlpha = alpha * dyn.bridgeAlpha;
    const smearAlpha = alpha * dyn.smearAlpha;

    if (
      (paint.mode === "bridge" || paint.mode === "hybrid") &&
      bridgeAlpha > 0.0001 &&
      move <= dyn.maxBridgeSpan
    ) {
      g.stroke(this._colorWithAlpha(this.foreground, bridgeAlpha * 255));
      g.strokeWeight(Math.max(0.5, width * dyn.bridgeWeight));
      g.line(point.px, point.py, point.x, point.y);
    }

    if (paint.mode === "dots" || paint.mode === "hybrid") {
      g.noStroke();
      for (let step = 1; step <= steps; step++) {
        const u = step / steps;
        let sx = lerp(point.px, point.x, u);
        let sy = lerp(point.py, point.y, u);

        if (dyn.depositJitter > 0) {
          const jx = this._noise3(chainIndex * 0.19 + pointIndex * 0.07, u * 5, this.time * dyn.noiseSpeed);
          const jy = this._noise3(chainIndex * 0.19 + pointIndex * 0.07 + 100, u * 5 + 100, this.time * dyn.noiseSpeed);
          sx += jx * dyn.depositJitter;
          sy += jy * dyn.depositJitter;
        }

        if (dotAlpha > 0.0001) {
          g.fill(this._colorWithAlpha(this.foreground, dotAlpha * 255));
          g.circle(sx, sy, Math.max(0.45, width));
        }

        if (smearAlpha > 0.0001 && dyn.smearLength > 0.0001) {
          const tx = sx - state.vx * dyn.smearLength;
          const ty = sy - state.vy * dyn.smearLength;
          g.fill(this._colorWithAlpha(this.foreground, smearAlpha * 255));
          g.circle(lerp(sx, tx, 0.5), lerp(sy, ty, 0.5), Math.max(0.45, width * dyn.smearSize));
        }

        if (dyn.splashChance > 0.0001) {
          const splash = (this._noise3(
            chainIndex * 0.23 + pointIndex * 0.11,
            u * 8 + this.time,
            this.noiseSeed + state.speed * 5
          ) + 1) * 0.5;
          if (splash > 1 - dyn.splashChance) {
            const ang = splash * TWO_PI * 6;
            const rad = dyn.splashRadius * (0.3 + splash * 0.7);
            g.fill(this._colorWithAlpha(this.foreground, alpha * dyn.splashAlpha * 255));
            g.circle(sx + Math.cos(ang) * rad, sy + Math.sin(ang) * rad, Math.max(0.4, width * 0.42));
          }
        }
      }
    }
  }

  _deriveDynamics(recipe, state, tx, ty, rawTx, rawTy, controlSet) {
    const dx = tx - state.tx;
    const dy = ty - state.ty;
    const rawDx = rawTx - state.rawTx;
    const rawDy = rawTy - state.rawTy;
    state.vx = lerp(state.vx, dx, recipe.motion.velocitySmooth);
    state.vy = lerp(state.vy, dy, recipe.motion.velocitySmooth);
    state.rawVx = lerp(state.rawVx, rawDx, recipe.motion.velocitySmooth);
    state.rawVy = lerp(state.rawVy, rawDy, recipe.motion.velocitySmooth);
    state.speed = Math.hypot(state.rawVx, state.rawVy);

    const angle = Math.atan2(state.vy || 0.0001, state.vx || 0.0001);
    let da = angle - state.lastAngle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    state.turn = lerp(state.turn, Math.abs(da) / Math.PI, 0.28);
    state.lastAngle = angle;

    if (state.speed > 0.001) {
      state.dirX = Math.cos(angle);
      state.dirY = Math.sin(angle);
    }

    const speed01 = constrain(state.speed / recipe.motion.speedNorm, 0, 1);
    const turn01 = constrain(state.turn, 0, 1);
    const size = controlSet.size;
    const opacity = controlSet.opacity;
    const wetness = controlSet.wetness;
    const wildness = controlSet.wildness;

    const sizeScale = lerp(recipe.control.sizeRange[0], recipe.control.sizeRange[1], size);
    const opacityScale = lerp(recipe.control.opacityRange[0], recipe.control.opacityRange[1], opacity);
    const wetScale = lerp(recipe.control.wetRange[0], recipe.control.wetRange[1], wetness);
    const wildScale = lerp(recipe.control.wildRange[0], recipe.control.wildRange[1], wildness);
    const wildBoost = lerp(0.2, 1.8, wildness);

    const speedRadiusScale = recipe.shape.speedRadiusResponse >= 0
      ? lerp(1, 1 + recipe.shape.speedRadiusResponse, speed01)
      : lerp(1, Math.max(0.08, 1 + recipe.shape.speedRadiusResponse), speed01);

    const speedWidthScale = recipe.paint.speedWidthResponse >= 0
      ? lerp(1, 1 + recipe.paint.speedWidthResponse, speed01)
      : lerp(1, Math.max(0.08, 1 + recipe.paint.speedWidthResponse), speed01);

    return {
      speed01,
      turn01,
      wildCurve: wildness,
      dirX: state.dirX,
      dirY: state.dirY,
      cosA: Math.cos(angle),
      sinA: Math.sin(angle),
      brushScale: {
        x: recipe.shape.radius * sizeScale * speedRadiusScale * recipe.shape.aspectX,
        y: recipe.shape.radius * sizeScale * speedRadiusScale * recipe.shape.aspectY,
      },
      alignRootsToStroke: !!recipe.shape.alignToStroke,
      radiusWarp: recipe.shape.radiusWarp * wildScale * wildBoost * (0.35 + turn01 * 0.65) * constrain((state.age - 2) / 10, 0, 1),
      rootJitter: recipe.shape.rootJitter * wildScale * wildBoost * (0.3 + speed01 * 0.7) * constrain((state.age - 2) / 10, 0, 1),
      restLength: recipe.chain.restLength * sizeScale * lerp(1.0, recipe.chain.speedRestScale, speed01),
      headSpring: recipe.chain.head.spring * (0.85 + speed01 * 0.3),
      headDrag: constrain(recipe.chain.head.drag - wetScale * 0.08 + wildScale * 0.04, 0.3, 0.98),
      startFade: constrain(state.age / 10, 0, 1),
      depositDelaySteps: recipe.paint.depositDelaySteps ?? 4,
      rootSpreadFade: constrain((state.age - 4) / 18, 0, 1),
      leadX: constrain(
        state.vx * recipe.motion.lead * wildScale * constrain(state.age / 10, 0, 1),
        -(recipe.motion.maxLead ?? 6),
        recipe.motion.maxLead ?? 6
      ),
      leadY: constrain(
        state.vy * recipe.motion.lead * wildScale * constrain(state.age / 10, 0, 1),
        -(recipe.motion.maxLead ?? 6),
        recipe.motion.maxLead ?? 6
      ),
      strokeSize: recipe.paint.strokeSize * sizeScale * speedWidthScale * lerp(1, 1 + recipe.paint.turnWidthGain, turn01),
      spacing: Math.max(0.4, recipe.paint.spacing * lerp(1, recipe.paint.fastSpacing, speed01) * lerp(1, 0.72, wetness)),
      alpha: recipe.paint.alpha * opacityScale,
      dotAlpha: recipe.paint.dotAlpha * lerp(0.7, 1.45, wetness),
      bridgeAlpha: recipe.paint.bridgeAlpha * lerp(0.9, 1.1, wildness),
      bridgeWeight: recipe.paint.bridgeWeight,
      smearAlpha: recipe.paint.smearAlpha * wetScale * (0.25 + speed01 * 0.75),
      smearLength: recipe.paint.smearLength * wetScale * lerp(0.8, 1.5, wildness),
      smearSize: recipe.paint.smearSize * lerp(1, 1.35, wetness),
      depositJitter: recipe.paint.depositJitter * wildScale * wildBoost * (0.35 + turn01 * 0.65),
      splashChance: recipe.paint.splashChance * wildScale * wildBoost * (0.2 + speed01 * 0.8),
      splashRadius: recipe.paint.splashRadius * sizeScale * (0.5 + wetness * 0.8),
      splashAlpha: recipe.paint.splashAlpha * opacityScale,
      maxBridgeSpan: Math.max(6, recipe.paint.maxBridgeSpan * sizeScale),
      noiseSpeed: recipe.motion.noiseSpeed * (0.8 + wildness * 1.4),
    };
  }

  _makeRoots(shape, count) {
    const roots = [];

    if (shape.layout === "row") {
      for (let i = 0; i < count; i++) {
        const t = count <= 1 ? 0.5 : i / (count - 1);
        roots.push({ x: lerp(-1, 1, t), y: 0 });
      }
      return roots;
    }

    if (shape.layout === "ring") {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TWO_PI;
        roots.push({ x: Math.cos(a), y: Math.sin(a) });
      }
      return roots;
    }

    if (shape.layout === "fan") {
      for (let i = 0; i < count; i++) {
        const t = count <= 1 ? 0.5 : i / (count - 1);
        const a = lerp(-shape.spread * 0.5, shape.spread * 0.5, t);
        const r = 0.25 + 0.75 * Math.abs(Math.sin((t + 0.12) * Math.PI));
        roots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      return roots;
    }

    for (let i = 0; i < count; i++) {
      const a = i * 2.399963229728653;
      const r = Math.sqrt((i + 0.5) / count);
      roots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return roots;
  }

  _sample(profile, t, curve = 0) {
    if (typeof profile === "number") return profile;
    if (Array.isArray(profile)) {
      if (profile.length === 2) return lerp(profile[0], profile[1], t);
      if (profile.length === 3) {
        const a = lerp(profile[0], profile[1], t);
        return lerp(a, profile[2], t * t);
      }
    }
    if (profile && typeof profile === "object") {
      const power = profile.power ?? 1;
      const u = Math.pow(t, power);
      return lerp(profile.from ?? 0, profile.to ?? 1, u);
    }
    return 0;
  }

  _mergeControls(base, patch = {}) {
    return {
      size: constrain(Number(patch.size ?? base.size), 0.02, 1.5),
      opacity: constrain(Number(patch.opacity ?? base.opacity), 0.01, 1.0),
      wetness: constrain(Number(patch.wetness ?? base.wetness), 0.0, 1.0),
      wildness: constrain(Number(patch.wildness ?? base.wildness), 0.0, 1.0),
    };
  }

  _colorWithAlpha(colorValue, alpha) {
    if (Array.isArray(colorValue)) return color(colorValue[0], colorValue[1], colorValue[2], alpha);
    if (typeof colorValue === "number") return color(colorValue, alpha);
    return color(colorValue || 0, alpha);
  }

  _noise2(x, y) {
    if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise2D === "function") {
      return simplexNoise.noise2D(x, y);
    }
    if (typeof OpenSimplexNoise !== "undefined") {
      if (!window.simplexNoise) window.simplexNoise = new OpenSimplexNoise(1234);
      return window.simplexNoise.noise2D(x, y);
    }
    return noise(x, y) * 2 - 1;
  }

  _noise3(x, y, z) {
    if (typeof simplexNoise !== "undefined" && simplexNoise && typeof simplexNoise.noise3D === "function") {
      return simplexNoise.noise3D(x, y, z);
    }
    if (typeof OpenSimplexNoise !== "undefined") {
      if (!window.simplexNoise) window.simplexNoise = new OpenSimplexNoise(1234);
      return window.simplexNoise.noise3D(x, y, z);
    }
    return noise(x, y, z) * 2 - 1;
  }

  _buildRecipes() {
    return {
      round_brush: {
        label: "Round Brush",
        family: "common",
        control: {
          sizeRange: [0.4, 2.1],
          opacityRange: [0.25, 1.0],
          wetRange: [0.45, 1.15],
          wildRange: [0.55, 1.1],
        },
        shape: {
          layout: "disk",
          radius: 16,
          aspectX: 1,
          aspectY: 1,
          speedRadiusResponse: -0.55,
          alignToStroke: false,
          rootJitter: 1.2,
          radiusWarp: 0.08,
        },
        motion: {
          velocitySmooth: 0.24,
          speedNorm: 18,
          lead: 0.45,
          maxLead: 3.5,
          noiseSpeed: 0.7,
        },
        chain: {
          count: 18,
          points: 10,
          restLength: 1.1,
          speedRestScale: 0.95,
          head: { spring: 0.33, drag: 0.72 },
          spring: [0.26, 0.18],
          drag: [0.77, 0.84],
          slip: [0.02, 0.18],
          straighten: [0.02, 0.16],
          restBias: [1.0, 0.88],
        },
        paint: {
          mode: "hybrid",
          strokeSize: 3.2,
          speedWidthResponse: -0.4,
          turnWidthGain: 0.08,
          spacing: 0.9,
          fastSpacing: 1.35,
          alpha: 0.12,
          dotAlpha: 0.72,
          bridgeAlpha: 0.08,
          bridgeWeight: 0.85,
          smearAlpha: 0.08,
          smearLength: 1.1,
          smearSize: 1.12,
          depositJitter: 0.6,
          splashChance: 0.015,
          splashRadius: 5,
          splashAlpha: 0.22,
          maxBridgeSpan: 10,
          depositDelaySteps: 12,
          widthProfile: [1.0, 0.58],
          alphaProfile: [1.0, 0.7],
        },
      },
      calligraphy_rake: {
        label: "Calligraphy Rake",
        family: "common",
        control: {
          sizeRange: [0.14, 1.0],
          opacityRange: [0.35, 1.0],
          wetRange: [0.35, 0.95],
          wildRange: [0.3, 0.8],
        },
        shape: {
          layout: "row",
          radius: 8.5,
          aspectX: 1,
          aspectY: 0.9,
          speedRadiusResponse: 0.7,
          alignToStroke: true,
          rootJitter: 0.35,
          radiusWarp: 0.02,
        },
        motion: {
          velocitySmooth: 0.28,
          speedNorm: 16,
          lead: 0.15,
          maxLead: 2.0,
          noiseSpeed: 0.45,
        },
        chain: {
          count: 12,
          points: 10,
          restLength: 1.0,
          speedRestScale: 1.1,
          head: { spring: 0.42, drag: 0.7 },
          spring: [0.34, 0.16],
          drag: [0.76, 0.88],
          slip: [0.0, 0.08],
          straighten: [0.14, 0.55],
          restBias: [1.0, 1.0],
        },
        paint: {
          mode: "bridge",
          strokeSize: 1.6,
          speedWidthResponse: 1.0,
          turnWidthGain: 0.62,
          spacing: 0.7,
          fastSpacing: 0.9,
          alpha: 0.15,
          dotAlpha: 0.0,
          bridgeAlpha: 1.0,
          bridgeWeight: 1.5,
          smearAlpha: 0.02,
          smearLength: 0.4,
          smearSize: 1.0,
          depositJitter: 0.04,
          splashChance: 0.0,
          splashRadius: 4,
          splashAlpha: 0.0,
          maxBridgeSpan: 24,
          widthProfile: [1.0, 0.45],
          alphaProfile: [1.0, 0.9],
        },
      },
      dry_fan: {
        label: "Dry Fan",
        family: "common",
        control: {
          sizeRange: [0.14, 1.0],
          opacityRange: [0.28, 0.95],
          wetRange: [0.18, 0.65],
          wildRange: [0.7, 1.4],
        },
        shape: {
          layout: "fan",
          spread: Math.PI * 0.9,
          radius: 11,
          aspectX: 1,
          aspectY: 0.8,
          speedRadiusResponse: 0.15,
          alignToStroke: true,
          rootJitter: 0.8,
          radiusWarp: 0.14,
        },
        motion: {
          velocitySmooth: 0.22,
          speedNorm: 20,
          lead: 0.08,
          maxLead: 1.6,
          noiseSpeed: 1.0,
        },
        chain: {
          count: 18,
          points: 8,
          restLength: 1.05,
          speedRestScale: 0.95,
          head: { spring: 0.28, drag: 0.76 },
          spring: [0.22, 0.14],
          drag: [0.82, 0.9],
          slip: [0.02, 0.06],
          straighten: [0.04, 0.22],
          restBias: [0.9, 1.15],
        },
        paint: {
          mode: "dots",
          strokeSize: 1.35,
          speedWidthResponse: -0.45,
          turnWidthGain: 0.0,
          spacing: 1.35,
          fastSpacing: 1.8,
          alpha: 0.13,
          dotAlpha: 0.92,
          bridgeAlpha: 0.0,
          bridgeWeight: 0.7,
          smearAlpha: 0.0,
          smearLength: 0.0,
          smearSize: 1.0,
          depositJitter: 1.8,
          splashChance: 0.02,
          splashRadius: 5,
          splashAlpha: 0.16,
          maxBridgeSpan: 8,
          widthProfile: [1.0, 0.3],
          alphaProfile: [1.0, 0.55],
        },
      },
      ink_mop: {
        label: "Ink Mop",
        family: "interesting",
        control: {
          sizeRange: [0.16, 1.15],
          opacityRange: [0.25, 0.95],
          wetRange: [0.65, 1.75],
          wildRange: [0.5, 1.15],
        },
        shape: {
          layout: "disk",
          radius: 13,
          aspectX: 1,
          aspectY: 1,
          speedRadiusResponse: 0.32,
          alignToStroke: false,
          rootJitter: 2.0,
          radiusWarp: 0.22,
        },
        motion: {
          velocitySmooth: 0.2,
          speedNorm: 18,
          lead: 0.55,
          maxLead: 4.0,
          noiseSpeed: 0.7,
        },
        chain: {
          count: 26,
          points: 13,
          restLength: 1.35,
          speedRestScale: 1.05,
          head: { spring: 0.22, drag: 0.8 },
          spring: [0.18, 0.1],
          drag: [0.84, 0.92],
          slip: [0.1, 0.52],
          straighten: [0.02, 0.18],
          restBias: [0.9, 1.1],
        },
        paint: {
          mode: "hybrid",
          strokeSize: 2.8,
          speedWidthResponse: 0.4,
          turnWidthGain: 0.14,
          spacing: 0.72,
          fastSpacing: 0.95,
          alpha: 0.09,
          dotAlpha: 0.55,
          bridgeAlpha: 0.18,
          bridgeWeight: 1.2,
          smearAlpha: 0.26,
          smearLength: 2.0,
          smearSize: 1.42,
          depositJitter: 1.0,
          splashChance: 0.035,
          splashRadius: 8,
          splashAlpha: 0.22,
          maxBridgeSpan: 14,
          widthProfile: [1.0, 0.62],
          alphaProfile: [1.0, 0.62],
        },
      },
      chain_drag: {
        label: "Chain Drag",
        family: "interesting",
        control: {
          sizeRange: [0.12, 1.0],
          opacityRange: [0.28, 1.0],
          wetRange: [0.45, 1.15],
          wildRange: [0.35, 1.0],
        },
        shape: {
          layout: "ring",
          radius: 10.5,
          aspectX: 1,
          aspectY: 1,
          speedRadiusResponse: -0.55,
          alignToStroke: true,
          rootJitter: 0.8,
          radiusWarp: 0.08,
        },
        motion: {
          velocitySmooth: 0.24,
          speedNorm: 15,
          lead: 0.8,
          maxLead: 4.5,
          noiseSpeed: 0.85,
        },
        chain: {
          count: 10,
          points: 18,
          restLength: 1.55,
          speedRestScale: 1.12,
          head: { spring: 0.24, drag: 0.74 },
          spring: [0.14, 0.08],
          drag: [0.88, 0.94],
          slip: [0.28, 0.75],
          straighten: [0.1, 0.72],
          restBias: [0.85, 1.15],
        },
        paint: {
          mode: "bridge",
          strokeSize: 1.8,
          speedWidthResponse: -0.3,
          turnWidthGain: 0.12,
          spacing: 0.85,
          fastSpacing: 1.05,
          alpha: 0.11,
          dotAlpha: 0.0,
          bridgeAlpha: 0.9,
          bridgeWeight: 0.95,
          smearAlpha: 0.16,
          smearLength: 1.6,
          smearSize: 1.15,
          depositJitter: 0.18,
          splashChance: 0.01,
          splashRadius: 5,
          splashAlpha: 0.12,
          maxBridgeSpan: 18,
          widthProfile: [1.0, 0.26],
          alphaProfile: [1.0, 0.55],
        },
      },
      dirty_mop: {
        label: "Dirty Mop",
        family: "interesting",
        control: {
          sizeRange: [0.18, 1.2],
          opacityRange: [0.18, 0.85],
          wetRange: [0.5, 1.35],
          wildRange: [0.8, 1.9],
        },
        shape: {
          layout: "disk",
          radius: 15,
          aspectX: 1,
          aspectY: 1,
          speedRadiusResponse: 0.4,
          alignToStroke: false,
          rootJitter: 3.2,
          radiusWarp: 0.32,
        },
        motion: {
          velocitySmooth: 0.18,
          speedNorm: 17,
          lead: 0.65,
          maxLead: 4.2,
          noiseSpeed: 1.15,
        },
        chain: {
          count: 30,
          points: 14,
          restLength: 1.45,
          speedRestScale: 1.06,
          head: { spring: 0.18, drag: 0.82 },
          spring: [0.12, 0.07],
          drag: [0.88, 0.95],
          slip: [0.18, 0.68],
          straighten: [0.02, 0.18],
          restBias: [0.82, 1.18],
        },
        paint: {
          mode: "hybrid",
          strokeSize: 2.4,
          speedWidthResponse: 0.12,
          turnWidthGain: 0.16,
          spacing: 0.84,
          fastSpacing: 1.0,
          alpha: 0.075,
          dotAlpha: 0.48,
          bridgeAlpha: 0.1,
          bridgeWeight: 1.1,
          smearAlpha: 0.22,
          smearLength: 2.1,
          smearSize: 1.52,
          depositJitter: 2.5,
          splashChance: 0.06,
          splashRadius: 10,
          splashAlpha: 0.28,
          maxBridgeSpan: 12,
          widthProfile: [1.0, 0.58],
          alphaProfile: [1.0, 0.5],
        },
      },
    };
  }
}

window.ChainBrush = ChainBrush;
