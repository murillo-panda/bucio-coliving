create extension if not exists pgcrypto;
create schema if not exists private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  is_active boolean not null default true,
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members(user_id);

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening', 'income', 'expense')),
  concept text not null check (char_length(btrim(concept)) between 2 and 180),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles(id) on delete restrict,
  created_by_label text,
  source text not null default 'app' check (source in ('app', 'google_sheets_import', 'system')),
  source_reference text,
  source_sequence integer,
  reversal_of uuid unique references public.cash_movements(id) on delete restrict,
  reversal_reason text,
  constraint movement_reversal_reason check (
    (reversal_of is null and reversal_reason is null)
    or (reversal_of is not null and char_length(btrim(reversal_reason)) >= 5)
  ),
  unique (organization_id, source_reference)
);

create index cash_movements_account_order_idx
  on public.cash_movements(cash_account_id, occurred_at, source_sequence, created_at);
create index cash_movements_organization_idx on public.cash_movements(organization_id);

create table public.movement_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  movement_id uuid not null unique references public.cash_movements(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  content_type text not null check (content_type like 'image/%'),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 1048576),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute procedure public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger members_set_updated_at before update on public.organization_members
  for each row execute procedure public.set_updated_at();

create or replace function private.is_active_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.is_active
  );
$$;

create or replace function private.has_role(target_organization_id uuid, accepted_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.is_active
      and member.role = any(accepted_roles)
  );
$$;

create or replace function private.can_view_profile(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_user_id = auth.uid() or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.is_active and theirs.user_id = target_user_id
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, text[]) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

create or replace function private.block_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Los movimientos de caja son inmutables; crea un contramovimiento.';
end;
$$;

create trigger cash_movements_are_immutable
  before update or delete on public.cash_movements
  for each row execute procedure private.block_ledger_mutation();

create or replace function private.validate_movement_account()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.cash_accounts account
    where account.id = new.cash_account_id
      and account.organization_id = new.organization_id
  ) then
    raise exception 'La caja no pertenece a la organización indicada.';
  end if;
  return new;
end;
$$;

create trigger validate_cash_movement_account
  before insert on public.cash_movements
  for each row execute procedure private.validate_movement_account();

create or replace function private.audit_movement_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    new.organization_id,
    new.created_by,
    case when new.reversal_of is null then 'movement.created' else 'movement.reversed' end,
    'cash_movement',
    new.id::text,
    jsonb_build_object('source', new.source, 'reversal_of', new.reversal_of)
  );
  return new;
end;
$$;

create trigger audit_cash_movement_insert
  after insert on public.cash_movements
  for each row execute procedure private.audit_movement_insert();

create or replace function public.reverse_cash_movement(target_movement_id uuid, reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  original public.cash_movements;
  new_id uuid;
begin
  if char_length(btrim(coalesce(reason, ''))) < 5 then raise exception 'El motivo debe tener al menos 5 caracteres.'; end if;
  select * into original from public.cash_movements where id = target_movement_id;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if not private.has_role(original.organization_id, array['admin']) then raise exception 'Solo un administrador puede anular movimientos.'; end if;
  if original.movement_type = 'opening' then raise exception 'El saldo de apertura no se puede anular desde la aplicación.'; end if;
  if original.reversal_of is not null then raise exception 'Un contramovimiento no se puede volver a anular.'; end if;
  if exists (select 1 from public.cash_movements where reversal_of = original.id) then raise exception 'Este movimiento ya fue anulado.'; end if;

  insert into public.cash_movements (
    organization_id, cash_account_id, movement_type, concept, amount,
    occurred_at, created_by, source, reversal_of, reversal_reason
  ) values (
    original.organization_id,
    original.cash_account_id,
    case when original.movement_type = 'income' then 'expense' else 'income' end,
    'Anulación: ' || original.concept,
    original.amount,
    now(),
    auth.uid(),
    'app',
    original.id,
    btrim(reason)
  ) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.reverse_cash_movement(uuid, text) from public;
grant execute on function public.reverse_cash_movement(uuid, text) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.cash_movements enable row level security;
alter table public.movement_receipts enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_select on public.organizations for select to authenticated using (private.is_active_member(id));
create policy profiles_select on public.profiles for select to authenticated using (private.can_view_profile(id));
create policy members_select on public.organization_members for select to authenticated using (private.is_active_member(organization_id));
create policy accounts_select on public.cash_accounts for select to authenticated using (private.is_active_member(organization_id));
create policy movements_select on public.cash_movements for select to authenticated using (private.is_active_member(organization_id));
create policy movements_insert on public.cash_movements for insert to authenticated with check (
  private.has_role(organization_id, array['admin', 'operator'])
  and created_by = auth.uid()
  and source = 'app'
  and reversal_of is null
  and (movement_type in ('income', 'expense') or private.has_role(organization_id, array['admin']))
);
create policy receipts_select on public.movement_receipts for select to authenticated using (private.is_active_member(organization_id));
create policy receipts_insert on public.movement_receipts for insert to authenticated with check (
  private.has_role(organization_id, array['admin', 'operator'])
  and created_by = auth.uid()
  and exists (
    select 1 from public.cash_movements movement
    where movement.id = movement_id
      and movement.organization_id = organization_id
      and movement.created_by = auth.uid()
  )
);
create policy audit_select on public.audit_events for select to authenticated using (private.has_role(organization_id, array['admin']));

revoke all on public.organizations, public.profiles, public.organization_members,
  public.cash_accounts, public.cash_movements, public.movement_receipts,
  public.audit_events from anon, authenticated;
grant select on public.organizations, public.profiles, public.organization_members,
  public.cash_accounts, public.cash_movements, public.movement_receipts to authenticated;
grant insert on public.cash_movements, public.movement_receipts to authenticated;
grant select on public.audit_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy receipts_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'receipts' and private.is_active_member((storage.foldername(name))[1]::uuid)
);
create policy receipts_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts' and private.has_role((storage.foldername(name))[1]::uuid, array['admin', 'operator'])
);
