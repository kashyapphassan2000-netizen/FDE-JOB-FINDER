import type { Category, Domain, RawJob, Settings } from './types';
import { COMPANY_TAG } from './companies';

/**
 * ROLE filter (what you want): only FDE and AI/ML roles.
 * DOMAIN tag (where): the company's industry — semiconductor, embedded/robotics/auto, IT/SaaS, fintech, …
 * A firmware or RTL job with no AI in it is NOT kept; an "Edge AI engineer" at Bosch is kept with domain EMBEDDED.
 */
const RX = {
  FDE: /forward[\s-]*deploy|\bfde\b|deployment strateg|deployed (ai |software )?engineer|applied ai (engineer|architect|specialist|lead)|ai deployment|agent deployment|(ai|ml|llm|genai|agent|model) deployment engineer|(solutions?|customer|field|implementation|sales|forward) (engineer|architect)[^,]{0,25}\b(ai|ml|llm|genai|gen ai|agents?)\b|\b(ai|ml|llm|genai|gen ai|agentic)\b[^,]{0,25}(solutions?|customer|field|implementation) (engineer|architect)|founding (ai|ml|llm|genai|agents?) engineer|founding engineer[^,]{0,30}\b(ai|ml|llm|agents?|genai)\b|technical (deployment|success) (engineer|lead)/i,
  AIML: /machine learning|\bml\b|\bai\b|\ba\.i\.|artificial intelligence|\bllms?\b|genai|gen ai|generative|deep learning|neural|mlops|ml ?ops|ml platform|ai platform|applied scientist|(ai|ml) research|\bnlp\b|computer vision|\bcv engineer|data scientist|agentic|\bagents?\b engineer|\brag\b|inference|model (training|serving|optimization)|perception|speech|conversational|recommendation|ranking|tinyml|edge ai|on-device ai|tensorrt|ml compiler|ai compiler|ai accelerator/i,
  TECH: /engineer|scientist|developer|architect|researcher|specialist|\blead\b|mlops|programmer|\bsde\b|\bmts\b|member of technical|consultant|strategist/i,
};

export const DOMAIN_LABEL: Record<Domain, string> = {
  AI_LAB: 'Frontier AI lab', AI_INFRA: 'AI infra / devtools', SEMI: 'Semiconductor / AI silicon', EMBEDDED: 'Embedded / Robotics / Auto',
  IT: 'IT / SaaS / Software', FINTECH: 'Fintech', HEALTH: 'Healthcare / Bio', DEFENSE: 'Defense / Aerospace', CONSULTING: 'Consulting / Services', OTHER: 'Other',
};

const DOM_RX: [Domain, RegExp][] = [
  ['SEMI', /semiconductor|silicon|\basic\b|\bsoc\b|\bvlsi\b|\bfpga\b|\bchips?\b|chipmaker|\bnpu\b|wafer|foundry|\beda\b|\brtl\b|tape-?out/i],
  ['EMBEDDED', /embedded|firmware|edge ai|tinyml|on-device|autosar|rtos|robot|autonom|adas|automotive|vehicle|drone|\buav\b|\biot\b|sensor|mechatronic|lidar|\bev\b|electric vehicle/i],
  ['DEFENSE', /defen[cs]e|military|aerospace|national security|mission systems/i],
  ['HEALTH', /health|medical|clinical|hospital|pharma|biotech|bio\b|radiology|patient/i],
  ['FINTECH', /fintech|bank|payments?|lending|insurance|trading|capital markets|wealth|credit|upi/i],
  ['CONSULTING', /consult|services|deloitte|accenture|infosys|tcs|wipro|cognizant|capgemini|pwc|ey\b|kpmg/i],
];
const TAG_TO_DOMAIN: Record<string, Domain> = { semi: 'SEMI', embedded: 'EMBEDDED', frontier: 'AI_LAB', infra: 'AI_INFRA' };
const BIG = /openai|anthropic|deepmind|tata consultancy|\btcs\b|infosys|wipro|\bhcl|tech mahindra|accenture|cognizant|capgemini|deloitte|ltimindtree|amazon|microsoft|google|nvidia|intel|samsung|salesforce|adobe|cisco|ibm|oracle|meta|apple|qualcomm|micron|walmart|target|paypal|mastercard|hitachi|philips|bosch|continental|servicenow|snowflake|databricks|stripe|coinbase|thomson reuters|autodesk|workday|equinix|ge healthcare|hp\b|broadcom|marvell|cadence|kla|analog devices|nxp|harman|western digital/i;

export function classify(job: RawJob): Category[] {
  const title = job.title || '';
  const desc = (job.description || '').slice(0, 1500);
  const cats: Category[] = [];
  if (RX.FDE.test(title)) cats.push('FDE');
  else if (/forward[\s-]*deployed/i.test(desc) && RX.TECH.test(title)) cats.push('FDE');
  if (RX.AIML.test(title) && (RX.TECH.test(title) || cats.includes('FDE'))) cats.push('AIML');
  return cats;
}

export function domainOf(job: RawJob): Domain {
  const tag = COMPANY_TAG.get((job.company || '').toLowerCase());
  if (tag && TAG_TO_DOMAIN[tag]) return TAG_TO_DOMAIN[tag];
  const text = `${job.title} ${job.company} ${(job.description || '').slice(0, 600)}`;
  for (const [d, rx] of DOM_RX) if (rx.test(text)) return d;
  if (/anthropic|openai|deepmind|cohere|mistral|perplexity|xai\b/i.test(job.company || '')) return 'AI_LAB';
  return 'IT';
}

export function seniorityOf(title: string): 'junior' | 'mid' | 'senior' {
  if (/intern|junior|\bjr\b|graduate|entry|new grad|fresher|trainee|associate (ai|ml|software|data)|\bi\b$|\b1\b$/i.test(title)) return 'junior';
  if (/senior|\bsr\b|staff|principal|lead|head|director|manager|architect|\biii\b|\biv\b|distinguished/i.test(title)) return 'senior';
  return 'mid';
}

export function isHiddenGem(job: { company: string; sources: string[] }): boolean {
  const mainstream = job.sources.some((s) => ['linkedin', 'jsearch', 'serpapi', 'apify_linkedin', 'adzuna', 'jooble'].includes(s));
  return !mainstream && !BIG.test(job.company || '');
}

const INDIA = /india|bengaluru|bangalore|hyderabad|pune|chennai|gurgaon|gurugram|noida|mumbai|delhi|\bncr\b|kolkata|ahmedabad|kochi|trivandrum|coimbatore|mysore|mysuru|hassan|karnataka|telangana|maharashtra|tamil nadu|, in$|\bind\b/i;
const BLR = /bengaluru|bangalore|karnataka/i;
const REMOTE = /remote|anywhere|worldwide|distributed|work from home|wfh/i;
const USA = /united states|\busa\b|\bu\.s\.|remote \(us|\bus\b|, (ca|ny|wa|tx|ma|co|il|ga|nc|va|fl|or|pa|nj|az|ut|mn|oh|mi|md|dc)\b|san francisco|new york|nyc|seattle|austin|boston|bay area|palo alto|mountain view|sunnyvale|san jose|los angeles|chicago|denver|atlanta/i;
// Remote roles that people living in India can actually take
const REMOTE_OPEN = /worldwide|anywhere|global|apac|asia|india|international|emea.{0,10}apac|\bist\b|all countries|any country|work from anywhere/i;
const REMOTE_CLOSED = /us only|usa only|u\.s\. only|remote \(us|remote - us|remote, us|united states only|north america|canada|americas|europe only|\beu only|uk only|latam|must (be|reside) in the us|us-based/i;

export function locationTags(job: RawJob): string[] {
  const l = `${job.location || ''}`;
  const tags: string[] = [];
  const remote = Boolean(job.remote) || REMOTE.test(l);
  if (BLR.test(l)) tags.push('BLR');
  if (INDIA.test(l)) tags.push('INDIA');
  if (USA.test(l)) tags.push('USA');
  if (remote) {
    tags.push('REMOTE');
    if (tags.includes('INDIA') || (REMOTE_OPEN.test(l) && !REMOTE_CLOSED.test(l)) || (/^remote$/i.test(l.trim()) && !tags.includes('USA'))) tags.push('REMOTE_IN');
  }
  if (!l.trim() || /^\s*\d+\s+locations?\s*$/i.test(l)) tags.push('UNSTATED'); // Workday "3 Locations" etc.
  else if (!tags.length) tags.push('GLOBAL');
  return tags;
}

/**
 * YOUR LOCATION RULE: the only office you can go to is Bengaluru; everything else must be remote and open to India.
 * Kept: Bengaluru onsite/hybrid · remote roles India-based people can take · "India" with no city named (often Bengaluru) · no location stated.
 * Dropped: onsite anywhere else (Hyderabad, Pune, USA, Europe…) and remote roles locked to US/EU/UK etc.
 */
export function locationAllowed(tags: string[], location = ''): boolean {
  if (tags.includes('BLR') || tags.includes('REMOTE_IN') || tags.includes('UNSTATED')) return true;
  return /^\s*(india|in|ind|republic of india)\s*\.?$/i.test(location);
}

export function isExcluded(job: RawJob, s: Settings): boolean {
  const t = (job.title || '').toLowerCase();
  return s.excludeTitleWords.some((w) => w && t.includes(w.toLowerCase()));
}

export function freshnessHours(postedAt?: string | null, firstSeen?: string): number {
  const ref = postedAt || firstSeen;
  if (!ref) return 9999;
  const t = Date.parse(ref);
  if (Number.isNaN(t)) return 9999;
  return Math.max(0, (Date.now() - t) / 36e5);
}

export function baseScore(cats: Category[], loc: string[], hours: number, hidden = false): number {
  let s = 0;
  if (cats.includes('FDE')) s += 40;
  if (cats.includes('AIML')) s += 20;
  if (loc.includes('BLR')) s += 20;
  else if (loc.includes('REMOTE_IN')) s += 18;
  else if (loc.includes('INDIA')) s += 8;
  if (hours < 24) s += 15;
  else if (hours < 72) s += 10;
  else if (hours < 168) s += 5;
  if (hidden) s += 5;
  return s;
}

const norm = (s: string) => (s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function dedupeKey(j: RawJob): string {
  const city = norm((j.location || '').split(/[,;|/]/)[0]).split(' ').slice(0, 2).join(' ');
  return `${norm(j.company).replace(/ (inc|llc|ltd|pvt|private|limited|technologies|labs|ai)$/g, '')}|${norm(j.title)}|${city}`;
}

export function hashId(s: string): string {
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---- CV skill matching ----
export const SKILL_TERMS = [
  'python', 'c++', 'embedded c', 'rust', 'go', 'typescript', 'javascript', 'java', 'sql', 'bash',
  'pytorch', 'tensorflow', 'jax', 'keras', 'scikit-learn', 'xgboost', 'numpy', 'pandas',
  'transformers', 'hugging face', 'huggingface', 'llm', 'llms', 'rag', 'retrieval', 'langchain', 'langgraph', 'llamaindex',
  'pydanticai', 'mcp', 'a2a', 'agents', 'agentic', 'prompt engineering', 'evals', 'evaluation', 'guardrails', 'fine-tuning', 'finetuning',
  'lora', 'qlora', 'peft', 'dpo', 'rlhf', 'sft', 'distillation', 'quantization', 'pruning', 'vllm', 'tgi', 'triton', 'cuda',
  'tensorrt', 'onnx', 'flash attention', 'deepspeed', 'fsdp', 'whisper', 'asr', 'speech', 'nlp', 'computer vision', 'opencv',
  'vector database', 'pinecone', 'weaviate', 'qdrant', 'chroma', 'faiss', 'elasticsearch', 'knowledge graph', 'neo4j',
  'fastapi', 'flask', 'django', 'rest', 'grpc', 'kafka', 'redis', 'postgres', 'mongodb',
  'docker', 'kubernetes', 'helm', 'terraform', 'aws', 'gcp', 'azure', 'sagemaker', 'bedrock', 'vertex ai', 'ecr', 'eks',
  'mlops', 'mlflow', 'kubeflow', 'airflow', 'ci/cd', 'github actions', 'prometheus', 'grafana', 'observability',
  'autosar', 'can', 'can fd', 'lin', 'uds', 'hil', 'sil', 'dspace', 'canoe', 'vector', 'rtos', 'freertos', 'embedded linux',
  'firmware', 'microcontroller', 'stm32', 'arm', 'misra', 'iso 26262', 'adas', 'ros', 'ros2', 'edge ai', 'tinyml', 'jetson',
  'fpga', 'verilog', 'systemverilog', 'rtl', 'synthetic data', 'data pipelines', 'spark', 'databricks', 'snowflake',
  'customer-facing', 'stakeholder', 'solutions', 'consulting', 'pre-sales', 'deployment', 'production',
];

export function extractSkills(text: string): string[] {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  return SKILL_TERMS.filter((s) => {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9+])${esc}([^a-z0-9+]|$)`, 'i').test(t);
  });
}

export function cvMatchScore(job: RawJob, cvSkills: string[]): number {
  if (!cvSkills.length) return 0;
  const jobSkills = extractSkills(`${job.title} ${job.description || ''}`);
  if (!jobSkills.length) return 0;
  const set = new Set(cvSkills);
  const hit = jobSkills.filter((s) => set.has(s)).length;
  return Math.round((hit / jobSkills.length) * 100);
}
