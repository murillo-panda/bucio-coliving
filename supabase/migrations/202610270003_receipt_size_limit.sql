alter table public.movement_receipts
  drop constraint if exists movement_receipts_size_bytes_check;

alter table public.movement_receipts
  add constraint movement_receipts_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 2097152);

update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'receipts';
