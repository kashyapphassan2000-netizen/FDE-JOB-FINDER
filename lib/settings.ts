import type { Settings } from './types';
import { getJSON, setJSON } from './store';

export const DEFAULT_SETTINGS: Settings = {
  keywords: [
    'forward deployed engineer',
    'applied AI engineer',
    'AI engineer',
    'machine learning engineer',
    'MLOps engineer',
    'embedded AI engineer',
    'edge AI engineer',
    'AI solutions engineer',
  ],
  locations: ['India', 'Bengaluru', 'Remote'],
  extraCompanies: [],
  disabledCompanies: [],
  disabledSources: [],
  telegramChannels: ['AiIndiaJobs'],
  subreddits: ['MLjobs', 'DataScienceJobs', 'developersIndia', 'mlops', 'forhire'],
  alertMinScore: 60,
  excludeTitleWords: ['intern', 'internship', 'account executive', 'sales development', 'recruiter', 'paralegal', 'nurse'],
};

export async function getSettings(): Promise<Settings> {
  const s = await getJSON<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next: Settings = { ...cur, ...patch };
  // sanitize
  next.keywords = (next.keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 20);
  next.locations = (next.locations || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 8);
  next.telegramChannels = (next.telegramChannels || []).map((k) => String(k).replace(/^@|https?:\/\/t\.me\/(s\/)?/g, '').trim()).filter(Boolean).slice(0, 15);
  next.subreddits = (next.subreddits || []).map((k) => String(k).replace(/^r\//, '').trim()).filter(Boolean).slice(0, 15);
  next.alertMinScore = Math.max(0, Math.min(150, Number(next.alertMinScore) || 60));
  await setJSON('settings', next);
  return next;
}
