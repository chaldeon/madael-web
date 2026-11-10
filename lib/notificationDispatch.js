// SERVER ONLY — meneruskan hasil build() sebuah event notifikasi ke helper
// notify* yang sesuai dengan penerimanya. Dipakai bersama oleh
// /api/notifications/dispatch dan lib/announcementBroadcast.js supaya aturan
// "siapa menerima apa" hanya ada di satu tempat.
//
// `to` mengikuti bentuk di lib/notificationEvents.js:
//   'superadmins' | 'all_active' | { module } | { userId } | { userIds }
// Mengembalikan { ok, inserted } dari helper notify*, atau null bila bentuk
// `to` tidak dikenal (pemanggil memperlakukannya sebagai gagal kirim).
import {
  notifyEmployee,
  notifyEmployees,
  notifySuperadmins,
  notifyByModule,
  notifyAllActive,
} from '@/lib/notify';

export async function kirimKePenerima(admin, to, payload) {
  if (to === 'superadmins') return notifySuperadmins(admin, payload);
  if (to === 'all_active') return notifyAllActive(admin, payload);
  if (typeof to?.module === 'string') {
    return notifyByModule(admin, { moduleKey: to.module, ...payload });
  }
  if (to?.userId) return notifyEmployee(admin, { userId: to.userId, ...payload });
  if (Array.isArray(to?.userIds)) return notifyEmployees(admin, { userIds: to.userIds, ...payload });
  return null;
}
