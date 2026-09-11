-- El idioma del asesor, persistido igual que su zona horaria y por la misma
-- razon: el cron diario de recordatorios no tiene request del cual leer el
-- header Accept-Language, y hoy escribe los titulos que genera ("Pago de Prima
-- · GM000...", "Renovacion · ...") siempre en espanol. Un asesor con la app en
-- ingles los recibe en espanol.
--
-- Nullable a proposito: solo se llena cuando un cliente manda el header de
-- verdad. Rellenarlo a ciegas con un default haria que una peticion sin header
-- —un webhook, un curl, la futura web— pisara el idioma correcto del asesor.
-- Quien lo lee cae a espanol cuando esta vacio, que es el default del producto.

alter table agents add column if not exists locale text;

comment on column agents.locale is
  'Codigo de idioma del ultimo cliente que lo reporto (es / en). Lo usa el cron de recordatorios, que no tiene request.';
