-- Run before 20261101090000_tickets_cancel_not_delete.sql reaches an
-- environment, and again after: tickets with no customer_id predate the rule
-- that every work order belongs to a customer. The migration stops new ones;
-- these have to be attached by hand (or a customer opened for them), since a
-- name typed into a ticket is not enough to pick the right record safely.
--
-- Read-only. Paste into the SQL editor of the target project.

select g.name as garage,
       count(*) as tickets_without_customer
  from public.tickets t
  join public.garages g on g.id = t.garage_id
 where t.customer_id is null
 group by g.name
 order by 2 desc;

-- The rows themselves, with the likeliest match: same garage, same name, and
-- the same phone digits when the ticket has a phone.
select t.garage_id, t.key, t.created_at, t.customer_name, t.phone,
       (select string_agg(c.id::text, ', ')
          from public.customers c
         where c.garage_id = t.garage_id
           and c.name = t.customer_name
           and (t.phone is null
                or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
                   = regexp_replace(t.phone, '\D', '', 'g'))) as candidate_customers
  from public.tickets t
 where t.customer_id is null
 order by t.garage_id, t.created_at;
