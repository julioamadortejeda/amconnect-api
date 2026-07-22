-- Revierte 20260721233000_create_client_notes_table.sql: las notas manuales
-- del asesor se unifican con agent_notes (note_origin knowledge, vía
-- knowledge_ingestion.service.ts) en vez de vivir en una tabla aparte —
-- evita que el asesor perciba dos conceptos de "notas" distintos y las hace
-- buscables por el mismo pipeline de embeddings/RAG que el resto.
-- Datos de prueba locales en client_notes se descartan (no hay producción aún).
drop table if exists client_notes;
