export type Category = 'FDE' | 'AIML';
export type Domain = 'AI_LAB' | 'AI_INFRA' | 'SEMI' | 'EMBEDDED' | 'IT' | 'FINTECH' | 'HEALTH' | 'DEFENSE' | 'CONSULTING' | 'OTHER';

export interface RawJob {
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string | null; // ISO
  description?: string;
  salary?: string;
  remote?: boolean;
  via?: string; // original platform (e.g. "Naukri" when found through Google Jobs)
}

export interface Job extends RawJob {
  id: string;
  sources: string[];
  categories: Category[]; // role: FDE and/or AI/ML (only these are kept)
  domain: Domain; // company industry: semiconductor, embedded, IT…
  seniority: 'junior' | 'mid' | 'senior';
  hidden: boolean; // low-crowd: not from LinkedIn/aggregators and not a big brand
  locTags: string[]; // BLR, INDIA, USA, REMOTE, REMOTE_IN (India-eligible remote), GLOBAL
  score: number;
  cvMatch: number;
  firstSeen: string;
  lastSeen: string;
}

export interface SourceContext {
  keywords: string[];
  locations: string[];
  settings: Settings;
  signal: AbortSignal;
}

export interface SourceDef {
  id: string;
  name: string;
  group: 'ATS (company careers)' | 'Big Tech careers' | 'Job boards' | 'Community & social' | 'Aggregators (API key)' | 'Social (API key)';
  keyless: boolean;
  envKeys: string[]; // all must be present unless keyless
  optionalEnv?: string[]; // improves the source but not required
  defaultIntervalMin: number; // cooldown between runs
  covers: string; // which platforms it covers
  docs: string; // where to get the key
  run: (ctx: SourceContext) => Promise<RawJob[]>;
}

export interface SourceHealth {
  id: string;
  ok: boolean;
  lastRun: string | null;
  lastSuccess: string | null;
  count: number;
  relevant: number;
  ms: number;
  error?: string;
  skipped?: string;
}

export type TrackStatus = 'saved' | 'applied' | 'referral' | 'interview' | 'offer' | 'rejected' | 'ignored';

export interface TrackEntry {
  status: TrackStatus;
  notes?: string;
  updatedAt: string;
  job: Pick<Job, 'id' | 'title' | 'company' | 'location' | 'url' | 'sources' | 'categories' | 'postedAt'> & { domain?: Domain };
}

export interface CompanyEntry {
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'workday';
  slug: string; // workday: tenant|wdN|site
  name: string;
  tag?: 'semi' | 'embedded' | 'frontier' | 'india' | 'infra' | 'fde';
}

export interface Settings {
  keywords: string[];
  locations: string[];
  extraCompanies: CompanyEntry[];
  disabledCompanies: string[]; // "ats:slug"
  disabledSources: string[];
  telegramChannels: string[];
  subreddits: string[];
  alertMinScore: number;
  excludeTitleWords: string[];
  digestCount: number; // jobs per daily email
  digestMaxAgeHours: number; // only jobs posted within this window
}

export interface CvVersion {
  pathname: string;
  name: string;
  size: number;
  uploadedAt: string;
  contentType: string;
}

export interface CvState {
  versions: CvVersion[];
  active: string | null; // pathname
  text: string;
  skills: string[];
}
