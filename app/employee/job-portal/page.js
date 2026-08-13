'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';

const emptyForm = {
  title: '',
  slug: '',
  department: '',
  client_industry: '',
  location: '',
  type: '',
  description: '',
  requirements: '',
  closes_at: '',
  is_active: true,
  questions: [],
};

const QUESTION_TYPES = [
  { value: 'text', label: 'Teks Bebas' },
  { value: 'yesno', label: 'Ya / Tidak' },
  { value: 'number', label: 'Angka' },
  { value: 'scale', label: 'Skala 1-5' },
];

const MAX_QUESTIONS = 5;

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function findUniqueSlug(supabase, baseSlug, excludeId = null) {
  let candidate = baseSlug;
  let n = 2;
  while (true) {
    let query = supabase.from('job_listings').select('id').eq('slug', candidate);
    if (excludeId) query = query.neq('id', excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
    candidate = `${baseSlug}-${n}`;
    n++;
  }
}

export default function JobPortalLowonganPage() {
  const supabase = createClient();

  const [listings, setListings] = useState([]);
  const [applicantCounts, setApplicantCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // openId: null (tertutup semua) | 'new' (form create) | <job.id> (form edit row itu)
  const [openId, setOpenId] = useState(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);

  const editingId = openId && openId !== 'new' ? openId : null;

  const createSectionRef = useRef(null);
  const rowRefs = useRef({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: jobs, error: jobsError } = await supabase
      .from('job_listings')
      .select('*')
      .order('created_at', { ascending: false });

    if (jobsError) {
      setError(jobsError.message);
      setLoading(false);
      return;
    }

    const { data: apps, error: appsError } = await supabase.from('applications').select('job_id');

    if (!appsError && apps) {
      const counts = {};
      apps.forEach((a) => {
        // Lamaran tanpa job_id = lamaran umum, dihitung terpisah di bawah key 'umum'.
        const key = a.job_id || 'umum';
        counts[key] = (counts[key] || 0) + 1;
      });
      setApplicantCounts(counts);
    }

    setListings(jobs || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-scroll ke accordion yang baru dibuka
  useEffect(() => {
    if (openId === 'new') {
      createSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (openId) {
      rowRefs.current[openId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [openId]);

  const closeForm = () => {
    setOpenId(null);
    setFormData(emptyForm);
    setSlugTouched(false);
    setFormError(null);
  };

  const openCreateForm = () => {
    if (openId === 'new') {
      closeForm();
      return;
    }
    setFormData(emptyForm);
    setSlugTouched(false);
    setFormError(null);
    setOpenId('new');
  };

  const openEditForm = (job) => {
    if (openId === job.id) {
      closeForm();
      return;
    }
    setFormData({
      title: job.title || '',
      slug: job.slug || '',
      department: job.department || '',
      client_industry: job.client_industry || '',
      location: job.location || '',
      type: job.type || '',
      description: job.description || '',
      requirements: job.requirements || '',
      closes_at: job.closes_at || '',
      is_active: job.is_active,
      questions: Array.isArray(job.questions) ? job.questions : [],
    });
    setSlugTouched(true);
    setFormError(null);
    setOpenId(job.id);
  };

  const handleTitleChange = (e) => {
    const title = e.target.value;
    setFormData((prev) => ({
      ...prev,
      title,
      slug: slugTouched ? prev.slug : slugify(title),
    }));
  };

  const handleSlugChange = (e) => {
    setSlugTouched(true);
    setFormData((prev) => ({ ...prev, slug: slugify(e.target.value) }));
  };

  const handleFieldChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleToggleActiveInForm = () => {
    setFormData((prev) => ({ ...prev, is_active: !prev.is_active }));
  };

  // ---- Pertanyaan untuk pelamar ----
  const addQuestion = () => {
    setFormData((prev) => {
      if (prev.questions.length >= MAX_QUESTIONS) return prev;
      return {
        ...prev,
        questions: [...prev.questions, { text: '', type: 'text', required: false }],
      };
    });
  };

  const updateQuestion = (index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, [field]: value } : q)),
    }));
  };

  const removeQuestion = (index) => {
    setFormData((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.title || !formData.slug) {
      setFormError('Judul posisi dan slug wajib diisi.');
      return;
    }

    const cleanedQuestions = formData.questions
      .map((q) => ({ text: (q.text || '').trim(), type: q.type || 'text', required: !!q.required }))
      .filter((q) => q.text);

    if (cleanedQuestions.length !== formData.questions.length) {
      setFormError('Ada pertanyaan yang masih kosong. Isi atau hapus pertanyaan tersebut.');
      return;
    }

    setSaving(true);

    const uniqueSlug = await findUniqueSlug(supabase, formData.slug, editingId);

    const payload = {
      title: formData.title,
      slug: uniqueSlug,
      department: formData.department || null,
      client_industry: formData.client_industry || null,
      location: formData.location || null,
      type: formData.type || null,
      description: formData.description || null,
      requirements: formData.requirements || null,
      closes_at: formData.closes_at || null,
      is_active: formData.is_active,
      questions: cleanedQuestions,
    };

    let result;
    if (editingId) {
      result = await supabase.from('job_listings').update(payload).eq('id', editingId);
    } else {
      result = await supabase.from('job_listings').insert([payload]);
    }

    if (result.error) {
      setFormError('Gagal menyimpan: ' + result.error.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    closeForm();
    fetchData();
  };

  const handleToggleActive = async (job) => {
    setTogglingId(job.id);
    const { error } = await supabase.from('job_listings').update({ is_active: !job.is_active }).eq('id', job.id);

    if (!error) {
      setListings((prev) => prev.map((j) => (j.id === job.id ? { ...j, is_active: !j.is_active } : j)));
    } else {
      alert('Gagal mengubah status: ' + error.message);
    }
    setTogglingId(null);
  };

  const handleDuplicate = async (job) => {
    setDuplicatingId(job.id);

    const newSlug = await findUniqueSlug(supabase, job.slug + '-copy');

    const payload = {
      title: job.title + ' (Copy)',
      slug: newSlug,
      department: job.department,
      client_industry: job.client_industry,
      location: job.location,
      type: job.type,
      description: job.description,
      requirements: job.requirements,
      closes_at: job.closes_at,
      is_active: false,
      questions: Array.isArray(job.questions) ? job.questions : [],
    };

    const { error } = await supabase.from('job_listings').insert([payload]);

    if (error) {
      alert('Gagal menduplikat lowongan: ' + error.message);
    } else {
      fetchData();
    }
    setDuplicatingId(null);
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';
  const textareaClass = inputClass + ' resize-y min-h-[100px]';
  const selectClass = inputClass + ' cursor-pointer';

  // Isi form dipakai bareng untuk accordion Create (di atas tabel) & Edit (nempel di row)
  const renderFormContent = () => (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em]">
          {editingId ? 'Edit Lowongan' : 'Buat Lowongan Baru'}
        </h2>
        <button type="button" onClick={closeForm} className="text-sm text-[#6B6B6B] hover:text-black">
          Batal
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Judul Posisi</label>
            <input type="text" required value={formData.title} onChange={handleTitleChange} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Slug</label>
            <input type="text" required value={formData.slug} onChange={handleSlugChange} className={inputClass} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <div>
            <label className={labelClass}>Departemen</label>
            <input type="text" value={formData.department} onChange={handleFieldChange('department')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Lokasi</label>
            <input type="text" value={formData.location} onChange={handleFieldChange('location')} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Tipe</label>
            <input
              type="text"
              placeholder="Full-time / Part-time / Contract"
              value={formData.type}
              onChange={handleFieldChange('type')}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Client / Industri</label>
          <input
            type="text"
            placeholder='mis. "Technology & Services Company" — dipakai di kalimat pembuka job-ad'
            value={formData.client_industry}
            onChange={handleFieldChange('client_industry')}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Deskripsi Pekerjaan</label>
          <textarea value={formData.description} onChange={handleFieldChange('description')} className={textareaClass} />
        </div>

        <div>
          <label className={labelClass}>Kualifikasi</label>
          <textarea value={formData.requirements} onChange={handleFieldChange('requirements')} className={textareaClass} />
        </div>

        {/* ---- Pertanyaan untuk pelamar (screening questions) ---- */}
        <div className="border-t border-[#E0E0E0] pt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <label className={labelClass + ' mb-0.5'}>Pertanyaan untuk Pelamar</label>
              <p className="text-xs text-[#AAA]">Opsional, maks. {MAX_QUESTIONS} pertanyaan. Ditampilkan di form apply.</p>
            </div>
            <button
              type="button"
              onClick={addQuestion}
              disabled={formData.questions.length >= MAX_QUESTIONS}
              className="text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Tambah Pertanyaan
            </button>
          </div>

          {formData.questions.length === 0 ? (
            <p className="text-xs text-[#AAA]">Belum ada pertanyaan tambahan.</p>
          ) : (
            <div className="space-y-3">
              {formData.questions.map((q, index) => (
                <div key={index} className="flex items-start gap-3 bg-[#FAFAFA] border border-[#E0E0E0] p-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder={`Pertanyaan ${index + 1}, mis. "Berapa tahun pengalaman Anda?"`}
                      value={q.text}
                      onChange={(e) => updateQuestion(index, 'text', e.target.value)}
                      className={inputClass + ' mb-2'}
                    />
                    <div className="flex items-center gap-3 flex-wrap">
                      <select
                        value={q.type}
                        onChange={(e) => updateQuestion(index, 'type', e.target.value)}
                        className={selectClass + ' w-auto text-xs py-1.5'}
                      >
                        {QUESTION_TYPES.map((qt) => (
                          <option key={qt.value} value={qt.value}>
                            {qt.label}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-xs text-[#3D3D3D] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!q.required}
                          onChange={(e) => updateQuestion(index, 'required', e.target.checked)}
                        />
                        Wajib dijawab
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQuestion(index)}
                    className="text-xs text-[#AAA] hover:text-madael-red mt-2.5"
                    title="Hapus pertanyaan"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-5 items-end">
          <div>
            <label className={labelClass}>Deadline Apply</label>
            <input type="date" value={formData.closes_at || ''} onChange={handleFieldChange('closes_at')} className={inputClass} />
          </div>
          <div className="flex items-center gap-3 pb-2.5">
            <button
              type="button"
              onClick={handleToggleActiveInForm}
              className={'relative w-11 h-6 transition-colors ' + (formData.is_active ? 'bg-madael-red' : 'bg-[#D0D0D0]')}
            >
              <span
                className={
                  'absolute top-0.5 left-0.5 w-5 h-5 bg-white transition-transform ' +
                  (formData.is_active ? 'translate-x-5' : 'translate-x-0')
                }
              />
            </button>
            <span className="text-sm text-[#3D3D3D]">{formData.is_active ? 'Aktif' : 'Nonaktif'}</span>
          </div>
        </div>

        {formError && <p className="text-sm text-madael-red">{formError}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="border border-[#E0E0E0] text-[#6B6B6B] px-8 py-3 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
          >
            Batal
          </button>
        </div>
      </form>
    </div>
  );

  const umumCount = applicantCounts.umum || 0;

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Lowongan</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{listings.length} lowongan total</p>
        </div>
        <button
          onClick={openCreateForm}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
        >
          Buat Lowongan Baru
        </button>
      </div>

      <div ref={createSectionRef} className="bg-white border border-[#E0E0E0] overflow-hidden mb-8">
        {/* Accordion Create — selalu di atas tabel */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            openId === 'new' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden border-b border-[#E0E0E0]">
            {openId === 'new' && renderFormContent()}
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-[#6B6B6B] p-6">Memuat data...</p>
          ) : error ? (
            <p className="text-sm text-madael-red p-6">Gagal memuat data: {error}</p>
          ) : listings.length === 0 ? (
            <p className="text-sm text-[#6B6B6B] p-6">Belum ada lowongan.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                  <th className="px-5 py-3 font-medium">Judul Posisi</th>
                  <th className="px-5 py-3 font-medium">Pelamar</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {/* Baris tetap: lamaran umum (job_id null) — bukan row job_listings sungguhan */}
                <tr className="bg-[#FAFAFA]">
                  <td className="px-5 py-3.5 text-black">
                    Umum
                    <div className="text-xs text-[#AAA] mt-0.5">Lamaran tanpa posisi spesifik</div>
                  </td>
                  <td className="px-5 py-3.5 text-[#3D3D3D]">
                    {umumCount > 0 ? (
                      <Link
                        href="/employee/job-portal/pelamar?posisi=umum"
                        className="text-madael-red hover:text-madael-dark font-medium"
                      >
                        {umumCount}
                      </Link>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-medium px-2.5 py-1 bg-[#F0F0F0] text-[#6B6B6B]">Selalu terbuka</span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-[#AAA]">—</td>
                </tr>

                {listings.map((job) => (
                  <Fragment key={job.id}>
                    <tr ref={(el) => (rowRefs.current[job.id] = el)}>
                      <td className="px-5 py-3.5 text-black">
                        {job.title}
                        <div className="text-xs text-[#AAA] mt-0.5">/{job.slug}</div>
                      </td>
                      <td className="px-5 py-3.5 text-[#3D3D3D]">
                        {applicantCounts[job.id] ? (
                          <Link
                            href={`/employee/job-portal/pelamar?posisi=${job.slug}`}
                            className="text-madael-red hover:text-madael-dark font-medium"
                          >
                            {applicantCounts[job.id]}
                          </Link>
                        ) : (
                          '0'
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={
                            'text-xs font-medium px-2.5 py-1 ' +
                            (job.is_active ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F0F0F0] text-[#6B6B6B]')
                          }
                        >
                          {job.is_active ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-4 flex-wrap">
                          <button
                            onClick={() => openEditForm(job)}
                            className={`text-xs font-medium hover:text-madael-dark ${
                              openId === job.id ? 'text-madael-dark underline' : 'text-madael-red'
                            }`}
                          >
                            {openId === job.id ? 'Tutup' : 'Edit'}
                          </button>
                          <button
                            onClick={() => handleDuplicate(job)}
                            disabled={duplicatingId === job.id}
                            className="text-xs font-medium text-[#6B6B6B] hover:text-black disabled:opacity-50"
                          >
                            {duplicatingId === job.id ? 'Menduplikat...' : 'Duplikat'}
                          </button>
                          <button
                            onClick={() => handleToggleActive(job)}
                            disabled={togglingId === job.id}
                            className="text-xs font-medium text-[#6B6B6B] hover:text-black disabled:opacity-50"
                          >
                            {job.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <a
                            href={`/employee/job-portal-cetak/${job.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-[#6B6B6B] hover:text-black"
                          >
                            Cetak PDF
                          </a>
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td colSpan={4} className="p-0 border-b border-[#F0F0F0] last:border-0">
                        <div
                          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                            openId === job.id ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                          }`}
                        >
                          <div className="overflow-hidden bg-[#FAFAFA]">
                            {openId === job.id && renderFormContent()}
                          </div>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}