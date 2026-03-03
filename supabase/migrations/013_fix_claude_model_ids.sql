-- Fix legacy "claude" model IDs stored before "claude-sonnet-4-6" was standardised.
-- array_replace replaces every occurrence of 'claude' in the selected_models array.
-- Safe to re-run: no-op if 'claude' is not present.
UPDATE clients
SET selected_models = array_replace(selected_models, 'claude', 'claude-sonnet-4-6')
WHERE 'claude' = ANY(selected_models);
