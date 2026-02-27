# CLAUDE.md — Shadovi AEO Tracker

## Project Overview
Shadovi tracks brand visibility across LLMs (ChatGPT, Claude, Perplexity).
Core value: show clients they have **zero or low or improvable LLM visibility** before competitors do.
Dual use: SaaS product + consulting deliverable for founders.


## Coding Rules
- Prefer small, focused diffs — no unrequested refactors
- Never hardcode API keys; always read from `.env` or environment
- Never use `rm -rf` or destructive file ops without explicit confirmation
- Always handle API rate limits and auth errors gracefully with retry logic
- When touching the Chart.js dashboard, preserve the white/off-white 2026 aesthetic
- Add comments explaining *why*, not just *what*, for non-obvious logic

## Before Writing Any Code
1. Describe your approach in bullet points and **wait for approval**
2. If requirements are ambiguous, ask one clarifying question before proceeding
3. If changes span more than 3 files, break into smaller tasks and confirm order first

## After Writing Code
- List what could break and name the functions/API calls most at risk
- Suggest a quick manual test or smoke test command to verify

## Bug Workflow
1. First, reproduce the bug with a minimal test or print-debug trace
2. Confirm root cause before touching code
3. Fix, then verify the original symptom is gone

## Query Engine Rules (Core IP — Handle Carefully)
- Query taxonomy: Problem-Aware → Category → Comparative → Validation intent
- Never collapse all 4 intent layers into generic queries
- Prefer constrained template generation over open-ended LLM output
- Each client should have 15 queries minimum across the 4 intent layers
- Estimated API cost per full client run: ~$0.21/run → flag if a change inflates this


## Self-Updating Rule
Every time I correct you, add the lesson as a new rule at the bottom of this file
under a `## Learned Rules` section so it never happens again.

## SAO - short answer only. 
Whenever i put SAO in the prompt, it means i want a short answer only - it is a conversation/brainstorming and back and forth with you. do not execute any code or make any changes to the codebase. just answer my question and wait for my next prompt.

## When Compacting
Always preserve:
- The full list of modified files
- Any failing API calls and their error messages
- The current client being worked on
- Outstanding tasks not yet implemented

## Learned Rules
<!-- Claude appends corrections here over time -->
