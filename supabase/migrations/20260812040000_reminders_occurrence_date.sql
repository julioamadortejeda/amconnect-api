-- A qué ocurrencia del calendario pertenece un recordatorio generado.
--
-- Sin esto, el job tenía que adivinar el ciclo a partir de `due_date` — que es
-- justo el campo que el asesor cambia al reagendar. Reagendar el pago de agosto
-- a diciembre "movía" el recordatorio de ciclo y el job volvía a crear el de
-- agosto, deshaciendo la acción del asesor.
--
-- Se llena solo al generar y NUNCA cambia al reagendar: la fecha del aviso se
-- mueve, el ciclo al que corresponde no.

alter table reminders add column occurrence_date date;

comment on column reminders.occurrence_date is
  'Fecha de la ocurrencia del calendario que este recordatorio cubre. La fija el generador y no cambia al reagendar.';

-- Los ya existentes nacieron en su fecha, así que su ocurrencia es esa.
update reminders
   set occurrence_date = (due_date at time zone 'America/Mexico_City')::date
 where occurrence_date is null
   and type_id in (
     select id from reminder_types where code in ('PAYMENT','RENEWAL','ANNIVERSARY','BIRTHDAY')
   );

create index idx_reminders_occurrence
  on reminders (agent_id, type_id, occurrence_date)
  where occurrence_date is not null;
