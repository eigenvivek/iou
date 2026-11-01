// Offline cache for the app shell and the vendored OCR engine.
// VERSION is a hash of every file below; `npm run sw` updates it and a unit test fails if it's stale.
const VERSION = 'iou-fb58235c56';

const FILES = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/dom.js',
  'src/heic.js',
  'src/image.js',
  'src/ocr.js',
  'src/parse.js',
  'src/split.js',
  'src/state.js',
  'src/ui/assign.js',
  'src/ui/capture.js',
  'src/ui/crop.js',
  'src/ui/items.js',
  'src/ui/people.js',
  'src/ui/read.js',
  'src/ui/results.js',
  'vendor/tesseract/tesseract.esm.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/tesseract-core-simd-lstm.js',
  'vendor/tesseract/tesseract-core-simd-lstm.wasm',
  'vendor/tesseract/tesseract-core-lstm.js',
  'vendor/tesseract/tesseract-core-lstm.wasm',
  'vendor/tesseract/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('iou-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // Shared links differ only in the hash, which never reaches here, so './' covers them.
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      const response = await fetch(request);
      // The HEIC decoder isn't precached (most people never need it), but keep it once it's been used.
      const keep = request.mode === 'navigate' || new URL(request.url).pathname.includes('/vendor/libheif/');
      if (response.ok && keep) cache.put(request, response.clone());
      return response;
    }),
  );
});
