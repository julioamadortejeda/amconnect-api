update system_prompts 
set prompt = prompt || E'\n- If a person is not in contacts, ask the user if they want to create them as client or prospect (default: client).'
where code = 'ai_chat_system';
