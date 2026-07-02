-- ─── Prevenir pólizas duplicadas por agente ──────────────────────────────────
-- Índice único parcial: bloquea dos pólizas ACTIVAS del mismo agente con el
-- mismo policy_number. Permite NULLs (policy_number es opcional) y permite
-- reusar un número si la póliza anterior fue soft-deleted (is_active = false).

create unique index idx_policies_agent_policy_number_unique
  on policies (agent_id, policy_number)
  where policy_number is not null and is_active = true;
