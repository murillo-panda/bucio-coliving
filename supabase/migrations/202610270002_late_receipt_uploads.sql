drop policy if exists receipts_insert on public.movement_receipts;

create policy receipts_insert on public.movement_receipts
for insert to authenticated
with check (
  created_by = auth.uid()
  and private.has_role(organization_id, array['admin', 'operator'])
  and exists (
    select 1
    from public.cash_movements movement
    where movement.id = movement_id
      and movement.organization_id = organization_id
      and movement.movement_type in ('income', 'expense')
      and (
        private.has_role(organization_id, array['admin'])
        or movement.created_by = auth.uid()
      )
  )
);

create or replace function private.audit_receipt_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    new.organization_id,
    new.created_by,
    'receipt.attached',
    'movement_receipt',
    new.id::text,
    jsonb_build_object(
      'movement_id', new.movement_id,
      'original_name', new.original_name,
      'size_bytes', new.size_bytes
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_receipt_insert() from public, anon, authenticated;

drop trigger if exists audit_movement_receipt_insert on public.movement_receipts;
create trigger audit_movement_receipt_insert
  after insert on public.movement_receipts
  for each row execute procedure private.audit_receipt_insert();
