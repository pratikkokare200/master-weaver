# ADR-001 — Strict Decoupling of Observation Deck and Autonomous Engine

- **Status:** Accepted
- **Decided:** 2026-08-17
- **Affects:** System Architecture, Deployment Strategy

## Context
Master Weaver is an autonomous system that repairs broken web scrapers. A full healing episode (detect → probe → diagnose → heal → canary → approve → confirm) requires multiple sequential calls to the Bright Data CLI. This process takes 30 to 60 seconds, and sometimes longer if multiple refinement attempts are needed.

Initially, it is tempting to run this logic in a serverless function (like a Next.js API route). However, Vercel serverless functions forcefully terminate after 10–60 seconds on standard tiers. If a serverless function kills our healing process mid-episode, the collector could be left in an unstable state, or an approved fix might never get confirmed.

## Decision
We will strictly decouple the system into three layers:
1. **Layer A (Observation Deck):** A read-only Next.js application deployed on Vercel. It never runs scraping or healing logic directly; it only enqueues jobs and reads results.
2. **Layer B (Persistence & Queue):** Supabase Postgres. It acts as both our ledger and a job queue (using `FOR UPDATE SKIP LOCKED`).
3. **Layer C (Autonomous Engine):** A long-running Node.js worker process. This worker polls the Supabase queue and executes the Bright Data CLI commands. 

## Consequences
**Accepted:**
- The Next.js UI remains incredibly fast because it never blocks waiting for a Bright Data scrape to complete.
- The Node worker can take as long as it needs to run a complex healing episode without timing out. 
- We avoid the complexity of a dedicated message broker (like RabbitMQ or Redis) by using Postgres as a queue, keeping the stack lean for the hackathon window.

**Costs:**
- We must deploy the Node worker separately to a platform that supports long-running processes (e.g., Railway, Render, or Fly.io), adding a slight deployment overhead on Day 5.