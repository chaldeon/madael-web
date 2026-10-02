'use client';

import { useEffect, useState } from 'react';

// Panel "Reviewer Lowongan" di dalam form Edit Lowongan. Menyimpan sendiri
// (terpisah dari tombol Simpan form lowongan) lewat
// /api/job-listings/[id]/reviewers, jadi mengubah reviewer tidak ikut
// menyimpan perubahan lain di form yang belum disimpan.
//
// Hanya pemegang akses penuh Job Portal yang melihat panel ini.
export default function JobReviewersPanel({ jobId, onSaved }) {
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState([]); // id karyawan
  const [initial, setInitial] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/job-listings/${jobId}/reviewers`);
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Gagal memuat reviewer.');
        } else {
          const ids = (json.reviewers || []).map((r) => r.id);
          // Reviewer yang aksesnya sudah dicabut tetap tampil supaya bisa
          // dilepas dari lowongan ini.
          const known = new Set((json.candidates || []).map((c) => c.id));
          const orphan = (json.reviewers || []).filter((r) => !known.has(r.id));
          setCandidates([...(json.candidates || []), ...orphan.map((r) => ({ ...r, orphan: true }))]);
          setSelected(ids);
          setInitial(ids);
        }
      } catch {
        if (!cancelled) setError('Gagal memuat reviewer.');
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const toggle = (id) => {
    setSaved(false);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const dirty =
    selected.length !== initial.length || selected.some((id) => !initial.includes(id));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/job-listings/${jobId}/reviewers`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: selected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Gagal menyimpan reviewer.');
      } else {
        setInitial(selected);
        setSaved(true);
        onSaved?.(jobId, json.reviewers || []);
      }
    } catch {
      setError('Gagal menyimpan reviewer.');
    }
    setSaving(false);
  };

  return (
    <div className="border border-[#E0E0E0] bg-white p-5">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-black">Reviewer Lowongan</h3>
        <p className="text-xs text-[#6B6B6B] mt-1">
          Reviewer hanya melihat lowongan ini beserta pelamarnya. Pemegang akses penuh Job Portal dan superadmin
          selalu melihat semua lowongan, jadi tidak perlu di-assign.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-[#6B6B6B]">Memuat...</p>
      ) : candidates.length === 0 && !error ? (
        <p className="text-xs text-[#6B6B6B]">
          Belum ada karyawan dengan akses &quot;Job Portal Terbatas&quot;. Berikan aksesnya lewat Employee List → Kelola
          Akses, lalu kembali ke sini.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-3 text-sm text-[#3D3D3D] cursor-pointer">
              <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              <span>{c.nama}</span>
              {c.orphan && <span className="text-[11px] text-[#9A9A9A]">(akses terbatas sudah dicabut)</span>}
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-madael-red mt-3">{error}</p>}
      {saved && !error && <p className="text-xs text-[#166534] mt-3">Reviewer tersimpan.</p>}

      {!loading && candidates.length > 0 && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="mt-4 border border-madael-red text-madael-red px-5 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-red hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Menyimpan...' : 'Simpan Reviewer'}
        </button>
      )}
    </div>
  );
}
