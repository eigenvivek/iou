// HEIC/HEIF decoding for browsers that can't do it themselves (Chrome, Firefox). Safari decodes HEIC
// natively, and iOS usually hands the page a JPEG anyway, so this only loads when it's actually needed.
// The decoder is libheif compiled to WebAssembly, vendored in vendor/libheif/. No network.

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

/** True if the bytes start with an ISO-BMFF 'ftyp' box naming a HEIF brand. */
export function isHeif(bytes) {
  if (bytes.length < 12) return false;
  const str = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
  if (str(4, 8) !== 'ftyp') return false;
  if (HEIF_BRANDS.has(str(8, 12))) return true;
  // Compatible brands follow the major brand and minor version.
  const size = Math.min(bytes.length, (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
  for (let i = 16; i + 4 <= size; i += 4) if (HEIF_BRANDS.has(str(i, i + 4))) return true;
  return false;
}

let libPromise = null;

function loadLibheif() {
  libPromise ??= (async () => {
    const base = new URL('../vendor/libheif/', import.meta.url).href;
    if (!globalThis.libheif) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${base}libheif.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Couldn't load the HEIC decoder."));
        document.head.append(script);
      });
    }
    const wasmBinary = await (await fetch(`${base}libheif.wasm`)).arrayBuffer();
    let lib;
    await new Promise((resolve, reject) => {
      // onRuntimeInitialized can fire before the factory returns, so defer resolving until `lib` is set.
      lib = globalThis.libheif({ wasmBinary, onRuntimeInitialized: () => setTimeout(resolve), onAbort: (e) => reject(new Error(String(e))) });
    });
    return lib;
  })();
  libPromise.catch(() => {
    libPromise = null;
  });
  return libPromise;
}

/** Decode a HEIC file to an upright ImageBitmap (libheif applies the rotation/mirror stored in the file). */
export async function decodeHeif(file) {
  const lib = await loadLibheif();
  const images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  if (!images?.length) throw new Error("This HEIC file doesn't contain a readable image.");
  try {
    // The primary photo is the largest top-level image (others are thumbnails or depth maps).
    const image = images.reduce((a, b) => (b.get_width() * b.get_height() > a.get_width() * a.get_height() ? b : a));
    const target = new ImageData(image.get_width(), image.get_height());
    await new Promise((resolve, reject) => image.display(target, (out) => (out ? resolve() : reject(new Error('HEIC decoding failed.')))));
    return await createImageBitmap(target);
  } finally {
    for (const img of images) img.free?.();
  }
}
