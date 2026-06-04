-- ─── Bucket para PDFs de pólizas ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policies',
  'policies',
  false,
  52428800,                        -- 50 MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ─── RLS en storage.objects ───────────────────────────────────────────────────
-- Los archivos se guardan bajo la ruta {agent_id}/{filename}
-- La primera parte del path debe coincidir con el UUID del asesor autenticado

create policy "policies_bucket_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'policies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "policies_bucket_select"
  on storage.objects for select
  using (
    bucket_id = 'policies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "policies_bucket_delete"
  on storage.objects for delete
  using (
    bucket_id = 'policies'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
