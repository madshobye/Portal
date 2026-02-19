/*
problem with loading everything
let canvas;
let cam, pose;

async function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  await pSetup();
   await loadScript("portal/bodyPose.js");

  cam = await setupWebcamera(false, 640, 480, true);
 pose = await new BodyPose({
    video: cam,
    videoIsFlipped: true,   // same as createCapture(...,{ flipped })
  
   onResults: (poses) => {
      // poses are rect-mapped to (0,0,width,height) by default in this callback
     //  console.log(poses);
    }
  }).init();

  pose.start();
  textSize(20);
  fill(255);
}

function draw() {
  background(0);
 image(cam, 0, 0);                // draws at native size (640x480)
pose.drawPoses(0, 0, cam.width, cam.height, {
  minConfidence: 0.9,
  minPoseScore: 0.3,
  drawSkeleton: true,
  drawKeypoints: true
});            // overlays into the exact same rect

  // Example: use flipped-only VIDEO-space landmarks (no scaling)
  const best = pose.getBest();
  if (best) {
    const lw = best.left_wrist;    // named landmark
    if (lw) ellipse(lw.x, lw.y, 16, 16); // If drawing on canvas, scale if canvas≠video size
  }
}

function keyPressed() {
  if (key == "f") {
    fullScreenToggle();
  }
}

*/

/************* Singleton loader (ml5 + MediaPipe Pose) *************/
let __ml5PoseLoaderPromise = null;

function loadScriptSerial(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false; // preserve order
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureMl5AndPoseOnce() {
  if (__ml5PoseLoaderPromise) return __ml5PoseLoaderPromise;
  __ml5PoseLoaderPromise = (async () => {
    if (!window.ml5) {
      await loadScriptSerial('https://unpkg.com/ml5@1/dist/ml5.min.js');
    }
    if (!window.Pose) {
      await loadScriptSerial('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');
    }
  })();
  return __ml5PoseLoaderPromise;
}

/*********************** BodyPose helper (final) ***********************/
class BodyPose {
  constructor({
  video,
  videoIsFlipped = false,
  backend = 'webgl',
  onResults = null,
} = {}) {
  if (!video) throw new Error('BodyPose: video is required');
  this.video = video.elt ? video.elt : video;
  this.videoIsFlipped = !!videoIsFlipped;
  this.backend = backend;
  this._onResults = typeof onResults === 'function' ? onResults : null;

  this.detector = null;

  this.posesRaw = [];   // VIDEO-space, unflipped
  this.posesVideo = []; // VIDEO-space, flipped if videoIsFlipped (NO scaling)

  this.ready = false;
  this.running = false;
  this._raf = null;

  this._hasResult = false;
  this._hasNew = false;

  // startup reliability
  this._firstResultSeen = false;
  this._firstResultResolvers = [];
  this._startAttempts = 0;
  this._maxStartAttempts = 3;

  // guard: only one instance per <video>
  this._videoClaimed = false;

  // ✅ Canonical MediaPipe Pose order (33)
  this._names = [
    'nose',
    'left_eye_inner','left_eye','left_eye_outer',
    'right_eye_inner','right_eye','right_eye_outer',
    'left_ear','right_ear',
    'mouth_left','mouth_right',
    'left_shoulder','right_shoulder',
    'left_elbow','right_elbow',
    'left_wrist','right_wrist',
    'left_pinky','right_pinky',
    'left_index','right_index',
    'left_thumb','right_thumb',
    'left_hip','right_hip',
    'left_knee','right_knee',
    'left_ankle','right_ankle',
    'left_heel','right_heel',
    'left_foot_index','right_foot_index'
  ];

  // ✅ Skeleton edges by canonical indices
  this._edges = [
    [11,12],[11,23],[12,24],[23,24],          // torso
    [11,13],[13,15],[15,17],[15,19],[15,21],  // left arm
    [12,14],[14,16],[16,18],[16,20],[16,22],  // right arm
    [23,25],[25,27],[27,29],[27,31],          // left leg
    [24,26],[26,28],[28,30],[28,32],          // right leg
    // light face
    [0,1],[1,2],[2,3],[0,4],[4,5],[5,6],
    [2,7],[5,8],[9,10]
  ];
}


  /**************** lifecycle ****************/
  async init() {
    await ensureMl5AndPoseOnce();

    if (ml5?.setBackend) {
      try { await ml5.setBackend(this.backend); } catch (e) { console.warn('[ml5.setBackend]', e); }
    }

    // selfieMode off; we handle mirroring explicitly
    this.detector = await ml5.bodyPose({
      runtime: 'mediapipe',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose',
      selfieMode: false,
      // modelType: 'lite' | 'full' | 'heavy'  // optional
    });

    await this._waitDetectorReady(this.detector);
    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready || !this.detector) throw new Error('Call init() before start()');
    if (this.running) return;
    this.running = true;

    const v = this.video?.elt ? this.video.elt : this.video;
    if (v.__bpBusy && v.__bpBusy !== this) {
      console.warn('This video is already used by another BodyPose instance.');
    }
    v.__bpBusy = this;
    this._videoClaimed = true;

    // ensure real frames are flowing
    await this._waitForVideoReady(this.video);
    await this._waitForRealFrames(this.video);

    const runDetect = () => {
      if (typeof this.detector.detectStart === 'function') {
        this.detector.detectStart(this.video, (res) => this._handle(res));
      } else {
        const loop = async () => {
          if (!this.running) return;
          try { this.detector.detect(this.video, (err, res) => !err && this._handle(res)); }
          catch (e) { console.warn('[BodyPose] detect error:', e); }
          this._raf = requestAnimationFrame(loop);
        };
        loop();
      }
    };

    const tryStart = async () => {
      this._startAttempts++;
      this._firstResultSeen = false;

      runDetect();

      // short wait; if nothing arrives, retry a couple of times
      await this._waitFirstResult(1500);
      if (!this._firstResultSeen && this._startAttempts < this._maxStartAttempts) {
        if (typeof this.detector.detectStop === 'function') this.detector.detectStop();
        await new Promise(r => setTimeout(r, 150));
        return tryStart();
      }
    };

    await tryStart();

    // soft timeout warm-up
    await this._waitFirstResult(4000);
  }

  stop() {
    if (!this.detector || !this.running) return;
    if (typeof this.detector.detectStop === 'function') this.detector.detectStop();
    if (this._raf) cancelAnimationFrame(this._raf), (this._raf = null);
    this.running = false;

    const v = this.video?.elt ? this.video.elt : this.video;
    if (this._videoClaimed && v && v.__bpBusy === this) {
      delete v.__bpBusy;
      this._videoClaimed = false;
    }
  }

  /**************** public API ****************/
  hasResult() { return this._hasResult; }
  hasNewResult() { return this._hasNew; }
  resetNewFlag() { this._hasNew = false; }

  /** VIDEO-space, flipped to match flipped feed, NO scaling. Includes named landmarks. */
  getPoses() { return this.posesVideo; }

  /** Raw ml5 results (VIDEO-space, unflipped) */
  getPosesRaw() { return this.posesRaw; }

  /** Poses scaled + offset to the rect you use in image(cam, x, y, w, h) */
  getPosesInRect(x, y, w, h) { return this._mapPosesToRect(this.posesRaw, x, y, w, h); }

  /** Best (highest score) pose in VIDEO-space (flipped) */
  getBest() {
    const arr = this.posesVideo || [];
    return arr.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || null;
  }

  /** Draw into rect (defaults to video native size → matches image(cam,0,0)) */
  drawPoses(
  x = 0, y = 0, w = null, h = null,
  {
    drawSkeleton = true,
    drawKeypoints = true,
    showLabels = false,
    ptSize = 6,
    minConfidence = 0.5,   // NEW: per-landmark minimum confidence
    minPoseScore = 0       // NEW: overall pose score threshold (if available)
  } = {}
) {
  const v = this.video?.elt ? this.video.elt : this.video;
  const vw = v?.videoWidth || v?.width || width;
  const vh = v?.videoHeight || v?.height || height;
  const W = w ?? vw, H = h ?? vh;

  const poses = this.getPosesInRect(x, y, W, H);
  if (!poses || !poses.length || typeof ellipse !== 'function') return;

  push();
  noFill(); stroke(0); strokeWeight(2);

  for (const pose of poses) {
    // optional overall pose gate
    const poseScore = Number(pose.score ?? 0);
    if (poseScore && poseScore < minPoseScore) continue;

    const pts = this._extractKeypoints(pose); // rect-space with {x,y,c}
    if (!pts.length) continue;

    // skeleton
    if (drawSkeleton) {
      this._drawSkeletonWithConfidence(pts, minConfidence);
    }

    // keypoints
    if (drawKeypoints) {
      for (const p of pts) {
        if (!this._ptOK(p, minConfidence)) continue;
        noStroke(); fill(0);
        ellipse(p.x, p.y, ptSize + 2, ptSize + 2);
        fill(255);
        ellipse(p.x, p.y, ptSize, ptSize);
      }
    }

    if (showLabels) {
      fill(255); textSize(10);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!this._ptOK(p, minConfidence)) continue;
        text(this._names[i] || i, p.x + 4, p.y - 4);
      }
    }
  }
  pop();
}


  /**************** detection callbacks ****************/
  _handle = (results) => {
    if (!this._firstResultSeen) {
      this._firstResultSeen = true;
      (this._firstResultResolvers || []).splice(0).forEach(fn => fn());
    }

    // ml5.bodyPose can return [] or { poses: [] } or a single object
    let arr = [];
    if (Array.isArray(results)) arr = results;
    else if (Array.isArray(results?.poses)) arr = results.poses;
    else if (results && typeof results === 'object') arr = [results];

    this.posesRaw = arr;
    this.posesVideo = this._toVideoFlipped(arr);

    this._hasResult = this.posesRaw.length > 0;
    this._hasNew = true;

    if (this._onResults) {
      try { this._onResults(this.getPosesInRect(0, 0, width, height)); }
      catch (e) { console.warn('[BodyPose] onResults threw:', e); }
    }
  };

  /**************** transforms ****************/
 _toVideoFlipped(poses) {
  if (!poses || !poses.length) return [];
  const v = this.video?.elt ? this.video.elt : this.video;
  const vw = v?.videoWidth || v?.width || width;

  const mapPose = (pose, pts) => {
    const keypoints = pts.map(p => this._safePoint(p));
    const landmarks = pts.map(p => {
      const q = this._safePoint(p);
      return [q.x, q.y, 0];
    });
    const named = {};
    for (let i = 0; i < Math.min(this._names.length, pts.length); i++) {
      const q = this._safePoint(pts[i]);
      named[this._names[i]] = { x: q.x, y: q.y, c: q.c };
    }
    return { ...pose, keypoints, landmarks, ...named };
  };

  return poses.map(pose => {
    const base = this._extractKeypoints(pose);
    const pts  = base.map(p => {
      const q = this._safePoint(p);
      const x = this.videoIsFlipped ? (vw - q.x) : q.x;
      return { x, y: q.y, c: q.c };
    });
    return mapPose(pose, pts);
  });
}
_mapPosesToRect(poses, x, y, w, h) {
  if (!poses || !poses.length) return [];
  const v = this.video?.elt ? this.video.elt : this.video;
  const vw = v?.videoWidth || v?.width || width;
  const vh = v?.videoHeight || v?.height || height;
  const sx = w / vw, sy = h / vh;
  const flipX = this.videoIsFlipped;

  const mapPose = (pose, pts) => {
    const keypoints = pts.map(p => this._safePoint(p));
    const landmarks = pts.map(p => {
      const q = this._safePoint(p);
      return [q.x, q.y, 0];
    });
    const named = {};
    for (let i = 0; i < Math.min(this._names.length, pts.length); i++) {
      const q = this._safePoint(pts[i]);
      named[this._names[i]] = { x: q.x, y: q.y, c: q.c };
    }
    return { ...pose, keypoints, landmarks, ...named };
  };

  return poses.map(pose => {
    const base = this._extractKeypoints(pose);
    const pts  = base.map(p => {
      const q = this._safePoint(p);
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return { x: NaN, y: NaN, c: 0 };
      let px = q.x, py = q.y;
      if (flipX) px = vw - px;
      return { x: x + px * sx, y: y + py * sy, c: q.c };
    });
    return mapPose(pose, pts);
  });
}

 _extractKeypoints(pose) {
  if (!pose) return [];
  let pts = [];

  // A) Named keypoints (order can vary) → reorder by name, keep confidence
  if (Array.isArray(pose.keypoints) && pose.keypoints.length) {
    const allHaveNames = pose.keypoints.every(k => 'name' in k || 'part' in k || 'label' in k);
    if (allHaveNames) {
      const named = pose.keypoints.map(k => ({
        x: k.x, y: k.y,
        name: k.name ?? k.part ?? k.label,
        c: Number(k.score ?? k.confidence ?? k.visibility ?? 1)
      }));
      const reordered = this._reorderByName(named);
      pts = reordered;
    } else {
      pts = pose.keypoints.map(k => ({
        x: k.x, y: k.y, c: Number(k.score ?? k.confidence ?? k.visibility ?? 1)
      }));
    }
  }
  // B) landmarks: [[x,y,(z)]] or [{x,y,visibility?}]
  else if (Array.isArray(pose.landmarks) && pose.landmarks.length) {
    const lm = pose.landmarks;
    if (Array.isArray(lm[0])) {
      pts = lm.map(q => ({ x: q[0], y: q[1], c: 1 }));
    } else {
      pts = lm.map(q => ({ x: q.x, y: q.y, c: Number(q.visibility ?? q.score ?? q.confidence ?? 1) }));
    }
  }
  // C) nested variants
  else {
    const nested =
      pose.pose?.keypoints || pose.pose?.landmarks ||
      pose.output?.keypoints || pose.output?.landmarks ||
      pose.result?.keypoints || pose.result?.landmarks;

    if (Array.isArray(nested) && nested.length) {
      if (nested[0]?.x !== undefined || nested[0]?.part || nested[0]?.label) {
        const allHaveNames = nested.every(k => 'name' in k || 'part' in k || 'label' in k);
        if (allHaveNames) {
          const named = nested.map(k => ({
            x: k.x, y: k.y,
            name: k.name ?? k.part ?? k.label,
            c: Number(k.score ?? k.confidence ?? k.visibility ?? 1)
          }));
          const reordered = this._reorderByName(named);
          pts = reordered;
        } else {
          pts = nested.map(k => ({ x: k.x, y: k.y, c: Number(k.score ?? k.confidence ?? k.visibility ?? 1) }));
        }
      } else if (Array.isArray(nested[0])) {
        pts = nested.map(q => ({ x: q[0], y: q[1], c: 1 }));
      }
    }
  }

  // Normalize 0..1 → pixels (before flip/scale). Keep c unchanged.
  if (pts.length) {
    const v = this.video?.elt ? this.video.elt : this.video;
    const vw = v?.videoWidth || v?.width || width;
    const vh = v?.videoHeight || v?.height || height;

    let count01 = 0, valid = 0;
    for (const p of pts) {
      if (!p) continue;
      valid++;
      if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) count01++;
    }
    const likelyNormalized = count01 >= Math.max(6, Math.floor(valid * 0.6));
    if (likelyNormalized) {
      pts = pts.map(p => p ? { x: p.x * vw, y: p.y * vh, c: p.c } : null);
    }
  }

  return pts;
}


_drawSkeleton(pts) {
  stroke(255); strokeWeight(2);
  for (const [a, b] of this._edges) {
    const pa = pts[a], pb = pts[b];
    if (pa && pb && Number.isFinite(pa.x) && Number.isFinite(pa.y) && Number.isFinite(pb.x) && Number.isFinite(pb.y)) {
      line(pa.x, pa.y, pb.x, pb.y);
    }
  }
}


  /**************** waits ****************/
  async _waitDetectorReady(detector, timeoutMs = 10000) {
    const start = performance.now();
    if (typeof detector?.on === 'function') {
      let resolved = false;
      await new Promise((resolve) => {
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        try { detector.on('loaded', done); } catch {}
        try { detector.on('ready', done); } catch {}
        const id = setInterval(() => {
          if (detector?.model || typeof detector?.detectStart === 'function') { clearInterval(id); done(); }
          if (performance.now() - start > timeoutMs) { clearInterval(id); done(); }
        }, 50);
      });
      return;
    }
    while (performance.now() - start < timeoutMs) {
      if (detector?.model || typeof detector?.detectStart === 'function') return;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  async _waitForVideoReady(video) {
    try { video.setAttribute?.('playsinline',''); await video.play?.(); } catch {}
    const ready = () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    if (ready()) return;
    await new Promise((resolve) => {
      const on = () => { if (ready()) { video.removeEventListener?.('loadeddata', on); video.removeEventListener?.('loadedmetadata', on); resolve(); } };
      video.addEventListener?.('loadeddata', on);
      video.addEventListener?.('loadedmetadata', on);
      const id = setInterval(() => { if (ready()) { clearInterval(id); resolve(); } }, 50);
    });
    if (!video.width || !video.height) { video.width = video.videoWidth; video.height = video.videoHeight; }
  }

  async _waitForRealFrames(video, minFrames = 2, timeoutMs = 4000) {
    const v = video.elt ? video.elt : video;
    try { v.setAttribute('playsinline',''); await v.play?.(); } catch {}
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();

    if (typeof v.requestVideoFrameCallback === 'function') {
      let seen = 0;
      await new Promise((resolve) => {
        const onF = () => {
          seen++;
          if (seen >= minFrames || (now() - t0) > timeoutMs) resolve();
          else v.requestVideoFrameCallback(onF);
        };
        v.requestVideoFrameCallback(onF);
      });
      return;
    }
    if (v.readyState < 2) {
      await new Promise((resolve) => {
        const onPlay = () => { v.removeEventListener('playing', onPlay); resolve(); };
        v.addEventListener('playing', onPlay);
        setTimeout(resolve, timeoutMs);
      });
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  async _waitFirstResult(timeoutMs = 6000) {
    if (this._firstResultSeen) return;
    return new Promise((resolve) => {
      this._firstResultResolvers.push(resolve);
      setTimeout(() => resolve(), timeoutMs); // soft timeout
    });
  }// Normalize variant landmark names to our canonical snake_case names
_normalizeName(n) {
  if (!n) return null;
  // unify case and separators
  let s = String(n).trim();
  // convert camelCase to snake_case
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  s = s.replace(/[\s\-]+/g, '_').toLowerCase();

  // common alias fixes (ml5/MP variants)
  const alias = {
    left_eye_inner: 'left_eye_inner',
    left_eye: 'left_eye',
    left_eye_outer: 'left_eye_outer',
    right_eye_inner: 'right_eye_inner',
    right_eye: 'right_eye',
    right_eye_outer: 'right_eye_outer',
    left_ear: 'left_ear',
    right_ear: 'right_ear',
    mouth_left: 'mouth_left',
    mouth_right: 'mouth_right',
    left_shoulder: 'left_shoulder',
    right_shoulder: 'right_shoulder',
    left_elbow: 'left_elbow',
    right_elbow: 'right_elbow',
    left_wrist: 'left_wrist',
    right_wrist: 'right_wrist',
    left_pinky: 'left_pinky',
    right_pinky: 'right_pinky',
    left_index: 'left_index',
    right_index: 'right_index',
    left_thumb: 'left_thumb',
    right_thumb: 'right_thumb',
    left_hip: 'left_hip',
    right_hip: 'right_hip',
    left_knee: 'left_knee',
    right_knee: 'right_knee',
    left_ankle: 'left_ankle',
    right_ankle: 'right_ankle',
    left_heel: 'left_heel',
    right_heel: 'right_heel',
    left_foot_index: 'left_foot_index',
    right_foot_index: 'right_foot_index',
    nose: 'nose',
  };
  return alias[s] || s; // fall back to normalized string
}
_reorderByName(namedList) {
  const out = new Array(this._names.length).fill(null);
  const indexOf = Object.create(null);
  this._names.forEach((nm, i) => { indexOf[nm] = i; });

  for (const kp of namedList) {
    const nm = this._normalizeName(kp.name || kp.part || kp.label);
    if (!nm || !(nm in indexOf)) continue;
    const i = indexOf[nm];
    out[i] = { x: kp.x, y: kp.y, c: Number(kp.c ?? 1) };
  }
  return out;
}

  
// put this anywhere inside the BodyPose class
_safeXY(p) { return (p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? { x: p.x, y: p.y } : { x: NaN, y: NaN }; }
// --- confidence helpers ---
_safePoint(p) {                 // always return a point object
  return (p && Number.isFinite(p.x) && Number.isFinite(p.y))
    ? { x: p.x, y: p.y, c: Number.isFinite(p.c) ? p.c : 1 }
    : { x: NaN, y: NaN, c: 0 };
}
_ptOK(p, minC) {                // usable for drawing?
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.c ?? 0) >= minC;
}
  _drawSkeletonWithConfidence(pts, minC) {
  stroke(255); strokeWeight(2);
  for (const [a, b] of this._edges) {
    const pa = pts[a], pb = pts[b];
    if (this._ptOK(pa, minC) && this._ptOK(pb, minC)) {
      line(pa.x, pa.y, pb.x, pb.y);
    }
  }
}

}
