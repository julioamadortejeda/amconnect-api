-- Error logs: persiste errores del servidor para debugging con UUID de referencia
CREATE TABLE error_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID        REFERENCES agents(id) ON DELETE SET NULL,
  error_type    TEXT        NOT NULL,
  status_code   INTEGER     NOT NULL,
  error_message TEXT        NOT NULL,
  stack_trace   TEXT,
  request_path  TEXT,
  request_method TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_error_logs_agent_id   ON error_logs(agent_id);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);
CREATE INDEX idx_error_logs_error_type ON error_logs(error_type);

-- Solo el service role puede leer/escribir; los agentes no acceden a esta tabla
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
