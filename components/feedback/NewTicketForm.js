'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { FEEDBACK_JENIS, FEEDBACK_MAX_TEXT, resolveModuleTag } from '@/lib/feedbackConfig';
import { api, inputClass, AttachmentPicker } from './parts';

export default function NewTicketForm({ pathname, onCreated }) {
  const [jenis, setJenis] = useState('bug');
  const [isi, setIsi] = useState('');
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Hanya untuk ditampilkan; server menghitung ulang tag dari path.
  const modul = resolveModuleTag(pathname);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!isi.trim()) {
      setError('Deskripsi wajib diisi.');
      return;
    }
    setSubmitting(true);
    setError('');

    const body = new FormData();
    body.append('jenis', jenis);
    body.append('isi', isi.trim());
    body.append('halaman', pathname || '');
    if (file) body.append('file', file);

    const res = await api('/api/feedback/tickets', { method: 'POST', body });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data.id);
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      <p className="text-xs text-[#6B6B6B]">
        Dikirim dari halaman: <span className="font-medium text-black">{modul.label}</span>
      </p>

      <div>
        <p className="text-xs font-medium text-black mb-2">Jenis</p>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_JENIS.map((j) => (
            <button
              key={j.key}
              type="button"
              onClick={() => setJenis(j.key)}
              disabled={submitting}
              className={`px-3 py-1.5 text-xs border transition-colors ${
                jenis === j.key
                  ? 'bg-madael-red text-white border-madael-red'
                  : 'bg-white text-[#3D3D3D] border-[#E0E0E0] hover:border-madael-red'
              }`}
            >
              {j.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="feedback-isi" className="block text-xs font-medium text-black mb-2">Deskripsi</label>
        <textarea
          id="feedback-isi"
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          rows={5}
          maxLength={FEEDBACK_MAX_TEXT}
          disabled={submitting}
          placeholder="Ceritakan apa yang terjadi atau yang Anda butuhkan."
          className={`${inputClass} resize-none`}
        />
      </div>

      <AttachmentPicker file={file} onChange={setFile} onError={setError} disabled={submitting} />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full flex items-center justify-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60"
      >
        <Send size={14} />
        {submitting ? 'Mengirim...' : 'Kirim Tiket'}
      </button>
    </form>
  );
}
