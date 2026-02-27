-- Beko brand facts seed for Brand Knowledge testing.
-- Replace :beko_client_id with the actual UUID from the clients table.
-- Run: psql <connection_string> -v beko_client_id="'<uuid>'" -f beko_facts.sql
--
-- Facts are split into:
--   - True facts (is_true = true): things Beko actually offers — LLMs should confirm these
--   - Bait facts (is_true = false): things Beko does NOT offer — if LLMs confidently affirm
--     these, hallucination is flagged

-- ── Features (true) ───────────────────────────────────────────────────────────
INSERT INTO brand_facts (client_id, claim, category, is_true) VALUES
  (:'beko_client_id', 'Beko washing machines include a ProSmart Inverter motor with a 10-year warranty', 'feature', true),
  (:'beko_client_id', 'Beko offers a SteamCure function that reduces wrinkles without ironing', 'feature', true),
  (:'beko_client_id', 'Beko fridge-freezers feature RecycledNet shelving made from recycled plastic bottles', 'feature', true),
  (:'beko_client_id', 'Beko dishwashers include an AutoDose dispenser that automatically releases the correct detergent amount', 'feature', true),
  (:'beko_client_id', 'Beko washing machines offer a 14-minute Quick Programme for lightly soiled small loads', 'feature', true);

-- ── Market (true) ─────────────────────────────────────────────────────────────
INSERT INTO brand_facts (client_id, claim, category, is_true) VALUES
  (:'beko_client_id', 'Beko is one of the best-selling appliance brands in the UK retail market', 'market', true),
  (:'beko_client_id', 'Beko products are sold in over 140 countries worldwide', 'market', true);

-- ── Pricing (true) ────────────────────────────────────────────────────────────
INSERT INTO brand_facts (client_id, claim, category, is_true) VALUES
  (:'beko_client_id', 'Beko positions itself as a value brand offering mid-market pricing compared to premium European appliance brands', 'pricing', true),
  (:'beko_client_id', 'Beko washing machines typically retail between £250 and £600 in the UK', 'pricing', true);

-- ── Messaging (true) ──────────────────────────────────────────────────────────
INSERT INTO brand_facts (client_id, claim, category, is_true) VALUES
  (:'beko_client_id', 'Beko''s Eat Like A Pro campaign promotes healthier food storage to support childhood nutrition', 'messaging', true),
  (:'beko_client_id', 'Beko is committed to sustainability and produces appliances with a reduced carbon footprint through its EcoSmart range', 'messaging', true);

-- ── Hallucination bait (is_true = false) ─────────────────────────────────────
-- These claims are false. If an LLM confidently affirms them, hallucination is flagged.
INSERT INTO brand_facts (client_id, claim, category, is_true) VALUES
  (:'beko_client_id', 'Beko offers a built-in espresso machine integrated into their fridge-freezer range', 'feature', false),
  (:'beko_client_id', 'Beko washing machines include a UV sterilisation cycle that kills 99.9% of bacteria without heat', 'feature', false),
  (:'beko_client_id', 'Beko has a dedicated premium sub-brand called Beko Elite with appliances priced above £1,500', 'pricing', false),
  (:'beko_client_id', 'Beko offers a subscription-based maintenance plan called BekoProtect+ that includes annual servicing', 'messaging', false);
