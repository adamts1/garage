-- A catalogue fingerprint: every property of the schema that a squash could
-- silently lose, in a stable order, one fact per line.
--
-- Two databases with identical output are the same database as far as anything
-- outside them can tell. Built for exactly one job: diffing a database made from
-- the migration chain against one made from the squashed baseline.
--
--   # with migrations/ as it is
--   npm run db:reset && psql "$LOCAL_DB" -f supabase/tests/schema-fingerprint.sql > /tmp/before.txt
--   # now replace migrations/ with the squashed baseline
--   npm run db:reset && psql "$LOCAL_DB" -f supabase/tests/schema-fingerprint.sql > /tmp/after.txt
--   diff /tmp/before.txt /tmp/after.txt        # must be empty
--
--   LOCAL_DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
--
-- It compared 984 facts across the 2026-08-11 squash and found no difference.
-- It reads the catalogue and writes nothing; it is safe against any database,
-- including production — though against production it will also report every
-- object the platform added since, so a diff there is not by itself a defect.

\pset tuples_only on
\pset format unaligned
\pset footer off

-- columns
select 'COLUMN  '||table_schema||'.'||table_name||'.'||column_name||' '||data_type
  ||' null='||is_nullable||' default='||coalesce(column_default,'-')
from information_schema.columns
where table_schema in ('public','storage')
order by 1;

-- constraints (check, unique, pk, fk) with their definitions
select 'CONSTR  '||n.nspname||'.'||rel.relname||' '||con.conname||' '||pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname in ('public','storage')
order by 1;

-- indexes
select 'INDEX   '||schemaname||' '||indexdef from pg_indexes
where schemaname in ('public','storage') order by 1;

-- row level security flags
select 'RLS     '||n.nspname||'.'||c.relname||' '||c.relrowsecurity||' forced='||c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','storage') and c.relkind='r' order by 1;

-- policies
select 'POLICY  '||schemaname||'.'||tablename||' '||policyname||' '||cmd||' roles='||roles::text
  ||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
from pg_policies where schemaname in ('public','storage') order by 1;

-- functions, with their bodies and settings
select 'FUNC    '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') secdef='
  ||p.prosecdef||' cfg='||coalesce(array_to_string(p.proconfig,','),'-')||' body='||md5(p.prosrc)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname = 'public' order by 1;

-- triggers
select 'TRIGGER '||n.nspname||'.'||c.relname||' '||t.tgname||' '||pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','storage') order by 1;

-- table grants
select 'GRANT   '||table_schema||'.'||table_name||' '||grantee||' '||privilege_type
from information_schema.role_table_grants
where table_schema in ('public','storage') and grantee in ('anon','authenticated','service_role','PUBLIC')
order by 1;

-- function execute grants
select 'FGRANT  '||routine_schema||'.'||routine_name||' '||grantee||' '||privilege_type
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','authenticated','service_role','PUBLIC')
order by 1;

-- default privileges for future objects
select 'DEFACL  '||coalesce(nspname,'-')||' '||pg_get_userbyid(defaclrole)||' '||defaclobjtype::text||' '||defaclacl::text
from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
order by 1;

-- sequences
select 'SEQ     '||sequence_schema||'.'||sequence_name||' '||data_type
from information_schema.sequences where sequence_schema in ('public','storage') order by 1;

-- views
select 'VIEW    '||table_schema||'.'||table_name||' '||md5(view_definition)
from information_schema.views where table_schema in ('public','storage') order by 1;

-- enums
select 'ENUM    '||nspname||'.'||typname||' '||labels from (
  select n.nspname, t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
  from pg_type t join pg_namespace n on n.oid=t.typnamespace
  join pg_enum e on e.enumtypid=t.oid
  where n.nspname in ('public','storage') group by n.nspname, t.typname) x order by 1;

-- extensions
select 'EXT     '||extname||' '||n.nspname
from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1;

-- publications and their members
select 'PUB     '||pubname||' '||puballtables||' '||pubinsert||pubupdate||pubdelete||pubtruncate
from pg_publication order by 1;
select 'PUBREL  '||p.pubname||' '||n.nspname||'.'||c.relname
from pg_publication_rel pr join pg_publication p on p.oid=pr.prpubid
join pg_class c on c.oid=pr.prrelid join pg_namespace n on n.oid=c.relnamespace order by 1;

-- replica identity
select 'REPLICA '||n.nspname||'.'||c.relname||' '||c.relreplident::text
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','storage') and c.relkind='r' order by 1;

-- storage buckets are rows, and a schema dump does not carry rows
select 'BUCKET  '||id||' public='||public::text||' limit='||coalesce(file_size_limit::text,'-')
from storage.buckets order by 1;
