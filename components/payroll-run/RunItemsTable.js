'use client';

import SortableHeader from '@/components/SortableHeader';
import { formatNumberDisplay } from '@/lib/payrollRunConfig';
import { formatRupiah } from '@/lib/format';

// Tabel item payroll run: kolom Overtime/Insentif/Kompensasi adalah input aktif
// per baris. State (draft input, sortir, simpan) tetap dipegang page.js —
// komponen ini murni tampilan. `locked` = status draft 'Approved' (input dikunci).
export default function RunItemsTable({
  items, sortField, sortDir, onSort, locked, getEditValue, setEditValue, recalcSaving, onRecalc,
}) {
  return (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <p className="text-xs text-[#6B6B6B] px-4 pt-3">
            Isi Overtime/Insentif/Kompensasi per employee lalu klik "Hitung Ulang" untuk update PPh21 & THP — sama seperti di Kelola Slip Gaji.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <SortableHeader className="px-4 py-3" colKey="nama" label="Nama" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortableHeader className="px-4 py-3" colKey="posisi" label="Posisi" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortableHeader className="px-4 py-3" colKey="gaji_pokok" label="Gaji Pokok" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right" />
                <SortableHeader className="px-4 py-3" colKey="allowance" label="Allowance" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right" />
                <th className="px-4 py-3 font-medium text-right">Overtime</th>
                <th className="px-4 py-3 font-medium text-right">Insentif</th>
                <th className="px-4 py-3 font-medium text-right">Kompensasi</th>
                <SortableHeader className="px-4 py-3" colKey="penalty" label="Penalty" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right" />
                <SortableHeader className="px-4 py-3" colKey="pph21" label="PPh21" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right" />
                <SortableHeader className="px-4 py-3" colKey="thp" label="THP" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right" />
                <th className="px-4 py-3 font-medium">Slip</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{item.employees_master?.nama || '—'}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{item.employees_master?.posisi || '—'}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.gaji_pokok)}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.allowance)}</td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={locked}
                      value={formatNumberDisplay(getEditValue(item, 'overtime'))}
                      onChange={(e) => setEditValue(item.id, 'overtime', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={locked}
                      value={formatNumberDisplay(getEditValue(item, 'insentif'))}
                      onChange={(e) => setEditValue(item.id, 'insentif', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={locked}
                      value={formatNumberDisplay(getEditValue(item, 'kompensasi'))}
                      onChange={(e) => setEditValue(item.id, 'kompensasi', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.penalty)}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.pph21)}</td>
                  <td className="px-4 py-3 text-right text-black font-medium">{formatRupiah(item.take_home_pay)}</td>
                  <td className="px-4 py-3">
                    {item.payslip_id ? (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#DCFCE7] text-[#166534]">
                        SUDAH ADA
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#9A9A9A]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={locked || recalcSaving === item.id}
                      onClick={() => onRecalc(item)}
                      className="text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {recalcSaving === item.id ? 'Menghitung...' : 'Hitung Ulang'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
  );
}
