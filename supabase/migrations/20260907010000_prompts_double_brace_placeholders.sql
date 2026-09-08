-- Una sola convencion de placeholders en los prompts: {{dobles}}.
--
-- Convivian las dos formas ({excerpt} junto a {{advisor_language}} en el mismo
-- prompt) y eso impide validar: PromptService no puede tratar las llaves
-- simples como placeholders porque los prompts traen ejemplos de JSON —el del
-- clasificador dice literalmente { "domains": [...] }— que darian un falso
-- positivo en cada llamada. Con una sola convencion, un placeholder sin valor
-- se detecta y truena en vez de llegarle al modelo escrito tal cual.
--
-- Los replace van anidados de fuera hacia dentro para ser idempotentes:
-- primero colapsan la forma doble a simple y luego la vuelven a doblar, asi
-- correr esto dos veces no produce {{{tres}}}.

update system_prompts
set prompt = replace(
      replace(
        replace(
          replace(prompt, '{{availableDomains}}', '{availableDomains}'),
          '{{message}}', '{message}'
        ),
        '{availableDomains}', '{{availableDomains}}'
      ),
      '{message}', '{{message}}'
    ),
    updated_at = now()
where code = 'message_classifier_system';

update system_prompts
set prompt = replace(
      replace(
        replace(
          replace(prompt, '{{excerpt}}', '{excerpt}'),
          '{{lengthNote}}', '{lengthNote}'
        ),
        '{excerpt}', '{{excerpt}}'
      ),
      '{lengthNote}', '{{lengthNote}}'
    ),
    updated_at = now()
where code = 'knowledge_text_metadata_system';
