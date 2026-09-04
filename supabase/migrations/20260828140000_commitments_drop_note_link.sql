-- Los compromisos nacen en el asistente, no en una nota.
--
-- Misma historia que `policy_id` (ver 20260828120000): la columna existía desde
-- el primer día, cuando los compromisos se extraían de la ingesta de notas. Ese
-- camino se quitó — las notas volvieron a ser expediente y nada más — así que
-- hoy el ÚNICO código que inserta pone `note_id = null` literal
-- (commitment.service.ts). Nadie la lee: no se filtra por ella, no se navega a
-- la nota, y el modelo de Flutter ni siquiera la parsea.
--
-- Media conexión es peor que ninguna: el siguiente que lea el esquema va a
-- asumir que un compromiso se puede rastrear hasta la nota que lo originó.

alter table client_commitments drop column note_id;
