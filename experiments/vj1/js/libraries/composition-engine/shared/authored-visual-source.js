const MODEL_MEDIA_EXTENSIONS = /\.(?:stl|obj)$/i;

export function createAuthoredMediaSource(mediaId = "", media = null) {
  const id = String(mediaId || "");
  const model = media?.type === "model" || MODEL_MEDIA_EXTENSIONS.test(id);
  return {
    type: "generator",
    generatorId: model ? "modelMedia" : "mediaImage",
    params: { mediaId: id },
  };
}

export function createAuthoredVisualSource(source = {}, mediaById = null) {
  if (source?.type === "black") {
    return canonicalGeneratorSource(source, "black");
  }
  if (source?.type === "camera") {
    return canonicalGeneratorSource(source, "cameraInput");
  }
  if (source?.type !== "media") return source;
  const mediaId = String(source.mediaId || "");
  const media = mediaById instanceof Map
    ? mediaById.get(mediaId)
    : (mediaById || []).find?.((item) => String(item?.id || "") === mediaId);
  const {
    type: _type,
    mediaId: _mediaId,
    componentId: _componentId,
    generatorId: _generatorId,
    start,
    end,
    speed,
    params = {},
    ...retained
  } = source;
  const semantic = createAuthoredMediaSource(mediaId, media);
  return {
    ...retained,
    ...semantic,
    params: {
      ...params,
      mediaId,
      ...(Number(start) > 0 ? { start } : {}),
      ...(Number(end) > 0 ? { end } : {}),
      ...(speed !== undefined && Number(speed) !== 1 ? { speed } : {}),
    },
  };
}

export function canonicalizeAuthoredVisualSource(source = {}, mediaById = null) {
  return createAuthoredVisualSource(source, mediaById);
}

export function canonicalizeAuthoredVisualChain(chain = [], media = []) {
  const mediaById = media instanceof Map
    ? media
    : new Map((media || []).map((item) => [String(item?.id || ""), item]));
  let changed = false;
  const canonical = (chain || []).map((item) => {
    if (item?.kind === "group") {
      const nested = canonicalizeAuthoredVisualChain(item.chain || [], mediaById);
      if (nested === item.chain) return item;
      changed = true;
      return {
        ...item,
        chain: nested,
      };
    }
    if (item?.kind !== "source") return item;
    const source = canonicalizeAuthoredVisualSource(item.source, mediaById);
    if (source === item.source) return item;
    changed = true;
    return {
      ...item,
      source,
    };
  });
  return changed ? canonical : chain;
}

function canonicalGeneratorSource(source, generatorId) {
  const {
    type: _type,
    mediaId: _mediaId,
    componentId: _componentId,
    generatorId: _generatorId,
    params,
    ...retained
  } = source || {};
  return {
    ...retained,
    type: "generator",
    generatorId,
    params: params && typeof params === "object" ? { ...params } : {},
  };
}
