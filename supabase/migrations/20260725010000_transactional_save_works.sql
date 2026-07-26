-- ============================================================
--  Phase 3.5 (the update path) — rewriting a ticket's works, atomically.
--
--  create_ticket handles a NEW ticket in one transaction. Editing an existing
--  ticket's works still went through saveWorks(), which deletes every work for
--  the ticket and re-inserts the current set in separate statements with no
--  transaction. A failure after the delete and before the insert completes
--  leaves the ticket with fewer works than it had — or none. Two people editing
--  the same ticket clobber each other's lines.
--
--  This function does the same wipe-and-reinsert, but as one statement sequence
--  in a single transaction: it all lands or none of it does.
--
--  SECURITY INVOKER, deliberately unlike create_ticket. This one touches no
--  privileged table — only works and work_items, which the caller already has
--  tenant-scoped policies on. Running under the caller's own RLS means the
--  ticket-ownership check is the policy itself: a caller cannot rewrite the
--  works of a ticket in another garage, because they cannot see the parent
--  ticket to match p_ticket_id against, and the work rows they would insert
--  fail the work_items/works tenant policy.
-- ============================================================
create or replace function public.save_ticket_works(p_ticket_id uuid, works jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  w   jsonb;
  wid uuid;
  p   jsonb;
begin
  -- Refuse to touch a ticket the caller cannot see. Without this the delete
  -- below would simply affect zero rows for someone else's ticket, which is
  -- safe but silent; a clear error is better than a no-op that looks like
  -- success.
  if not exists (select 1 from public.tickets where id = p_ticket_id) then
    raise exception 'ticket not found or not in your garage' using errcode = '42501';
  end if;

  delete from public.works where ticket_id = p_ticket_id;

  for w in select * from jsonb_array_elements(coalesce(works, '[]'::jsonb))
  loop
    insert into public.works (ticket_id, uid, code, name, labor, custom, position)
    values (
      p_ticket_id,
      coalesce(w->>'uid', gen_random_uuid()::text),
      nullif(w->>'code',''), coalesce(w->>'name',''),
      coalesce((w->>'labor')::numeric, 0),
      coalesce((w->>'custom')::boolean, false),
      coalesce((w->>'position')::int, 0)
    )
    returning id into wid;

    for p in select * from jsonb_array_elements(coalesce(w->'items', '[]'::jsonb))
    loop
      insert into public.work_items (work_id, sku, name, qty, price, position)
      values (
        wid, nullif(p->>'sku',''), coalesce(p->>'name',''),
        coalesce((p->>'qty')::numeric, 1), coalesce((p->>'price')::numeric, 0),
        coalesce((p->>'position')::int, 0)
      );
    end loop;
  end loop;
end $$;

revoke all on function public.save_ticket_works(uuid, jsonb) from public;
grant execute on function public.save_ticket_works(uuid, jsonb) to authenticated;

comment on function public.save_ticket_works(uuid, jsonb) is
  'Replace a ticket''s works and parts in one transaction — the delete and the '
  're-inserts land together or not at all. SECURITY INVOKER: the caller''s RLS is '
  'the ownership check. See docs/PRODUCTION.md §3.5.';
