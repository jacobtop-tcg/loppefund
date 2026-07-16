import { listPublicInformalPlaces } from '../../lib/informal.ts';

// Hidden places as one static JSON asset, mirroring venues.json: the Explorer
// fetches it lazily rather than baking every place into every page's HTML.
//
// EVERYTHING HERE IS ALREADY PUBLICATION-SAFE. listPublicInformalPlaces() runs
// each row through publicView() first, so no street or precise coordinate of a
// blurred place can reach this file — which matters more here than for venues:
// this asset is world-readable at a fixed URL, cached, crawled and mirrored, and
// these records point at private homes rather than shops.
export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json(listPublicInformalPlaces(), {
    headers: { 'cache-control': 'public, max-age=3600' },
  });
}
