'use server';

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { insertTip, openDb } from '@loppefund/db';

function resolveDbPath(): string {
  if (process.env.LOPPEFUND_DB) return process.env.LOPPEFUND_DB;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data', 'loppefund.db');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'data', 'loppefund.db');
}

export interface TipState {
  ok: boolean | null;
  error?: string;
}

export async function submitTip(_prev: TipState, formData: FormData): Promise<TipState> {
  const url = String(formData.get('url') ?? '').trim().slice(0, 500);
  const text = String(formData.get('text') ?? '').trim().slice(0, 4000);
  const contact = String(formData.get('contact') ?? '').trim().slice(0, 200);
  // The honeypot field catches naive bots.
  if (String(formData.get('website') ?? '')) return { ok: true };
  if (!url && !text) {
    return { ok: false, error: 'Indsæt et link eller opslagets tekst.' };
  }
  const db = openDb(resolveDbPath());
  insertTip(db, {
    url: url || undefined,
    text: text || undefined,
    contact: contact || undefined,
  });
  return { ok: true };
}
