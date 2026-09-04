-- Los compromisos se ligan a personas, no a pólizas.
--
-- La columna existía desde el primer día y NADA la llenaba: la skill
-- `create_commitment` nunca expuso el parámetro, así que siempre llegaba null,
-- y la pantalla de detalle de póliza tampoco muestra compromisos. Media
-- conexión es peor que ninguna — el siguiente que lea el esquema va a asumir
-- que funciona.
--
-- Y no es simetría con recordatorios: ahí el vínculo sí carga peso, porque
-- `reminder_generation.service.ts` genera renovaciones y pagos A PARTIR de la
-- póliza y la pantalla de la póliza los muestra. Un compromiso nace de una
-- conversación; casi siempre es también sobre el titular, y ligarlo al contacto
-- ya da a dónde ir.

alter table client_commitments drop column policy_id;
