import type { Job, RawJob, SourceHealth } from './types';
import { SOURCES, intervalFor, sourceConfigured } from './sources';
import { getSettings } from './settings';
import { acquireLock, getJSON, hgetall, releaseLock, setJSON } from './store';
import { baseScore, classify, experienceOf, jobFlags, locationAllowed, payBand, cvMatchScore, dedupeKey, domainOf, freshnessHours, hashId, isExcluded, isHiddenGem, locationTags, seniorityOf } from './classify';
import { getCv } from './cv';
import { sendAlert } from './notify';
import { loadVault } from './secrets';
import { saveTrendSnapshot } from './trends';
import { recordDirectory, recordGlobal } from './directory';

const MAX_JOBS = 2500;
const KEEP_DAYS = 5; // not seen on its board for 5 days → treated as closed and removed
const MAX_POSTED_DAYS = 60; // fresh only: roles posted more than 60 days ago are dropped
const SOURCE_TIMEOUT_MS = 90000;

export interface RefreshMeta {
  lastRefresh: string | null;
  trigger: string;
  ms: number;
  added: number;
  total: number;
  ran: string[];
  skipped: string[];
  failed: string[];
}

export async function getJobs(): Promise<Job[]> {
  const jobs = await getJSON<Job[]>('jobs', []);
  // Local UI testing only: seed from a fixture file when the store is empty (never used on Vercel).
  if (!jobs.length && process.env.FJ_SEED_FILE && !process.env.VERCEL) {
    const fs = await import('node:fs');
    return JSON.parse(fs.readFileSync(process.env.FJ_SEED_FILE, 'utf8')) as Job[];
  }
  return jobs;
}

export async function getHealth(): Promise<Record<string, SourceHealth>> {
  return getJSON<Record<string, SourceHealth>>('health', {});
}

export async function getMeta(): Promise<RefreshMeta | null> {
  return getJSON<RefreshMeta | null>('meta', null);
}

function valid(j: RawJob): boolean {
  return Boolean(j && j.title && j.url && /^https?:\/\//.test(j.url));
}

/** Recomputes every derived field, so classification rule changes apply to already-stored jobs too. */
export function rescore(job: Job, cvSkills: string[]): Job {
  const categories = classify(job);
  const locTags = locationTags(job);
  const hidden = isHiddenGem(job);
  const hours = freshnessHours(job.postedAt, job.firstSeen);
  const cvMatch = cvMatchScore(job, cvSkills);
  return {
    ...job,
    categories,
    locTags,
    hidden,
    domain: domainOf(job),
    seniority: seniorityOf(job.title),
    cvMatch,
    score: baseScore(categories, locTags, hours, hidden) + Math.round(cvMatch * 0.3) - (jobFlags(job).some((f) => f.startsWith('⚠')) ? 40 : 0),
    flags: jobFlags(job),
    exp: experienceOf(job.title, job.description || '', seniorityOf(job.title)),
    payBand: payBand({ ...job, categories, locTags, domain: domainOf(job), seniority: seniorityOf(job.title) }),
  };
}

export async function refresh(opts: { only?: string[]; force?: boolean; trigger: string }): Promise<RefreshMeta & { health: Record<string, SourceHealth> }> {
  const t0 = Date.now();
  const lockName = opts.only?.length === 1 ? `refresh:${opts.only[0]}` : 'refresh';
  if (!(await acquireLock(lockName, 120))) throw new Error('A refresh is already running – try again in a minute.');
  try {
    await loadVault();
    const [settings, health, existing, cv, tracked] = await Promise.all([getSettings(), getHealth(), getJobs(), getCv(), hgetall<unknown>('track')]);
    const nowIso = new Date().toISOString();
    const ctxBase = { keywords: settings.keywords, locations: settings.locations, settings };
    const targets = SOURCES.filter((s) => !opts.only || opts.only.includes(s.id));
    const ran: string[] = [], skipped: string[] = [], failed: string[] = [];

    const globalSeen: RawJob[] = [];
    const results = await Promise.all(
      targets.map(async (s) => {
        const prev = health[s.id];
        const base: SourceHealth = prev || { id: s.id, ok: false, lastRun: null, lastSuccess: null, count: 0, relevant: 0, ms: 0 };
        if (settings.disabledSources.includes(s.id) && !opts.only) {
          skipped.push(s.id);
          health[s.id] = { ...base, skipped: 'Disabled in Settings' };
          return [] as RawJob[];
        }
        if (!sourceConfigured(s)) {
          skipped.push(s.id);
          health[s.id] = { ...base, ok: false, skipped: `Add env var(s): ${s.envKeys.join(', ')}` };
          return [];
        }
        const iv = intervalFor(s);
        if (!opts.force && iv > 0 && prev?.lastRun && Date.now() - Date.parse(prev.lastRun) < iv * 60000) {
          skipped.push(s.id);
          health[s.id] = { ...base, skipped: `Cooldown (${iv} min) to protect free quota – next run after ${new Date(Date.parse(prev.lastRun) + iv * 60000).toISOString()}` };
          return [];
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SOURCE_TIMEOUT_MS);
        const st = Date.now();
        try {
          const raw = await s.run({ ...ctxBase, signal: ctrl.signal });
          const warnings = (raw as RawJob[] & { warnings?: string[] }).warnings;
          const rel = raw.filter((j) => valid(j) && !isExcluded(j, settings) && classify(j).length > 0);
          globalSeen.push(...rel); // every FDE / AI role anywhere in the world (before your location rule) → Companies hiring
          ran.push(s.id);
          health[s.id] = {
            id: s.id,
            ok: true,
            lastRun: nowIso,
            lastSuccess: nowIso,
            count: raw.length,
            relevant: rel.length,
            ms: Date.now() - st,
            error: warnings?.length ? `${warnings.length} partial failure(s): ${warnings.slice(0, 3).join(' · ')}` : undefined,
          };
          return rel.map((j) => ({ ...j, __src: s.id }));
        } catch (e) {
          failed.push(s.id);
          health[s.id] = { ...base, ok: false, lastRun: nowIso, ms: Date.now() - st, error: ctrl.signal.aborted ? `Timed out after ${SOURCE_TIMEOUT_MS / 1000}s` : (e as Error).message?.slice(0, 400) };
          return [];
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    await recordGlobal(globalSeen).catch(() => null);

    // ---- merge ----
    const byId = new Map<string, Job>(existing.map((j) => [j.id, j]));
    const firstRun = existing.length === 0;
    const added: Job[] = [];
    for (const raw of results.flat() as (RawJob & { __src: string })[]) {
      const id = hashId(dedupeKey(raw));
      const cur = byId.get(id);
      if (cur) {
        cur.lastSeen = nowIso;
        if (!cur.sources.includes(raw.__src)) cur.sources.push(raw.__src);
        if (!cur.postedAt && raw.postedAt) cur.postedAt = raw.postedAt;
        if (!cur.description && raw.description) cur.description = raw.description.slice(0, 400);
        if (!cur.salary && raw.salary) cur.salary = raw.salary;
        continue;
      }
      const { __src, ...r } = raw;
      const job: Job = {
        ...r,
        title: r.title.trim().slice(0, 200),
        company: (r.company || '').trim().slice(0, 120),
        location: (r.location || '').trim().slice(0, 160),
        description: (r.description || '').slice(0, 400),
        id,
        sources: [__src],
        categories: classify(r),
        locTags: locationTags(r),
        domain: domainOf(r),
        seniority: seniorityOf(r.title),
        hidden: false,
        score: 0,
        cvMatch: 0,
        firstSeen: nowIso,
        lastSeen: nowIso,
      };
      byId.set(id, job);
      added.push(job);
    }

    // ---- rescore, prune, cap ----
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    let jobs = [...byId.values()]
      .filter((j) => Date.parse(j.lastSeen) >= cutoff || tracked[j.id])
      .filter((j) => !j.postedAt || Date.now() - Date.parse(j.postedAt) < MAX_POSTED_DAYS * 864e5 || tracked[j.id])
      .map((j) => rescore(j, cv.skills))
      .filter((j) => j.categories.length > 0 || tracked[j.id]) // only FDE + AI/ML roles are kept
      .filter((j) => locationAllowed(j.locTags, j.location) || tracked[j.id]); // only Bengaluru office or India-eligible remote
    jobs.sort((a, b) => b.score - a.score || Date.parse(b.postedAt || b.firstSeen) - Date.parse(a.postedAt || a.firstSeen));
    jobs = jobs.slice(0, MAX_JOBS);
    const kept = new Set(jobs.map((j) => j.id));

    const meta: RefreshMeta = {
      lastRefresh: nowIso,
      trigger: opts.trigger,
      ms: Date.now() - t0,
      added: added.filter((j) => kept.has(j.id)).length,
      total: jobs.length,
      ran,
      skipped,
      failed,
    };
    await Promise.all([setJSON('jobs', jobs), setJSON('health', health), setJSON('meta', meta), saveTrendSnapshot(jobs).catch(() => null), recordDirectory(jobs).catch(() => null)]);

    // ---- alerts (skip the very first fill to avoid a flood) ----
    if (!firstRun) {
      const hot = jobs.filter((j) => added.some((a) => a.id === j.id) && j.score >= settings.alertMinScore);
      if (hot.length) await sendAlert(hot, 'New FDE / AI jobs');
    }
    return { ...meta, health };
  } finally {
    await releaseLock(lockName);
  }
}

/** Adds jobs from outside the refresh cycle (browser capture) to your list; returns how many were new and kept. */
export async function addExternalJobs(raws: RawJob[], source: string): Promise<number> {
  if (!raws.length) return 0;
  const [existing, cv, settings] = await Promise.all([getJobs(), getCv(), getSettings()]);
  const byId = new Map(existing.map((j) => [j.id, j]));
  const nowIso = new Date().toISOString();
  let added = 0;
  for (const r of raws.filter(valid)) {
    if (isExcluded(r, settings)) continue;
    const id = hashId(dedupeKey(r));
    const cur = byId.get(id);
    if (cur) {
      cur.lastSeen = nowIso;
      if (!cur.sources.includes(source)) cur.sources.push(source);
      continue;
    }
    const job = rescore({ ...r, title: r.title.trim().slice(0, 200), company: (r.company || '').trim().slice(0, 120), location: (r.location || '').trim().slice(0, 160), description: (r.description || '').slice(0, 400), id, sources: [source], categories: [], locTags: [], domain: 'OTHER', seniority: 'mid', hidden: false, score: 0, cvMatch: 0, firstSeen: nowIso, lastSeen: nowIso }, cv.skills);
    if (!job.categories.length || !locationAllowed(job.locTags, job.location)) continue;
    byId.set(id, job);
    added++;
  }
  const jobs = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, MAX_JOBS);
  await setJSON('jobs', jobs);
  return added;
}
