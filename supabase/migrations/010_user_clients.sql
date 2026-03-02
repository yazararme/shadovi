-- ─── user_clients junction table ─────────────────────────────────────────────
-- Many-to-many mapping between auth users and clients.
-- Replaces clients.user_id for access-control purposes (old column kept for
-- backwards compatibility — do not drop it here).

CREATE TABLE public.user_clients (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- email is stored at mapping time to support pre-signup invitations where
  -- user_id is not yet known; resolved to user_id on first sign-in.
  email      text,
  role       text        NOT NULL DEFAULT 'viewer'
                         CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT user_clients_pkey   PRIMARY KEY (id),
  CONSTRAINT user_clients_unique UNIQUE (user_id, client_id)
);

-- Indexes for the three common lookup patterns
CREATE INDEX idx_user_clients_user_id   ON public.user_clients(user_id);
CREATE INDEX idx_user_clients_client_id ON public.user_clients(client_id);
CREATE INDEX idx_user_clients_email     ON public.user_clients(email);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.user_clients ENABLE ROW LEVEL SECURITY;

-- Regular users may only see their own mappings (matched by user_id or by email
-- for rows created before the user signed up).
CREATE POLICY "user_clients_select_own" ON public.user_clients
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = (auth.jwt() ->> 'email')
    -- Hardcoded admin bypass: yazararme@gmail.com sees every mapping
    OR (auth.jwt() ->> 'email') = 'yazararme@gmail.com'
  );

-- ─── Backfill existing clients ────────────────────────────────────────────────
-- Seed one viewer mapping per existing client so the new table is immediately
-- consistent with the old clients.user_id column.

INSERT INTO public.user_clients (user_id, client_id, role)
SELECT user_id, id, 'viewer'
FROM   public.clients
WHERE  user_id IS NOT NULL
ON CONFLICT DO NOTHING;
