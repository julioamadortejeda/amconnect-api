-- document_metadata es solo registro del archivo físico — contact y policy viven en agent_notes y policies
ALTER TABLE document_metadata DROP COLUMN IF EXISTS contact_id;
ALTER TABLE document_metadata DROP COLUMN IF EXISTS policy_id;

-- agent_notes ya tiene document_metadata_id como FK — storage_path es redundante
ALTER TABLE agent_notes DROP COLUMN IF EXISTS storage_path;
