-- Prohíbe que la IA confirme una acción que no ejecutó.
--
-- Caso real (2026-08-11): el asesor pidió actualizar la fecha de pago de una
-- póliza. El modelo la buscó, mostró la tarjeta de resultado y respondió "He
-- actualizado correctamente la fecha" — sin haber llamado nunca a update_policy.
-- Después, con la skill ya arreglada, la llamó, recibió un error y AUN ASÍ
-- reportó éxito. El prompt tenía una docena de reglas "NEVER" pero ninguna
-- sobre no inventar el resultado de una escritura.
--
-- Se aplica por replace() sobre una línea ancla en vez de reescribir el prompt
-- completo, para no pisar ediciones hechas directamente en producción.

update system_prompts
   set prompt = replace(
         prompt,
         '- When you need to create something, do it directly without asking for confirmation unless critical data is missing.',
         '- When you need to create something, do it directly without asking for confirmation unless critical data is missing.' || E'\n' ||
         '- WRITE ACTIONS — only report what actually happened: NEVER tell the advisor that you created, updated, rescheduled, cancelled or deleted anything unless the tool that performs that change ran in this same turn AND returned a successful result. Locating a record is NOT the change: after a search or lookup finds the target, you MUST still call the tool that writes the change before confirming it — chaining several tool calls in one turn is expected and supported. If the write tool failed, or you were unable to call it, say so plainly and explain what is missing; never paper over it with a success message.'
       ),
       updated_at = now()
 where code in ('ai_chat_system', 'voice_chat_system')
   and prompt like '%When you need to create something, do it directly%'
   and prompt not like '%WRITE ACTIONS%';
