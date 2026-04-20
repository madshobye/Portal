(() => {
  const DOTS_PER_MM = 203 / 25.4;
  const STORAGE_KEY_FORMAT = "ttl.labelPrinter.format";
  const LABEL_FORMATS = {
    "10x10": { widthCm: 10, heightCm: 10 },
    "10x15": { widthCm: 10, heightCm: 15 },
  };
  const PAGE_PADDING = 18;
  const BASE_WIDTH_MM = 58;
  const TITLE_FONT = 22;
  const META_FONT = 14;
  const BODY_FONT = 14;
  const LINE_GAP = 6;

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
        return "-";
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

    function createReceiptImageData(response) {
      const data = pickAnalysisValues(response);
      const format = getActiveFormat();
      const widthMm = format.widthCm * 10;
      const heightMm = format.heightCm * 10;
      const widthPx = Math.round(widthMm * DOTS_PER_MM);
      const heightPx = Math.round(heightMm * DOTS_PER_MM);
      const contentWidth = widthPx - PAGE_PADDING * 2;
      const contentHeight = heightPx - PAGE_PADDING * 2;
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

      const metaLineHeight = metaFont + Math.round(3 * scale);
      const bodyLineHeight = bodyFont + Math.round(4 * scale);
      const titleHeight = titleFont + Math.round(2 * scale);
      const separatorHeight = Math.round(8 * scale);
      const metaRows = 6;
      const calculatedHeight =
        PAGE_PADDING * 2 +
        titleHeight +
        lineGap +
        separatorHeight +
        metaRows * metaLineHeight +
        lineGap +
        Math.max(1, adviceLines.length) * bodyLineHeight;
      const labelHeightMm = heightMm;

      const gfx = createGraphics(widthPx, heightPx);
      gfx.pixelDensity(1);
      gfx.background(255);
      gfx.fill(0);
      gfx.textAlign(LEFT, TOP);
      gfx.textFont("Helvetica");

      let y = PAGE_PADDING;
      gfx.textStyle(BOLD);
      gfx.textSize(titleFont);
      gfx.text("TTL ANALYSIS", PAGE_PADDING, y, contentWidth, titleHeight);
      y += titleHeight + lineGap;

      gfx.stroke(0);
      gfx.strokeWeight(1);
      gfx.line(PAGE_PADDING, y, widthPx - PAGE_PADDING, y);
      y += separatorHeight;

      gfx.noStroke();
      gfx.textStyle(NORMAL);
      gfx.textSize(metaFont);
      const rows = [
        `Age: ${data.age}`,
        `Gender: ${data.gender}`,
        `Ethnicity: ${data.ethnicity}`,
        `Country: ${data.country}`,
        `Education: ${data.education}`,
        `Lifespan: ${data.lifespan}`,
      ];
      for (const row of rows) {
        gfx.text(row, PAGE_PADDING, y, contentWidth, metaLineHeight);
        y += metaLineHeight;
      }

      y += lineGap;
      gfx.textStyle(BOLD);
      gfx.text("Life advice:", PAGE_PADDING, y, contentWidth, bodyLineHeight);
      y += bodyLineHeight;
      gfx.textStyle(NORMAL);
      gfx.textSize(bodyFont);
      for (const line of adviceLines) {
        if (y + bodyLineHeight > PAGE_PADDING + contentHeight) break;
        gfx.text(line, PAGE_PADDING, y, contentWidth, bodyLineHeight);
        y += bodyLineHeight;
      }

      if (calculatedHeight > heightPx) {
        onLog("receipt content truncated to fit selected label size");
      }

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

    async function printAnalysisReceipt(response) {
      await ensureReady();
      const payload = createReceiptImageData(response);
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
