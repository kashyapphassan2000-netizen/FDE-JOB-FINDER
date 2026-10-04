import type React from 'react';
import type { Job, TrackEntry, TrackStatus } from '@/lib/types';
import type { RefreshMeta } from '@/lib/refresh';

export type JobsPayload = {
  jobs: Job[];
  meta: RefreshMeta | null;
  track: Record<string, TrackEntry>;
  storeMode: 'redis' | 'memory';
  sourcesOk: number;
};

export async function api<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...(init.headers || {}) } : init.headers,
  });
  if (r.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d as T;
}

export const STATUS_LABEL: Record<TrackStatus, string> = {
  saved: '⭐ Saved',
  applied: '📨 Applied',
  referral: '🤝 Referral asked',
  interview: '🎤 Interview',
  offer: '🏆 Offer',
  rejected: '✖ Rejected',
  ignored: '🙈 Ignored',
};

export function ago(iso?: string | null): string {
  if (!iso) return '—';
  const h = (Date.now() - Date.parse(iso)) / 36e5;
  if (Number.isNaN(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export async function setTrack(job: Job | TrackEntry['job'], status: TrackStatus | 'none', notes?: string) {
  return api('/api/track', { method: 'POST', body: JSON.stringify({ job, status, notes }) });
}

export function linkify(text: string): React.ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>
    ) : (
      p
    ),
  );
}
