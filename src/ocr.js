// tesseract.js wrapper. Everything loads from vendor/tesseract/ on this origin. No CDN, no network.
// The worker is created lazily (preloadOcr() when the capture screen opens) and reused.

/** Page segmentation 4 (a single column of variable-size text) reads receipts best in our tests. */
export const OCR_PARAMS = { tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' };

// wasm-feature-detect's SIMD probe: a tiny module using a v128 instruction.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const simd = () => {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
};

let workerPromise = null;
let listener = null;

async function createOcrWorker() {
  const base = new URL('../vendor/tesseract/', import.meta.url).href;
  const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    // The core .js fetches its .wasm from the worker script's directory, which is this same folder.
    corePath: `${base}${simd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'}`,
    langPath: base.replace(/\/$/, ''),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    logger: (m) => listener?.(m),
    errorHandler: () => {},
  });
  await worker.setParameters(OCR_PARAMS);
  return worker;
}

export function preloadOcr() {
  if (!workerPromise) {
    workerPromise = createOcrWorker();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/**
 * OCR an image (canvas). onProgress receives a 0–1 fraction and a status label.
 * @returns {Promise<{text: string, confidence: number}>}
 */
export async function recognize(image, onProgress = () => {}) {
  listener = (m) => {
    if (m.status === 'recognizing text') onProgress(0.15 + 0.85 * m.progress, 'Reading the receipt…');
    else onProgress(0.1 * (m.progress ?? 0), 'Loading the text reader…');
  };
  try {
    onProgress(0, 'Loading the text reader…');
    const worker = await preloadOcr();
    const { data } = await worker.recognize(image);
    onProgress(1, 'Done');
    return { text: data.text, confidence: data.confidence };
  } finally {
    listener = null;
  }
}
