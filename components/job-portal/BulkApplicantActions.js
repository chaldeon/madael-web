'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_CANDIDATE, parseTagList } from '@/lib/talentPoolTags';
import { REJECTION_REASON_OTHER, REJECTION_REASON_PRESETS, buildRejectionReason } from '@/lib/applicationStatus';
import { friendlyCaught } from '@/lib/errorMessage';

// Aksi massal di halaman Pelamar (/employee/job-portal/pelamar).
//
// Komponen ini hanya mengurus tampilan + alur (pilih aksi -> konfirmasi ->
// jalan satu per satu dengan batas paralel -> ringkasan hasil). Setiap aksi
// memakai handler per-pelamar yang sama dengan yang dipakai di halaman, jadi
// aturan akses (reviewer terbatas vs akses penuh), pencatatan activity log,
// dan riwayat pesan ke kandidat TIDAK berubah.
//
// Props:
//   selectedApps   : pelamar terpilih yang sedang tampil (sudah ikut filter)
//   hiddenCount    : jumlah terpilih yang tersembunyi oleh filter (tidak ikut diproses)
//   canTag         : true kalau akses penuh dan tag berhasil dimuat
//   onChangeStatus : (app, status, reason?) => Promise<{ error?, skipped? }> — reason wajib untuk "Ditolak"
//   onAddTag       : (app, rawTags) => Promise<{ error? }>
//   onSendRejection: (app) => Promise<{ error? }>
//   onFinish       : (failedIds: string[]) => void — dipanggil saat modal ditutup setelah proses
//   onClear        : () => void — kosongkan pilihan

// Interview sengaja tidak ada: statusnya butuh jadwal & interviewer per kandidat.
const BULK_STATUS_OPTIONS = ['Baru', 'Review', 'Ditolak', 'Diterima'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Jalankan worker untuk semua item dengan paling banyak `limit` berjalan bersamaan.
async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export default function BulkApplicantActions({
  selectedApps,
  hiddenCount,
  canTag,
  onChangeStatus,
  onAddTag,
  onSendRejection,
  onFinish,
  onClear,
}) {
  const [action, setAction] = useState(null); // 'status' | 'tag' | 'email' | null
  const [statusValue, setStatusValue] = useState('Review');
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [rejectPreset, setRejectPreset] = useState('');
  const [rejectDetail, setRejectDetail] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null); // { ok, skipped, failed: [{ id, nama, error }] }

  const rejectReason = useMemo(() => buildRejectionReason(rejectPreset, rejectDetail), [rejectPreset, rejectDetail]);
  const tagList = useMemo(() => parseTagList(tagInput), [tagInput]);
  const tagEligible = useMemo(() => selectedApps.filter((a) => !a.job_id), [selectedApps]);
  const emailEligible = useMemo(
    () => selectedApps.filter((a) => a.status === 'Ditolak' && EMAIL_RE.test(a.email || '')),
    [selectedApps]
  );
  const statusChangeable = useMemo(
    () => selectedApps.filter((a) => a.status !== statusValue),
    [selectedApps, statusValue]
  );

  const open = (name) => {
    setAction(name);
    setResult(null);
    setAlsoEmail(false);
    setRejectPreset('');
    setRejectDetail('');
    setTagInput('');
    setProgress({ done: 0, total: 0 });
  };

  const close = () => {
    if (running) return;
    const failedIds = result ? result.failed.map((f) => f.id) : null;
    setAction(null);
    if (failedIds) onFinish(failedIds);
    setResult(null);
  };

  const execute = async () => {
    if (running) return;
    let targets = [];
    let worker;
    let limit = 4;
    const failed = [];
    let ok = 0;
    let skipped = 0;

    if (action === 'status') {
      targets = statusChangeable;
      skipped = selectedApps.length - targets.length;
      const sendMail = statusValue === 'Ditolak' && alsoEmail;
      worker = async (app) => {
        const res = await onChangeStatus(app, statusValue, statusValue === 'Ditolak' ? rejectReason : undefined);
        if (res?.error) {
          failed.push({ id: app.id, nama: app.nama, error: res.error });
          return;
        }
        if (sendMail) {
          if (!EMAIL_RE.test(app.email || '')) {
            failed.push({ id: app.id, nama: app.nama, error: 'Status diubah, tetapi email pelamar tidak valid sehingga email tidak dikirim.' });
            return;
          }
          const mail = await onSendRejection(app);
          if (mail?.error) {
            failed.push({ id: app.id, nama: app.nama, error: `Status diubah, tetapi email gagal: ${mail.error}` });
            return;
          }
        }
        ok++;
      };
      if (sendMail) limit = 2;
    } else if (action === 'tag') {
      targets = tagEligible;
      skipped = selectedApps.length - targets.length;
      worker = async (app) => {
        const res = await onAddTag(app, tagList);
        if (res?.error) failed.push({ id: app.id, nama: app.nama, error: res.error });
        else ok++;
      };
    } else if (action === 'email') {
      targets = emailEligible;
      skipped = selectedApps.length - targets.length;
      limit = 2; // SMTP jangan dibanjiri
      worker = async (app) => {
        const res = await onSendRejection(app);
        if (res?.error) failed.push({ id: app.id, nama: app.nama, error: res.error });
        else ok++;
      };
    } else {
      return;
    }

    if (targets.length === 0) {
      setResult({ ok: 0, skipped, failed: [] });
      return;
    }

    setRunning(true);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    await runPool(targets, limit, async (app) => {
      try {
        await worker(app);
      } catch (err) {
        failed.push({ id: app.id, nama: app.nama, error: friendlyCaught(err, 'Terjadi kesalahan.') });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    });
    setRunning(false);
    setResult({ ok, skipped, failed });
  };

  if (selectedApps.length === 0 && !action) return null;

  const btn =
    'border border-madael-red text-madael-red px-3.5 py-1.5 text-xs font-medium tracking-[0.02em] hover:bg-madael-red hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  // Ringkasan "akan diproses" untuk tombol konfirmasi.
  let confirmCount = 0;
  let confirmLabel = '';
  let confirmDisabled = false;
  if (action === 'status') {
    confirmCount = statusChangeable.length;
    confirmLabel = `Ubah status ${confirmCount} pelamar`;
    confirmDisabled = confirmCount === 0 || (statusValue === 'Ditolak' && !rejectReason);
  } else if (action === 'tag') {
    confirmCount = tagEligible.length;
    confirmLabel = `Tambah tag ke ${confirmCount} pelamar`;
    confirmDisabled = confirmCount === 0 || tagList.length === 0 || tagList.length > MAX_TAGS_PER_CANDIDATE;
  } else if (action === 'email') {
    confirmCount = emailEligible.length;
    confirmLabel = `Kirim ${confirmCount} email penolakan`;
    confirmDisabled = confirmCount === 0;
  }

  return (
    <>
      {selectedApps.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 bg-[#FFF5F5] border border-[#F5C6C6]">
          <span className="text-sm text-black font-medium">{selectedApps.length} pelamar dipilih</span>
          {hiddenCount > 0 && (
            <span className="text-xs text-[#6B6B6B]">(+{hiddenCount} tersembunyi oleh filter, tidak ikut diproses)</span>
          )}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button type="button" onClick={() => open('status')} className={btn}>Ubah Status</button>
            {canTag && (
              <button type="button" onClick={() => open('tag')} className={btn}>Tambah Tag</button>
            )}
            <button type="button" onClick={() => open('email')} className={btn}>Kirim Email Penolakan</button>
            <button type="button" onClick={onClear} className="text-xs text-[#6B6B6B] hover:text-black px-2 py-1.5">
              Batal pilih
            </button>
          </div>
        </div>
      )}

      {action && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={close}>
          <div
            className="bg-white w-full max-w-[520px] p-6 relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              disabled={running}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black disabled:opacity-40"
              aria-label="Tutup"
            >
              <X size={18} />
            </button>

            <h2 className="text-sm font-medium text-black mb-1">
              {action === 'status' && 'Ubah Status Massal'}
              {action === 'tag' && 'Tambah Tag Massal'}
              {action === 'email' && 'Kirim Email Penolakan Massal'}
            </h2>
            <p className="text-xs text-[#6B6B6B] mb-4">{selectedApps.length} pelamar dipilih</p>

            {!result && (
              <>
                {action === 'status' && (
                  <div className="mb-4">
                    <p className="text-xs text-[#6B6B6B] mb-1.5">Status baru</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {BULK_STATUS_OPTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={running}
                          onClick={() => { setStatusValue(s); if (s !== 'Ditolak') setAlsoEmail(false); }}
                          className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                            statusValue === s
                              ? 'border-madael-red bg-madael-red text-white'
                              : 'border-[#E0E0E0] text-[#3D3D3D] hover:border-madael-red'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-[#6B6B6B]">
                      {statusChangeable.length} pelamar akan diubah
                      {selectedApps.length - statusChangeable.length > 0 &&
                        `, ${selectedApps.length - statusChangeable.length} dilewati karena sudah berstatus "${statusValue}"`}
                      . Status &quot;Interview&quot; tidak tersedia di sini karena butuh jadwal per kandidat.
                    </p>
                    {statusValue === 'Ditolak' && (
                      <div className="mt-3">
                        <p className="text-xs text-[#6B6B6B] mb-1.5">Alasan penolakan (dicatat di riwayat tiap pelamar)</p>
                        <select
                          value={rejectPreset}
                          disabled={running}
                          onChange={(e) => setRejectPreset(e.target.value)}
                          className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors mb-2"
                        >
                          <option value="">Pilih alasan...</option>
                          {REJECTION_REASON_PRESETS.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={rejectDetail}
                          disabled={running}
                          onChange={(e) => setRejectDetail(e.target.value)}
                          maxLength={200}
                          placeholder={rejectPreset === REJECTION_REASON_OTHER ? 'Jelaskan alasannya (wajib)' : 'Keterangan tambahan (opsional)'}
                          className="w-full border border-[#E0E0E0] px-3 py-2 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                        />
                      </div>
                    )}
                    {statusValue === 'Ditolak' && (
                      <label className="flex items-start gap-2 mt-3 text-xs text-[#3D3D3D] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={alsoEmail}
                          disabled={running}
                          onChange={(e) => setAlsoEmail(e.target.checked)}
                          className="accent-[#B91C1C] mt-0.5"
                        />
                        <span>
                          Kirim juga email penolakan ke pelamar yang statusnya diubah (hanya yang berubah di proses ini).
                          Tanpa centang ini, status berubah tanpa mengirim pesan.
                        </span>
                      </label>
                    )}
                    {selectedApps.some((a) => a.status === 'Interview' && a.interview_at) && (
                      <p className="text-xs text-[#92700C] bg-[#FEF3C7] px-3 py-2 mt-3">
                        Sebagian pelamar sudah punya jadwal interview. Jadwal akan terkunci bila statusnya keluar dari &quot;Interview&quot;.
                      </p>
                    )}
                  </div>
                )}

                {action === 'tag' && (
                  <div className="mb-4">
                    <p className="text-xs text-[#6B6B6B] mb-1.5">Tag (pisahkan dengan koma)</p>
                    <input
                      type="text"
                      value={tagInput}
                      disabled={running}
                      onChange={(e) => setTagInput(e.target.value)}
                      list="talent-pool-tags"
                      maxLength={MAX_TAG_LENGTH * MAX_TAGS_PER_CANDIDATE}
                      placeholder="mis. excel, sales"
                      className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors mb-2"
                    />
                    {tagList.length > 0 && (
                      <p className="text-xs text-[#3D3D3D] mb-2">Akan ditambahkan: {tagList.join(', ')}</p>
                    )}
                    <p className="text-xs text-[#6B6B6B]">
                      Tag hanya untuk talent pool (lamaran umum): {tagEligible.length} pelamar akan diberi tag
                      {selectedApps.length - tagEligible.length > 0 &&
                        `, ${selectedApps.length - tagEligible.length} dilewati karena melamar ke lowongan tertentu`}
                      . Maksimal {MAX_TAGS_PER_CANDIDATE} tag per kandidat; yang melebihi batas akan gagal dan dilaporkan.
                    </p>
                  </div>
                )}

                {action === 'email' && (
                  <div className="mb-4">
                    <p className="text-xs text-[#3D3D3D] mb-2">
                      Template &quot;Ditolak&quot; dikirim lewat email ke pelamar berstatus &quot;Ditolak&quot;. Setiap pengiriman
                      tercatat di riwayat pesan masing-masing pelamar.
                    </p>
                    <p className="text-xs text-[#6B6B6B]">
                      {emailEligible.length} email akan dikirim
                      {selectedApps.length - emailEligible.length > 0 &&
                        `, ${selectedApps.length - emailEligible.length} dilewati (status bukan "Ditolak" atau email tidak valid)`}
                      .
                    </p>
                    <p className="text-xs text-[#92700C] bg-[#FEF3C7] px-3 py-2 mt-3">
                      Email tidak bisa ditarik kembali. Daftar ini tidak memeriksa apakah pelamar sudah pernah dikirimi
                      email penolakan sebelumnya, jadi pastikan belum ada yang terkirim.
                    </p>
                  </div>
                )}

                {running && (
                  <p className="text-xs text-[#3D3D3D] mb-3">
                    Memproses {progress.done} dari {progress.total}... jangan tutup halaman ini.
                  </p>
                )}

                <button
                  type="button"
                  onClick={execute}
                  disabled={running || confirmDisabled}
                  className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
                >
                  {running ? 'Memproses...' : confirmLabel}
                </button>
              </>
            )}

            {result && (
              <div>
                <p className="text-sm text-black mb-2">
                  Selesai: {result.ok} berhasil
                  {result.failed.length > 0 && `, ${result.failed.length} gagal`}
                  {result.skipped > 0 && `, ${result.skipped} dilewati`}.
                </p>
                {result.failed.length > 0 && (
                  <div className="mb-4 max-h-[200px] overflow-y-auto border border-[#F5C6C6] bg-[#FFF5F5] px-3 py-2">
                    {result.failed.map((f) => (
                      <p key={f.id} className="text-xs text-[#B91C1C] py-0.5">
                        <span className="font-medium">{f.nama}</span>: {f.error}
                      </p>
                    ))}
                    <p className="text-xs text-[#6B6B6B] mt-2">
                      Pelamar yang gagal tetap terpilih setelah modal ditutup, supaya bisa dicoba lagi.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={close}
                  className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
                >
                  Tutup
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
