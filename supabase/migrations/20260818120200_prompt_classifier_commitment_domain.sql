-- El clasificador no conocía el dominio "commitment", así que nunca lo devolvía
-- y las skills get_commitments / close_commitment quedaban invisibles para el
-- modelo. Síntoma: "¿qué tengo que hacer en septiembre?" se contestaba mirando
-- solo los recordatorios, con un "no tienes nada" que se veía correcto.
--
-- Se le enseña explícitamente que se traslapa con "reminder": los pendientes
-- del asesor viven en dos lados —los recordatorios que él creó y los
-- compromisos que la IA sacó de sus notas— y para él es una sola pregunta.
-- El emparejamiento duro de los dos dominios está además en ai_chat.service.ts,
-- porque no basta con confiar en que el clasificador lo entienda.

update system_prompts
set prompt = replace(
  prompt,
  E'- catalog: System catalogs such as insurance carriers',
  E'- commitment: Loose ends the AI extracted from the advisor''s notes — what a client is waiting on, who asked to be contacted on a date, what the advisor promised. Overlaps with "reminder": both answer "what do I have pending".\n- catalog: System catalogs such as insurance carriers'
)
where code = 'message_classifier_system'
  and prompt not like '%- commitment:%';
