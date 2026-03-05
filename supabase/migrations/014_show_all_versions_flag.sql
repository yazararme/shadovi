ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS show_all_versions boolean NOT NULL DEFAULT false;
