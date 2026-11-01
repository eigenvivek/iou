// Image preprocessing for OCR. The pixel algorithms are pure (RGBA arrays in, numbers out) so Node tests
// can run them on the same photos; the canvas helpers take a createCanvas(w, h) so they run under
// @napi-rs/canvas too.
//
// Cropping matters more than resolution: OCR on an uncropped photo reads wood grain as text.

const ANALYSIS_SIZE = 360;
const MAX_SATURATION = 0.3;
const MIN_LUMINANCE = 110;
const MARGIN = 0.015;

const defaultCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Otsu's threshold over a 256-bin histogram. */
export function otsu(hist) {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Find the receipt: the largest bright, low-saturation connected region.
 * @param {Uint8ClampedArray} rgba  pixels of a (small) analysis image
 * @returns {{x, y, w, h} | null} bounding box as fractions of width/height, with a small margin
 */
export function findReceiptBox(rgba, width, height) {
  const n = width * height;
  const lum = new Uint8Array(n);
  const sat = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const y = (r * 299 + g * 587 + b * 114) / 1000;
    const max = Math.max(r, g, b);
    lum[i] = y;
    sat[i] = max ? (max - Math.min(r, g, b)) / max : 0;
    hist[lum[i]]++;
  }
  const threshold = Math.max(otsu(hist), MIN_LUMINANCE);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = lum[i] >= threshold && sat[i] <= MAX_SATURATION ? 1 : 0;

  // Close small gaps (printed text) so the receipt is one region: dilate, then label components.
  const closed = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && mask[yy * width + xx]) {
            on = 1;
            break;
          }
        }
      }
      closed[y * width + x] = on;
    }
  }

  const label = new Int32Array(n);
  const queue = new Int32Array(n);
  let best = null;
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (!closed[start] || label[start]) continue;
    next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    label[start] = next;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      if (mask[i]) count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && closed[i - 1] && !label[i - 1]) { label[i - 1] = next; queue[tail++] = i - 1; }
      if (x < width - 1 && closed[i + 1] && !label[i + 1]) { label[i + 1] = next; queue[tail++] = i + 1; }
      if (y > 0 && closed[i - width] && !label[i - width]) { label[i - width] = next; queue[tail++] = i - width; }
      if (y < height - 1 && closed[i + width] && !label[i + width]) { label[i + width] = next; queue[tail++] = i + width; }
    }
    if (!best || count > best.count) best = { count, minX, minY, maxX, maxY };
  }

  if (!best || best.count < n * 0.03) return null;
  const x0 = Math.max(0, best.minX / width - MARGIN);
  const y0 = Math.max(0, best.minY / height - MARGIN);
  const x1 = Math.min(1, (best.maxX + 1) / width + MARGIN);
  const y1 = Math.min(1, (best.maxY + 1) / height + MARGIN);
  // A "receipt" covering nearly everything means we found the background, not the paper.
  if ((x1 - x0) * (y1 - y0) > 0.97) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Convert RGBA to grayscale in place and stretch contrast, clipping `cutoff` of pixels at each end. */
export function grayAutocontrast(rgba, cutoff = 0.02) {
  const n = rgba.length / 4;
  const hist = new Uint32Array(256);
  for (let p = 0; p < rgba.length; p += 4) {
    const y = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    rgba[p] = y;
    hist[rgba[p]]++;
  }
  const clip = n * cutoff;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) <= clip; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) <= clip; hi--);
  const scale = hi > lo ? 255 / (hi - lo) : 1;
  for (let p = 0; p < rgba.length; p += 4) {
    const v = Math.max(0, Math.min(255, Math.round((rgba[p] - lo) * scale)));
    rgba[p] = rgba[p + 1] = rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  return { lo, hi };
}

/** Scale factor so the crop height lands in 1800–2400 px, never upscaling more than 2×. */
export function ocrScale(height) {
  if (height > 2400) return 2400 / height;
  if (height < 1800) return Math.min(2, 1800 / height);
  return 1;
}

/** Guess the receipt rectangle in source pixels. Falls back to the whole image. */
export function guessCrop(source, createCanvas = defaultCanvas) {
  const { width, height } = source;
  const s = Math.min(1, ANALYSIS_SIZE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * s));
  const h = Math.max(1, Math.round(height * s));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  const box = findReceiptBox(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!box) return { x: 0, y: 0, w: width, h: height, found: false };
  return {
    x: Math.round(box.x * width),
    y: Math.round(box.y * height),
    w: Math.round(box.w * width),
    h: Math.round(box.h * height),
    found: true,
  };
}

/** Crop, grayscale, autocontrast, and resize for OCR. Returns a canvas. */
export function preprocess(source, crop, createCanvas = defaultCanvas) {
  const scale = ocrScale(crop.h);
  const w = Math.max(1, Math.round(crop.w * scale));
  const h = Math.max(1, Math.round(crop.h * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  grayAutocontrast(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Decode a File into an upright bitmap. Throws a friendly error if it can't be read. */
export async function decodeImage(file, { onStatus = () => {} } = {}) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // fall through: unsupported format (e.g. HEIC outside Safari) or a browser that rejects the options bag
  }
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const { isHeif, decodeHeif } = await import('./heic.js');
  if (isHeif(head) || /\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type)) {
    onStatus('Converting HEIC photo…');
    try {
      return await decodeHeif(file);
    } catch (err) {
      console.error(err);
      throw new Error("Couldn't open that HEIC photo. Paste the receipt text instead, or use a screenshot of the photo.");
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } catch {
    throw new Error("Couldn't open that image. Paste the receipt text instead.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
