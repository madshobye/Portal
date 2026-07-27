const AUDIO_TEXTURE_HEIGHT = 2;
const WAVEFORM_SILENCE = 128;
const FFT_SILENCE = 0;

// Publishes the shared native Web Audio analysis as two small retained p5
// textures. Every ISF instance in a renderer reuses these images; the analyser
// and pixel upload each run at most once for a given audio frame.
export class IsfAudioTextureRuntime {
  constructor(host, {
    createImage = (width, height) => globalThis.createImage?.(width, height),
  } = {}) {
    this.host = host;
    this.createImage = createImage;
    this.entries = new Map();
  }

  texture(type) {
    const fft = type === "audioFFT";
    const frame = this.host.controlSignalRuntime?.analysisFrame?.("audio");
    const samples = fft ? frame?.frequencyData : frame?.timeData;
    const width = Math.max(1, samples?.length || (fft ? 512 : 1024));
    let entry = this.entries.get(type);
    if (!entry || entry.width !== width) {
      entry?.image?.remove?.();
      const image = this.createImage(width, AUDIO_TEXTURE_HEIGHT);
      if (!image) return null;
      entry = {
        image,
        width,
        sequence: -1,
        lifecycleRevision: -1,
        hadSamples: false,
      };
      this.entries.set(type, entry);
    }
    const sequence = Number(frame?.sequence) || 0;
    const lifecycleRevision = Number(frame?.lifecycleRevision) || 0;
    const hadSamples = !!samples;
    if (
      entry.sequence !== sequence ||
      entry.lifecycleRevision !== lifecycleRevision ||
      entry.hadSamples !== hadSamples
    ) {
      writeMonoTexture(
        entry.image,
        samples,
        fft ? FFT_SILENCE : WAVEFORM_SILENCE,
      );
      entry.sequence = sequence;
      entry.lifecycleRevision = lifecycleRevision;
      entry.hadSamples = hadSamples;
    }
    return entry.image;
  }

  dispose() {
    for (const entry of this.entries.values()) entry.image?.remove?.();
    this.entries.clear();
  }
}

function writeMonoTexture(image, samples, silence) {
  image.loadPixels?.();
  const pixels = image.pixels;
  if (!pixels) return;
  const width = Math.max(1, Number(image.width) || samples?.length || 1);
  for (let row = 0; row < AUDIO_TEXTURE_HEIGHT; row++) {
    for (let x = 0; x < width; x++) {
      const value = samples?.[x] ?? silence;
      const offset = (row * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  image.updatePixels?.();
}
