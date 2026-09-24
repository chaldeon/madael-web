import { getAttendanceStatus } from '@/lib/attendanceStatus';

const TONE_CLASS = {
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
};

// Badge status absensi (Tepat Waktu / Telat / Tepat Waktu (Disetujui)).
// showNote: tampilkan catatan kecil (mis. "Alasan menunggu review HR") di bawah badge.
export default function AttendanceStatusBadge({ row, showNote = false }) {
  const s = getAttendanceStatus(row);
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${TONE_CLASS[s.tone]}`}>
        {s.label}
      </span>
      {showNote && s.note && <span className="text-[11px] text-[#9A9A9A]">{s.note}</span>}
    </div>
  );
}
