'use client';
import { useState } from 'react';
import type { TrackEntry, TrackStatus } from '@/lib/types';
import { ago, setTrack, STATUS_LABEL, type JobsPayload } from './api';
import ExportButton from './ExportButton';

const ORDER: TrackStatus[] = ['saved', 'applied', 'referral', 'interview', 'offer', 'rejected', 'ignored'];

export default function TrackerTab({ data, reload, toast }: { data: JobsPayload | null; reload: () => void; toast: (s: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const entries = Object.values(data?.track || {}) as TrackEntry[];

  async function update(e: TrackEntry, status: TrackStatus | 'none', n?: string) {
    try {
      await setTrack(e.job, status, n ?? e.notes);
      reload();
      setEditing(null);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted">{entries.length} tracked applications · pipeline persists in Redis even after jobs expire from boards.</span>
        <span className="grow" />
        <ExportButton title="Application tracker" subtitle={ORDER.map((st) => `${STATUS_LABEL[st]}: ${entries.filter((e) => e.status === st).length}`).join(' · ')} filename="tracker"
          cols={[{ header: 'Status', get: (e: TrackEntry) => STATUS_LABEL[e.status], width: 70 }, { header: 'Role', get: (e) => e.job.title, link: (e) => e.job.url }, { header: 'Company', get: (e) => e.job.company, width: 90 },
            { header: 'Location', get: (e) => e.job.location, width: 90 }, { header: 'Updated', get: (e) => new Date(e.updatedAt).toLocaleDateString('en-IN'), width: 55 }, { header: 'Notes', get: (e) => e.notes || '', width: 150 }]}
          rows={[...entries].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt))} />
      </div>
      <div className="kanban">
        {ORDER.map((st) => {
          const list = entries.filter((e) => e.status === st).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return (
            <div key={st}>
              <h3 style={{ margin: '4px 0 8px', fontSize: 14 }}>{STATUS_LABEL[st]} <span className="muted">({list.length})</span></h3>
              {list.map((e) => (
                <div className="card" key={e.job.id}>
                  <h4><a href={e.job.url} target="_blank" rel="noreferrer noopener">{e.job.title}</a></h4>
                  <div className="small">{e.job.company} · <span className="muted">{e.job.location}</span></div>
                  <div className="small muted">updated {ago(e.updatedAt)} ago · {e.job.sources.join(', ')}</div>
                  {editing === e.job.id ? (
                    <>
                      <textarea value={notes} onChange={(x) => setNotes(x.target.value)} placeholder="Referral contact, interview date, salary discussed…" />
                      <div className="row"><button className="primary" onClick={() => update(e, e.status, notes)}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></div>
                    </>
                  ) : (
                    e.notes && <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{e.notes}</div>
                  )}
                  <div className="row" style={{ marginTop: 6 }}>
                    <select value={e.status} onChange={(x) => update(e, x.target.value as TrackStatus)}>
                      {ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                    <button onClick={() => { setEditing(e.job.id); setNotes(e.notes || ''); }}>Notes</button>
                    <button className="danger" onClick={() => update(e, 'none')}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
