/**
 * The healing episode orchestrator — doc 01 §7, the sequence the product is built around.
 *
 *   snapshot → open episode → diagnose → heal → score canary → approve or reject → confirm
 *
 * `@weaver/healing` decides which edge to take at every branch below; this file executes those
 * decisions, calls Bright Data, and writes the ledger. The split is deliberate: the decisions are
 * pure and exhaustively tested without a network, and the I/O lives here where it can be faked at
 * one seam.
 *
 * Two rules govern every write in this file.
 *
 * **The ledger row precedes the CLI call it describes** (doc 03 §4). `healing_attempts` is inserted
 * with its diagnosis and argv *before* `scraper heal` is spawned, so an episode killed mid-repair is
 * still auditable up to the moment it died. The alternative — writing after the call returns —
 * leaves the least reversible operation in the system with no record it was ever attempted.
 *
 * **We never pass `--auto-approve`.** Every proposed fix is scored at the gate against the same
 * contract that caught the break, at a stricter threshold, before it is committed. `heal` rewrites
 * the collector in place and the CLI exposes no version history, so rejection at the gate is the
 * only true undo the platform offers (doc 01 §8, ADR-003, ADR-005).
 */

import type { BrightDataClient } from '@weaver/brightdata';
import { extractCanarySample, isAwaitingApproval } from '@weaver/brightdata';
import type {
  CollectorContract,
  EpisodeFinalState,
  EpisodeTriggerReason,
  FhsBreakdown,
  RunState,
  ScrapedRow,
} from '@weaver/contracts';
import {
  authorisedBy,
  buildEvidence,
  buildDiagnosis,
  checkBreaker,
  decideAfterCanary,
  decideAfterConfirmation,
  decideAfterDiagnosis,
  decideAfterGate,
  decideAfterHeal,
  decideAfterRejection,
  refineDiagnosis,
  type BreakerLimits,
} from '@weaver/healing';
import {
  captureBaseline,
  compareBaseline,
  evaluateGoldenSet,
  goldenFailures,
  scoreCanary,
  scoreFhs,
} from '@weaver/validation';

import type { Queryable } from './db.js';
import {
  closeEpisode,
  getBaselines,
  healAttemptsLast24h,
  lastHealthyRows,
  noteAttemptFailure,
  openEpisode,
  recordAttempt,
  settleAttempt,
  upsertBaseline,
} from './episodes.js';
import { silentNotifier, type Notifier } from './discord.js';
import { transitionRun, type CollectorRow } from './ledger.js';
import type { Logger } from './log.js';

export interface EpisodeDeps {
  db: Queryable;
  brightdata: BrightDataClient;
  log: Logger;
  limits?: BreakerLimits;
  /** Global kill switch. The worker keeps running scrapes; it just refuses to heal. */
  killSwitchEnabled?: boolean;
  /** Fires on RESTORED and QUARANTINED only — never on the transitions in between (doc 03 6.3). */
  notify?: Notifier;
  now?: () => number;
}

export interface EpisodeInput {
  collector: CollectorRow;
  contract: CollectorContract;
  /** BROKEN opens autonomously; DEGRADED only ever arrives here after an operator said so. */
  trigger: EpisodeTriggerReason;
  /** The failing run's score — `fhs_before` and the evidence the diagnosis is built from. */
  breakdown: FhsBreakdown;
  /** The failing run's rows, for the "now returns" half of the diagnosis. */
  badRows: readonly unknown[];
  /** Operator path only: when the human was asked, and when they answered. */
  operatorPromptedAt?: Date | null;
  operatorActedAt?: Date | null;
  /**
   * The run to drive through the healing states as the episode progresses.
   *
   * Optional, and the episode is correct without it — the ledger is the record of what happened.
   * But the live badge reads `runs.run_state`, so supplying this is what makes "Healing…",
   * "Verifying fix…" and "Committing fix…" appear on screen while the repair is actually happening,
   * rather than the UI jumping from broken to restored with nothing in between.
   */
  runId?: string | null;
}

export interface EpisodeOutcome {
  episodeId: string;
  finalState: EpisodeFinalState;
  attempts: number;
  fhsAfter: number | null;
  creditsSpent: number | null;
  durationMs: number;
  /** The last decision's reason — what the ledger and the UI say happened. */
  reason: string;
}

/** Read the balance, tolerating a budget call that fails. A missing number is not a zero. */
async function readBalance(deps: EpisodeDeps): Promise<number | null> {
  try {
    const result = await deps.brightdata.getBudget({});
    const balance = result.ok ? result.data?.balance : undefined;
    return typeof balance === 'number' ? balance : null;
  } catch {
    return null;
  }
}

/**
 * Run one complete healing episode.
 *
 * Returns rather than throws on every expected failure — a quarantine is an outcome, not an
 * exception. The caller records it and moves on; the episode row already says why.
 */
export async function runHealingEpisode(
  deps: EpisodeDeps,
  input: EpisodeInput,
): Promise<EpisodeOutcome> {
  const { db, brightdata, contract, collector } = { ...deps, ...input };
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const log = deps.log.child({
    collector_id: collector.collector_id,
    trigger: input.trigger,
  });

  const authorised = authorisedBy(input.trigger);

  /**
   * Walk the run through one edge of the state machine.
   *
   * Best-effort on purpose. A run row that has moved on underneath us — a newer run, a manual
   * reset — must not abort a repair that is already spending credits. The episode is the record
   * that matters; this is the live view.
   */
  const moveRun = async (decision: { from: RunState; to: RunState }): Promise<void> => {
    if (!input.runId) return;
    try {
      await transitionRun(db, input.runId, decision.from, decision.to);
    } catch (error) {
      log.debug('could not move the run to its next state', {
        run_id: input.runId,
        from: decision.from,
        to: decision.to,
        error,
      });
    }
  };

  // A DEGRADED episode reaching this function without an operator behind it would violate the
  // architect's severity decision. The database enforces the trigger/authoriser pairing; this
  // enforces the thing the database cannot see, which is that a human actually acted.
  if (input.trigger === 'DEGRADED' && !input.operatorActedAt) {
    throw new Error(
      'a DEGRADED episode requires operatorActedAt — partial breakage never repairs unattended',
    );
  }

  // ── Snapshot before anything is spent or mutated (doc 01 §8: unconditionally) ──────────────
  const lastGood = await lastHealthyRows(db, collector.id);
  const baselines = await getBaselines(db, collector.id);
  const goodRow = (lastGood?.rows?.[0] ?? null) as ScrapedRow | null;
  const badRow = (input.badRows[0] ?? null) as ScrapedRow | null;

  const balanceBefore = await readBalance(deps);

  // ── The breaker, before the episode is opened ──────────────────────────────────────────────
  const attemptsLast24h = await healAttemptsLast24h(db, collector.id);
  const firstVerdict = checkBreaker(
    {
      killSwitchEnabled: deps.killSwitchEnabled,
      healAttemptsLast24h: attemptsLast24h,
      rejectionsThisEpisode: 0,
      accountBalance: balanceBefore,
    },
    deps.limits,
  );

  const episode = await openEpisode(db, {
    collectorId: collector.id,
    workspaceId: collector.workspace_id,
    trigger: input.trigger,
    authorisedBy: authorised,
    fhsBefore: input.breakdown.fhs,
    failedFields: input.breakdown.failed_fields,
    snapshotBefore: {
      last_known_good_row: goodRow,
      last_known_good_fhs: lastGood?.fhs ?? null,
      baselines: baselines.map((b) => ({ url: b.url, shape: b.shape })),
    },
    operatorPromptedAt: input.operatorPromptedAt ?? null,
    operatorActedAt: input.operatorActedAt ?? null,
  });

  const finish = async (
    finalState: EpisodeFinalState,
    reason: string,
    extra: { fhsAfter?: number | null; snapshotAfter?: unknown; attempts: number; rejections?: number },
  ): Promise<EpisodeOutcome> => {
    const balanceAfter = await readBalance(deps);
    const creditsSpent =
      balanceBefore !== null && balanceAfter !== null ? balanceBefore - balanceAfter : null;
    const durationMs = now() - startedAt;

    await closeEpisode(db, {
      episodeId: episode.id,
      finalState,
      fhsAfter: extra.fhsAfter ?? null,
      snapshotAfter: extra.snapshotAfter,
      creditsSpent,
      durationMs,
      attemptCount: extra.attempts,
    });

    log.info('episode closed', {
      episode_id: episode.id,
      final_state: finalState,
      attempts: extra.attempts,
      fhs_before: input.breakdown.fhs,
      fhs_after: extra.fhsAfter ?? null,
      credits_spent: creditsSpent,
      duration_ms: durationMs,
      reason,
    });

    // Every terminal path converges here, which is why the alert lives here and not at each return:
    // an episode that ends without a notification would be one somebody has to go looking for.
    const notify = deps.notify ?? silentNotifier;
    if (finalState === 'RESTORED') {
      await notify.restored({
        collectorName: collector.name,
        fieldsRepaired: input.breakdown.failed_fields,
        fhsBefore: input.breakdown.fhs,
        fhsAfter: extra.fhsAfter ?? null,
        attempts: extra.attempts,
        rejections: extra.rejections ?? 0,
        creditsSpent,
        durationMs,
      });
    } else if (finalState === 'QUARANTINED') {
      await notify.quarantined({
        collectorName: collector.name,
        reason,
        attempts: extra.attempts,
        fhsBefore: input.breakdown.fhs,
        creditsSpent,
        durationMs,
      });
    }

    return {
      episodeId: episode.id,
      finalState,
      attempts: extra.attempts,
      fhsAfter: extra.fhsAfter ?? null,
      creditsSpent,
      durationMs,
      reason,
    };
  };

  if (!firstVerdict.allowed) {
    log.warn('circuit breaker refused the repair', {
      episode_id: episode.id,
      rail: firstVerdict.rail,
      reason: firstVerdict.reason,
    });
    await moveRun({ from: input.trigger === 'BROKEN' ? 'BROKEN' : 'PENDING_OPERATOR', to: 'QUARANTINED' });
    return finish('QUARANTINED', `circuit breaker tripped — ${firstVerdict.reason}`, { attempts: 0 });
  }

  // ── Page context for the diagnosis: where did the data move to? ────────────────────────────
  const pageMarkdown = await probePageMarkdown(deps, collector.target_url);

  // ── The repair loop ───────────────────────────────────────────────────────────────────────
  const evidence = buildEvidence({
    after: input.breakdown,
    before: null,
    contract,
    goodRow,
    badRow,
    pageMarkdown,
  });

  let description = buildDiagnosis(evidence);
  let attemptNo = 0;
  let rejections = 0;

  // BROKEN -> DIAGNOSING, or PENDING_OPERATOR -> DIAGNOSING. Both edges exist in the frozen table;
  // which one applies is exactly the severity decision that got us here.
  await moveRun({ from: input.trigger === 'BROKEN' ? 'BROKEN' : 'PENDING_OPERATOR', to: 'DIAGNOSING' });

  // Bounded by the breaker's own rejection rail; the loop condition is a backstop, not the rule.
  for (;;) {
    attemptNo += 1;

    const diagnosisDecision = decideAfterDiagnosis(description.length);
    await moveRun({ from: diagnosisDecision.from, to: diagnosisDecision.next });
    log.info('diagnosis built', {
      episode_id: episode.id,
      attempt_no: attemptNo,
      chars: description.length,
      failed_fields: evidence.failedFields.map((f) => f.name),
      reason: diagnosisDecision.reason,
    });

    // The attempt row exists before the subprocess does. Argv is filled in after the call returns —
    // it is not known until then — but the diagnosis and the intent are on record first.
    const attempt = await recordAttempt(db, {
      episodeId: episode.id,
      attemptNo,
      descriptionSent: description,
      cliArgvRedacted: `brightdata scraper heal ${collector.collector_id} <diagnosis> --url ${collector.target_url} --json`,
    });

    const healResult = await brightdata.healScraper({
      collectorId: collector.collector_id,
      diagnosis: description,
      url: collector.target_url,
    });

    const canary = healResult.ok ? extractCanarySample(healResult.data) : null;
    const healDecision = decideAfterHeal({
      ok: healResult.ok,
      awaitingApproval: healResult.ok ? isAwaitingApproval(healResult.data) : false,
      hasCanary: Array.isArray(canary) && canary.length > 0,
      error: healResult.error?.message ?? healResult.stderrExcerpt ?? undefined,
    });

    await moveRun({ from: healDecision.from, to: healDecision.next });

    if (healDecision.next === 'QUARANTINED') {
      await noteAttemptFailure(db, {
        attemptId: attempt.id,
        cliArgvRedacted: healResult.argvRedacted,
        stderrExcerpt: healResult.stderrExcerpt ?? healResult.error?.message ?? null,
      });
      log.error('heal did not reach a verifiable gate', {
        episode_id: episode.id,
        attempt_no: attemptNo,
        reason: healDecision.reason,
        stderr: healResult.stderrExcerpt,
      });
      return finish('QUARANTINED', healDecision.reason, { attempts: attemptNo });
    }

    const canaryRows = canary ?? [];
    const gateDecision = decideAfterGate(canaryRows.length);
    await moveRun({ from: gateDecision.from, to: gateDecision.next });
    log.info('proposed fix waiting at the gate', {
      episode_id: episode.id,
      attempt_no: attemptNo,
      reason: gateDecision.reason,
    });

    // The canary is scored by the SAME function that scored the break. That is what makes the gate
    // mean anything: a fix is judged by the measure it has to satisfy in production.
    const canaryScore = scoreCanary(canaryRows, contract);
    const canaryDecision = decideAfterCanary(canaryScore.fhs);
    await moveRun({ from: canaryDecision.from, to: canaryDecision.next });

    log.info('canary scored', {
      episode_id: episode.id,
      attempt_no: attemptNo,
      canary_fhs: canaryScore.fhs,
      failed_fields: canaryScore.failed_fields,
      decision: canaryDecision.approved ? 'APPROVED' : 'REJECTED',
      reason: canaryDecision.reason,
    });

    // ── Rejected ──────────────────────────────────────────────────────────────────────────
    if (!canaryDecision.approved) {
      const rejectResult = await brightdata.rejectHeal({ collectorId: collector.collector_id });

      await settleAttempt(db, {
        attemptId: attempt.id,
        canarySample: canaryRows,
        canaryFhs: canaryScore.fhs,
        decision: 'REJECTED',
        rejectionReason: canaryDecision.reason,
        stderrExcerpt: rejectResult.ok ? null : rejectResult.stderrExcerpt ?? null,
      });

      rejections += 1;

      const retry = decideAfterRejection(
        {
          killSwitchEnabled: deps.killSwitchEnabled,
          healAttemptsLast24h: attemptsLast24h + attemptNo,
          rejectionsThisEpisode: rejections,
          accountBalance: await readBalance(deps),
        },
        deps.limits,
      );

      await moveRun({ from: retry.from, to: retry.next });

      if (retry.next === 'QUARANTINED') {
        return finish('QUARANTINED', retry.reason, {
          attempts: attemptNo,
          rejections,
          fhsAfter: canaryScore.fhs,
        });
      }

      // Never resend an identical description — the healer would have no reason to answer
      // differently, and we would pay again for the fix we just refused.
      const worst = canaryScore.field_scores.find((f) => f.below_min_fill);
      description = refineDiagnosis(description, {
        field: worst?.field ?? evidence.failedFields[0]?.name ?? 'the broken field',
        observed: worst && worst.fill_rate === 0 ? 'nothing' : 'an unusable value',
        expectedType:
          contract.fields.find((f) => f.name === worst?.field)?.type ?? 'valid value',
      });
      continue;
    }

    // ── Approved: commit, then prove it ───────────────────────────────────────────────────
    const approveResult = await brightdata.approveHeal({
      collectorId: collector.collector_id,
      url: collector.target_url,
    });

    await settleAttempt(db, {
      attemptId: attempt.id,
      canarySample: canaryRows,
      canaryFhs: canaryScore.fhs,
      decision: 'APPROVED',
      stderrExcerpt: approveResult.ok ? null : approveResult.stderrExcerpt ?? null,
    });

    if (!approveResult.ok) {
      await moveRun({ from: 'APPROVING', to: 'QUARANTINED' });
      return finish(
        'QUARANTINED',
        `the fix cleared the gate but the approve call failed — ${approveResult.error?.message ?? 'unknown error'}`,
        { attempts: attemptNo, fhsAfter: canaryScore.fhs },
      );
    }

    // The fix is now committed in place and cannot be rolled back. Everything below is finding out
    // whether that was the right call.
    const confirmation = await confirmAgainstGoldenSet(deps, { collector, contract, baselines });

    const decision = decideAfterConfirmation({ goldenMatchRate: confirmation.matchRate });
    await moveRun({ from: decision.from, to: decision.next });

    if (decision.next === 'RESTORED') {
      // Baselines refresh only now — never from a degraded or mid-heal run (doc 01 §3.4).
      for (const entry of confirmation.entries) {
        await upsertBaseline(db, {
          collectorId: collector.id,
          url: entry.url,
          baseline: captureBaseline(entry.rows, contract) ?? ({} as ScrapedRow),
          shape: contract.golden_set_shape,
        });
      }

      return finish('RESTORED', decision.reason, {
        attempts: attemptNo,
        rejections,
        fhsAfter: confirmation.fhs,
        snapshotAfter: { confirmation_rows: confirmation.entries[0]?.rows?.slice(0, 3) ?? [] },
      });
    }

    log.error('a committed fix failed its golden-set confirmation', {
      episode_id: episode.id,
      match_rate: confirmation.matchRate,
      failures: confirmation.failures,
    });

    return finish('QUARANTINED', decision.reason, {
      attempts: attemptNo,
      fhsAfter: confirmation.fhs,
      snapshotAfter: { failures: confirmation.failures },
    });
  }
}

/**
 * The post-approval confirmation run — doc 01 §7.
 *
 * Runs the repaired collector against every pinned URL and compares each to its baseline. This is
 * the difference between "the canary looked good" and "the scraper works", and it is the only thing
 * standing between a plausible-but-wrong fix and a RESTORED badge.
 */
async function confirmAgainstGoldenSet(
  deps: EpisodeDeps,
  input: {
    collector: CollectorRow;
    contract: CollectorContract;
    baselines: Awaited<ReturnType<typeof getBaselines>>;
  },
): Promise<{
  matchRate: number;
  fhs: number | null;
  failures: string[];
  entries: { url: string; rows: unknown[] }[];
}> {
  const urls = input.contract.golden_set;
  const byUrl = new Map(input.baselines.map((b) => [b.url, b]));

  const entries: { url: string; rows: unknown[] }[] = [];
  for (const url of urls) {
    const result = await deps.brightdata.runScraper({
      collectorId: input.collector.collector_id,
      url,
      name: `${input.collector.name} (confirmation)`,
    });
    entries.push({ url, rows: Array.isArray(result.data) ? result.data : [] });
  }

  const evaluated = evaluateGoldenSet(
    entries.map((entry) => ({
      url: entry.url,
      baseline: byUrl.get(entry.url)?.baseline_row ?? null,
      rows: entry.rows,
    })),
    input.contract,
  );

  // Score the confirmation run itself, folding in the match rate — the FHS that lands in
  // `fhs_after` is the real, penalty-adjusted number, not the raw field score.
  const allRows = entries.flatMap((e) => e.rows);
  const scored = scoreFhs(allRows, input.contract, { goldenSetMatchRate: evaluated.match_rate });

  return {
    matchRate: evaluated.match_rate,
    fhs: scored.fhs,
    failures: goldenFailures(evaluated),
    entries,
  };
}

/**
 * Fetch the page as text for the diagnosis's context section.
 *
 * Best-effort by design. Page context is the most valuable part of the prompt and the first thing
 * the character budget sacrifices (doc 01 §5.2), so failing to get it must never stop a repair —
 * the diagnosis is weaker without it, not invalid.
 */
async function probePageMarkdown(deps: EpisodeDeps, url: string): Promise<string | null> {
  try {
    const result = await deps.brightdata.probeUrl({ url, format: 'markdown' });
    const text = typeof result.stdout === 'string' ? result.stdout : null;
    return text && text.trim() !== '' ? text : null;
  } catch {
    return null;
  }
}

/** Re-export so the runner has one import for the healing surface. */
export { compareBaseline };
