-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Client brand profile
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  brand_name TEXT,
  brand_dna JSONB,         -- BrandDNA object: description, POV, category name, strategic_battlegrounds, etc.
  use_cases TEXT[],        -- top 3-5 specific problems solved
  industries TEXT[],
  key_products JSONB,      -- [{name, description}]
  raw_scrape TEXT,         -- full scraped content, kept for re-processing
  selected_models TEXT[] DEFAULT ARRAY['gpt-4o', 'perplexity'],
  tracking_frequency TEXT DEFAULT 'weekly',  -- daily | weekly | monthly
  status TEXT DEFAULT 'onboarding', -- onboarding | active | paused
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Synthetic Buyer personas (up to 5 per client)
CREATE TABLE personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT,               -- e.g. "Skeptical CFO"
  role TEXT,
  pain_points TEXT[],
  buying_triggers TEXT[],  -- what sends them to a chatbot vs Google
  internal_monologue TEXT, -- how they frame their problem internally
  skepticisms TEXT[],      -- what would make them NOT shortlist this brand
  priority INTEGER DEFAULT 1,  -- 1=highest priority persona
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Competitors (with LLM recognition status)
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT,
  context_injection TEXT,  -- brief for unrecognized competitors
  llm_recognized BOOLEAN,  -- overall recognition status
  recognition_detail JSONB, -- per-model recognition {"gpt4o": true, "perplexity": false}
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Generated query portfolio
CREATE TABLE queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  persona_id UUID REFERENCES personas(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  intent TEXT NOT NULL,    -- problem_aware | category | comparative | validation
  funnel_stage TEXT,       -- awareness | consideration | decision
  phrasing_style TEXT,     -- conversational | formal
  rationale TEXT,
  strategic_goal TEXT,
  relevance_score INTEGER, -- 1-10, from critic pass
  status TEXT DEFAULT 'pending_approval', -- pending_approval | active | paused | removed
  created_at TIMESTAMPTZ DEFAULT now()
);

-- LLM tracking runs
CREATE TABLE tracking_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID REFERENCES queries(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  model TEXT NOT NULL,     -- gpt-4o | claude-sonnet-4-6 | perplexity | gemini
  ran_at TIMESTAMPTZ DEFAULT now(),
  raw_response TEXT,
  brand_mentioned BOOLEAN,
  mention_position TEXT,   -- first_third | middle | last_third | not_mentioned
  mention_sentiment TEXT,  -- positive | neutral | negative | not_mentioned
  competitors_mentioned TEXT[],
  cited_sources JSONB,     -- [{url, domain, snippet}]
  share_of_model_score NUMERIC  -- calculated field 0-1
);

-- Authority Blueprint tasks
CREATE TABLE recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  query_id UUID REFERENCES queries(id) ON DELETE SET NULL,
  type TEXT,               -- content_directive | entity_foundation | placement_strategy
  priority INTEGER,        -- 1=highest
  title TEXT,
  description TEXT,        -- specific actionable task
  rationale TEXT,          -- which gap this addresses
  status TEXT DEFAULT 'open', -- open | in_progress | done | dismissed
  created_at TIMESTAMPTZ DEFAULT now()
);
