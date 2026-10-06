import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Multi-user isolation. Every authenticated request runs "as" its user (tenant). The owner keeps the original data;
 * every other user gets their OWN copy of personal data (CV, tracker, job-role priorities, analyses, referrals,
 * watched companies, agent searches, outreach, Excel progress …) under `u:{email}:` keys — they never see the owner's.
 * Shared market data (job feed, trends, layoffs, hiring radar, companies directory, careers index) stays shared, read-only.
 * Cron / background work must say who it runs as (isCron → owner, runAs(user) for a user's agents / brief).
 * With no user set, personal keys resolve to an empty namespace (fail-closed), so a bug can never leak the owner's data.
 */
export interface Tenant { ns: string; email: string; role: 'owner' | 'member' }
const als = new AsyncLocalStorage<Tenant>();
export const OWNER: Tenant = { ns: 'owner', email: 'owner', role: 'owner' };
/** FAIL-CLOSED: code running with no known user sees an empty personal namespace — never the owner's data. */
const NOBODY: Tenant = { ns: '_nobody', email: '', role: 'member' };

export function tenant(): Tenant { return als.getStore() || NOBODY; }
export const isMember = () => tenant().role === 'member';
/** Called by the auth check of every request (sets the user for the rest of that request). */
export function enterTenant(t: Tenant) { als.enterWith(t); }
/** Run background work as a specific user (their scheduled agents, their daily brief). */
export function runAs<T>(t: Tenant, fn: () => Promise<T>): Promise<T> { return als.run(t, fn); }
export type { Tenant as TenantT };
export function tenantFor(email: string, ownerEmails: string[]): Tenant {
  const e = email.toLowerCase();
  if (e === 'owner' || ownerEmails.includes(e)) return OWNER;
  return { ns: e.replace(/[^a-z0-9@._-]/g, ''), email: e, role: 'member' };
}

/** Personal data keys: each user has their own. Everything else is shared. */
const PERSONAL = new Set(['cv', 'track', 'profile', 'analyses', 'referrals', 'fit', 'xl', 'outreach:leads', 'agent:finds', 'agent:runs', 'watch:list', 'watch:hits', 'watch:meta', 'watch:migrated', 'sem', 'semvec', 'sem:meta', 'drafts', 'gap:reports', 'notes', 'apply:kits', 'apply:profile', 'reach', 'pw:config', 'pw:posts', 'pw:contacts', 'pw:meta', 'pw:sent']);
const PERSONAL_PREFIX = ['watch:seen:'];
export function scopedKey(key: string): string {
  const t = tenant();
  if (t.ns === 'owner') return key;
  if (PERSONAL.has(key) || PERSONAL_PREFIX.some((p) => key.startsWith(p))) return `u:${t.ns}:${key}`;
  return key;
}
