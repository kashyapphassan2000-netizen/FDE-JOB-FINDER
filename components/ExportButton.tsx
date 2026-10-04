'use client';
import { useState } from 'react';

export type Col<T> = { header: string; get: (r: T) => string | number | null | undefined; width?: number; link?: (r: T) => string | undefined };
export type Section = { title: string; text?: string; rows?: string[][]; headers?: string[] };

export type PdfOpts<T> = { title: string; subtitle?: string; cols?: Col<T>[]; rows?: T[]; sections?: Section[]; filename?: string; tableFirst?: boolean };
const fileName = (f: string) => f.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + `-${new Date().toISOString().slice(0, 10)}`;
// jsPDF's built-in font only has Latin characters: map the few symbols we use, drop the rest (emoji etc.)
const clean = (v: unknown) => String(v ?? '').replace(/₹/g, 'Rs ').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '').slice(0, 600);

/** Real PDF download (jsPDF): title band, filters line, text sections, tables with clickable links, page numbers. */
export async function makePdf<T>({ title, subtitle, cols, rows, sections, filename, tableFirst }: PdfOpts<T>) {
  const name = fileName(filename || title);
  {
    {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      doc.setFillColor(91, 76, 240);
      doc.rect(0, 0, W, 54, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text(clean(title), 32, 32);
      doc.setFontSize(9);
      doc.text(`FDE Job Finder · exported ${new Date().toLocaleString('en-IN')}${rows ? ` · ${rows.length} rows` : ''}`, 32, 46);
      doc.setTextColor(30, 30, 40);
      let y = 72;
      if (subtitle) { doc.setFontSize(9); const t = doc.splitTextToSize(clean(subtitle), W - 64); doc.text(t, 32, y); y += t.length * 11 + 6; }
      const drawSections = () => {
      for (const s of sections || []) {
        if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 40; }
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(clean(s.title), 32, y); doc.setFont('helvetica', 'normal'); y += 14;
        if (s.text) { doc.setFontSize(9); const t = doc.splitTextToSize(clean(s.text), W - 64); doc.text(t, 32, y); y += t.length * 11 + 8; }
        if (s.rows?.length) {
          const raw = s.rows;
          const isUrl = (v: string) => /^https?:\/\//.test(v || '');
          autoTable(doc, {
            startY: y, head: s.headers ? [s.headers.map(clean)] : undefined,
            body: raw.map((r) => r.map((v) => (isUrl(v) ? (() => { try { return new URL(v).hostname.replace(/^www\./, '') ; } catch { return 'open'; } })() : clean(v)))),
            styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: [91, 76, 240] }, alternateRowStyles: { fillColor: [245, 246, 251] }, margin: { left: 32, right: 32 },
            didParseCell: (h) => { if (h.section === 'body' && isUrl(raw[h.row.index]?.[h.column.index])) h.cell.styles.textColor = [79, 70, 229]; },
            didDrawCell: (h) => { const v = h.section === 'body' ? raw[h.row.index]?.[h.column.index] : ''; if (isUrl(v)) doc.link(h.cell.x, h.cell.y, h.cell.width, h.cell.height, { url: v }); },
          });
          y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
        }
      }
      };
      const drawTable = () => {
      if (cols && rows?.length) {
        const links: (string | undefined)[][] = rows.map((r) => cols.map((c) => c.link?.(r)));
        autoTable(doc, {
          startY: y,
          head: [cols.map((c) => c.header)],
          body: rows.map((r) => cols.map((c) => clean(c.get(r)))),
          styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
          headStyles: { fillColor: [91, 76, 240], textColor: 255 },
          alternateRowStyles: { fillColor: [245, 246, 251] },
          columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.width ? { cellWidth: c.width } : {}])),
          margin: { left: 32, right: 32 },
          didParseCell: (h) => { if (h.section === 'body' && links[h.row.index]?.[h.column.index]) h.cell.styles.textColor = [79, 70, 229]; },
          didDrawCell: (h) => {
            const l = h.section === 'body' ? links[h.row.index]?.[h.column.index] : undefined;
            if (l) doc.link(h.cell.x, h.cell.y, h.cell.width, h.cell.height, { url: l });
          },
        });
        y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
      }
      };
      if (tableFirst) { drawTable(); drawSections(); } else { drawSections(); drawTable(); }
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`${i} / ${pages}`, W - 60, doc.internal.pageSize.getHeight() - 16); }
      doc.save(`${name}.pdf`);
    }
  }
}

export default function ExportButton<T>({ title, subtitle, cols, rows, sections, filename, tableFirst }: PdfOpts<T>) {
  const [busy, setBusy] = useState(false);
  const name = fileName(filename || title);
  async function pdf() {
    setBusy(true);
    try {
      await makePdf({ title, subtitle, cols, rows, sections, filename, tableFirst });
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    if (!cols || !rows) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = [cols.map((c) => esc(c.header)).join(','), ...rows.map((r) => cols.map((c) => esc(c.link?.(r) && c.header.toLowerCase().includes('link') ? c.link(r) : c.get(r))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    a.download = `${name}.csv`;
    a.click();
  }

  return (
    <span className="row" style={{ gap: 4 }}>
      <button className="small-btn" disabled={busy || (!rows?.length && !sections?.length)} onClick={pdf} title="Download as PDF">{busy ? 'Building PDF…' : '⬇ PDF'}</button>
      {cols && <button className="small-btn" disabled={!rows?.length} onClick={csv} title="Download as CSV (Excel)">⬇ CSV</button>}
    </span>
  );
}
