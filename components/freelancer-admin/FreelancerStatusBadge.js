import { FREELANCER_STATUS, freelancerStatusLabel } from '@/lib/freelancerModules';

const STYLE = {
  [FREELANCER_STATUS.ACTIVE]: 'bg-[#DCFCE7] text-[#166534]',
  [FREELANCER_STATUS.INACTIVE]: 'bg-[#F4F4F4] text-[#6B6B6B]',
  [FREELANCER_STATUS.SUSPENDED]: 'bg-[#FEE2E2] text-[#991B1B]',
};

// Lencana status akun Freelancer (Active / Inactive / Suspended).
export default function FreelancerStatusBadge({ status }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 ${STYLE[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {freelancerStatusLabel(status)}
    </span>
  );
}
