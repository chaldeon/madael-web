import { useEffect, useCallback } from 'react';

const DEFAULT_MESSAGE = 'Keluar dari form ini? Data yang sudah diisi tidak akan tersimpan.';

// Hook dipakai oleh modal form (tambah/edit data) di seluruh modul, supaya
// perilakunya konsisten: klik di luar modal atau tekan Esc akan memunculkan
// konfirmasi sebelum menutup, dan kalau dikonfirmasi, modal ditutup TANPA
// menyimpan data yang sudah diisi.
//
// Pemakaian:
//   const handleBackdropClick = useModalDismiss(isOpen, onClose);
//   ...
//   <div className="fixed inset-0 ..." onClick={handleBackdropClick}>
//     <div onClick={(e) => e.stopPropagation()}> ...isi modal... </div>
//   </div>
//
// isOpen: boolean, kapan modal ini sedang tampil (dipakai supaya listener
// Esc cuma aktif saat modal ini benar-benar terbuka).
// onClose: fungsi yang menutup modal (biasanya setState(false) / setState(null)).
// message: teks konfirmasi. Isi `false` untuk modal read-only (tidak ada input
// yang bisa hilang), sehingga backdrop/Esc langsung menutup tanpa konfirmasi.
// isDirty: boolean, apakah form di dalam modal sudah ada perubahan dari
// keadaan awalnya. Default `true` supaya modal yang belum sempat dikirim
// status dirty-nya tetap berperilaku seperti sebelumnya (selalu tanya kalau
// message bukan `false`). Kalau `false` dikirim (form belum diubah sama
// sekali), modal langsung tertutup tanpa konfirmasi meski `message` diisi.
// Cara hitung isDirty diserahkan ke pemanggil (biasanya bandingin state form
// saat ini vs snapshot nilai awal saat modal dibuka), karena bentuk data tiap
// form beda-beda (ada yang objek biasa, ada yang punya field File dsb).
export function useModalDismiss(isOpen, onClose, message = DEFAULT_MESSAGE, isDirty = true) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (message === false || !isDirty || window.confirm(message)) onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, message, isDirty]);

  return useCallback((e) => {
    // Cuma tutup kalau yang diklik backdrop-nya sendiri, bukan konten modal
    // (konten modal harus stopPropagation supaya klik di dalamnya tidak nyasar ke sini).
    if (e.target !== e.currentTarget) return;
    if (message === false || !isDirty || window.confirm(message)) onClose();
  }, [onClose, message, isDirty]);
}