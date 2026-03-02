# CLAUDE.md — Shadovi AEO Tracker


## Coding Rules
- Prefer small, focused diffs — no unrequested refactors
- Never hardcode API keys; always read from `.env` or environment
- Never use `rm -rf` or destructive file ops without explicit confirmation
- Always handle API rate limits and auth errors gracefully with retry logic
- When touching the Chart.js dashboard, preserve the white/off-white 2026 aesthetic
- Add comments explaining *why*, not just *what*, for non-obvious logic

## Tech Stack
- Next.js 14, Supabase, Inngest, TypeScript

## Before Writing Any Code
- Describe approach, wait for approval; ask one clarifying question if ambiguous; break 3+ file changes into smaller tasks

## After Writing Code
- List what could break and name the functions/API calls most at risk
- Suggest a quick manual test or smoke test command to verify

## Bug Workflow
- Reproduce → confirm root cause → fix → verify

## Query Engine Rules (Core IP — Handle Carefully)
- Query taxonomy: Problem-Aware → Category → Comparative → Validation intent
- Never collapse all 4 intent layers into generic queries
- Prefer constrained template generation over open-ended LLM output
- Each client should have 15 queries minimum across the 4 intent layers
- Estimated API cost per full client run: ~$0.21/run → flag if a change inflates this


## SAO - short answer only. 
Whenever i put SAO in the prompt, it means i want a short answer only - it is a conversation/brainstorming and back and forth with you. do not execute any code or make any changes to the codebase. just answer my question and wait for my next prompt.

## Learned Rules
<!-- Claude appends corrections here over time -->

## Portfolio Versioning (March 2026)
Portfolio versioning is being implemented via migration 010. See kk_temp_docs/cc_prompt_portfolio_versioning.md for the full spec. Core concept: every query regeneration creates a new portfolio_versions row. Queries are soft-deleted (status='inactive') not hard-deleted. All tracking_runs and brand_knowledge_scores inherit version_id from the query they ran against. Dashboard queries filter by the active version.

## BVI Composite Score (March 2026)
BVI score = (Frequency × 0.6) + (Replication × 0.4), range 0–100, lower is better. 
Computed in lib/bvi/compute-bvi.ts — pure function, no DB calls. Surfaces on Brand Knowledge 
page as a 5-card panel and on Overview as a single card. Severity and Persistence greyed out 
pending future features. INVERTED colour logic: low = green, high = coral.