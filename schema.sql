CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embedding_models (
    id BIGSERIAL PRIMARY KEY,
    model_name TEXT NOT NULL UNIQUE,
    dimension INTEGER NOT NULL CHECK (dimension > 0),
    max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens > 0),
    normalized BOOLEAN NOT NULL,
    backend TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY,
    canonical_url TEXT NOT NULL UNIQUE,
    title TEXT,
    page_type TEXT NOT NULL,
    language TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_documents (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    content_type TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_id, content_hash)
);

CREATE TABLE IF NOT EXISTS document_versions (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    content_hash TEXT NOT NULL,
    cleaned_content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_id, version_number)
);

CREATE TABLE IF NOT EXISTS chunks (
    id BIGSERIAL PRIMARY KEY,
    document_version_id BIGINT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_text TEXT NOT NULL CHECK (btrim(chunk_text) <> ''),
    token_count INTEGER NOT NULL CHECK (token_count > 0),
    start_char INTEGER NOT NULL CHECK (start_char >= 0),
    end_char INTEGER NOT NULL CHECK (end_char > start_char),
    overlap_with_previous INTEGER NOT NULL CHECK (overlap_with_previous >= 0),
    heading_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_version_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS embeddings (
    id BIGSERIAL PRIMARY KEY,
    chunk_id BIGINT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    embedding_model_id BIGINT NOT NULL REFERENCES embedding_models(id) ON DELETE RESTRICT,
    embedding vector NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(chunk_id, embedding_model_id)
);

CREATE TABLE IF NOT EXISTS retrieval_traces (
    id UUID PRIMARY KEY,
    question TEXT NOT NULL,
    query_language TEXT,
    intent TEXT NOT NULL,
    embedding_model_id BIGINT REFERENCES embedding_models(id),
    selected_chunk_ids BIGINT[] NOT NULL,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS raw_documents_document_idx ON raw_documents(document_id);
CREATE INDEX IF NOT EXISTS document_versions_document_idx ON document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS chunks_version_idx ON chunks(document_version_id, chunk_index);
CREATE INDEX IF NOT EXISTS embeddings_model_idx ON embeddings(embedding_model_id);
CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING gin (to_tsvector('simple', chunk_text));
