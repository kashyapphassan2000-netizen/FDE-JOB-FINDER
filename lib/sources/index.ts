import type { SourceDef } from '../types';
import { secret } from '../secrets';
import { ATS_SOURCES } from './ats';
import { BOARD_SOURCES } from './boards';
import { COMMUNITY_SOURCES } from './community';
import { KEYED_SOURCES } from './keyed';

export const SOURCES: SourceDef[] = [...ATS_SOURCES, ...BOARD_SOURCES, ...COMMUNITY_SOURCES, ...KEYED_SOURCES];

export function sourceConfigured(s: SourceDef): boolean {
  return s.keyless || s.envKeys.every((k) => Boolean(secret(k)));
}

export function intervalFor(s: SourceDef): number {
  const override = Number(process.env[`${s.id.toUpperCase()}_INTERVAL_MIN`]);
  return Number.isFinite(override) && override > 0 ? override : s.defaultIntervalMin;
}
