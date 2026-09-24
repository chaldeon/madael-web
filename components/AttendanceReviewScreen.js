'use client';

// Layar review (read-only) sebelum absensi benar-benar tersimpan. Semua angka
// berasal dari hasil hitung server (/api/attendance/clock/preview) — komponen ini
// hanya menampilkan. Peringatan tidak pernah memblokir tombol simpan; kasus di
// luar radius / wajah tidak cocok tetap ditangkap tab "Perlu Review" admin.
//
// review: { mode: 'in'|'out', photoUrl, preview, expiresAt }
import { AlertTriangle, Info, MapPin, ExternalLink, Camera } from 'lucide-react';
import {
  MODE_LABEL, buildReviewWarnings, formatJarak, formatDurasi, osmEmbedUrl, osmLinkUrl,
} from '@/lib/attendanceReview';

const WAJAH_BADGE = {
  cocok: { label: 'WAJAH COCOK', cls: 'bg-green-100 text-green-700' },
  tidak_cocok: { label: 'WAJAH TIDAK COCOK', cls: 'bg-amber-100 text-amber-800' },
  tidak_terdeteksi: { label: 'WAJAH TIDAK TERDETEKSI', cls: 'bg-amber-100 text-amber-800' },
  belum_dicek: { label: 'BELUM DIVERIFIKASI', cls: 'bg-[#F4F4F4] text-[#6B6B6B]' },
  tanpa_referensi: { label: 'TANPA FOTO REFERENSI', cls: 'bg-[#F4F4F4] text-[#6B6B6B]' },
};

function formatTanggalLengkap(tanggal) {
  if (!tanggal) return '—';
  return new Date(tanggal + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatJamMenit(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-[#F0F0F0] last:border-0">
      <span className="text-xs text-[#6B6B6B] shrink-0">{label}</span>
      <span className="text-sm text-black text-right">{children}</span>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold text-black tracking-[0.02em] mb-2">{children}</p>;
}

export default function AttendanceReviewScreen({
  review, confirming = false, error = null, fatal = false, onConfirm, onCancel, onRetake,
}) {
  if (!review) return null;
  const { mode, photoUrl, preview, expiresAt } = review;
  const label = MODE_LABEL[mode] || 'Absensi';
  const warnings = buildReviewWarnings(preview);
  const { jadwal, wajah, lokasi } = preview;
  const badge = WAJAH_BADGE[wajah.status] || WAJAH_BADGE.belum_dicek;
  const durasi = mode === 'out' ? formatDurasi(preview.clockInAt, preview.waktu.iso) : null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[1000] flex items-start justify-center overflow-y-auto px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${label}`}
    >
      <div className="bg-white w-full max-w-[520px]">
        <div className="px-6 pt-6 pb-4 border-b border-[#E0E0E0]">
          <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em]">Review {label}</h2>
          <p className="text-xs text-[#6B6B6B] mt-1">
            Periksa data di bawah. Absensimu <span className="font-medium text-black">belum tersimpan</span> sampai kamu menekan konfirmasi
            {expiresAt ? ` (paling lambat pukul ${formatJamMenit(expiresAt)}).` : '.'}
          </p>
        </div>

        <div className="p-6 space-y-6">
          {warnings.length > 0 && (
            <div className="space-y-2" data-testid="review-warnings">
              {warnings.map((w) => (
                <div
                  key={w.key}
                  className={`flex items-start gap-2 text-xs px-4 py-3 border ${
                    w.tone === 'warn'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-[#F4F4F4] border-[#E0E0E0] text-[#6B6B6B]'
                  }`}
                >
                  {w.tone === 'warn' ? (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  ) : (
                    <Info size={14} className="mt-0.5 shrink-0" />
                  )}
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <SectionTitle>Waktu &amp; Jadwal</SectionTitle>
            <Row label="Tanggal">{formatTanggalLengkap(preview.tanggal)}</Row>
            <Row label={`Jam ${label}`}><span className="font-medium">{preview.waktu.jam} WIB</span></Row>
            <Row label="Jadwal kerja">
              {jadwal ? (
                <>
                  {jadwal.jamMasuk.slice(0, 5)}{jadwal.jamPulang ? ` – ${jadwal.jamPulang.slice(0, 5)}` : ''}
                  {jadwal.toleransiMenit > 0 && (
                    <span className="block text-[11px] text-[#9A9A9A]">Toleransi keterlambatan {jadwal.toleransiMenit} menit</span>
                  )}
                </>
              ) : (
                <span className="text-[#6B6B6B]">Belum diatur</span>
              )}
            </Row>
            {mode === 'in' && (
              <Row label="Status">
                {!jadwal ? (
                  <span className="text-xs text-[#6B6B6B]">Status telat tidak dihitung (jadwal belum diatur)</span>
                ) : preview.statusTelat ? (
                  <span className="inline-flex flex-col items-end gap-1">
                    <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">TELAT</span>
                    <span className="text-[11px] text-[#9A9A9A]">Setelah disimpan, kamu bisa menambahkan alasan.</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700">TEPAT WAKTU</span>
                )}
              </Row>
            )}
            {mode === 'out' && preview.clockInAt && (
              <Row label="Clock in hari ini">
                {formatJamMenit(preview.clockInAt)}
                {durasi && <span className="block text-[11px] text-[#9A9A9A]">Durasi kerja {durasi}</span>}
              </Row>
            )}
          </div>

          <div>
            <SectionTitle>Foto &amp; Verifikasi Wajah</SectionTitle>
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 bg-[#F4F4F4] border border-[#E0E0E0] overflow-hidden shrink-0">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob URL lokal dari kamera, next/image tidak relevan
                  <img src={photoUrl} alt={`Foto ${label}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#9A9A9A]">
                    <Camera size={22} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className={`inline-block text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${badge.cls}`}>{badge.label}</span>
                {wajah.kemiripanPersen != null && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs text-[#6B6B6B]">Skor kemiripan</span>
                      <span className="text-sm text-black font-medium">{wajah.kemiripanPersen}%</span>
                    </div>
                    <div className="h-1.5 bg-[#E0E0E0]" role="img" aria-label={`Kemiripan wajah ${wajah.kemiripanPersen}%`}>
                      <div
                        className={`h-full ${wajah.cocok ? 'bg-green-600' : 'bg-amber-500'}`}
                        style={{ width: `${wajah.kemiripanPersen}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-[#9A9A9A] mt-1">Skor perkiraan; penentu cocok atau tidaknya adalah ambang verifikasi wajah.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <SectionTitle>Lokasi</SectionTitle>
            <div className="flex items-start gap-2 text-xs text-[#6B6B6B] mb-3">
              <MapPin size={13} className="mt-0.5 shrink-0" />
              <span>
                {lokasi.dalamRadius === null ? (
                  'Belum ada lokasi kerja terdaftar untuk dicek.'
                ) : (
                  <>
                    <span className={`font-medium ${lokasi.dalamRadius ? 'text-green-700' : 'text-amber-800'}`}>
                      {lokasi.dalamRadius ? 'Dalam radius' : 'Di luar radius'}
                    </span>
                    {' · '}{formatJarak(lokasi.jarakMeter)} dari {lokasi.nama || 'lokasi kerja'}
                    {lokasi.radiusMeter != null && ` (radius ${lokasi.radiusMeter} m)`}
                  </>
                )}
                <span className="block text-[11px] text-[#9A9A9A] mt-0.5">
                  Koordinatmu: {lokasi.lat.toFixed(5)}, {lokasi.lng.toFixed(5)}
                </span>
              </span>
            </div>
            <iframe
              title="Peta lokasi absensi"
              src={osmEmbedUrl(lokasi)}
              className="w-full h-[200px] border border-[#E0E0E0] bg-[#F4F4F4]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] text-[#9A9A9A]">Penanda = posisimu saat foto diambil.</span>
              <a
                href={osmLinkUrl(lokasi)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-madael-red hover:text-madael-dark"
              >
                Buka peta besar <ExternalLink size={11} />
              </a>
            </div>
          </div>

          <div className="flex items-start gap-2 border border-red-200 bg-red-50 text-red-800 text-xs px-4 py-3" data-testid="final-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">Data tidak dapat diubah setelah disimpan.</span>{' '}
              Kalau ada yang salah, gunakan <span className="font-medium">Ajukan Koreksi</span>.
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3" role="alert">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-3">
            {!fatal && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirming}
                className="w-full bg-madael-red text-white px-6 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                {confirming ? 'Menyimpan...' : error ? `Coba Simpan Lagi` : `Konfirmasi & Simpan ${label}`}
              </button>
            )}
            {fatal && (
              <button
                type="button"
                onClick={onRetake}
                className="w-full bg-madael-red text-white px-6 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
              >
                Ambil Foto Ulang
              </button>
            )}
            <div className="flex items-center justify-center gap-6 text-xs">
              {!fatal && (
                <button type="button" onClick={onRetake} disabled={confirming} className="text-[#6B6B6B] hover:text-black disabled:opacity-50">
                  Ambil Foto Ulang
                </button>
              )}
              <button type="button" onClick={onCancel} disabled={confirming} className="text-[#6B6B6B] hover:text-black disabled:opacity-50">
                Batal
              </button>
            </div>
            <p className="text-[11px] text-[#9A9A9A] text-center">
              Ingin melewati layar ini? Atur di Profil Saya → Preferensi Absensi.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}