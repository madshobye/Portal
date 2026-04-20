(() => {
  const DOTS_PER_MM = 203 / 25.4;
  const STORAGE_KEY_FORMAT = "ttl.labelPrinter.format";
  const LABEL_FORMATS = {
    "10x10": { widthCm: 10, heightCm: 10 },
    "10x15": { widthCm: 10, heightCm: 15 },
  };
  const TEXT_MARGIN_MM = 8;
  const TEXT_TOP_MARGIN_MM = 2.5;
  const BASE_WIDTH_MM = 58;
  const TITLE_FONT = 22;
  const META_FONT = 14;
  const BODY_FONT = 14;
  const LINE_GAP = 6;
  const FACEMESH_LABEL_PATHS = [
    {
      closed: true,
      indices: [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
      ],
    },
    {
      closed: true,
      indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    },
    {
      closed: true,
      indices: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    },
    {
      closed: false,
      indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    },
    {
      closed: false,
      indices: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
    },
    {
      closed: true,
      indices: [
        61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308,
        324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37, 0,
        267, 269, 270, 409, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78,
      ],
    },
    {
      closed: true,
      indices: [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
    },
    {
      closed: false,
      indices: [168, 6, 197, 195, 5, 4],
    },
    {
      closed: true,
      indices: [2, 97, 326, 327, 98],
    },
  ];
  const FACEMESH_LABEL_LINE_WEIGHT = 2.8;
  const FACEMESH_LABEL_DENSE_ENABLED = true;
  const FACEMESH_LABEL_DENSE_NEIGHBORS = 5;
  const FACEMESH_LABEL_DENSE_MAX_DIST_RATIO = 0.18;
  const FACEMESH_LABEL_DENSE_WEIGHT = 1.6;

  function create({ onLog = () => {}, onState = () => {} } = {}) {
    let printer = null;
    let ready = false;
    let busy = false;
    let initPromise = null;
    let labelFormat = loadLabelFormat();
    let lastPreviewGraphic = null;
    let lastPreviewMeta = null;

    function loadLabelFormat() {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY_FORMAT) || "";
        if (stored in LABEL_FORMATS) return stored;
      } catch {}
      return "10x15";
    }

    function persistLabelFormat() {
      try {
        window.localStorage.setItem(STORAGE_KEY_FORMAT, labelFormat);
      } catch {}
    }

    function getActiveFormat() {
      return LABEL_FORMATS[labelFormat] || LABEL_FORMATS["10x15"];
    }

    function getLabelFormat() {
      return labelFormat;
    }

    function toggleLabelFormat() {
      labelFormat = labelFormat === "10x15" ? "10x10" : "10x15";
      persistLabelFormat();
      emitState();
      onLog(`label format: ${labelFormat}`);
      return labelFormat;
    }

    function getState() {
      const connection = printer?.getConnectionState?.() || {};
      return {
        ready,
        busy,
        connected: !!connection.connected,
        connecting: !!connection.connecting,
        state: connection.state || (ready ? "ready" : "loading"),
        deviceName: connection.deviceName || "",
        labelFormat,
        hasPreview: !!lastPreviewGraphic,
      };
    }

    function emitState() {
      onState(getState());
    }

    async function ensureReady() {
      if (ready) return true;
      if (initPromise) return initPromise;
      initPromise = (async () => {
        await loadScript("portal/labelPrinterProtocol.js");
        await loadScript("portal/bleLabelPrinter.js");
        printer = await new BleLabelPrinter({
          protocol: "tspl",
          waitForAutoReconnect: true,
          autoReconnectAttempts: 2,
          reconnectDelayMs: 700,
          onState: () => emitState(),
          onError: (error) => onLog(`printer error: ${error?.message || error}`),
        }).init();
        ready = true;
        onLog("printer module ready");
        emitState();
        return true;
      })();
      try {
        return await initPromise;
      } finally {
        initPromise = null;
      }
    }

    async function pairAndConnect() {
      await ensureReady();
      busy = true;
      emitState();
      try {
        await printer.connectWithPicker({ acceptAllDevices: false });
        onLog("printer connected via picker");
        return true;
      } finally {
        busy = false;
        emitState();
      }
    }

    async function tryReconnectPaired() {
      await ensureReady();
      const state = printer.getConnectionState();
      if (state.connected) return true;
      try {
        const connected = await printer.reconnectKnown({
          reason: "analysis",
          attempts: 1,
          delayMs: 0,
        });
        emitState();
        return !!connected;
      } catch (error) {
        onLog(`reconnect skipped: ${error?.message || error}`);
        emitState();
        return false;
      }
    }

    function pickAnalysisValues(response) {
      const safe = response && typeof response === "object" ? response : {};
      const pick = (...keys) => {
        for (const key of keys) {
          const value = safe[key];
          if (value === undefined || value === null) continue;
          const text = String(value).trim();
          if (text) return text;
        }
        return "";
      };
      return {
        age: pick("age"),
        gender: pick("gender"),
        ethnicity: pick("ethnicity"),
        country: pick("country"),
        education: pick("education_level", "educational_level", "education"),
        lifespan: pick("lifespan"),
        lifeAdvice: pick("life_advice"),
      };
    }

    function wrapText(gfx, text, maxWidth) {
      const content = String(text || "").replace(/\r/g, "");
      const sourceLines = content.split("\n");
      const wrapped = [];
      for (const sourceLine of sourceLines) {
        const words = sourceLine.split(/\s+/).filter(Boolean);
        if (!words.length) {
          wrapped.push("");
          continue;
        }
        let current = words[0];
        for (let i = 1; i < words.length; i += 1) {
          const candidate = `${current} ${words[i]}`;
          if (gfx.textWidth(candidate) <= maxWidth) {
            current = candidate;
          } else {
            wrapped.push(current);
            current = words[i];
          }
        }
        wrapped.push(current);
      }
      return wrapped;
    }

    function drawFaceMeshOnLabel(gfx, normalizedFacePoints, box) {
      if (!Array.isArray(normalizedFacePoints) || normalizedFacePoints.length === 0) return;
      const left = box.x;
      const top = box.y;
      const w = box.w;
      const h = box.h;
      if (w <= 0 || h <= 0) return;

      gfx.push();
      gfx.noFill();
      gfx.stroke(0);
      gfx.strokeCap(ROUND);
      gfx.strokeJoin(ROUND);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of normalizedFacePoints) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        gfx.pop();
        return;
      }

      const sourceW = Math.max(1e-5, maxX - minX);
      const sourceH = Math.max(1e-5, maxY - minY);
      const scale = Math.min(w / sourceW, h / sourceH);
      const drawW = sourceW * scale;
      const drawH = sourceH * scale;
      const offsetX = left + (w - drawW) * 0.5 - minX * scale;
      const offsetY = top + (h - drawH) * 0.5 - minY * scale;

      const mappedPoints = normalizedFacePoints.map((point) => {
        const x = Number(point?.x);
        const y = Number(point?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return {
          x: offsetX + x * scale,
          y: offsetY + y * scale,
        };
      });

      if (FACEMESH_LABEL_DENSE_ENABLED) {
        const denseEdges = buildDenseEdges(mappedPoints);
        gfx.strokeWeight(FACEMESH_LABEL_DENSE_WEIGHT);
        for (const edge of denseEdges) {
          const a = mappedPoints[edge[0]];
          const b = mappedPoints[edge[1]];
          if (!a || !b) continue;
          gfx.line(a.x, a.y, b.x, b.y);
        }
      }

      gfx.strokeWeight(FACEMESH_LABEL_LINE_WEIGHT);
      for (const path of FACEMESH_LABEL_PATHS) {
        const indices = path?.indices || [];
        if (indices.length < 2) continue;
        for (let i = 0; i < indices.length - 1; i += 1) {
          const a = mappedPoints[indices[i]];
          const b = mappedPoints[indices[i + 1]];
          if (!a || !b) continue;
          gfx.line(a.x, a.y, b.x, b.y);
        }
        if (path.closed) {
          const a = mappedPoints[indices[indices.length - 1]];
          const b = mappedPoints[indices[0]];
          if (!a || !b) continue;
          gfx.line(a.x, a.y, b.x, b.y);
        }
      }

      gfx.pop();
    }

    function buildDenseEdges(points) {
      const validIndices = [];
      for (let i = 0; i < points.length; i += 1) {
        if (points[i]) validIndices.push(i);
      }
      if (validIndices.length < 4) return [];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const index of validIndices) {
        const point = points[index];
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
      const diagonal = Math.hypot(maxX - minX, maxY - minY);
      const maxDist = diagonal * FACEMESH_LABEL_DENSE_MAX_DIST_RATIO;
      if (!Number.isFinite(maxDist) || maxDist <= 0) return [];

      const edgeSet = new Set();
      const edges = [];

      for (const sourceIndex of validIndices) {
        const source = points[sourceIndex];
        const nearest = [];

        for (const targetIndex of validIndices) {
          if (targetIndex === sourceIndex) continue;
          const target = points[targetIndex];
          const distance = Math.hypot(target.x - source.x, target.y - source.y);
          if (!Number.isFinite(distance) || distance > maxDist) continue;

          nearest.push({ targetIndex, distance });
        }

        nearest.sort((a, b) => a.distance - b.distance);
        const count = Math.min(FACEMESH_LABEL_DENSE_NEIGHBORS, nearest.length);

        for (let i = 0; i < count; i += 1) {
          const targetIndex = nearest[i].targetIndex;
          const a = Math.min(sourceIndex, targetIndex);
          const b = Math.max(sourceIndex, targetIndex);
          const key = `${a}-${b}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          edges.push([a, b]);
        }
      }

      return edges;
    }

    function createReceiptImageData(response, { faceMeshPoints = null } = {}) {
      const data = pickAnalysisValues(response);
      const format = getActiveFormat();
      const widthMm = format.widthCm * 10;
      const heightMm = format.heightCm * 10;
      const widthPx = Math.round(widthMm * DOTS_PER_MM);
      const heightPx = Math.round(heightMm * DOTS_PER_MM);
      const pagePadding = Math.round(TEXT_MARGIN_MM * DOTS_PER_MM);
      const topPadding = Math.round(TEXT_TOP_MARGIN_MM * DOTS_PER_MM);
      const contentWidth = widthPx - pagePadding * 2;
      const scale = Math.max(1, widthMm / BASE_WIDTH_MM);
      const titleFont = Math.round(TITLE_FONT * scale);
      const metaFont = Math.round(META_FONT * scale);
      const bodyFont = Math.round(BODY_FONT * scale);
      const lineGap = Math.round(LINE_GAP * scale);

      const measure = createGraphics(widthPx, 64);
      measure.pixelDensity(1);
      measure.textAlign(LEFT, TOP);
      measure.textStyle(NORMAL);
      measure.textFont("Helvetica");
      measure.textSize(bodyFont);
      const adviceLines = wrapText(measure, data.lifeAdvice, contentWidth);

      const metaLineHeight = metaFont + Math.round(5 * scale);
      const bodyLineHeight = bodyFont + Math.round(4 * scale);
      const titleHeight = titleFont + Math.round(2 * scale);
      const separatorHeight = Math.round(8 * scale);
      const profileHeaderHeight = metaFont + Math.round(4 * scale);
      const labelHeightMm = heightMm;

      const gfx = createGraphics(widthPx, heightPx);
      gfx.pixelDensity(1);
      gfx.background(255);
      gfx.fill(0);
      gfx.textAlign(LEFT, TOP);
      gfx.textFont("Helvetica");

      let y = topPadding;
      gfx.textStyle(BOLD);
      gfx.textSize(titleFont);
      gfx.text("TTL ANALYSIS", pagePadding, y, contentWidth, titleHeight);
      y += titleHeight + lineGap;

      gfx.stroke(0);
      gfx.strokeWeight(1);
      gfx.line(pagePadding, y, widthPx - pagePadding, y);
      y += separatorHeight;

      gfx.noStroke();
      gfx.textStyle(BOLD);
      gfx.textSize(metaFont);
      gfx.text("PROFILE", pagePadding, y, contentWidth, profileHeaderHeight);
      y += profileHeaderHeight + lineGap;

      const rows = [
        ["AGE", data.age],
        ["GENDER", data.gender],
        ["ETHNICITY", data.ethnicity],
        ["COUNTRY", data.country],
        ["EDUCATION", data.education],
        ["LIFESPAN", data.lifespan],
      ];
      const labelColWidth = Math.max(120, Math.round(contentWidth * 0.34));
      for (const row of rows) {
        const label = `${row[0]}:`;
        const value = row[1] || "";
        gfx.textStyle(BOLD);
        gfx.text(label, pagePadding, y, labelColWidth, metaLineHeight);
        gfx.textStyle(NORMAL);
        gfx.text(value, pagePadding + labelColWidth, y, contentWidth - labelColWidth, metaLineHeight);
        y += metaLineHeight;
      }

      y += lineGap;
      gfx.textStyle(BOLD);
      gfx.text("Life advice:", pagePadding, y, contentWidth, bodyLineHeight);
      y += bodyLineHeight;
      gfx.textStyle(NORMAL);
      gfx.textSize(bodyFont);
      for (const line of adviceLines) {
        gfx.text(line, pagePadding, y, contentWidth, bodyLineHeight);
        y += bodyLineHeight;
      }

      const meshTop = Math.floor(heightPx * (2 / 3));
      const meshBox = {
        x: pagePadding,
        y: meshTop + Math.round(pagePadding * 0.5),
        w: widthPx - pagePadding * 2,
        h: Math.max(1, heightPx - meshTop - Math.round(pagePadding * 1.5)),
      };
      drawFaceMeshOnLabel(gfx, faceMeshPoints, meshBox);

      const imageData = gfx.drawingContext.getImageData(0, 0, gfx.width, gfx.height);
      return {
        graphic: gfx,
        imageData,
        labelWidthMm: widthMm,
        labelHeightMm,
      };
    }

    function getDebugPreview() {
      if (!lastPreviewGraphic || !lastPreviewMeta) return null;
      return {
        graphic: lastPreviewGraphic,
        labelWidthMm: lastPreviewMeta.labelWidthMm,
        labelHeightMm: lastPreviewMeta.labelHeightMm,
        labelFormat,
      };
    }

    async function printAnalysisReceipt(response, options = {}) {
      await ensureReady();
      const payload = createReceiptImageData(response, options);
      lastPreviewGraphic = payload.graphic;
      lastPreviewMeta = {
        labelWidthMm: payload.labelWidthMm,
        labelHeightMm: payload.labelHeightMm,
      };
      emitState();

      const connected = await tryReconnectPaired();
      if (!connected) {
        onLog("no paired printer found; auto print skipped");
        return { printed: false, reason: "not-connected" };
      }

      busy = true;
      emitState();
      try {
        await printer.printTsplBitmap(payload.imageData, {
          labelWidthMm: payload.labelWidthMm,
          labelHeightMm: payload.labelHeightMm,
          gapMm: 2,
          threshold: 210,
          invert: true,
          dither: true,
        });
        onLog("analysis receipt printed");
        return { printed: true };
      } finally {
        busy = false;
        emitState();
      }
    }

    return {
      ensureReady,
      pairAndConnect,
      tryReconnectPaired,
      getLabelFormat,
      toggleLabelFormat,
      printAnalysisReceipt,
      getDebugPreview,
      getState,
    };
  }

  window.TtlLabelPrint = {
    create,
  };
})();
