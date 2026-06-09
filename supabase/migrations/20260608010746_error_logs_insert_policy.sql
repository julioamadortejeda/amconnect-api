-- error_logs: usuarios autenticados pueden insertar sus propios errores.
-- SELECT/UPDATE/DELETE bloqueado — los logs son solo para revisión interna.
create policy "error_logs: authenticated insert"
  on error_logs for insert
  to authenticated
  with check (true);
