// Pure mapping helpers shared by the worker and its tests.
const FireDmxCore = {
  width: 448,
  height: 192,
  segments: 28,
  defaults: {
    mode: 0, paused: false, blackout: false, reversed: false, testColor: 0,
    speed: 0.7, brightness: 0.8, wind: 0.15, sampleHeight: 0.4, whiteMix: 0,
  },

  band(sampleHeight) {
    const center = Math.round((1 - sampleHeight) * this.height);
    return { top: Math.max(0, center - 10), bottom: Math.min(this.height, center + 10) };
  },

  sample(pixels, settings) {
    const output = new Array(this.segments * 4).fill(0);
    if (settings.blackout) return output;
    if (settings.testColor) {
      for (let i = 0; i < this.segments; i++) output[i * 4 + settings.testColor - 1] = 160;
      return output;
    }
    const { top, bottom } = this.band(settings.sampleHeight);
    const sectionWidth = this.width / this.segments;
    for (let section = 0; section < this.segments; section++) {
      let r = 0, g = 0, b = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = section * sectionWidth; x < (section + 1) * sectionWidth; x++) {
          // WebGL readPixels starts at the bottom; preview/band coordinates start at the top.
          const i = ((this.height - 1 - y) * this.width + x) * 4;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
        }
      }
      const gain = settings.brightness / ((bottom - top) * sectionWidth);
      r *= gain; g *= gain; b *= gain;
      const white = Math.min(r, g, b) * settings.whiteMix;
      const target = settings.reversed ? this.segments - 1 - section : section;
      [r - white, g - white, b - white, white].forEach((v, c) => {
        output[target * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
      });
    }
    return output;
  },

  previewPixels(pixels) {
    const result = new Uint8ClampedArray(pixels.length);
    const stride = this.width * 4;
    for (let y = 0; y < this.height; y++) {
      const start = (this.height - 1 - y) * stride;
      result.set(pixels.subarray(start, start + stride), y * stride);
    }
    return result;
  },
};
