-- ============================================================
--  Phase 4a — generalise the billing config so a second accounting service is
--  one adapter module away.
--
--  20260727010000 stored iCount-shaped columns: garage_billing.icount_cid and
--  garage_billing_secrets.icount_token. That names one provider into the schema.
--  This migration replaces them with a provider-agnostic credentials bag:
--
--    garage_billing_secrets.credentials jsonb   -- iCount: {"cid","token"};
--                                                   another provider: whatever it needs
--
--  garage_billing keeps only provider-neutral operational settings (provider,
--  doc_type, vat_rate, active). The Edge Function's per-provider adapter is what
--  knows how to read the bag.
--
--  Runs identically on a fresh database (where 20260727010000 just created the
--  iCount-shaped form) and on staging (already carrying real rows) — the backfill
--  moves any existing cid+token into the bag before the old columns are dropped.
-- ============================================================

-- 1) Add the bag and backfill from the old columns (cid lives in garage_billing,
--    token in garage_billing_secrets — join them before either is dropped).
alter table public.garage_billing_secrets add column if not exists credentials jsonb;

update public.garage_billing_secrets s
   set credentials = jsonb_strip_nulls(jsonb_build_object(
         'cid',   b.icount_cid,
         'token', s.icount_token))
  from public.garage_billing b
 where b.garage_id = s.garage_id
   and s.credentials is null;

-- 2) Every secret row now has a bag (icount_token was NOT NULL, so the backfill
--    always produced at least a token). Enforce it going forward.
alter table public.garage_billing_secrets alter column credentials set not null;

-- 3) Drop the iCount-specific columns.
alter table public.garage_billing_secrets drop column if exists icount_token;
alter table public.garage_billing drop column if exists icount_cid;
