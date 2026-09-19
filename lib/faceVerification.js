// Wrapper tipis di atas face-api.js untuk ekstraksi & pencocokan wajah.
// Jalan 100% di browser, gratis, tanpa API key/biaya per panggilan.
//
// Dipakai di dua tempat:
// - app/employee/profile/page.js: ekstrak descriptor dari foto referensi
//   karyawan (didaftarkan 1x).
// - app/employee/absensi/page.js: ekstrak descriptor dari frame clock-in/out,
//   dibandingkan ke descriptor referensi.
//
// SETUP WAJIB sebelum fitur ini bisa jalan:
//   1. npm install face-api.js
//   2. node scripts/download-face-models.mjs   (download model weights ke /public/models)
// Tanpa langkah ini, loadFaceModels() akan gagal fetch dan verifikasi wajah
// otomatis dianggap "belum bisa dicek" (bukan error yang membatalkan absensi).

let faceapiPromise = null;
function getFaceApi() {
  // Import dinamis: face-api.js pakai beberapa API browser (canvas dsb.) yang
  // tidak ada di server, jadi wajib lazy-load dan cuma dipanggil dari client.
  if (!faceapiPromise) faceapiPromise = import('face-api.js');
  return faceapiPromise;
}

const MODEL_URL = '/models';
let modelsLoadedPromise = null;

// Jarak Euclidean descriptor di bawah nilai ini dianggap wajah yang sama.
// 0.6 adalah threshold default yang direkomendasikan dokumentasi face-api.js.
export const FACE_MATCH_THRESHOLD = 0.6;

export async function loadFaceModels() {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = (async () => {
      const faceapi = await getFaceApi();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
    })();
  }
  return modelsLoadedPromise;
}

// Ekstrak descriptor wajah (array 128 angka) dari elemen gambar/video/canvas.
// Return null kalau tidak ada wajah yang cukup jelas terdeteksi — ini BUKAN
// exception, dianggap kondisi normal (foto blur/wajah nunduk/dst).
export async function getFaceDescriptor(mediaEl) {
  const faceapi = await getFaceApi();
  await loadFaceModels();
  const detection = await faceapi
    .detectSingleFace(mediaEl, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection) return null;
  return Array.from(detection.descriptor);
}

// Jarak Euclidean antar dua descriptor (array angka, sama panjang).
export function descriptorDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function isFaceMatch(distance) {
  return distance <= FACE_MATCH_THRESHOLD;
}

// Ubah jarak Euclidean jadi persentase kemiripan yang gampang dibaca orang
// awam (0% = beda total, 100% = identik). Ini APROKSIMASI untuk tampilan UI
// saja — keputusan cocok/tidak TETAP pakai isFaceMatch(distance) di atas,
// bukan angka persen ini, karena skala jarak face-api.js tidak linear
// terhadap "kemiripan" yang sebenarnya (cuma dilatih untuk memisahkan
// wajah yang sama vs beda, bukan mengukur derajat kemiripan).
export function similarityPercent(distance) {
  if (distance == null || Number.isNaN(distance) || !Number.isFinite(distance)) return null;
  const pct = (1 - distance / 1.0) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)));
}