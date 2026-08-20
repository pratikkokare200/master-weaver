import { NextResponse } from 'next/server';

import { isUuid, query } from '@/lib/db.server';

/**
 * The `PENDING_OPERATOR` decision — doc 01 §2.2, the operator half of the severity split.
 *
 * A partial break halts and waits for a human. This is where the human answers: `repair` authorises
 * the episode, `dismiss` accepts the degradation and lets the collector carry on.
 *
 * **The route does not repair anything.** It enqueues. A full healing episode runs 30 to 60 seconds
 * and Vercel terminates a request well before that (ADR-001), so a repair driven from inside this
 * handler would be killed mid-episode — after the heal call, quite possibly between the approval and
 * the confirmation, which is the worst possible moment to lose the process. The click becomes a job;
 * the worker owns the loop.
 *
 * ⚠️ **This endpoint is unauthenticated, and so is the deep link that reaches it.** v1 has no auth at
 * all (doc 03 §2.3), so nothing here should be described as a security control. The design direction
 * is that an approval eventually binds to an operator identity in the ledger — `authorised_by`
 * records *that* a human authorised a repair and should one day record *which* — but that identity
 * does not exist yet, and claiming otherwise invites the obvious question (ADR-005).
 */

export const dynamic = 'force-dynamic';

interface RunRow {
  id: string;
  finished_at: string | null;
}

interface CollectorRow {
  id: string;
  name: string;
  status: string;
}

type Action = 'repair' | 'dismiss';

function isAction(value: unknown): value is Action {
  return value === 'repair' || value === 'dismiss';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  if (!isUuid(id)) {
    return NextResponse.json({ error: 'not a collector id' }, { status: 404 });
  }

  let action: unknown;
  try {
    const body: unknown = await request.json();
    action = (body as { action?: unknown } | null)?.action;
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  if (!isAction(action)) {
    return NextResponse.json(
      { error: "action must be 'repair' or 'dismiss'" },
      { status: 400 },
    );
  }

  const [collector] = await query<CollectorRow>(
    'select id, name, status from collectors where id = $1',
    [id],
  );
  if (!collector) {
    return NextResponse.json({ error: 'no such collector' }, { status: 404 });
  }

  // The run holding the break. Its existence IS the authorisation: without one, there is nothing
  // awaiting approval and nothing to approve.
  const [pending] = await query<RunRow>(
    `select id, finished_at
       from runs
      where collector_id = $1 and run_state = 'PENDING_OPERATOR'
      order by started_at desc
      limit 1`,
    [id],
  );

  if (!pending) {
    // 409, not 404: the collector exists and the request was well formed, but the world has moved
    // on — most often because the same button was pressed twice, or another operator got there
    // first. Saying so plainly is more useful than pretending nothing is there.
    return NextResponse.json(
      { error: 'nothing is awaiting approval for this collector' },
      { status: 409 },
    );
  }

  if (action === 'dismiss') {
    // PENDING_OPERATOR -> IDLE. The break is accepted, not repaired; the next scheduled run will
    // score it again and prompt again if it is still degraded.
    await query(
      `update runs set run_state = 'IDLE' where id = $1 and run_state = 'PENDING_OPERATOR'`,
      [pending.id],
    );
    return NextResponse.json({ ok: true, action, runId: pending.id, state: 'IDLE' });
  }

  // Enqueue the repair. `on conflict do nothing` against the partial unique index from migration
  // 0002 makes a double click idempotent rather than racing two episodes onto one Bright Data
  // collector — a race that would be discovered only after the credits were spent.
  const inserted = await query<{ id: string }>(
    `insert into jobs (collector_id, kind, state, scheduled_for)
     values ($1, 'repair', 'PENDING', now())
     on conflict do nothing
     returning id`,
    [id],
  );

  if (inserted.length === 0) {
    const [existing] = await query<{ id: string }>(
      `select id from jobs
        where collector_id = $1 and kind = 'repair' and state in ('PENDING', 'CLAIMED')
        limit 1`,
      [id],
    );
    return NextResponse.json({
      ok: true,
      action,
      jobId: existing?.id ?? null,
      alreadyQueued: true,
    });
  }

  return NextResponse.json({ ok: true, action, jobId: inserted[0]?.id, runId: pending.id });
}

/**
 * What is awaiting a decision, for the confirmation panel the deep link opens.
 *
 * Returns the failing run's score and fields so the operator sees the same evidence the Discord
 * alert carried, rather than being asked to authorise something described only as "a repair".
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'not a collector id' }, { status: 404 });

  const [pending] = await query<{
    id: string;
    fhs: string | null;
    field_scores: { field: string; field_score: number; below_min_fill: boolean }[] | null;
    finished_at: string | null;
  }>(
    `select id, fhs, field_scores, finished_at
       from runs
      where collector_id = $1 and run_state = 'PENDING_OPERATOR'
      order by started_at desc
      limit 1`,
    [id],
  );

  if (!pending) return NextResponse.json({ pending: false });

  const scores = pending.field_scores ?? [];
  return NextResponse.json({
    pending: true,
    runId: pending.id,
    fhs: pending.fhs === null ? null : Number(pending.fhs),
    failedFields: scores.filter((s) => s.below_min_fill).map((s) => s.field),
    healthyFields: scores.filter((s) => !s.below_min_fill).map((s) => s.field),
    detectedAt: pending.finished_at,
  });
}
