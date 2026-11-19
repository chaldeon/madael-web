import { AGREEMENT_STATUS, AGREEMENT_STATUS_LABEL } from '@/lib/freelancerAgreementConfig';

const STYLE = {
  [AGREEMENT_STATUS.BELUM_TERSEDIA]: 'bg-[#F4F4F4] text-[#6B6B6B]',
  [AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN]: 'bg-amber-50 text-amber-800',
  [AGREEMENT_STATUS.MENUNGGU_VERIFIKASI]: 'bg-[#DBEAFE] text-[#1E40AF]',
  [AGREEMENT_STATUS.TERVERIFIKASI]: 'bg-[#DCFCE7] text-[#166534]',
  [AGREEMENT_STATUS.DITOLAK]: 'bg-[#FEE2E2] text-[#991B1B]',
};

// Lencana status Agreement. `status` null/kosong = belum tersedia (tidak ada baris
// Agreement), seperti yang dikirim API daftar/detail Freelancer.
export default function AgreementStatusBadge({ status }) {
  const key = status || AGREEMENT_STATUS.BELUM_TERSEDIA;
  return (
    <span
      className={`text-xs font-medium px-2.5 py-1 whitespace-nowrap ${STYLE[key] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}
    >
      {AGREEMENT_STATUS_LABEL[key] || key}
    </span>
  );
}
