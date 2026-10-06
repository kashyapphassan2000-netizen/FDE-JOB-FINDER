/** Where a job / post came from, in plain words — used for the "Source" filter everywhere. Pure (client + server). */
export const SOURCE_TYPES = ['Company website', 'Community', 'Job board', 'Web / other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number] | 'LinkedIn post' | 'X post';
export const SOURCE_ICON: Record<SourceType, string> = { 'Company website': '🏢', 'LinkedIn post': 'in', 'X post': '𝕏', Community: '👥', 'Job board': '📋', 'Web / other': '🌐' };

const ATS = /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|myworkdayjobs\.com|workday|recruitee\.com|bamboohr\.com|personio|teamtailor|jobvite|icims|successfactors|oraclecloud\.com|taleo|breezy\.hr|rippling|keka\.com|zohorecruit|darwinbox|freshteam|careers?\.|\/careers?\b|jobs\.[a-z0-9-]+\.(com|ai|io)|amazon\.jobs|careers\.microsoft|google\.com\/about\/careers|metacareers|apple\.com\/careers/i;
const BOARDS = /remotive|weworkremotely|himalayas|remoteok|wellfound|angel\.co|naukri|instahyre|indeed|glassdoor|foundit|monster|hirist|cutshort|unstop|internshala|jooble|adzuna|ziprecruiter|dice\.com|builtin|ycombinator\.com\/jobs|workatastartup|otta|welcometothejungle|80000hours|aijobs|hiring\.cafe|levels\.fyi|jobspresso|workingnomads|nodesk|remote\.co|flexjobs|euremotejobs|arc\.dev|turing\.com\/jobs|mercor/i;
const COMMUNITY = /news\.ycombinator\.com|reddit\.com|t\.me\/|telegram|indiehackers|discord|substack|dev\.to|hashnode|latent\.space|producthunt/i;
const BOARD_SOURCES = /^(remotive|wwr|weworkremotely|himalayas|remoteok|wellfound|jsearch|adzuna|jooble|themuse|unstop|naukri|instahyre|yc_jobs|hiringcafe|aijobs|80000|serpapi|google_jobs)/i;
const COMMUNITY_SOURCES = /^(hn|reddit|telegram|community)/i;
const COMPANY_SOURCES = /^(greenhouse|lever|ashby|workable|smartrecruiters|workday|careerpages|ats|amazon|microsoft|recruitee|company|careers)/i;

export function sourceType(url: string, sources: string[] = []): SourceType {
  const u = (url || '').toLowerCase();
  if (/(?:x|twitter)\.com\/[^/]+\/status\//.test(u)) return 'X post';
  if (/linkedin\.com\/(posts|feed\/update|pulse)\//.test(u)) return 'LinkedIn post';
  if (COMMUNITY.test(u) || sources.some((s) => COMMUNITY_SOURCES.test(s))) return 'Community';
  if (BOARDS.test(u)) return 'Job board';
  if (ATS.test(u) || sources.some((s) => COMPANY_SOURCES.test(s))) return 'Company website';
  if (sources.some((s) => BOARD_SOURCES.test(s))) return 'Job board';
  return 'Web / other';
}

/** Friendly names for the job-feed source ids. */
export const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse (company boards)', lever: 'Lever (company boards)', ashby: 'Ashby (company boards)', workable: 'Workable (company boards)',
  smartrecruiters: 'SmartRecruiters (company boards)', workday: 'Workday (company boards)', careerpages: 'Company career pages', amazon: 'Amazon jobs', microsoft: 'Microsoft careers',
  jpmc: 'JPMorgan careers', yc_jobs: 'Y Combinator / Work at a Startup', instahyre: 'Instahyre', remotive: 'Remotive', remoteok: 'Remote OK', himalayas: 'Himalayas', jobicy: 'Jobicy',
  themuse: 'The Muse', weworkremotely: 'We Work Remotely', hn: 'Hacker News (Who is hiring)', reddit: 'Reddit', telegram: 'Telegram channels', unstop: 'Unstop', mercor: 'Mercor',
  eightyk: '80,000 Hours', internshala: 'Internshala', jsearch: 'JSearch (Google Jobs)', serpapi: 'Google Jobs (SerpApi)', adzuna: 'Adzuna', jooble: 'Jooble', capture: 'Captured by you', watch: 'Watched companies',
};
export const sourceLabel = (id: string) => SOURCE_LABEL[id] || SOURCE_LABEL[id.split(':')[0]] || id.replace(/^agent:/, 'Agent: ').replace(/_/g, ' ');

const ATS_HOST: [RegExp, string][] = [
  [/greenhouse\.io/, 'Greenhouse (company boards)'], [/lever\.co/, 'Lever (company boards)'], [/ashbyhq\.com/, 'Ashby (company boards)'], [/workable\.com/, 'Workable (company boards)'],
  [/smartrecruiters\.com/, 'SmartRecruiters (company boards)'], [/myworkdayjobs\.com|workday/, 'Workday (company boards)'], [/oraclecloud\.com/, 'Oracle HCM (company boards)'],
  [/amazon\.jobs/, 'Amazon jobs'], [/careers\.microsoft|jobs\.careers\.microsoft/, 'Microsoft careers'], [/news\.ycombinator\.com|hn\.algolia/, 'Hacker News (Who is hiring)'],
  [/reddit\.com/, 'Reddit'], [/t\.me\//, 'Telegram channels'], [/ycombinator\.com|workatastartup\.com/, 'Y Combinator / Work at a Startup'],
];
/** The source name(s) of any item on any page: its feed source ids if known, else the job board / company site it links to. */
export function srcKeys(url: string, sources?: string[]): string[] {
  if (sources?.length) return Array.from(new Set(sources.map(sourceLabel)));
  const u = (url || '').toLowerCase();
  for (const [rx, l] of ATS_HOST) if (rx.test(u)) return [l];
  try { return [new URL(url).hostname.replace(/^www\./, '')]; } catch { return []; }
}
