insert into reminder_types (name, code) values
  ('Aniversario de Póliza', 'ANNIVERSARY')
on conflict (code) do nothing;
