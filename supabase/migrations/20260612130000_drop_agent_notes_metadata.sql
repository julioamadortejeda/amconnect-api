-- Drop unused metadata column from agent_notes.
-- Display intent (policy/policy_coverages) is no longer needed since summary and coverages
-- are now stored as a single agent_notes row. The field was written but never read.
alter table agent_notes drop column if exists metadata;
