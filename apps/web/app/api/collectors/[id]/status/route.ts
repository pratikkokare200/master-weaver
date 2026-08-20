import { NextResponse } from 'next/server';

import { isUuid } from '@/lib/db.server';
import { getLiveStatus } from '@/lib/queries.server';

/**
 * One collector's live state — what the health monitor polls.
 *
 * Polling rather than Supabase Realtime, and that is a considered choice rather than a shortcut.
 * Realtime would mean a websocket, a second client library, and a subscription whose reconnect
 * behaviour is its own source of bugs — to watch a table that changes at most once every fifteen
 * minutes under normal operation, and a handful of times during a sixty-second repair. A poll on a
 * few-second cadence is strictly simpler, degrades to "slightly stale" instead of "silently
 * disconnected", and needs nothing beyond `fetch`.
 *
 * `getLiveStatus` never selects `runs.rows`, which is what makes this cheap enough to call on a
 * timer: the payload is a score, a state and two short field lists.
 *
 * `no-store` is load-bearing. Without it Next would cache this at the edge and the badge would sit
 * on a stale value for the entire repair it is meant to be showing.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not a collector id' }, { status: 404 });

  const status = await getLiveStatus(id);
  if (!status) return NextResponse.json({ error: 'no such collector' }, { status: 404 });

  return NextResponse.json(status, { headers: { 'cache-control': 'no-store' } });
}
