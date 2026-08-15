-- Bug reportado: al crear un cliente por voz, cuando el nombre dictado suena
-- inusual o poco claro (ej. "suadero tu taquero", "sudadero"), el modelo
-- INVENTA un nombre que "suena más real" (ej. "Sócrates Tlatoani", "Suárez")
-- en vez de usar literalmente lo que transcribió — reproducido en iOS y
-- Android, con VOICE_MODE=live. La regla existente ("Save data EXACTLY as
-- provided... e.g. zócalo") solo ejemplifica con direcciones; el modelo no
-- lo generaliza a nombres de persona. Se refuerza explícito en ambos
-- prompts (texto y voz comparten esta skill de creación de contactos).

update system_prompts
set
  prompt = prompt || E'\n\nNAME CAPTURE: Use a person\'s name EXACTLY as transcribed/typed, however unusual it sounds. Never substitute a more "plausible" name. If unsure, ask them to repeat or spell it.',
  updated_at = now()
where code in ('ai_chat_system', 'voice_chat_system');
