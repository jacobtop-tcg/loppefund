/**
 * DATA-QUALITY REPORT for informal places.
 *
 * Runs in the crawl and prints what is wrong. Its job is to make silent decay
 * LOUD: a hidden place is exactly the kind of record that rots quietly — the
 * barn closes, the phone changes, the post is deleted — and nobody notices,
 * because nobody is looking. The report is the looking.
 *
 * The checks are ranked by what they'd cost a real person:
 *   error  — actively harmful or wrong (a private address about to be published,
 *            a coordinate in the sea, a score outside its range)
 *   warn   — likely wrong, needs a human (stale, contradictory, duplicate-ish)
 *   info   — worth knowing, not a defect
 *
 * Nothing here mutates. A report that quietly "fixed" things would hide the
 * very decay it exists to surface.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  INFORMAL_PLACE_STATUSES,
  INFORMAL_PLACE_TYPES,
  ADDRESS_VISIBILITIES,
  normalizePhone,
  type InformalPlaceStatus,
} from '@loppefund/core';
import { listInformalPlaces } from '@loppefund/db';

export type Severity = 'error' | 'warn' | 'info';

export interface QualityIssue {
  severity: Severity;
  slug: string;
  check: string;
  detail: string;
}

/** Denmark's land bounds — the same guard the event geocoder uses. A coordinate
 *  outside these is a bug, not a place. */
const DK = { minLat: 54.4, maxLat: 57.9, minLng: 7.8, maxLng: 15.3 };

/** A place unseen for this long is stale — it should not still claim to be
 *  confirmed_active. Configurable: the right number is a judgement, not a law. */
export const STALE_AFTER_DAYS = 365;
/** Past this, a place belongs in 'historical' or review, whatever it claims. */
export const HISTORICAL_AFTER_DAYS = 540;

/** Statuses that assert a human recently checked. Claiming one without evidence
 *  is the single most misleading thing this dataset can do. */
const CLAIMS_VERIFIED: ReadonlySet<InformalPlaceStatus> = new Set(['confirmed_active']);

const days = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function checkInformalQuality(db: DatabaseSync, today: string): QualityIssue[] {
  const rows = listInformalPlaces(db, { includeRejected: true });
  const issues: QualityIssue[] = [];
  const add = (severity: Severity, slug: string, check: string, detail: string) =>
    issues.push({ severity, slug, check, detail });

  const byPhone = new Map<string, string[]>();
  const byAddress = new Map<string, string[]>();

  for (const r of rows) {
    const slug = r.slug;

    // --- vocabulary: an unknown value means a typo or a stale writer ---
    if (!INFORMAL_PLACE_TYPES.includes(r.place_type as never)) {
      add('error', slug, 'ukendt-type', `place_type "${r.place_type}" findes ikke`);
    }
    if (!INFORMAL_PLACE_STATUSES.includes(r.status as never)) {
      add('error', slug, 'ukendt-status', `status "${r.status}" findes ikke`);
    }
    if (!ADDRESS_VISIBILITIES.includes(r.address_visibility as never)) {
      // Fail LOUD: an unrecognised visibility must never be treated as
      // permissive by some later default.
      add('error', slug, 'ukendt-synlighed', `address_visibility "${r.address_visibility}" findes ikke`);
    }

    // --- scores must stay inside their range, or the UI lies ---
    for (const [name, v] of [['confidence', r.confidence], ['fund_score', r.fund_score]] as const) {
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        add('error', slug, 'score-uden-for-interval', `${name} = ${v} (skal være 0..100)`);
      }
    }

    // --- geography ---
    if (r.lat != null && r.lng != null) {
      if (r.lat < DK.minLat || r.lat > DK.maxLat || r.lng < DK.minLng || r.lng > DK.maxLng) {
        add('error', slug, 'koordinat-uden-for-dk', `(${r.lat}, ${r.lng}) ligger uden for Danmark`);
      }
    }
    if (r.postcode && !/^[1-9]\d{3}$/.test(r.postcode)) {
      add('error', slug, 'ugyldigt-postnummer', `postnummer "${r.postcode}"`);
    }
    if (!r.city && !r.postcode && r.lat == null) {
      add('error', slug, 'ingen-placering', 'hverken by, postnummer eller koordinat');
    }

    // --- THE PRIVACY CHECK. A precise address stored against a place that is
    //     about to publish it fully, with no consent recorded in the sources,
    //     is the one failure that harms a real person. ---
    if (r.address_visibility === 'fuld' && r.street) {
      const consented = (r.sources as Array<{ source_type: string }>).some(
        (s) => s.source_type === 'operator_review' || s.source_type === 'phone_verification',
      );
      if (!consented) {
        add(
          'error',
          slug,
          'fuld-adresse-uden-vetting',
          'address_visibility=fuld med præcis adresse, men ingen operator_review/phone_verification blandt kilderne',
        );
      }
    }

    // --- required fields ---
    if (!r.canonical_name.trim()) add('error', slug, 'tomt-navn', 'canonical_name er tom');
    if ((r.sources as unknown[]).length === 0) {
      add('warn', slug, 'ingen-kilder', 'stedet har ingen kilder — hvorfor findes det?');
    }

    // --- contact ---
    if (r.phone && !normalizePhone(r.phone)) {
      add('warn', slug, 'ugyldigt-telefonnummer', `"${r.phone}" ligner ikke et dansk nummer`);
    }
    if (r.phone && !r.phone_norm) {
      add('warn', slug, 'telefon-ikke-normaliseret', 'phone_norm mangler — entity resolution virker ikke');
    }

    // --- staleness + illogical status combinations ---
    const age = days(r.last_verified_at ?? r.last_seen_at, today);
    if (CLAIMS_VERIFIED.has(r.status as InformalPlaceStatus)) {
      if (!r.last_verified_at) {
        add('error', slug, 'ulogisk-status', 'status=confirmed_active uden last_verified_at');
      } else if (age > STALE_AFTER_DAYS) {
        add(
          'warn',
          slug,
          'foraeldet-bekraeftelse',
          `status=confirmed_active, men senest bekræftet for ${age} dage siden`,
        );
      }
    }
    if (age > HISTORICAL_AFTER_DAYS && !['historical', 'rejected', 'possibly_inactive'].includes(r.status)) {
      add('warn', slug, 'ingen-aktivitet', `ingen aktivitet i ${age} dage, men status er "${r.status}"`);
    }
    if (r.status === 'call_first' && !r.phone) {
      add('warn', slug, 'ring-foerst-uden-nummer', 'status=call_first, men der er intet telefonnummer');
    }
    if (r.call_before_visiting && !r.phone && !r.facebook_url) {
      add('warn', slug, 'kontakt-mangler', 'call_before_visiting sat, men ingen måde at kontakte på');
    }
    if (r.address_visibility === 'kontakt-kraeves' && !r.phone && !r.facebook_url && !r.email) {
      add('error', slug, 'kontakt-kraeves-uden-kontakt', 'adressen kræver kontakt, men der er ingen kontaktvej — stedet er umuligt at besøge');
    }

    // --- a recurring place must have the history that justifies the claim ---
    const rec = r.recurrence ? (JSON.parse(r.recurrence) as { pattern?: string } | null) : null;
    if (rec?.pattern && (r.sources as unknown[]).length < 2) {
      add(
        'warn',
        slug,
        'tilbagevendende-uden-historik',
        `påstår mønsteret "${rec.pattern}" på grundlag af ${(r.sources as unknown[]).length} observation(er)`,
      );
    }

    // --- duplicate hints (cheap keys; the real resolver runs separately) ---
    if (r.phone_norm) {
      byPhone.set(r.phone_norm, [...(byPhone.get(r.phone_norm) ?? []), slug]);
    }
    if (r.street && r.city) {
      const k = `${r.street.toLowerCase().trim()}|${r.city.toLowerCase().trim()}`;
      byAddress.set(k, [...(byAddress.get(k) ?? []), slug]);
    }
  }

  for (const [phone, slugs] of byPhone) {
    if (slugs.length > 1) {
      add('warn', slugs.join(', '), 'dublet-telefon', `samme nummer (${phone}) på ${slugs.length} steder`);
    }
  }
  for (const [addr, slugs] of byAddress) {
    if (slugs.length > 1) {
      add('warn', slugs.join(', '), 'dublet-adresse', `samme adresse (${addr.split('|')[0]}) på ${slugs.length} steder`);
    }
  }

  add('info', '-', 'antal', `${rows.length} skjulte steder i alt`);
  return issues;
}

/** Human-readable report. Errors first — they are the ones that hurt someone. */
export function formatQualityReport(issues: QualityIssue[]): string {
  const order: Severity[] = ['error', 'warn', 'info'];
  const icon: Record<Severity, string> = { error: 'FEJL ', warn: 'ADVAR', info: 'INFO ' };
  const lines: string[] = [];
  for (const sev of order) {
    const group = issues.filter((i) => i.severity === sev);
    if (group.length === 0) continue;
    for (const i of group) lines.push(`  ${icon[sev]} [${i.check}] ${i.slug}: ${i.detail}`);
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;
  lines.push('');
  lines.push(`  ${errors} fejl, ${warns} advarsler.`);
  return lines.join('\n');
}
