// Lightweight face tracking for interactions that do not need a full face mesh.
// Uses MediaPipe BlazeFace: one box + six landmarks instead of 468 mesh points.

class PortalFaceTracker {
  constructor({
    video,
    videoIsFlipped = false,
    maxFaces = 1,
    targetFps = 24,
    smoothing = 0.35,
    minDetectionConfidence = 0.5,
    minSuppressionThreshold = 0.3,
    delegate = "CPU",
    onResults = null,
  } = {}) {
    if (!video) throw new Error("FaceTracker: video is required");

    this.videoP5 = video?.elt ? video : null;
    this.video = video?.elt || video;
    this.videoIsFlipped = !!videoIsFlipped;
    this.maxFaces = max(1, Number(maxFaces) || 1);
    this.targetFps = constrainNumber(targetFps, 1, 60, 24);
    this.smoothing = constrainNumber(smoothing, 0, 1, 0.35);
    this.minDetectionConfidence = constrainNumber(minDetectionConfidence, 0, 1, 0.5);
    this.minSuppressionThreshold = constrainNumber(minSuppressionThreshold, 0, 1, 0.3);
    this.delegate = delegate === "GPU" ? "GPU" : "CPU";
    this.onResults = typeof onResults === "function" ? onResults : null;

    this.detector = null;
    this.ready = false;
    this.running = false;
    this.facesRaw = [];
    this.faces = [];
    this.hasNew = false;
    this.lastInferenceMs = -Infinity;
    this.lastVideoTime = -1;
    this.raf = null;
  }

  async init() {
    const packageRoot =
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
    const visionTasks = await import(`${packageRoot}/vision_bundle.mjs`);
    const vision = await visionTasks.FilesetResolver.forVisionTasks(
      `${packageRoot}/wasm`,
    );

    this.detector = await visionTasks.FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: this.delegate,
      },
      runningMode: "VIDEO",
      minDetectionConfidence: this.minDetectionConfidence,
      minSuppressionThreshold: this.minSuppressionThreshold,
    });

    this.ready = true;
    return this;
  }

  async start() {
    if (!this.ready || !this.detector) {
      throw new Error("FaceTracker: call init() before start()");
    }
    if (this.running) return;

    await this.waitForVideo();
    this.running = true;

    const loop = (now) => {
      if (!this.running) return;

      const interval = 1000 / this.targetFps;
      const hasNewVideoFrame = this.video.currentTime !== this.lastVideoTime;
      if (hasNewVideoFrame && now - this.lastInferenceMs >= interval) {
        this.lastInferenceMs = now;
        this.lastVideoTime = this.video.currentTime;
        this.detect(now);
      }

      this.raf = requestAnimationFrame(loop);
    };

    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  close() {
    this.stop();
    this.detector?.close?.();
    this.detector = null;
    this.ready = false;
  }

  detect(timestamp) {
    try {
      const result = this.detector.detectForVideo(this.video, timestamp);
      const rawFaces = (result?.detections || [])
        .map((detection) => this.normalizeDetection(detection))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.maxFaces);

      this.facesRaw = this.smoothFaces(this.facesRaw, rawFaces);
      this.faces = this.facesRaw.map((face) => this.flipFace(face));
      this.hasNew = true;

      if (this.onResults) this.onResults(this.getFaces());
    } catch (error) {
      console.warn("FaceTracker detection failed:", error);
    }
  }

  normalizeDetection(detection) {
    const box = detection?.boundingBox;
    if (!box) return null;

    const videoWidth = this.video.videoWidth || this.video.width || 1;
    const videoHeight = this.video.videoHeight || this.video.height || 1;
    const x = Number(box.originX ?? box.origin_x ?? 0);
    const y = Number(box.originY ?? box.origin_y ?? 0);
    const width = Number(box.width ?? 0);
    const height = Number(box.height ?? 0);
    const landmarkNames = [
      "rightEye",
      "leftEye",
      "noseTip",
      "mouthCenter",
      "rightEarTragion",
      "leftEarTragion",
    ];

    const keypoints = (detection.keypoints || []).map((point, index) => ({
      x: point.x * videoWidth,
      y: point.y * videoHeight,
      name: point.label || point.displayName || landmarkNames[index] || `point${index}`,
    }));

    const face = {
      score: Number(detection.categories?.[0]?.score ?? 1),
      box: { x, y, width, height, xMin: x, yMin: y, xMax: x + width, yMax: y + height },
      center: { x: x + width * 0.5, y: y + height * 0.5 },
      keypoints,
    };

    for (const point of keypoints) face[point.name] = point;
    face.rotation = estimateFaceRotation(face);
    return face;
  }

  smoothFaces(previousFaces, nextFaces) {
    return nextFaces.map((face, index) => {
      const previous = previousFaces[index];
      if (!previous) return face;

      const amount = this.smoothing;
      const box = {
        x: mix(previous.box.x, face.box.x, amount),
        y: mix(previous.box.y, face.box.y, amount),
        width: mix(previous.box.width, face.box.width, amount),
        height: mix(previous.box.height, face.box.height, amount),
      };
      box.xMin = box.x;
      box.yMin = box.y;
      box.xMax = box.x + box.width;
      box.yMax = box.y + box.height;

      const keypoints = face.keypoints.map((point, pointIndex) => {
        const oldPoint = previous.keypoints?.[pointIndex] || point;
        return {
          ...point,
          x: mix(oldPoint.x, point.x, amount),
          y: mix(oldPoint.y, point.y, amount),
        };
      });

      const smoothed = {
        ...face,
        box,
        center: { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
        keypoints,
      };
      for (const point of keypoints) smoothed[point.name] = point;
      smoothed.rotation = estimateFaceRotation(smoothed);
      return smoothed;
    });
  }

  flipFace(face) {
    if (!this.videoIsFlipped) return cloneFace(face);
    const videoWidth = this.video.videoWidth || this.video.width || 1;
    const flipped = mapFace(face, (x, y) => ({ x: videoWidth - x, y }));
    flipped.rotation = {
      yaw: -face.rotation.yaw,
      pitch: face.rotation.pitch,
      roll: -face.rotation.roll,
    };
    return flipped;
  }

  getLatest() {
    return { faces: this.getFaces(), best: this.getBest() };
  }

  getFaces() {
    return this.faces;
  }

  getFacesRaw() {
    return this.facesRaw;
  }

  getBest() {
    return this.faces[0] || null;
  }

  getFacesInRect(x, y, width, height) {
    const videoWidth = this.video.videoWidth || this.video.width || 1;
    const videoHeight = this.video.videoHeight || this.video.height || 1;
    return this.faces.map((face) =>
      mapFace(face, (pointX, pointY) => ({
        x: x + (pointX / videoWidth) * width,
        y: y + (pointY / videoHeight) * height,
      })),
    );
  }

  hasResult() {
    return this.faces.length > 0;
  }

  hasNewResult() {
    return this.hasNew;
  }

  resetNewFlag() {
    this.hasNew = false;
  }

  consumeNew() {
    const wasNew = this.hasNew;
    this.hasNew = false;
    return { wasNew, faces: this.getFaces(), best: this.getBest() };
  }

  async waitForVideo() {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) return;
    await new Promise((resolve) => {
      const ready = () => {
        if (this.video.readyState >= 2 && this.video.videoWidth > 0) {
          this.video.removeEventListener("loadeddata", ready);
          resolve();
        }
      };
      this.video.addEventListener("loadeddata", ready);
      ready();
    });
  }
}

function mapFace(face, transform, isFlip = false, sourceWidth = 0) {
  const topLeft = transform(face.box.x, face.box.y);
  const bottomRight = transform(face.box.x + face.box.width, face.box.y + face.box.height);
  const boxX = minNumber(topLeft.x, bottomRight.x);
  const boxY = minNumber(topLeft.y, bottomRight.y);
  const boxWidth = Math.abs(bottomRight.x - topLeft.x);
  const boxHeight = Math.abs(bottomRight.y - topLeft.y);
  const keypoints = face.keypoints.map((point) => ({ ...point, ...transform(point.x, point.y) }));
  const mapped = {
    ...face,
    box: {
      x: boxX,
      y: boxY,
      width: boxWidth,
      height: boxHeight,
      xMin: boxX,
      yMin: boxY,
      xMax: boxX + boxWidth,
      yMax: boxY + boxHeight,
    },
    center: transform(face.center.x, face.center.y),
    keypoints,
  };
  for (const point of keypoints) mapped[point.name] = point;
  return mapped;
}

function cloneFace(face) {
  return mapFace(face, (x, y) => ({ x, y }));
}

function estimateFaceRotation(face) {
  const leftEye = face.leftEye || face.keypoints?.[0];
  const rightEye = face.rightEye || face.keypoints?.[1];
  const nose = face.noseTip || face.keypoints?.[2];
  const mouth = face.mouthCenter || face.keypoints?.[3];
  const leftEar = face.leftEarTragion || face.keypoints?.[4];
  const rightEar = face.rightEarTragion || face.keypoints?.[5];

  if (!leftEye || !rightEye || !nose) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  const eyeX = (leftEye.x + rightEye.x) * 0.5;
  const eyeY = (leftEye.y + rightEye.y) * 0.5;
  const eyeDX = leftEye.x - rightEye.x;
  const eyeDY = leftEye.y - rightEye.y;
  const eyeDistance = Math.max(1, Math.hypot(eyeDX, eyeDY));

  let roll = Math.atan2(eyeDY, eyeDX);
  if (roll > Math.PI * 0.5) roll -= Math.PI;
  if (roll < -Math.PI * 0.5) roll += Math.PI;

  const noseYaw = ((nose.x - eyeX) / eyeDistance) * 1.8;
  let earYaw = noseYaw;
  if (leftEar && rightEar) {
    const leftSpan = Math.abs(nose.x - leftEar.x);
    const rightSpan = Math.abs(rightEar.x - nose.x);
    earYaw = ((rightSpan - leftSpan) / Math.max(1, leftSpan + rightSpan)) * 1.25;
  }
  const yaw = clampNumber(noseYaw * 0.65 + earYaw * 0.35, -1.1, 1.1);

  let pitch = 0;
  if (mouth) {
    const eyeToMouth = Math.max(1, mouth.y - eyeY);
    const noseRatio = (nose.y - eyeY) / eyeToMouth;
    pitch = clampNumber((0.5 - noseRatio) * 2.4, -0.8, 0.8);
  }

  return { yaw, pitch, roll: clampNumber(roll, -0.8, 0.8) };
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function minNumber(a, b) {
  return a < b ? a : b;
}

function clampNumber(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function constrainNumber(value, low, high, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

window.PortalFaceTracker = PortalFaceTracker;
window.FaceTracker = PortalFaceTracker;
