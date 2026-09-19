// Download model weights face-api.js ke /public/models sekali di awal setup.
// Jalankan: node scripts/download-face-models.mjs
// (setelah npm install face-api.js)

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
const OUT_DIR = path.join(process.cwd(), 'public', 'models');

const FILES = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

async function downloadFile(fileName) {
  const url = `${BASE_URL}/${fileName}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gagal download ${fileName}: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(OUT_DIR, fileName), buf);
  console.log(`OK  ${fileName}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  if (!existsSync(OUT_DIR)) {
    await mkdir(OUT_DIR, { recursive: true });
  }
  console.log(`Mengunduh model face-api.js ke ${OUT_DIR} ...`);
  for (const file of FILES) {
    // Berurutan (bukan Promise.all) supaya log-nya rapi dan gampang dilihat kalau ada yang gagal.
    // eslint-disable-next-line no-await-in-loop
    await downloadFile(file);
  }
  console.log('Selesai. Model siap dipakai untuk verifikasi wajah di Absensi & Profil.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
