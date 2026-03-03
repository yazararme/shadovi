-- Migration 012: Remove hardcoded admin email from RLS policies
--
-- Migrations 010 and 011 included a hardcoded email bypass clause that allowed
-- a single email address to read every row across all tenants. The admin panel
-- already uses createServiceClient() (service-role key, bypasses RLS entirely),
-- so these RLS bypasses provide no functional benefit and are a security risk
-- if the account is ever compromised.
--
-- This migration recreates the affected policies without the bypass clause.

-- ── user_clients ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_clients_select_own" ON public.user_clients;

CREATE POLICY "user_clients_select_own" ON public.user_clients
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = (auth.jwt() ->> 'email')
  );

-- ── portfolio_versions ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "portfolio_versions_select_own" ON public.portfolio_versions;

CREATE POLICY "portfolio_versions_select_own" ON public.portfolio_versions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE clients.id = portfolio_versions.client_id
        AND clients.user_id = auth.uid()
    )
  );
