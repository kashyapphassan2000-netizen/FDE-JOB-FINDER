import { chatJson } from './llm';
import { getJSON, hgetall, hset, setJSON } from './store';
import { getCv } from './cv';
import { getProfile } from './profile';
import { readPage } from './search';
import { getSem } from './semantic';
import { sendMail, esc } from './mailer';
import { sendWhatsApp, notifyConfigured } from './notify';
import { secret } from './secrets';
import { tenant } from './tenant';
import type { Job } from './types';

/**
 * AUTOPILOT
 *  • Outreach drafts: every role the reranker scores ≥ 0.85 gets a 3-bullet cold message to the engineering hiring
 *    manager — Hook (an exact technical problem from the JD) · Proof (a real result from YOUR CV, never invented)
 *    · Ask (a low-friction 15-minute technical chat). Max 5 new drafts per run; you get them by email / WhatsApp.
 *  • Weekly resume-gap telemetry: what the week's top-100 AI roles keep asking for vs what your CV shows,
 *    with week-over-week trend, and the 5 gaps worth closing first.
 */
export interface Draft { jobId: string; title: string; company: string; url: string; subject: string; hook: string; proof: string; ask: string; text: string; at: string }
export const HIGH_SIGNAL = 0.85;

export async function draftOutreach(jobs: Job[], max = 5): Promise<Draft[]> {
  const [sem, drafts, cv, prof] = await Promise.all([getSem(), hgetall<Draft>('drafts'), getCv(), getProfile()]);
  if (!cv.text && !cv.skills.length) return [];
  const todo = jobs.filter((j) => (sem[j.id]?.r ?? 0) >= HIGH_SIGNAL && !drafts[j.id]).sort((a, b) => sem[b.id].r! - sem[a.id].r!).slice(0, max);
  const out: Draft[] = [];
  for (const j of todo) {
    const jd = (await readPage(j.url, 6000).catch(() => '')) || j.description || '';
    const { data } = await chatJson<Omit<Draft, 'jobId' | 'title' | 'company' | 'url' | 'text' | 'at'>>(
      'You write elite, short cold messages from an engineer to an ENGINEERING hiring manager (not HR). No flattery, no "I hope this finds you well", no buzzwords. Every claim about the candidate must come from the CV text given — if the CV has no metric for it, write [add your metric] instead of inventing one.',
      `JOB: ${j.title} at ${j.company} (${j.location})\nJD:\n${jd.slice(0, 5000)}\n\nCANDIDATE CV:\n${(cv.text || `Skills: ${cv.skills.join(', ')}`).slice(0, 5000)}\nTarget roles: ${prof.roles.slice(0, 4).join(', ')}\n\nWrite exactly 3 bullets:\n- hook: name ONE specific technical hurdle from this JD (e.g. high-throughput batching, multi-tenant serving, customer data pipelines) in their words\n- proof: ONE concrete result from the CV that shows I solved something similar (with the number from the CV)\n- ask: a frictionless ask — a 15-minute technical conversation about that hurdle\nPlus a 6-9 word subject line.\nJSON: {"subject":"","hook":"","proof":"","ask":""}`,
      { maxTokens: 900, timeoutMs: 45000 },
    ).catch(() => ({ data: null }));
    if (!data?.hook) continue;
    const d: Draft = { jobId: j.id, title: j.title, company: j.company, url: j.url, subject: data.subject || `${j.title} — quick technical question`, hook: data.hook, proof: data.proof, ask: data.ask, text: `• ${data.hook}\n• ${data.proof}\n• ${data.ask}`, at: new Date().toISOString() };
    await hset('drafts', j.id, d);
    out.push(d);
  }
  if (out.length && tenant().ns === 'owner') await announce(out).catch(() => null);
  return out;
}
async function announce(ds: Draft[]) {
  const to = secret('DIGEST_TO');
  if (to) await sendMail(to, `🎯 ${ds.length} high-fit role${ds.length > 1 ? 's' : ''} — outreach drafted`, `<div style="font-family:system-ui,sans-serif;max-width:680px">${ds.map((d) => `<div style="border:1px solid #e3e8ef;border-radius:12px;padding:12px 14px;margin:10px 0"><b><a href="${esc(d.url)}">${esc(d.title)}</a></b> — ${esc(d.company)}<div style="color:#555;font-size:13px;margin:6px 0">Subject: ${esc(d.subject)}</div><ul style="margin:0;padding-left:18px"><li>${esc(d.hook)}</li><li>${esc(d.proof)}</li><li>${esc(d.ask)}</li></ul></div>`).join('')}<p style="color:#999;font-size:12px">Send it to the engineering manager (Recruiters &amp; referrals finds them). Edit any [add your metric] first.</p></div>`).catch(() => null);
  if (notifyConfigured().whatsapp) await sendWhatsApp(`🎯 ${ds.length} high-fit role(s), outreach drafted:\n${ds.map((d) => `• ${d.title} — ${d.company}\n${d.url}`).join('\n')}`).catch(() => null);
}

// ---------- weekly resume gap telemetry ----------
const TERMS: [string, RegExp][] = ([
  ['Python', /\bpython\b/], ['PyTorch', /pytorch/], ['TensorFlow', /tensorflow/], ['JAX', /\bjax\b/], ['CUDA', /\bcuda\b/], ['Triton', /\btriton\b/], ['TensorRT / TensorRT-LLM', /tensorrt/],
  ['vLLM', /\bvllm\b/], ['SGLang', /sglang/], ['Ray', /\bray\b(?! ?ban)/], ['Kubernetes', /kubernetes|\bk8s\b/], ['Docker', /docker|container/], ['Terraform / IaC', /terraform|infrastructure as code/],
  ['AWS', /\baws\b|amazon web services/], ['GCP', /\bgcp\b|google cloud/], ['Azure', /\bazure\b/], ['SageMaker / Vertex / Bedrock', /sagemaker|vertex ai|bedrock/],
  ['RAG', /\brag\b|retrieval[- ]augmented/], ['Vector databases', /vector (db|database|store|search)|pinecone|weaviate|qdrant|milvus|pgvector/], ['LangChain / LangGraph', /langchain|langgraph/], ['LlamaIndex', /llama ?index/],
  ['AI agents', /\bagent(s|ic)?\b/], ['Function calling / tool use / MCP', /function calling|tool use|tool calling|\bmcp\b|model context protocol/], ['LLM evals', /\bevals?\b|evaluation framework|llm evaluation/],
  ['Fine-tuning / LoRA', /fine[- ]?tun|\blora\b|\bpeft\b/], ['RLHF / DPO', /rlhf|\bdpo\b|preference optimization/], ['Quantization / distillation', /quantiz|distillation/], ['Inference optimisation (KV cache, batching)', /kv[- ]cache|continuous batching|inference optimi[sz]|latency optimi[sz]|throughput/],
  ['Distributed training (DeepSpeed / FSDP)', /deepspeed|\bfsdp\b|megatron|distributed training/], ['MLOps / LLMOps', /mlops|llmops|ml platform|model serving|model deployment/], ['MLflow / Kubeflow / Airflow', /mlflow|kubeflow|airflow/],
  ['Spark / Databricks', /\bspark\b|databricks/], ['SQL', /\bsql\b/], ['Kafka / streaming', /kafka|streaming/], ['FastAPI / REST / gRPC', /fastapi|\brest\b|grpc|api design/], ['TypeScript / React', /typescript|react\b/],
  ['Go / Rust / C++', /\bgolang\b|\bgo\b(?= |,)|\brust\b|c\+\+/], ['Observability', /observability|prometheus|grafana|opentelemetry|langsmith|langfuse/], ['CI/CD', /ci\/cd|github actions|jenkins/],
  ['Customer-facing / stakeholders', /customer[- ]facing|stakeholder|client[- ]facing|work directly with customers|enterprise customers/], ['Solution architecture / system design', /solution architect|system design|architecture/],
  ['Pre-sales / POCs', /pre-?sales|proof of concept|\bpocs?\b|pilot/], ['Multimodal / vision / speech', /multimodal|computer vision|\basr\b|speech|\btts\b/], ['Security / guardrails', /guardrail|security|compliance/],
] as [string, RegExp][]).map(([n, r]) => [n, new RegExp(r.source, 'i')]);

export interface GapReport { at: string; jobs: number; terms: { term: string; pct: number; inCv: boolean; delta: number | null }[]; gaps: { term: string; why: string; how: string }[]; summary: string }
export async function weeklyGap(jobs: Job[], opts: { readTop?: number } = {}): Promise<GapReport> {
  const [sem, cv, prev] = await Promise.all([getSem(), getCv(), getJSON<GapReport[]>('gap:reports', [])]);
  const week = jobs.filter((j) => Date.now() - Date.parse(j.postedAt || j.firstSeen) < 7 * 864e5);
  const pool = (week.length >= 30 ? week : jobs).sort((a, b) => ((sem[b.id]?.r ?? sem[b.id]?.s ?? 0) - (sem[a.id]?.r ?? sem[a.id]?.s ?? 0)) || b.score - a.score).slice(0, 100);
  // full JD text for the best N (descriptions stored in the feed are short)
  const full = new Map<string, string>();
  const readTop = opts.readTop ?? 25;
  await Promise.allSettled(pool.slice(0, readTop).map(async (j) => full.set(j.id, await readPage(j.url, 8000))));
  const texts = pool.map((j) => `${j.title} ${j.description || ''} ${full.get(j.id) || ''}`.toLowerCase());
  const cvText = `${cv.text} ${cv.skills.join(' ')}`.toLowerCase();
  const last = prev[0];
  const terms = TERMS.map(([term, rx]) => {
    const pct = Math.round((texts.filter((t) => rx.test(t)).length / Math.max(1, texts.length)) * 100);
    const before = last?.terms.find((x) => x.term === term)?.pct;
    return { term, pct, inCv: rx.test(cvText), delta: before === undefined ? null : pct - before };
  }).filter((t) => t.pct > 0).sort((a, b) => b.pct - a.pct);
  const missing = terms.filter((t) => !t.inCv).slice(0, 12);
  const { data } = await chatJson<{ summary: string; gaps: { term: string; why: string; how: string }[] }>(
    'You are a brutally honest career strategist for AI / FDE engineers. No sugarcoating.',
    `This week's top ${pool.length} AI roles for this person ask for (share of roles): ${terms.slice(0, 25).map((t) => `${t.term} ${t.pct}%${t.delta !== null ? ` (${t.delta >= 0 ? '+' : ''}${t.delta} vs last week)` : ''}${t.inCv ? ' [in CV]' : ' [MISSING from CV]'}`).join('; ')}.\nCV skills: ${cv.skills.join(', ') || 'no CV uploaded'}.\nPick the 5 gaps most worth closing first (demand × trend × how fast it can be shown). For each: why it matters now, and the fastest credible way to prove it (a small public project / write-up, not a course certificate). JSON: {"summary":"3 blunt sentences","gaps":[{"term":"","why":"","how":""}]}`,
    { maxTokens: 1500, timeoutMs: 60000 },
  ).catch(() => ({ data: null }));
  const report: GapReport = { at: new Date().toISOString(), jobs: pool.length, terms, gaps: data?.gaps?.slice(0, 5) || missing.slice(0, 5).map((t) => ({ term: t.term, why: `${t.pct}% of top roles ask for it`, how: 'Ship a small public project using it' })), summary: data?.summary || (cv.text ? '' : 'Upload your CV in the CV tab — without it every term shows as missing.') };
  await setJSON('gap:reports', [report, ...prev].slice(0, 12));
  return report;
}
export async function emailGap(r: GapReport, to: string) {
  await sendMail(to, `📉 Weekly CV gap report — ${r.gaps.map((g) => g.term).slice(0, 3).join(', ')}`, `<div style="font-family:system-ui,sans-serif;max-width:680px"><p>${esc(r.summary)}</p><h3>Close these first</h3><ol>${r.gaps.map((g) => `<li><b>${esc(g.term)}</b> — ${esc(g.why)}<br><span style="color:#555">${esc(g.how)}</span></li>`).join('')}</ol><h3>What the top ${r.jobs} roles asked for this week</h3><table style="border-collapse:collapse;font-size:13px">${r.terms.slice(0, 25).map((t) => `<tr><td style="padding:3px 10px 3px 0">${esc(t.term)}</td><td>${t.pct}%</td><td style="padding-left:8px;color:${t.delta && t.delta > 0 ? '#0a7' : '#999'}">${t.delta === null ? '' : `${t.delta >= 0 ? '+' : ''}${t.delta}`}</td><td style="padding-left:8px">${t.inCv ? '✅ in CV' : '❌ missing'}</td></tr>`).join('')}</table></div>`);
}
