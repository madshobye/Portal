// Browser/p5 helpers for printing text-heavy ESC/POS receipt experiments.
// Low-level byte encoders stay in LabelPrinterProtocol; this module owns p5 text rendering.

class ReceiptTextPrinter {
  static async printBigAscii(printer, textToPrint, {
    size = 0x22,
    align = "center",
    bold = true,
    feedLines = 3,
  } = {}) {
    const encoder = new TextEncoder();
    const alignValue = align === "right" ? 2 : align === "left" ? 0 : 1;
    const normalizedText = String(textToPrint || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?");
    const bytes = LabelPrinterProtocol.concatBytes([
      new Uint8Array([
        0x1b, 0x40,
        0x1b, 0x61, alignValue,
        0x1d, 0x21, size & 0xff,
        0x1b, 0x45, bold ? 0x01 : 0x00,
      ]),
      encoder.encode(`${normalizedText}\n`),
      new Uint8Array([
        0x1b, 0x45, 0x00,
        0x1d, 0x21, 0x00,
        0x1b, 0x61, 0x00,
      ]),
      LabelPrinterProtocol.makeEscposFeed(feedLines),
    ]);
    await printer.writeBytes(bytes);
  }

  static async printLongText(printer, textToPrint, options = {}) {
    const settings = ReceiptTextPrinter.normalizeLongTextOptions(options);
    const metrics = ReceiptTextPrinter.measureText(textToPrint, settings);

    await printer.withWriteSettings({
      chunkDelayMs: settings.chunkDelayMs,
      chunkSize: settings.transportChunkSize,
    }, async () => {
      await printer.writeBytes(new Uint8Array([
        0x1b, 0x40,
        0x1b, 0x33, 0x00,
      ]));
      await ReceiptTextPrinter.applyHeatProfile(printer, settings.heatProfile);
      const pacing = { rowsSinceRest: 0 };
      for (let sourceX = 0; sourceX < metrics.sourceWidth; sourceX += settings.stripWidth) {
        settings.onProgress?.(Math.round((sourceX / metrics.sourceWidth) * 100));
        const currentStripWidth = Math.min(settings.stripWidth, metrics.sourceWidth - sourceX);
        const stripGraphic = ReceiptTextPrinter.makeTextSourceStrip(textToPrint, {
          ...settings,
          baseline: Math.round((settings.widthDots - metrics.ascent - metrics.descent) / 2 + metrics.ascent),
          sourceX,
          sourceWidth: currentStripWidth,
        });
        await ReceiptTextPrinter.printSourceStripAsRows(printer, stripGraphic, {
          ...settings,
          pacing,
        });
        stripGraphic.remove();
      }
      await printer.writeBytes(LabelPrinterProtocol.makeEscposFeed(settings.feedLines));
    });

    return { rasterRows: metrics.sourceWidth };
  }

  static async printVerticalText(printer, textToPrint, options = {}) {
    const settings = ReceiptTextPrinter.normalizeVerticalTextOptions(options);
    const metrics = ReceiptTextPrinter.measureText("M", settings);
    const renderHeight = Math.max(1, Math.ceil(metrics.ascent + metrics.descent + settings.paddingDots * 4));
    const baseline = Math.round(settings.paddingDots * 2 + metrics.ascent);
    const chars = Array.from(textToPrint);
    if (settings.reverseCharacters) chars.reverse();
    let rasterRows = 0;

    await printer.withWriteSettings({
      chunkDelayMs: settings.chunkDelayMs,
      chunkSize: settings.transportChunkSize,
    }, async () => {
      await printer.writeBytes(new Uint8Array([
        0x1b, 0x40,
        0x1b, 0x33, 0x00,
      ]));
      await ReceiptTextPrinter.applyHeatProfile(printer, settings.heatProfile);
      for (let index = 0; index < chars.length; index += 1) {
        settings.onProgress?.(Math.round((index / chars.length) * 100));
        const charGraphic = ReceiptTextPrinter.makeCharacterGraphic(chars[index], {
          ...settings,
          heightDots: renderHeight,
          baseline,
        });
        const croppedGraphic = ReceiptTextPrinter.trimVerticalWhitespace(charGraphic, {
          paddingRows: settings.letterGapRows,
          blankRows: chars[index] === " " ? settings.wordGapRows : null,
          threshold: settings.threshold,
        });
        charGraphic.remove();
        await ReceiptTextPrinter.printGraphicRasterBatched(printer, croppedGraphic, settings);
        rasterRows += croppedGraphic.height;
        croppedGraphic.remove();
      }
      await printer.writeBytes(LabelPrinterProtocol.makeEscposFeed(settings.feedLines));
    });

    return { rasterRows };
  }

  static preset(name, overrides = {}) {
    const shared = {
      widthDots: 384,
      fontFamily: '"Rubik Mono One", monospace',
      fontSize: 330,
      paddingDots: 12,
      outline: true,
      outlineWeight: 10,
      stripWidth: 64,
      heatProfile: "normal",
      threshold: 170,
      feedLines: 4,
    };

    if (name === "fastFill") {
      return {
        ...shared,
        outline: false,
        outlineWeight: 0,
        heatProfile: "low",
        bandHeight: 1,
        transportChunkSize: 300,
        chunkDelayMs: 0,
        bandsPerWrite: 96,
        writeDelayMs: 0,
        restEveryRows: 0,
        restMs: 0,
        rotation: "counterclockwise",
        ...overrides,
      };
    }

    if (name === "fast" || name === "fast90") {
      return {
        ...shared,
        bandHeight: 1,
        transportChunkSize: 300,
        chunkDelayMs: 0,
        bandsPerWrite: 96,
        writeDelayMs: 0,
        restEveryRows: 0,
        restMs: 0,
        rotation: name === "fast90" ? "clockwise" : "counterclockwise",
        ...overrides,
      };
    }

    return {
      ...shared,
      outline: false,
      outlineWeight: 0,
      bandHeight: 1,
      chunkDelayMs: 2,
      bandsPerWrite: 12,
      writeDelayMs: 80,
      restEveryRows: 36,
      restMs: 1400,
      rotation: "counterclockwise",
      ...overrides,
    };
  }

  static verticalPreset(overrides = {}) {
    return {
      widthDots: 384,
      fontFamily: '"Rubik Mono One", monospace',
      fontSize: 330,
      paddingDots: 12,
      outline: true,
      outlineWeight: 10,
      letterGapRows: 8,
      wordGapRows: 96,
      reverseCharacters: true,
      flipCharacters: true,
      heatProfile: "normal",
      transportChunkSize: 300,
      chunkDelayMs: 0,
      bandHeight: 8,
      bandsPerWrite: 10,
      writeDelayMs: 0,
      threshold: 170,
      feedLines: 4,
      ...overrides,
    };
  }

  static normalizeLongTextOptions(options = {}) {
    return {
      widthDots: 384,
      fontFamily: "serif",
      fontSize: 330,
      paddingDots: 12,
      outline: true,
      outlineWeight: 4,
      stripWidth: 64,
      bandHeight: 1,
      transportChunkSize: null,
      chunkDelayMs: 0,
      bandsPerWrite: 48,
      writeDelayMs: 0,
      restEveryRows: 96,
      restMs: 700,
      rotation: "counterclockwise",
      heatProfile: "low",
      threshold: 170,
      feedLines: 4,
      onProgress: null,
      ...options,
    };
  }

  static normalizeVerticalTextOptions(options = {}) {
    return {
      widthDots: 384,
      fontFamily: "serif",
      fontSize: 330,
      paddingDots: 12,
      outline: true,
      outlineWeight: 10,
      letterGapRows: 8,
      wordGapRows: 96,
      reverseCharacters: true,
      flipCharacters: true,
      heatProfile: "low",
      transportChunkSize: null,
      chunkDelayMs: 0,
      bandHeight: 8,
      bandsPerWrite: 10,
      writeDelayMs: 0,
      threshold: 170,
      feedLines: 4,
      onProgress: null,
      ...options,
    };
  }

  static measureText(textToPrint, {
    fontFamily = "serif",
    fontSize = 330,
    paddingDots = 28,
  } = {}) {
    const measurer = createGraphics(16, 16);
    measurer.pixelDensity(1);
    measurer.textFont(fontFamily);
    measurer.textSize(fontSize);
    const textWidthDots = Math.ceil(measurer.textWidth(textToPrint));
    const ascent = measurer.textAscent();
    const descent = measurer.textDescent();
    measurer.remove();
    return {
      ascent,
      descent,
      sourceWidth: Math.max(1, textWidthDots + paddingDots * 2),
    };
  }

  static makeTextSourceStrip(textToPrint, {
    widthDots = 384,
    fontFamily = "serif",
    fontSize = 330,
    paddingDots = 28,
    outline = true,
    outlineWeight = 4,
    baseline = 330,
    sourceX = 0,
    sourceWidth = 512,
  } = {}) {
    const source = createGraphics(sourceWidth, widthDots);
    source.pixelDensity(1);
    source.background(255);
    source.textFont(fontFamily);
    source.textSize(fontSize);
    source.textAlign(LEFT, BASELINE);
    if (outline) {
      source.noFill();
      source.stroke(0);
      source.strokeWeight(outlineWeight);
      source.strokeJoin(ROUND);
    } else {
      source.noStroke();
      source.fill(0);
    }
    source.text(textToPrint, paddingDots - sourceX, baseline);
    return source;
  }

  static makeCharacterGraphic(character, {
    widthDots = 384,
    heightDots = 384,
    fontFamily = "serif",
    fontSize = 330,
    outline = true,
    outlineWeight = 10,
    baseline = 330,
    flipCharacters = false,
  } = {}) {
    const graphic = createGraphics(widthDots, heightDots);
    graphic.pixelDensity(1);
    graphic.background(255);
    graphic.textFont(fontFamily);
    graphic.textSize(fontSize);
    graphic.textAlign(CENTER, BASELINE);
    if (outline) {
      graphic.noFill();
      graphic.stroke(0);
      graphic.strokeWeight(outlineWeight);
      graphic.strokeJoin(ROUND);
    } else {
      graphic.noStroke();
      graphic.fill(0);
    }
    if (character !== " ") {
      if (flipCharacters) {
        graphic.push();
        graphic.translate(widthDots, heightDots);
        graphic.rotate(PI);
        graphic.text(character, widthDots / 2, baseline);
        graphic.pop();
      } else {
        graphic.text(character, widthDots / 2, baseline);
      }
    }
    return graphic;
  }

  static async printSourceStripAsRows(printer, graphic, {
    widthDots = 384,
    threshold = 170,
    bandHeight = 1,
    bandsPerWrite = 48,
    writeDelayMs = 0,
    restEveryRows = 96,
    restMs = 700,
    rotation = "counterclockwise",
    pacing = null,
  } = {}) {
    graphic.loadPixels();
    const widthBytes = Math.ceil(widthDots / 8);
    const restState = pacing || { rowsSinceRest: 0 };
    const rowsPerBand = Math.max(1, Math.min(8, Math.round(Number(bandHeight) || 1)));
    const maxBandsPerWrite = Math.max(1, Math.min(64, Math.round(Number(bandsPerWrite) || 1)));
    let pendingPayloads = [];
    for (let sourceX = 0; sourceX < graphic.width; sourceX += rowsPerBand) {
      const currentBandHeight = Math.min(rowsPerBand, graphic.width - sourceX);
      if (!printer?.getConnectionState?.().connected) {
        throw new Error("Printer disconnected during long text print.");
      }
      const rowBytes = ReceiptTextPrinter.packSourceColumnsAsRasterRows(graphic, {
        sourceX,
        widthDots,
        heightDots: currentBandHeight,
        rotation,
        threshold,
      });
      pendingPayloads.push(LabelPrinterProtocol.makeEscposRasterPayload(widthBytes, currentBandHeight, rowBytes));
      restState.rowsSinceRest += currentBandHeight;
      const shouldFlush = pendingPayloads.length >= maxBandsPerWrite || sourceX + rowsPerBand >= graphic.width;
      if (shouldFlush) {
        await printer.writeBytes(LabelPrinterProtocol.concatBytes(pendingPayloads));
        pendingPayloads = [];
        if (writeDelayMs > 0) await ReceiptTextPrinter.waitMs(writeDelayMs);
      }
      if (restEveryRows > 0 && restState.rowsSinceRest >= restEveryRows && restMs > 0) {
        if (pendingPayloads.length) {
          await printer.writeBytes(LabelPrinterProtocol.concatBytes(pendingPayloads));
          pendingPayloads = [];
        }
        restState.rowsSinceRest = 0;
        await ReceiptTextPrinter.waitMs(restMs);
      }
    }
  }

  static async printGraphicRasterBatched(printer, graphic, {
    widthDots = 384,
    bandHeight = 8,
    bandsPerWrite = 10,
    writeDelayMs = 0,
    threshold = 170,
  } = {}) {
    graphic.loadPixels();
    const widthBytes = Math.ceil(widthDots / 8);
    const rowsPerBand = Math.max(1, Math.min(64, Math.round(Number(bandHeight) || 1)));
    const maxBandsPerWrite = Math.max(1, Math.min(64, Math.round(Number(bandsPerWrite) || 1)));
    let pendingPayloads = [];

    for (let y = 0; y < graphic.height; y += rowsPerBand) {
      if (!printer?.getConnectionState?.().connected) {
        throw new Error("Printer disconnected during receipt text print.");
      }
      const currentHeight = Math.min(rowsPerBand, graphic.height - y);
      const imageBytes = ReceiptTextPrinter.packRasterBand(graphic, {
        x: 0,
        y,
        widthDots,
        heightDots: currentHeight,
        threshold,
      });
      pendingPayloads.push(LabelPrinterProtocol.makeEscposRasterPayload(widthBytes, currentHeight, imageBytes));
      const shouldFlush = pendingPayloads.length >= maxBandsPerWrite || y + rowsPerBand >= graphic.height;
      if (!shouldFlush) continue;
      await printer.writeBytes(LabelPrinterProtocol.concatBytes(pendingPayloads));
      pendingPayloads = [];
      if (writeDelayMs > 0) await ReceiptTextPrinter.waitMs(writeDelayMs);
    }
  }

  static packSourceColumnsAsRasterRows(graphic, {
    sourceX = 0,
    widthDots = 384,
    heightDots = 1,
    rotation = "counterclockwise",
    threshold = 210,
  } = {}) {
    const widthBytes = Math.ceil(widthDots / 8);
    const output = new Uint8Array(widthBytes * heightDots);
    const pixels = graphic.pixels;
    for (let row = 0; row < heightDots; row += 1) {
      const currentSourceX = rotation === "clockwise"
        ? graphic.width - 1 - sourceX - row
        : sourceX + row;
      for (let dot = 0; dot < widthDots; dot += 1) {
        const sourceY = rotation === "clockwise" ? dot : widthDots - 1 - dot;
        const pixelIndex = (sourceY * graphic.width + currentSourceX) * 4;
        const alpha = pixels[pixelIndex + 3];
        if (alpha <= 20) continue;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        if (luminance >= threshold) continue;
        output[row * widthBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
      }
    }
    return output;
  }

  static packRasterBand(graphic, {
    x = 0,
    y = 0,
    widthDots = 384,
    heightDots = 16,
    threshold = 210,
  } = {}) {
    const widthBytes = Math.ceil(widthDots / 8);
    const output = new Uint8Array(widthBytes * heightDots);
    const pixels = graphic.pixels;
    for (let row = 0; row < heightDots; row += 1) {
      for (let column = 0; column < widthDots; column += 1) {
        const pixelIndex = ((y + row) * graphic.width + x + column) * 4;
        const alpha = pixels[pixelIndex + 3];
        if (alpha <= 20) continue;
        const red = pixels[pixelIndex];
        const green = pixels[pixelIndex + 1];
        const blue = pixels[pixelIndex + 2];
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        if (luminance >= threshold) continue;
        output[row * widthBytes + (column >> 3)] |= 0x80 >> (column & 7);
      }
    }
    return output;
  }

  static trimVerticalWhitespace(graphic, {
    paddingRows = 8,
    blankRows = null,
    threshold = 170,
  } = {}) {
    graphic.loadPixels();
    let top = graphic.height;
    let bottom = -1;
    for (let y = 0; y < graphic.height; y += 1) {
      for (let x = 0; x < graphic.width; x += 1) {
        const pixelIndex = (y * graphic.width + x) * 4;
        const alpha = graphic.pixels[pixelIndex + 3];
        if (alpha <= 20) continue;
        const red = graphic.pixels[pixelIndex];
        const green = graphic.pixels[pixelIndex + 1];
        const blue = graphic.pixels[pixelIndex + 2];
        const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
        if (luminance >= threshold) continue;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }

    if (bottom < top) {
      return ReceiptTextPrinter.makeBlankGraphic(graphic.width, Math.max(1, blankRows ?? paddingRows));
    }

    const cropTop = Math.max(0, top - paddingRows);
    const cropBottom = Math.min(graphic.height - 1, bottom + paddingRows);
    const height = Math.max(1, cropBottom - cropTop + 1);
    const cropped = createGraphics(graphic.width, height);
    cropped.pixelDensity(1);
    cropped.background(255);
    cropped.image(graphic, 0, -cropTop);
    return cropped;
  }

  static makeBlankGraphic(widthDots, heightDots) {
    const graphic = createGraphics(widthDots, heightDots);
    graphic.pixelDensity(1);
    graphic.background(255);
    return graphic;
  }

  static async applyHeatProfile(printer, profile = "low") {
    if (profile !== "low") return;
    const heatDots = 7;
    const heatTime = 55;
    const heatInterval = 90;
    const printDensity = 4;
    const printBreakTime = 4;
    const densityByte = ((printBreakTime & 0x07) << 5) | (printDensity & 0x1f);
    await printer.writeBytes(new Uint8Array([
      0x1b, 0x37, heatDots, heatTime, heatInterval,
      0x12, 0x23, densityByte,
    ]));
  }

  static waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

window.ReceiptTextPrinter = ReceiptTextPrinter;
