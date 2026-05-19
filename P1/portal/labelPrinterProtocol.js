// Shared label-printer command encoders.
// Transports such as BLE and USB serial should only write the bytes produced here.

class LabelPrinterProtocol {
  constructor() {
    this._encoder = new TextEncoder();
  }

  encode(data, { protocol = "tspl" } = {}) {
    const key = String(protocol || "").toLowerCase();
    if (!LabelPrinterProtocol.PROTOCOLS[key]) {
      throw new Error(`LabelPrinterProtocol: unsupported protocol "${protocol}"`);
    }
    return LabelPrinterProtocol.PROTOCOLS[key].encode(data, this._encoder);
  }

  makeZplTextLabel(text, options = {}) {
    return LabelPrinterProtocol.makeZplTextLabel(text, options);
  }

  makeTsplTextLabel(text, options = {}) {
    return LabelPrinterProtocol.makeTsplTextLabel(text, options);
  }

  makeTsplBitmapLabel(imageData, options = {}) {
    return LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder);
  }

  makeNiimbotB1BitmapPrint(imageData, options = {}) {
    return LabelPrinterProtocol.makeNiimbotB1BitmapPrint(imageData, options);
  }

  makeCpclTextLabel(text, options = {}) {
    return LabelPrinterProtocol.makeCpclTextLabel(text, options);
  }

  makeEscposTextReceipt(text, options = {}) {
    return LabelPrinterProtocol.makeEscposTextReceipt(text, options, this._encoder);
  }

  makeEscposFeed(lines = 4) {
    return LabelPrinterProtocol.makeEscposFeed(lines);
  }

  static makeZplTextLabel(text, {
    widthDots = 609,
    heightDots = 203,
    x = 32,
    y = 32,
    fontHeight = 42,
    fontWidth = 42,
    copies = 1,
  } = {}) {
    const safeText = LabelPrinterProtocol.escapeZplText(text);
    return [
      "^XA",
      `^PW${Math.round(widthDots)}`,
      `^LL${Math.round(heightDots)}`,
      `^FO${Math.round(x)},${Math.round(y)}`,
      `^A0N,${Math.round(fontHeight)},${Math.round(fontWidth)}`,
      `^FD${safeText}^FS`,
      `^PQ${Math.max(1, Math.round(copies))}`,
      "^XZ",
      "",
    ].join("\n");
  }

  static makeTsplTextLabel(text, {
    widthMm = 60,
    heightMm = 30,
    gapMm = 2,
    x = 40,
    y = 40,
    font = "3",
    xMul = 1,
    yMul = 1,
    copies = 1,
  } = {}) {
    const safeText = LabelPrinterProtocol.escapeQuotedText(text);
    return [
      `SIZE ${Number(widthMm) || 60} mm,${Number(heightMm) || 30} mm`,
      `GAP ${Number(gapMm) || 2} mm,0 mm`,
      "DIRECTION 1",
      "CLS",
      `TEXT ${Math.round(x)},${Math.round(y)},"${font}",0,${Math.max(1, Math.round(xMul))},${Math.max(1, Math.round(yMul))},"${safeText}"`,
      `PRINT ${Math.max(1, Math.round(copies))},1`,
      "",
    ].join("\r\n");
  }

  static makeTsplBitmapLabel(imageData, {
    labelWidthMm = 10,
    labelHeightMm = 15,
    gapMm = 2,
    x = 0,
    y = 0,
    threshold = 180,
    mode = 0,
    invert = true,
    dither = true,
    copies = 1,
  } = {}, encoder = new TextEncoder()) {
    if (!imageData?.data || !imageData.width || !imageData.height) {
      throw new Error("LabelPrinterProtocol: makeTsplBitmapLabel needs ImageData");
    }

    const width = Math.max(1, Math.round(imageData.width));
    const height = Math.max(1, Math.round(imageData.height));
    const widthBytes = Math.ceil(width / 8);
    const bitmap = new Uint8Array(widthBytes * height);
    if (invert) bitmap.fill(0xff);

    const luminance = new Float32Array(width * height);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const pixelIndex = (py * width + px) * 4;
        const red = imageData.data[pixelIndex] || 0;
        const green = imageData.data[pixelIndex + 1] || 0;
        const blue = imageData.data[pixelIndex + 2] || 0;
        const alpha = imageData.data[pixelIndex + 3] ?? 255;
        luminance[py * width + px] = alpha <= 20 ? 255 : 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
    }

    if (dither) {
      LabelPrinterProtocol.applyFloydSteinbergDither(luminance, width, height, threshold);
    }

    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const isBlack = luminance[py * width + px] < threshold;
        if (!isBlack) continue;

        const byteIndex = py * widthBytes + Math.floor(px / 8);
        const bitMask = 0x80 >> (px % 8);
        if (invert) {
          bitmap[byteIndex] &= ~bitMask;
        } else {
          bitmap[byteIndex] |= bitMask;
        }
      }
    }

    const header = [
      `SIZE ${Number(labelWidthMm) || 10} mm,${Number(labelHeightMm) || 15} mm`,
      `GAP ${Number(gapMm) || 2} mm,0 mm`,
      "DIRECTION 1",
      "CLS",
      `BITMAP ${Math.round(x)},${Math.round(y)},${widthBytes},${height},${Math.round(mode)},`,
    ].join("\r\n");
    const footer = `\r\nPRINT ${Math.max(1, Math.round(copies))},1\r\n`;

    const headerBytes = encoder.encode(header);
    const footerBytes = encoder.encode(footer);
    const bytes = new Uint8Array(headerBytes.length + bitmap.length + footerBytes.length);
    bytes.set(headerBytes, 0);
    bytes.set(bitmap, headerBytes.length);
    bytes.set(footerBytes, headerBytes.length + bitmap.length);
    return bytes;
  }

  static applyFloydSteinbergDither(values, width, height, threshold) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const oldValue = values[index];
        const newValue = oldValue < threshold ? 0 : 255;
        const error = oldValue - newValue;
        values[index] = newValue;

        if (x + 1 < width) values[index + 1] += error * (7 / 16);
        if (y + 1 >= height) continue;
        if (x > 0) values[index + width - 1] += error * (3 / 16);
        values[index + width] += error * (5 / 16);
        if (x + 1 < width) values[index + width + 1] += error * (1 / 16);
      }
    }
  }

  static makeCpclTextLabel(text, {
    widthDots = 384,
    heightDots = 240,
    x = 30,
    y = 40,
    font = 4,
    size = 0,
    copies = 1,
  } = {}) {
    const safeText = LabelPrinterProtocol.escapeLineText(text);
    return [
      `! 0 200 200 ${Math.round(heightDots)} ${Math.max(1, Math.round(copies))}`,
      `PAGE-WIDTH ${Math.round(widthDots)}`,
      `TEXT ${Math.round(font)} ${Math.round(size)} ${Math.round(x)} ${Math.round(y)} ${safeText}`,
      "FORM",
      "PRINT",
      "",
    ].join("\r\n");
  }

  static makeEscposTextReceipt(text, {
    title = "Portal ESC/POS",
    feedLines = 4,
    align = "center",
  } = {}, encoder = new TextEncoder()) {
    const alignValue = align === "right" ? 2 : align === "left" ? 0 : 1;
    const chunks = [
      new Uint8Array([0x1b, 0x40]), // Initialize printer
      new Uint8Array([0x1b, 0x61, alignValue]), // Alignment
      new Uint8Array([0x1b, 0x45, 0x01]), // Bold on
      encoder.encode(`${LabelPrinterProtocol.escapeLineText(title)}\n`),
      new Uint8Array([0x1b, 0x45, 0x00]), // Bold off
      encoder.encode(`${String(text ?? "").replace(/\r?\n/g, "\n")}\n`),
      LabelPrinterProtocol.makeEscposFeed(feedLines),
    ];
    return LabelPrinterProtocol.concatBytes(chunks);
  }

  static makeEscposFeed(lines = 4) {
    const count = Math.max(1, Math.min(12, Math.round(Number(lines) || 4)));
    const bytes = new Uint8Array(count);
    bytes.fill(0x0a);
    return bytes;
  }

  static makeNiimbotB1BitmapPrint(imageData, {
    labelWidthMm = 48,
    labelHeightMm = 30,
    dpi = 203,
    maxWidth = null,
    maxHeight = null,
    density = 3,
    labelType = 1,
    copies = 1,
    threshold = 180,
    dither = true,
    invert = false,
  } = {}) {
    if (!imageData?.data || !imageData.width || !imageData.height) {
      throw new Error("LabelPrinterProtocol: makeNiimbotB1BitmapPrint needs ImageData");
    }

    const sourceWidth = Math.max(1, Math.round(imageData.width));
    const sourceHeight = Math.max(1, Math.round(imageData.height));
    const dotsPerMm = (Number(dpi) || 203) / 25.4;
    const targetMaxWidth = Math.min(384, Math.max(8, Math.round(maxWidth || ((Number(labelWidthMm) || 48) * dotsPerMm))));
    const targetMaxHeight = Math.max(8, Math.round(maxHeight || ((Number(labelHeightMm) || 30) * dotsPerMm)));
    const scale = Math.min(targetMaxWidth / sourceWidth, targetMaxHeight / sourceHeight);
    const width = Math.max(8, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const luminance = LabelPrinterProtocol.resampleImageDataToLuminance(imageData, width, height);

    if (dither) {
      LabelPrinterProtocol.applyFloydSteinbergDither(luminance, width, height, threshold);
    }

    const rows = LabelPrinterProtocol.packMonochromeRows(luminance, width, height, {
      threshold,
      invert,
    });
    const packets = [];
    const packet = (command, data) => packets.push(LabelPrinterProtocol.makeNiimbotPacket(command, data));
    const u16 = (value) => [(value >> 8) & 0xff, value & 0xff];
    const pageCount = Math.max(1, Math.round(copies));

    packet(0x21, [LabelPrinterProtocol.clampByte(density)]); // SetDensity
    packet(0x23, [LabelPrinterProtocol.clampByte(labelType)]); // SetLabelType
    packet(0x01, [...u16(pageCount), 0x00, 0x00, 0x00, 0x00, 0x00]); // PrintStart for B1
    packet(0x03, [0x01]); // PageStart
    packet(0x13, [...u16(height), ...u16(width), ...u16(pageCount)]); // SetPageSize

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const blackCount = LabelPrinterProtocol.countSetBits(row);
      if (blackCount === 0) {
        packet(0x84, [...u16(rowIndex), 0x01]); // PrintEmptyRow
        continue;
      }
      packet(0x85, [
        ...u16(rowIndex),
        blackCount & 0xff,
        (blackCount >> 8) & 0xff,
        0x00,
        0x01,
        ...row,
      ]);
    }

    packet(0xe3, [0x01]); // PageEnd
    packet(0xf3, [0x01]); // PrintEnd
    return LabelPrinterProtocol.concatBytes(packets);
  }

  static makeNiimbotPacket(command, data = []) {
    const payload = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (payload.length > 255) {
      throw new Error("LabelPrinterProtocol: Niimbot packet payload is too large");
    }

    let checksum = command ^ payload.length;
    for (const byte of payload) checksum ^= byte;

    const packet = new Uint8Array(2 + 1 + 1 + payload.length + 1 + 2);
    let offset = 0;
    packet[offset++] = 0x55;
    packet[offset++] = 0x55;
    packet[offset++] = command & 0xff;
    packet[offset++] = payload.length & 0xff;
    packet.set(payload, offset);
    offset += payload.length;
    packet[offset++] = checksum & 0xff;
    packet[offset++] = 0xaa;
    packet[offset++] = 0xaa;
    return packet;
  }

  static resampleImageDataToLuminance(imageData, width, height) {
    const values = new Float32Array(width * height);
    const sourceWidth = imageData.width;
    const sourceHeight = imageData.height;
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / height));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / width));
        const pixelIndex = (sourceY * sourceWidth + sourceX) * 4;
        const red = imageData.data[pixelIndex] || 0;
        const green = imageData.data[pixelIndex + 1] || 0;
        const blue = imageData.data[pixelIndex + 2] || 0;
        const alpha = imageData.data[pixelIndex + 3] ?? 255;
        values[y * width + x] = alpha <= 20 ? 255 : 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
    }
    return values;
  }

  static packMonochromeRows(luminance, width, height, { threshold = 180, invert = false } = {}) {
    const widthBytes = Math.ceil(width / 8);
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      const row = new Uint8Array(widthBytes);
      for (let x = 0; x < width; x += 1) {
        let isBlack = luminance[y * width + x] < threshold;
        if (invert) isBlack = !isBlack;
        if (!isBlack) continue;
        row[Math.floor(x / 8)] |= 0x80 >> (x % 8);
      }
      rows.push(row);
    }
    return rows;
  }

  static countSetBits(bytes) {
    let count = 0;
    for (const byte of bytes) {
      let value = byte;
      while (value) {
        value &= value - 1;
        count += 1;
      }
    }
    return count;
  }

  static concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  static clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  static escapeZplText(text) {
    return String(text ?? "")
      .replace(/\^/g, " ")
      .replace(/~/g, " ")
      .replace(/\r?\n/g, "\\&");
  }

  static escapeQuotedText(text) {
    return LabelPrinterProtocol.escapeLineText(text).replace(/"/g, "'");
  }

  static escapeLineText(text) {
    return String(text ?? "").replace(/\r?\n/g, " ").trim();
  }
}

LabelPrinterProtocol.PROTOCOLS = {
  zpl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  tspl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  cpcl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  escpos: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
};

window.LabelPrinterProtocol = LabelPrinterProtocol;
