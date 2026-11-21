-- D-024: el idioma del asesor vive en agents.locale y solo es 'es' o 'en'.
--
-- Hasta ahora el middleware guardaba el Accept-Language crudo del telefono en
-- cada request ('en_US', 'es-MX', ...), lo que pisaba la eleccion del asesor en
-- la app. El codigo ya solo llena el vacio y normaliza; esta migracion limpia
-- lo viejo y cierra la puerta con un check.
--
-- Re-ejecutable: el update solo toca filas que no estan ya en es/en/null y el
-- constraint se recrea si existe.

update agents
set locale = case
  when lower(locale) ~ '^en' then 'en'
  when lower(locale) ~ '^es' then 'es'
  else null
end
where locale is not null and locale not in ('es', 'en');

alter table agents drop constraint if exists agents_locale_check;
alter table agents
  add constraint agents_locale_check check (locale is null or locale in ('es', 'en'));
