import type { CompanyEntry } from './types';

// Every slug below was verified live against the public ATS API (Oct 2026).
// Add more from Settings → Companies in the app (auto-detect tries every ATS).
const gh = (slug: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'greenhouse', slug, name, tag });
const lv = (slug: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'lever', slug, name, tag });
const ab = (slug: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'ashby', slug, name, tag });
const wk = (slug: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'workable', slug, name, tag });
const sr = (slug: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'smartrecruiters', slug, name, tag });
const wd = (tenant: string, wdn: string, site: string, name: string, tag?: CompanyEntry['tag']): CompanyEntry => ({ ats: 'workday', slug: `${tenant}|${wdn}|${site}`, name, tag });

export const DEFAULT_COMPANIES: CompanyEntry[] = [
  // Frontier labs + FDE-heavy companies
  gh('anthropic', 'Anthropic', 'frontier'), ab('openai', 'OpenAI', 'frontier'), ab('cohere', 'Cohere', 'frontier'),
  lv('palantir', 'Palantir', 'fde'), gh('scaleai', 'Scale AI', 'fde'), gh('databricks', 'Databricks', 'fde'),
  ab('snowflake', 'Snowflake', 'fde'), gh('gleanwork', 'Glean', 'fde'), ab('sierra', 'Sierra', 'fde'),
  ab('decagon', 'Decagon', 'fde'), ab('harvey', 'Harvey', 'fde'), ab('perplexity', 'Perplexity', 'frontier'),
  ab('elevenlabs', 'ElevenLabs', 'frontier'), ab('writer', 'Writer', 'fde'), ab('cognition', 'Cognition', 'frontier'),
  ab('cursor', 'Cursor (Anysphere)', 'frontier'), ab('replit', 'Replit'), ab('mercor', 'Mercor', 'fde'),
  ab('distyl', 'Distyl AI', 'fde'), ab('rogo', 'Rogo', 'fde'), ab('hex', 'Hex'), ab('notion', 'Notion'),
  ab('ramp', 'Ramp'), ab('vanta', 'Vanta'), ab('plaid', 'Plaid'), ab('linear', 'Linear'), ab('rillet', 'Rillet', 'fde'),
  ab('tennr', 'Tennr', 'fde'), ab('abridge', 'Abridge'), ab('nabla', 'Nabla'), gh('typeface', 'Typeface'),
  gh('cresta', 'Cresta', 'fde'), gh('parloa', 'Parloa', 'fde'), gh('intercom', 'Intercom'), ab('gamma', 'Gamma'),
  ab('ema', 'Ema', 'fde'), ab('composio', 'Composio', 'fde'), ab('gigaml', 'Giga ML', 'fde'), gh('invisibletech', 'Invisible Technologies', 'fde'),
  gh('turing', 'Turing'), ab('handshake', 'Handshake AI'), gh('snorkelai', 'Snorkel AI', 'fde'), gh('labelbox', 'Labelbox'),
  gh('workato', 'Workato'), gh('gitlab', 'GitLab'), gh('vercel', 'Vercel'), gh('stripe', 'Stripe'), gh('coinbase', 'Coinbase'),
  lv('toptal', 'Toptal'), ab('andela', 'Andela'), ab('braintrust', 'Braintrust'), ab('contra', 'Contra'), lv('appen', 'Appen'),
  // AI infra
  ab('modal', 'Modal', 'infra'), ab('baseten', 'Baseten', 'infra'), gh('togetherai', 'Together AI', 'infra'),
  ab('fireworks', 'Fireworks AI', 'infra'), ab('langchain', 'LangChain', 'infra'), ab('llamaindex', 'LlamaIndex', 'infra'),
  ab('pinecone', 'Pinecone', 'infra'), ab('weaviate', 'Weaviate', 'infra'), ab('unstructured', 'Unstructured', 'infra'),
  ab('anyscale', 'Anyscale', 'infra'), ab('lambda', 'Lambda', 'infra'), gh('coreweave', 'CoreWeave', 'infra'),
  ab('crusoe', 'Crusoe', 'infra'), gh('nebius', 'Nebius', 'infra'), ab('runpod', 'RunPod', 'infra'), ab('sfcompute', 'SF Compute', 'infra'),
  gh('arizeai', 'Arize AI', 'infra'), ab('clickhouse', 'ClickHouse', 'infra'), ab('temporal', 'Temporal', 'infra'),
  ab('supabase', 'Supabase', 'infra'), gh('vast', 'VAST Data', 'infra'), gh('purestorage', 'Pure Storage', 'infra'),
  ab('deepgram', 'Deepgram'), gh('assemblyai', 'AssemblyAI'), ab('cartesia', 'Cartesia'), ab('vapi', 'Vapi', 'fde'), ab('bland', 'Bland AI', 'fde'),
  ab('midjourney', 'Midjourney'), ab('reka', 'Reka'), ab('black-forest-labs', 'Black Forest Labs'), ab('lumaai', 'Luma AI'),
  ab('suno', 'Suno'), ab('pika', 'Pika'), ab('krea', 'Krea'), ab('tavus', 'Tavus'), ab('rasa', 'Rasa'), wk('huggingface', 'Hugging Face', 'infra'),
  // Semiconductor / AI silicon
  ab('cerebras', 'Cerebras', 'semi'), gh('sambanovasystems', 'SambaNova', 'semi'), ab('etched', 'Etched', 'semi'),
  ab('d-matrix', 'd-Matrix', 'semi'), gh('lightmatter', 'Lightmatter', 'semi'), gh('tenstorrent', 'Tenstorrent', 'semi'),
  gh('graphcore', 'Graphcore', 'semi'), ab('axelera', 'Axelera AI', 'semi'), ab('quadric', 'Quadric', 'semi'),
  lv('eliyan', 'Eliyan', 'semi'), gh('furiosaai', 'FuriosaAI', 'semi'), gh('fractile', 'Fractile', 'semi'),
  ab('rain', 'Rain AI', 'semi'), ab('extropic', 'Extropic', 'semi'), ab('matx', 'MatX', 'semi'), ab('normalcomputing', 'Normal Computing', 'semi'),
  wd('nvidia', 'wd5', 'NVIDIAExternalCareerSite', 'NVIDIA', 'semi'), wd('intel', 'wd1', 'External', 'Intel', 'semi'),
  wd('micron', 'wd1', 'External', 'Micron', 'semi'), wd('marvell', 'wd1', 'MarvellCareers', 'Marvell', 'semi'),
  wd('analogdevices', 'wd1', 'External', 'Analog Devices', 'semi'), wd('nxp', 'wd3', 'careers', 'NXP', 'semi'),
  wd('sec', 'wd3', 'Samsung_Careers', 'Samsung (incl. SRI-B)', 'semi'), wd('cadence', 'wd1', 'External_Careers', 'Cadence', 'semi'),
  wd('broadcom', 'wd1', 'External_Career', 'Broadcom', 'semi'), wd('kla', 'wd1', 'Search', 'KLA', 'semi'),
  wd('globalfoundries', 'wd1', 'External', 'GlobalFoundries', 'semi'), wd('microchiphr', 'wd5', 'External', 'Microchip', 'semi'),
  sr('WesternDigital', 'Western Digital', 'semi'),
  // Embedded / robotics / autonomy / defense
  gh('andurilindustries', 'Anduril', 'embedded'), lv('shieldai', 'Shield AI', 'embedded'), ab('skydio', 'Skydio', 'embedded'),
  ab('saronic', 'Saronic', 'embedded'), gh('helsing', 'Helsing', 'embedded'), gh('chaosindustries', 'Chaos Industries', 'embedded'),
  gh('vannevarlabs', 'Vannevar Labs', 'fde'), gh('figureai', 'Figure AI', 'embedded'), ab('1x', '1X Technologies', 'embedded'),
  ab('physicalintelligence', 'Physical Intelligence', 'embedded'), gh('apptronik', 'Apptronik', 'embedded'),
  gh('agilityrobotics', 'Agility Robotics', 'embedded'), gh('nimblerobotics', 'Nimble Robotics', 'embedded'),
  lv('dexterity', 'Dexterity', 'embedded'), lv('field-ai', 'Field AI', 'embedded'), ab('sanctuary', 'Sanctuary AI', 'embedded'),
  ab('persona', 'Persona AI', 'embedded'), gh('formic', 'Formic', 'embedded'), lv('brightmachines', 'Bright Machines', 'embedded'),
  gh('carbonrobotics', 'Carbon Robotics', 'embedded'), ab('maticrobots', 'Matic Robots', 'embedded'),
  ab('wayve', 'Wayve', 'embedded'), gh('waymo', 'Waymo', 'embedded'), lv('zoox', 'Zoox', 'embedded'), gh('nuro', 'Nuro', 'embedded'),
  gh('motional', 'Motional', 'embedded'), gh('kodiak', 'Kodiak', 'embedded'), ab('applied', 'Applied Intuition', 'embedded'),
  gh('samsara', 'Samsara', 'embedded'), gh('motive', 'Motive', 'embedded'), gh('lucidmotors', 'Lucid Motors', 'embedded'),
  gh('divergent', 'Divergent', 'embedded'), sr('BoschGroup', 'Bosch', 'embedded'), sr('Continental', 'Continental', 'embedded'),
  // India
  ab('sarvam', 'Sarvam AI', 'india'), gh('devrev', 'DevRev', 'india'), gh('nurix', 'Nurix AI', 'india'),
  gh('truefoundry', 'TrueFoundry', 'india'), ab('atlan', 'Atlan', 'india'), ab('spotdraft', 'SpotDraft', 'india'),
  ab('level', 'Level AI', 'india'), ab('bureau', 'Bureau', 'india'), ab('tekion', 'Tekion', 'india'), ab('cynlr', 'CynLr', 'india'),
  gh('netradyne', 'Netradyne', 'india'), gh('groww', 'Groww', 'india'), gh('observeai', 'Observe.AI', 'india'),
  gh('slice', 'slice', 'india'), gh('zetaglobal', 'Zeta Global', 'india'), lv('zeta', 'Zeta', 'india'), lv('mindtickle', 'Mindtickle', 'india'),
  lv('cred', 'CRED', 'india'), lv('meesho', 'Meesho', 'india'), lv('fi', 'Fi Money', 'india'), gh('glance', 'Glance', 'india'),
  gh('inmobi', 'InMobi', 'india'), sr('Freshworks', 'Freshworks', 'india'), sr('ServiceNow', 'ServiceNow', 'fde'),
  // Big enterprise with Workday
  wd('salesforce', 'wd12', 'External_Career_Site', 'Salesforce', 'fde'), wd('adobe', 'wd5', 'external_experienced', 'Adobe'),
  wd('hp', 'wd5', 'ExternalCareerSite', 'HP'),
  // Big Bengaluru employers on Workday (verified Oct 2026)
  wd('hitachi', 'wd1', 'hitachi', 'Hitachi'), wd('target', 'wd5', 'targetcareers', 'Target'), wd('philips', 'wd3', 'jobs-and-careers', 'Philips'),
  wd('mastercard', 'wd1', 'CorporateCareers', 'Mastercard'), wd('paypal', 'wd1', 'jobs', 'PayPal'), wd('thomsonreuters', 'wd5', 'External_Career_Site', 'Thomson Reuters'),
  wd('gehc', 'wd5', 'GEHC_ExternalSite', 'GE HealthCare'), wd('cisco', 'wd5', 'Cisco_Careers', 'Cisco'), wd('equinix', 'wd1', 'External', 'Equinix'),
  wd('autodesk', 'wd1', 'Ext', 'Autodesk'), wd('workday', 'wd5', 'Workday', 'Workday'), wd('harman', 'wd3', 'HARMAN', 'Harman', 'embedded'),
];

export const COMPANY_TAG = new Map<string, string>(DEFAULT_COMPANIES.filter((c) => c.tag).map((c) => [c.name.toLowerCase(), c.tag!]));
