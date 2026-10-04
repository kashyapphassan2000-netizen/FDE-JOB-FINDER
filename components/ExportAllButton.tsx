'use client';
import { useState } from 'react';
import { api } from './api';
import { makePdf, type Section } from './ExportButton';

/** One click → one PDF with every page: jobs, every agent tab, trends, hiring radar, layoffs, hidden startups, opportunities, tracker, outreach. */
export default function ExportAllButton({ toast }: { toast: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    toast('Collecting every page for the PDF…');
    try {
      const d = await api<{ generatedAt: string; sections: Section[] }>('/api/export-all');
      await makePdf({ title: 'FDE Job Finder — everything', subtitle: `All pages: ${d.sections.map((s) => s.title.replace(/\s*\(.*$/, '')).join(' · ')}`, sections: d.sections, filename: 'fde-job-finder-everything' });
      toast(`PDF ready — ${d.sections.length} sections`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <button disabled={busy} onClick={run} title="Download one PDF with the data of every page">{busy ? "Building PDF…" : "⬇ Export all"}</button>;
}
