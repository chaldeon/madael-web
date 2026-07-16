'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

const STATUS_OPTIONS = ['Baru', 'Review', 'Interview', 'Ditolak', 'Diterima'];

const STATUS_STYLES = {
  Baru: 'bg-[#E8F0FE] text-[#1A56DB]',
  Review: 'bg-[#FEF3C7] text-[#92700C]',
  Interview: 'bg-[#DCFCE7] text-[#166534]',
  Ditolak: 'bg-[#FEE2E2] text-[#B91C1C]',
  Diterima: 'bg-[#166534] text-white',
};

function CvLink({ driveId }) {
  const url = "https://drive.google.com/file/d/" + driveId + "/view";
  return <a href={url} target="_blank" rel="noopener noreferrer" className="text-madael-red hover:text-madael-dark text-xs font-medium">Lihat CV</a>;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [applications, setApplications] = useState([]);
  const [jobOptions, setJobOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterJob, setFilterJob] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('applications')
      .select('id, created_at, nama, email, telepon, status, cv_drive_id, cv_filename, job_id, job_listings ( title )')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setApplications(data || []);
      const uniqueTitles = Array.from(
        new Set((data || []).map((a) => a.job_listings?.title).filter(Boolean))
      );
      setJobOptions(uniqueTitles);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleStatusChange = async (id, newStatus) => {
    setUpdatingId(id);
    const { error } = await supabase
      .from('applications')
      .update({ status: newStatus })
      .eq('id', id);

    if (!error) {
      setApplications((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      );
    } else {
      alert('Gagal update status: ' + error.message);
    }
    setUpdatingId(null);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  const filtered = applications.filter((a) => {
    const matchJob = !filterJob || a.job_listings?.title === filterJob;
    const matchStatus = !filterStatus || a.status === filterStatus;
    return matchJob && matchStatus;
  });

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <section className="min-h-screen bg-[#F4F4F4] px-6 py-10">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="mb-8">
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
                Dashboard Kandidat
            </h1>
            <p className="text-sm text-[#6B6B6B] mt-1">
                {applications.length} total pelamar
            </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={filterJob}
            onChange={(e) => setFilterJob(e.target.value)}
            className={selectClass}
          >
            <option value="">Semua Posisi</option>
            {jobOptions.map((title) => (
              <option key={title} value={title}>{title}</option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={selectClass}
          >
            <option value="">Semua Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          {loading ? (
            <p className="text-sm text-[#6B6B6B] p-6">Memuat data...</p>
          ) : error ? (
            <p className="text-sm text-madael-red p-6">Gagal memuat data: {error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[#6B6B6B] p-6">Tidak ada pelamar yang cocok dengan filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                  <th className="px-5 py-3 font-medium">Nama</th>
                  <th className="px-5 py-3 font-medium">Posisi</th>
                  <th className="px-5 py-3 font-medium">Tanggal Apply</th>
                  <th className="px-5 py-3 font-medium">Kontak</th>
                  <th className="px-5 py-3 font-medium">CV</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-[#F0F0F0] last:border-0">
                    <td className="px-5 py-3.5 text-black">{a.nama}</td>
                    <td className="px-5 py-3.5 text-[#3D3D3D]">
                      {a.job_listings?.title || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-[#6B6B6B]">
                      {new Date(a.created_at).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-[#6B6B6B]">
                      <div>{a.email}</div>
                      {a.telepon && <div className="text-xs">{a.telepon}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      {a.cv_drive_id ? (
                        <CvLink driveId={a.cv_drive_id} />
                      ) : (
                        <span className="text-xs text-[#AAA]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <select
                        value={a.status}
                        disabled={updatingId === a.id}
                        onChange={(e) => handleStatusChange(a.id, e.target.value)}
                        className={`text-xs font-medium px-2.5 py-1.5 border-0 focus:outline-none cursor-pointer ${STATUS_STYLES[a.status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}