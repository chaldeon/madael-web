// Helper generik untuk export data (array of objects) jadi file CSV yang
// didownload langsung dari browser — tanpa perlu endpoint server, jadi bisa
// dipakai di halaman mana saja yang sudah punya datanya di state (Reports,
// Statistics, dan modul lain ke depannya).

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// headers: [{ key, label }]. rows: array of object (dibaca lewat header.key).
export function buildCsv(headers, rows) {
  const headerLine = headers.map((h) => escapeCsvValue(h.label)).join(',');
  const lines = (rows || []).map((row) => headers.map((h) => escapeCsvValue(row[h.key])).join(','));
  // \uFEFF (BOM) di depan supaya Excel di Windows baca karakter non-ASCII
  // (mis. "Rp", huruf beraksen) dengan benar — tanpa ini sering muncul mojibake.
  return '\uFEFF' + [headerLine, ...lines].join('\r\n');
}

export function downloadCsv(filename, headers, rows) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}