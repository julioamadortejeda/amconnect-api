-- Prohíbe que la IA conteste dos veces la misma pregunta.
--
-- Caso real (2026-08-13, voz Live): el asesor pidió "un resumen de cada uno de
-- ellos" sobre dos clientes que YA estaban en el contexto de la conversación
-- (venían de un search_contacts previo). El modelo contestó de inmediato con
-- lo que ya sabía, y ADEMÁS llamó a la skill de detalle de cada contacto. Al
-- llegar esas respuestas tuvo que abrir un turno nuevo y volvió a leer el
-- resumen completo, con otras palabras. En voz eso no es un renglón repetido:
-- el asesor lo escucha entero dos veces.
--
-- La regla ataca las dos mitades: no hablar antes de que lleguen las
-- respuestas de las tools, y no llamar tools para datos que ya tiene.
--
-- Se aplica por replace() sobre una línea ancla en vez de reescribir el prompt
-- completo, para no pisar ediciones hechas directamente en producción.

update system_prompts
   set prompt = replace(
         prompt,
         '- Internal record IDs (UUIDs such as id, contact_id, policy_id, reminder_id) returned by tools exist ONLY for you to chain tool calls.',
         '- ONE ANSWER PER TURN — never say the same thing twice. If you call one or more tools, stay SILENT until every tool response has arrived, then give ONE single complete answer. NEVER answer from what you already know and then repeat yourself once the tool results come back: in voice the advisor literally hears the entire answer a second time. If the conversation already contains the information the advisor is asking for, answer once from it and do not call the tool at all.' || E'\n' ||
         '- Internal record IDs (UUIDs such as id, contact_id, policy_id, reminder_id) returned by tools exist ONLY for you to chain tool calls.'
       ),
       updated_at = now()
 where code in ('ai_chat_system', 'voice_chat_system')
   and prompt like '%Internal record IDs (UUIDs such as id, contact_id%'
   and prompt not like '%ONE ANSWER PER TURN%';
