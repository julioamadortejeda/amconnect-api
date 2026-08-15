-- Zona horaria del asesor, en formato IANA ("America/Mexico_City").
--
-- La app ya manda `x-timezone` en cada request; el backend la persiste aquí la
-- primera vez que la ve y cuando cambia. El cron diario de generación de
-- recordatorios no tiene request del cual leerla, así que la toma de esta
-- columna para calcular la medianoche local correcta de cada asesor.

alter table agents add column timezone text;

comment on column agents.timezone is
  'IANA timezone del asesor (ej. America/Mexico_City). La llena el backend desde el header x-timezone; el cron la usa para calcular la fecha local.';
