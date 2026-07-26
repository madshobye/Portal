import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { numberType, optionalType, recordType, valueType } from "../../node-engine/node-types.js";
import { fitScale } from "../../render-engine/fit-geometry/index.js";

export const MAX_CPU_RESIZE_PIXELS = 4_194_304;

export const RasterImageType = recordType("raster-image", {
  width: numberType(),
  height: numberType(),
  data: valueType("binary"),
  channels: numberType(),
});

export const ImageFrameType = recordType("image-frame", {
  image: RasterImageType,
  transform: valueType("transform2d"),
  timestamp: numberType(),
});

export const ImageResizeNode = defineNode({
  id: "core.image.resize",
  name: "Image Resize",
  version: "0.1.0",
  description: "Bounded CPU resampling for thumbnails and utility jobs; live renderers must select a browser-native or GPU backend.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    image: {
      type: RasterImageType,
      required: true,
      description: "Packed raster pixels with one to four channels.",
      rate: { maxHz: 30, overflow: "latest" },
    },
    transform: {
      type: optionalType("transform2d"),
      optional: true,
      description: "Optional transform retained with the resized image.",
    },
  },
  parameters: {
    width: {
      type: "number",
      defaultValue: 320,
      allowedRange: [1, 16384],
      displayRange: [1, 1920],
      clamp: true,
      editor: { type: "slider", step: 1 },
    },
    height: {
      type: "number",
      defaultValue: 180,
      allowedRange: [1, 16384],
      displayRange: [1, 1080],
      clamp: true,
      editor: { type: "slider", step: 1 },
    },
    fit: {
      type: { type: "enum", values: ["contain", "cover", "stretch"] },
      defaultValue: "contain",
      editor: { type: "select" },
    },
  },
  outlets: {
    frame: {
      type: ImageFrameType,
      description: "The resized image and its synchronized transform metadata.",
    },
  },
  execution: {
    trigger: "input-change",
    domain: "worker",
    pure: true,
    asynchronous: false,
    maxHz: 30,
    workload: "bounded",
  },
  moduleBindings: { MAX_CPU_RESIZE_PIXELS },
  capabilities: ["image-processing", "produces-image", "worker-safe", "graph-placeable", "bounded-cpu"],
  presentation: {
    catalogs: ["graph", "image"],
    placeableOn: ["node-graph"],
    previewOutput: "frame",
  },
  parts: [
    {
      id: "resize-algorithm",
      name: "Resize algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["resizeRasterImage", "resizePlan"],
      source: [fitScale, resizeRasterImage, resizePlan, pixel, positiveDimension, positiveChannels, clampIndex, identityTransform2d]
        .map((fn) => fn.toString()).join("\n\n"),
    },
    {
      id: "resize-process",
      name: "Resize process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "resizeRasterNodeProcess",
      entry: "process",
      dependsOn: ["resize-algorithm"],
      source: resizeRasterNodeProcess.toString(),
    },
  ],
  process: resizeRasterNodeProcess,
});

export function resizeRasterNodeProcess(inputs, context = {}) {
  const image = resizeRasterImage(inputs.image, {
    width: inputs.width,
    height: inputs.height,
    fit: inputs.fit,
  });
  return {
    frame: {
      image,
      transform: inputs.transform || identityTransform2d(),
      timestamp: Number(context.timestamp) || 0,
    },
  };
}

// The resampling algorithm deliberately lives in the node module and operates
// directly on packed typed-array pixels.
export function resizeRasterImage(source, { width, height, fit = "contain" } = {}) {
  const sourceWidth = positiveDimension(source?.width);
  const sourceHeight = positiveDimension(source?.height);
  const channels = positiveChannels(source?.channels);
  const sourceData = source?.data;
  if (!ArrayBuffer.isView(sourceData)) throw new TypeError("IMAGE_RESIZE_SOURCE_DATA_INVALID");
  if (sourceData.length < sourceWidth * sourceHeight * channels) throw new RangeError("IMAGE_RESIZE_SOURCE_DATA_SHORT");

  const target = resizePlan(sourceWidth, sourceHeight, positiveDimension(width), positiveDimension(height), fit);
  if (target.width * target.height > MAX_CPU_RESIZE_PIXELS) {
    throw new RangeError(`IMAGE_RESIZE_CPU_BUDGET_EXCEEDED:${target.width}x${target.height}:${MAX_CPU_RESIZE_PIXELS}`);
  }
  const OutputArray = sourceData.constructor;
  const output = new OutputArray(target.width * target.height * channels);
  const scaleX = target.sourceWidth / target.width;
  const scaleY = target.sourceHeight / target.height;

  for (let y = 0; y < target.height; y++) {
    const sourceY = target.sourceY + (y + 0.5) * scaleY - 0.5;
    const y0 = clampIndex(Math.floor(sourceY), sourceHeight);
    const y1 = clampIndex(y0 + 1, sourceHeight);
    const fy = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
    for (let x = 0; x < target.width; x++) {
      const sourceX = target.sourceX + (x + 0.5) * scaleX - 0.5;
      const x0 = clampIndex(Math.floor(sourceX), sourceWidth);
      const x1 = clampIndex(x0 + 1, sourceWidth);
      const fx = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      for (let channel = 0; channel < channels; channel++) {
        const top = pixel(sourceData, sourceWidth, channels, x0, y0, channel) * (1 - fx) +
          pixel(sourceData, sourceWidth, channels, x1, y0, channel) * fx;
        const bottom = pixel(sourceData, sourceWidth, channels, x0, y1, channel) * (1 - fx) +
          pixel(sourceData, sourceWidth, channels, x1, y1, channel) * fx;
        output[(y * target.width + x) * channels + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }

  return {
    width: target.width,
    height: target.height,
    channels,
    data: output,
    colorSpace: source.colorSpace || "srgb",
  };
}

export function resizePlan(sourceWidth, sourceHeight, requestedWidth, requestedHeight, fit = "contain") {
  if (fit === "stretch") {
    return { width: requestedWidth, height: requestedHeight, sourceX: 0, sourceY: 0, sourceWidth, sourceHeight };
  }
  const scale = fitScale(
    { width: sourceWidth, height: sourceHeight },
    { width: requestedWidth, height: requestedHeight },
    fit
  ).x;
  if (fit === "contain") {
    return {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
      sourceX: 0,
      sourceY: 0,
      sourceWidth,
      sourceHeight,
    };
  }
  const cropWidth = requestedWidth / scale;
  const cropHeight = requestedHeight / scale;
  return {
    width: requestedWidth,
    height: requestedHeight,
    sourceX: (sourceWidth - cropWidth) * 0.5,
    sourceY: (sourceHeight - cropHeight) * 0.5,
    sourceWidth: cropWidth,
    sourceHeight: cropHeight,
  };
}

function pixel(data, width, channels, x, y, channel) {
  return data[(y * width + x) * channels + channel];
}

function positiveDimension(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1) throw new RangeError("IMAGE_RESIZE_DIMENSION_INVALID");
  return number;
}

function positiveChannels(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < 1 || number > 4) throw new RangeError("IMAGE_RESIZE_CHANNELS_INVALID");
  return number;
}

function clampIndex(value, size) {
  return Math.max(0, Math.min(size - 1, value));
}

function identityTransform2d() {
  return { translation: [0, 0], scale: [1, 1], rotation: 0 };
}
