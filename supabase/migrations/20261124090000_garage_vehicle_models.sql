-- The makes and models this garage has already written on its cars, for the
-- intake form's suggestions.
--
-- The static VEHICLE_CATALOG in @garage/shared is a starting point; it cannot
-- know the grey import a garage sees every week. A make or model typed once and
-- saved on a car is offered the next time, in that garage only (2026-11-22).
--
-- Nothing new is stored: the cars themselves are the list. A typo therefore
-- leaves the suggestions as soon as the car is corrected, and the legacy import
-- counts from day one. Spellings are returned as typed (trimmed) with a count;
-- the client folds near-identical spellings and merges with the catalog — see
-- mergeVehicleCatalog in packages/shared/src/vehicleCatalog.ts.
--
-- security invoker: the cars RLS policy keeps it to the caller's garage.

create or replace function public.garage_vehicle_models()
returns table (manufacturer text, model text, uses integer)
language sql stable
security invoker
set search_path = ''
as $$
  select btrim(c.manufacturer)              as manufacturer,
         nullif(btrim(c.model), '')         as model,
         count(*)::integer                  as uses
    from public.cars c
   where nullif(btrim(c.manufacturer), '') is not null
   group by 1, 2
$$;

comment on function public.garage_vehicle_models() is
  'Distinct (make, model) pairs on the caller''s cars with how many cars carry each. Feeds the intake form suggestions; see mergeVehicleCatalog in @garage/shared.';

revoke all on function public.garage_vehicle_models() from public, anon;
grant execute on function public.garage_vehicle_models() to authenticated;
