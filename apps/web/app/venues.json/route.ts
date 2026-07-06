import { listVenues } from '../../lib/data.ts';

// The permanent-venue layer is off by default and most visitors never open it,
// so ~1,000 venues don't belong in every page's initial HTML. Emit them as a
// single static JSON asset (prerendered by output:export) that the Explorer
// fetches lazily the first time the "Faste steder" toggle is switched on.
export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json(listVenues(), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
