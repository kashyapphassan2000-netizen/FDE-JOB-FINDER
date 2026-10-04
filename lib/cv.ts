import { del, get, put } from '@vercel/blob';
import type { CvState, CvVersion } from './types';
import { getJSON, setJSON } from './store';
import { extractSkills } from './classify';

/**
 * CV storage: PRIVATE Vercel Blob store (files are never public; served only through
 * the authenticated /api/cv/download route). Metadata + extracted skills live in Redis.
 */
export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const EMPTY: CvState = { versions: [], active: null, text: '', skills: [] };

export async function getCv(): Promise<CvState> {
  return getJSON<CvState>('cv', EMPTY);
}

async function extractText(buf: ArrayBuffer, contentType: string, name: string): Promise<string> {
  try {
    if (contentType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return String(text);
    }
    if (/wordprocessingml/.test(contentType) || name.toLowerCase().endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
      return r.value;
    }
    if (/text|markdown/.test(contentType) || /\.(txt|md)$/i.test(name)) return new TextDecoder().decode(buf);
  } catch (e) {
    console.error('CV text extraction failed', e);
  }
  return '';
}

export async function uploadCv(file: File, manualSkills?: string): Promise<CvState> {
  if (file.size > 4 * 1024 * 1024) throw new Error("CV must be under 4 MB (Vercel request limit is 4.5 MB)");
  const allowed = /\.(pdf|docx|doc|txt|md)$/i;
  if (!allowed.test(file.name)) throw new Error('Upload a PDF, DOCX, DOC, TXT or MD file');
  const buf = await file.arrayBuffer();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const blob = await put(`cv/${ts}__${safe}`, new Blob([buf], { type: file.type || 'application/octet-stream' }), {
    access: 'private',
    addRandomSuffix: true,
    contentType: file.type || 'application/octet-stream',
  });
  const text = await extractText(buf, file.type, file.name);
  const cur = await getCv();
  const v: CvVersion = { pathname: blob.pathname, name: file.name, size: file.size, uploadedAt: new Date().toISOString(), contentType: file.type || 'application/octet-stream' };
  const skills = Array.from(new Set([...extractSkills(text), ...splitSkills(manualSkills)]));
  const next: CvState = { versions: [v, ...cur.versions].slice(0, 20), active: v.pathname, text: text.slice(0, 20000), skills };
  await setJSON('cv', next);
  return next;
}

function splitSkills(s?: string): string[] {
  return (s || '').split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export async function setActive(pathname: string): Promise<CvState> {
  const cur = await getCv();
  const v = cur.versions.find((x) => x.pathname === pathname);
  if (!v) throw new Error('Unknown CV version');
  const r = await get(pathname, { access: 'private', useCache: false });
  let text = '';
  if (r && r.statusCode === 200 && r.stream) {
    const buf = await new Response(r.stream).arrayBuffer();
    text = await extractText(buf, v.contentType, v.name);
  }
  const next = { ...cur, active: pathname, text: text.slice(0, 20000), skills: extractSkills(text) };
  await setJSON('cv', next);
  return next;
}

export async function setSkills(skills: string): Promise<CvState> {
  const cur = await getCv();
  const next = { ...cur, skills: Array.from(new Set([...extractSkills(cur.text), ...splitSkills(skills)])) };
  await setJSON('cv', next);
  return next;
}

export async function deleteCv(pathname: string): Promise<CvState> {
  const cur = await getCv();
  await del(pathname).catch(() => undefined);
  const versions = cur.versions.filter((v) => v.pathname !== pathname);
  const next: CvState = cur.active === pathname ? { versions, active: versions[0]?.pathname || null, text: '', skills: [] } : { ...cur, versions };
  await setJSON('cv', next);
  return next;
}

export async function streamCv(pathname: string) {
  return get(pathname, { access: 'private' });
}
