## Query tracking challenge

Parked for project documentation — Query Change / Progress Tracking Problem:

If a user modifies, removes, or adds queries after the first run, historical comparisons break. You can't track trend on a query that didn't exist 4 weeks ago, and removing a query erases its baseline. This is the core longitudinal data integrity problem for Shadovi.


Options to resolve in later phases: (a) never delete queries, only "archive" them — archived queries stop running but preserve history; (b) treat query sets as versioned "snapshots" — a new version starts a fresh baseline while old version history is preserved; (c) flag any run where the query set changed so trend charts show a discontinuity marker rather than a false line. Recommended: archive + discontinuity marker as the minimum viable solution.


## Marketing funnel

Show performance on each step of the funnel

## Citations
ok now the citations feature discussion. i think there is a ton of value in including


## Brand Facts
Give the user a chance to upload "brand facts" documentation anytime - including URLs,docs etc.

## perception vs presence

which one do i want to use as the name?

## feedback 
Structural feedback
You need a "Bait Facts" section or clear visual separation. Right now bait and real facts are mixed in the same table with just a BAIT tag. For a client presentation, bait results belong in their own section with a short explanation — "we tested whether LLMs can be led into false claims about your brand." That's a distinct and powerful story from accuracy on real features.
60 scored runs shown as "50 of 60" at the bottom — pagination exists but doesn't tell you what's missing. The 10 hidden runs might include more hallucinations. Add a "view all" or at minimum surface the summary stats for the hidden rows.
Claude is still missing. You have 30 Perplexity, 30 GPT-4o runs in the knowledge table, no Claude, no Gemini — yet the header says "4 models." Either the counter is wrong or runs didn't complete. Fix this before showing it to Beko — they'll ask immediately.
