alter policy "Agentes pueden ver comentarios de sus recordatorios"
  on reminder_comments rename to "reminder_comments: view own";

alter policy "Agentes pueden crear comentarios en sus recordatorios"
  on reminder_comments rename to "reminder_comments: insert own";
