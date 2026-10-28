alter table public.organization_members
  drop constraint if exists organization_members_role_check;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'operator', 'viewer'));

alter table public.organizations
  add column if not exists owner_user_id uuid references public.profiles(id) on delete restrict;

create unique index if not exists organization_single_owner_idx
  on public.organization_members (organization_id)
  where role = 'owner';

create or replace function private.enforce_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  configured_owner_id uuid;
begin
  select organization.owner_user_id
    into configured_owner_id
    from public.organizations organization
    where organization.id = new.organization_id;

  if new.role = 'owner' and configured_owner_id is distinct from new.user_id then
    raise exception 'El rol superusuario está reservado al propietario configurado.';
  end if;

  if tg_op = 'UPDATE'
    and old.role = 'owner'
    and (new.role <> 'owner' or not new.is_active)
  then
    raise exception 'El superusuario no se puede degradar ni desactivar.';
  end if;

  if new.role = 'owner' and not new.is_active then
    raise exception 'El superusuario debe permanecer activo.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_owner_membership() from public, anon, authenticated;

drop trigger if exists enforce_owner_membership on public.organization_members;
create trigger enforce_owner_membership
  before insert or update on public.organization_members
  for each row execute procedure private.enforce_owner_membership();

create table public.cash_movement_visibility (
  movement_id uuid primary key references public.cash_movements(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  is_hidden boolean not null,
  reason text not null check (char_length(btrim(reason)) >= 5),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict
);

create index cash_movement_visibility_organization_idx
  on public.cash_movement_visibility (organization_id, is_hidden, updated_at);

create or replace function private.is_movement_hidden(target_movement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select visibility.is_hidden
    from public.cash_movement_visibility visibility
    where visibility.movement_id = target_movement_id
  ), false);
$$;

create or replace function private.can_view_receipt_storage(target_path text, target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member(target_organization_id)
    and (
      private.has_role(target_organization_id, array['owner'])
      or not exists (
        select 1
        from public.movement_receipts receipt
        where receipt.organization_id = target_organization_id
          and receipt.storage_path = target_path
          and private.is_movement_hidden(receipt.movement_id)
      )
    );
$$;

revoke all on function private.is_movement_hidden(uuid) from public, anon;
revoke all on function private.can_view_receipt_storage(text, uuid) from public, anon;
grant execute on function private.is_movement_hidden(uuid) to authenticated;
grant execute on function private.can_view_receipt_storage(text, uuid) to authenticated;

create or replace function public.set_cash_movement_visibility(
  target_movement_id uuid,
  should_hide boolean,
  reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  movement public.cash_movements;
  current_hidden boolean;
  clean_reason text := btrim(coalesce(reason, ''));
begin
  if char_length(clean_reason) < 5 then
    raise exception 'El motivo debe tener al menos 5 caracteres.';
  end if;

  select * into movement
  from public.cash_movements
  where id = target_movement_id;

  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if not private.has_role(movement.organization_id, array['owner']) then
    raise exception 'Solo el superusuario puede ocultar o restaurar movimientos.';
  end if;
  if movement.movement_type = 'opening' then
    raise exception 'El saldo de apertura no se puede ocultar.';
  end if;

  select visibility.is_hidden into current_hidden
  from public.cash_movement_visibility visibility
  where visibility.movement_id = movement.id;

  if found and current_hidden = should_hide then
    raise exception 'El movimiento ya se encuentra en ese estado.';
  end if;
  if not found and not should_hide then
    raise exception 'El movimiento ya se encuentra visible.';
  end if;

  insert into public.cash_movement_visibility (
    movement_id, organization_id, is_hidden, reason, updated_at, updated_by
  ) values (
    movement.id, movement.organization_id, should_hide, clean_reason, now(), auth.uid()
  )
  on conflict (movement_id) do update set
    is_hidden = excluded.is_hidden,
    reason = excluded.reason,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    movement.organization_id,
    auth.uid(),
    case when should_hide then 'movement.hidden' else 'movement.restored' end,
    'cash_movement',
    movement.id::text,
    jsonb_build_object('reason', clean_reason, 'hidden', should_hide)
  );

  return movement.id;
end;
$$;

revoke all on function public.set_cash_movement_visibility(uuid, boolean, text) from public, anon;
grant execute on function public.set_cash_movement_visibility(uuid, boolean, text) to authenticated;

create or replace function public.reverse_cash_movement(target_movement_id uuid, reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  original public.cash_movements;
  new_id uuid;
begin
  if char_length(btrim(coalesce(reason, ''))) < 5 then raise exception 'El motivo debe tener al menos 5 caracteres.'; end if;
  select * into original from public.cash_movements where id = target_movement_id;
  if not found then raise exception 'Movimiento no encontrado.'; end if;
  if not private.has_role(original.organization_id, array['owner', 'admin']) then raise exception 'Solo un administrador puede anular movimientos.'; end if;
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

alter table public.cash_movement_visibility enable row level security;

drop policy if exists movements_select on public.cash_movements;
create policy movements_select on public.cash_movements for select to authenticated using (
  private.is_active_member(organization_id)
  and (
    not private.is_movement_hidden(id)
    or private.has_role(organization_id, array['owner'])
  )
);

drop policy if exists movements_insert on public.cash_movements;
create policy movements_insert on public.cash_movements for insert to authenticated with check (
  private.has_role(organization_id, array['owner', 'admin', 'operator'])
  and created_by = auth.uid()
  and source = 'app'
  and reversal_of is null
  and (movement_type in ('income', 'expense') or private.has_role(organization_id, array['owner', 'admin']))
);

drop policy if exists receipts_select on public.movement_receipts;
create policy receipts_select on public.movement_receipts for select to authenticated using (
  private.is_active_member(organization_id)
  and (
    not private.is_movement_hidden(movement_id)
    or private.has_role(organization_id, array['owner'])
  )
);

drop policy if exists receipts_insert on public.movement_receipts;
create policy receipts_insert on public.movement_receipts for insert to authenticated with check (
  created_by = auth.uid()
  and private.has_role(organization_id, array['owner', 'admin', 'operator'])
  and exists (
    select 1
    from public.cash_movements movement
    where movement.id = movement_id
      and movement.organization_id = organization_id
      and movement.movement_type in ('income', 'expense')
      and (
        private.has_role(organization_id, array['owner', 'admin'])
        or movement.created_by = auth.uid()
      )
  )
);

drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated using (
  private.has_role(organization_id, array['owner', 'admin'])
);

create policy movement_visibility_select on public.cash_movement_visibility
for select to authenticated using (private.has_role(organization_id, array['owner']));

revoke all on public.cash_movement_visibility from anon, authenticated;
grant select on public.cash_movement_visibility to authenticated;

drop policy if exists receipts_storage_select on storage.objects;
create policy receipts_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'receipts'
  and private.can_view_receipt_storage(name, (storage.foldername(name))[1]::uuid)
);

drop policy if exists receipts_storage_insert on storage.objects;
create policy receipts_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'receipts'
  and private.has_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'operator'])
);
