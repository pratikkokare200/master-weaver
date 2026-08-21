# ADR-004 — Text-to-SQL runs on a role that cannot write, not on a guard that says no

- **Status:** Accepted
- **Decided:** 2026-08-21
- **Affects:** `supabase/migrations/0003_readonly_role.sql`, `@weaver/textsql`, `apps/web` (`lib/readonly.server.ts`, `api/collectors/[id]/ask`)
- **Related:** ADR-001 (layer decoupling) · ADR-003 (deny lists read from the argv) · doc 03 §2.3 (no auth in v1)

---

## Context

The Chat panel takes a question in English, asks a language model for SQL, and runs it against the
ledger. Every clause of that sentence is a reason to be careful: the statement is written by a model,
from text a user typed, and executed against the database that holds every run and every healing
episode this project has produced.

The usual implementation is a validator. Check that the string starts with `SELECT`, reject anything
containing `DROP`, run it. That is a string check on adversarial input, and string checks lose to
inputs nobody thought of — `select 1; drop table runs`, a `$tag$`-quoted literal carrying a
semicolon, `SELECT … INTO new_table` (a SELECT by its first word, a CREATE by its effect), a nested
block comment that swallows the check's idea of where the statement ends.

Each of those has an answer. The problem is that the list of things needing an answer is not
knowable in advance, and the cost of being wrong once is the ledger.

## Decision

**Two independent defences, on the assumption that the first one fails.**

**1 · The guard** (`@weaver/textsql`). A small SQL lexer that distinguishes code from string
literals, then: exactly one statement, first keyword `SELECT`/`WITH`, no forbidden word appearing as
code, no filesystem or sleep function, and the statement executed wrapped in
`select * from ( … ) as weaver_result limit 200`.

**2 · The role** (`migrations/0003_readonly_role.sql`). The connection is `weaver_readonly`:
`SELECT` on the six ledger tables and nothing else — no INSERT, no UPDATE, no DELETE, no CREATE, no
default privileges for future tables — with `default_transaction_read_only = on`,
`statement_timeout = 5s` and a pinned `search_path`. The route additionally opens every query with
`set transaction read only`.

The role is created without a password and cannot log in until someone gives it one out of band, and
**there is no fallback to `DATABASE_URL`**. If `DATABASE_URL_READONLY` is missing, the feature
reports that it is not configured.

## Rationale

**Neither layer is sufficient, which is the point.** The guard cannot anticipate every spelling of a
write. The role cannot stop a `SELECT` that reads a column it is entitled to read. A bypass needs
two independent failures, and they fail in different ways: one is a string-matching mistake, the
other a privilege-grant mistake.

**Only one of the two can be tested exhaustively.** The guard has 35 tests, including every injection
shape listed above. The role does not need tests of that kind — its guarantee is Postgres's, not
ours — and it was verified directly instead. With the guard bypassed entirely:

```
DELETE (guard bypassed entirely)     -> refused: cannot execute DELETE in a read-only transaction
SELECT … FOR SHARE                   -> refused: cannot execute SELECT FOR SHARE in a read-only transaction
select * into evil from runs         -> refused: cannot execute SELECT INTO in a read-only transaction
select * from pg_authid              -> refused: permission denied for table pg_authid
```

**The escalation attempt was checked, not assumed.** `SET default_transaction_read_only = off` is
accepted inside the transaction — and the write that follows it is still refused, because changing a
*default* does not change the transaction already in progress, and the `rollback` reverts the setting
before the connection returns to the pool. Verified end to end: the value reads `on` before, `on`
after.

**No fallback, deliberately.** A fallback to `DATABASE_URL` would mean a missing environment variable
silently upgrades model-generated SQL to owner privileges — and everything would appear to work,
which is what makes it the worst available failure mode. The same reasoning produced one more check:
the app refuses to run generated SQL on a **superuser** connection, because a superuser ignores every
grant in the migration while looking correctly configured.

**Grants are enumerated, not wildcarded.** `grant select on table collectors, …` naming six tables,
not `on all tables in schema public`, and no `alter default privileges`. The day someone adds a
table, it is invisible to text-to-SQL until a human grants it. The failure is "I cannot see that
table" rather than an unreviewed disclosure.

**The generated SQL is always shown, including when it is refused.** Doc 05 §6 requires it for
answers; refusals need it more. "The generated query was refused: INTO is not allowed" with the
statement underneath is diagnosable — the same message without it is not, and it is the only way a
user can tell a false positive from a real refusal.

**The prompt is not a defence and is not written as one.** It tells the model where the data is, so
it stops inventing column names. Nothing in the security story depends on the model reading it.

## Consequences

**Accepted:**

- A statement that gets past the guard still cannot write. That is the whole design.
- The guard's mistakes are recoverable in the safe direction: a false positive costs a rephrased
  question, and the refused statement is shown so the user can see why.
- The read-only pool is small (2 connections) and separate, so a runaway query cannot starve the
  pages that render the dashboard.

**Costs:**

- **A second connection string and a manual password step per environment.** The role cannot be
  fully provisioned by a migration, because a password does not belong in a public repository.
  Setup is longer and the feature is off until someone does it.
- The guard rejects some valid SQL. `SET` is banned outright, so a query needing a session setting
  cannot be asked for. Accepted.
- Two words that would be natural to ban are not: `END` (because `CASE … END` is ordinary analytic
  SQL) and `FOR` (because `substring(x from 2 for 3)` is legitimate). `FOR UPDATE` is caught anyway
  by `update`; `FOR SHARE` is left to the read-only transaction. Both checked against Postgres
  rather than assumed.
- **Reads are not restricted at all.** Anyone who can reach the page can read the whole ledger
  through it. That is the same exposure the collector page already has, and it is a consequence of
  v1 having no authentication (doc 03 §2.3) rather than of this decision.

## Alternatives considered

**A · Guard only, on the existing connection.** Rejected. It puts the entire ledger behind one
regular expression, and the failure is silent and permanent.

**B · Role only, no guard.** Tempting, and nearly sufficient — Postgres refuses every write. Rejected
for two reasons. A read can still be pathological (an unbounded cross join over `runs`, where every
row carries a full CLI payload), and a refusal that arrives as a Postgres permission error is much
worse to read than one that names the rule it broke.

**C · Let the model call tools instead of writing SQL.** A fixed set of parameterised queries would
be safe by construction. Rejected because it answers only the questions somebody thought of in
advance, which removes the reason to have text-to-SQL at all.

**D · Run the query through the worker instead of the route.** Rejected. A person is waiting; ADR-001
routes work to the worker when it is *slow*, not when it is *sensitive*, and a 5-second statement
timeout fits inside a request comfortably.

## If revisited

1. **Rate limit it.** The endpoint is unauthenticated and unmetered, and a loop of questions spends
   Groq tokens. This is the most obvious next thing.
2. **Bind the workspace, not just the collector.** `$1` scopes every query to one collector today
   because the page does. When workspaces and auth arrive, the scope has to move into the role — RLS
   with a policy on `workspace_id` — rather than staying in a prompt instruction.
3. **Log every generated statement with its verdict.** Refusals are the interesting ones: a pattern
   of them is either a guard that is too strict or somebody probing it, and today neither is visible.
4. **Reconsider the deny list as an allow list.** A permitted-function list is stricter than a
   forbidden-word list and would not need extending each time Postgres adds a way to write.
