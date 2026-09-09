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
export function useModalDismiss(isOpen, onClose, message = DEFAULT_MESSAGE) {
  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (message === false || window.confirm(message)) onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, message]);

  return useCallback((e) => {
    // Cuma tutup kalau yang diklik backdrop-nya sendiri, bukan konten modal
    // (konten modal harus stopPropagation supaya klik di dalamnya tidak nyasar ke sini).
    if (e.target !== e.currentTarget) return;
    if (message === false || window.confirm(message)) onClose();
  }, [onClose, message]);
}