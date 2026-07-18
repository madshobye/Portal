export function mergeSourceChoice(previous = {}, choice = {}) {
  const previousSource = previous && typeof previous === "object" ? previous : {};
  const nextChoice = choice && typeof choice === "object" ? choice : {};
  const replacingMedia = previousSource.type === "media" && nextChoice.type === "media";
  const retainingGenerator = previousSource.type === "generator" &&
    nextChoice.type === "generator" &&
    previousSource.generatorId === nextChoice.generatorId;

  if (!replacingMedia && !retainingGenerator) return { ...nextChoice };

  return {
    ...previousSource,
    ...nextChoice,
    ...(previousSource.params || nextChoice.params ? {
      params: {
        ...(previousSource.params && typeof previousSource.params === "object" ? previousSource.params : {}),
        ...(nextChoice.params && typeof nextChoice.params === "object" ? nextChoice.params : {}),
      },
    } : {}),
  };
}
