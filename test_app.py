from types import SimpleNamespace

import pytest

import app
from app import REFUSAL, Chunk, build_prompt, chunk_text, grounded

MAX_CHARS = 1800 * 4
SINGLE_NEWLINES = '\n'.join(f'Paragraph {i} ' + 'word ' * 60 for i in range(60))
BLANK_LINES = '\n\n'.join(f'Paragraph {i} ' + 'word ' * 60 for i in range(60))
INDENTED = '\n\n'.join(f'   Section {i}\n   ' + 'text ' * 300 for i in range(20))
ONE_HUGE_PARAGRAPH = 'token ' * 5000

EXAMPLE = Chunk(1, 'This domain is for use in documentation examples without needing permission.', 'u1', 't1', 'p', 0.76)
SMITH = Chunk(2, 'Perth, the begrimed blacksmith, suffered the loss of the extremities of both feet.', 'u2', 't2', 'p', 0.71)


@pytest.mark.parametrize('text', [SINGLE_NEWLINES, BLANK_LINES, INDENTED, ONE_HUGE_PARAGRAPH])
def test_chunk_offsets_point_at_the_chunk_text(text):
    chunks = chunk_text(text)
    assert len(chunks) > 1
    for body, start, end, _ in chunks:
        assert start >= 0
        assert text[start:end] == body
        assert len(body) <= MAX_CHARS


@pytest.mark.parametrize('text', [SINGLE_NEWLINES, INDENTED, ONE_HUGE_PARAGRAPH])
def test_consecutive_chunks_really_overlap(text):
    chunks = chunk_text(text)
    assert chunks[0][3] == 0
    for previous, current in zip(chunks, chunks[1:]):
        assert current[1] < previous[2]
        assert current[3] > 0


def test_chunks_cover_the_whole_text():
    chunks = chunk_text(SINGLE_NEWLINES)
    assert chunks[0][1] == 0
    assert chunks[-1][2] == len(SINGLE_NEWLINES.rstrip())


def test_short_and_empty_text():
    assert chunk_text('   \n ') == []
    assert chunk_text('Just one short line.') == [('Just one short line.', 0, 20, 0)]


@pytest.mark.parametrize('response', [
    'The blacksmith is named Perth [E2].',
    'Perth lost the extremities of both feet [E2].\nThe domain is for documentation examples [E1].',
    'The blacksmith Perth worked on deck:\n```\nforge --lash ringbolts\n```\nHe lost the extremities of both feet [E2].',
    'Here is what the evidence says about the blacksmith:\n\n1. Perth lost the extremities of both feet [E2].',
])
def test_grounded_accepts_cited_supported_answers(response):
    assert grounded(response, [EXAMPLE, SMITH])


@pytest.mark.parametrize('response', [
    'The capital of France is Paris [E1].',
    'Perth is the name of the blacksmith.',
    'Perth is the name of the blacksmith [E3].',
    'In the quiet of twilight, where shadows play,\nA cat prowls with grace through the moonlit gray.',
    'The capital is Paris. However, there is insufficient evidence [E1].',
    'Paris is the capital:\n\nIt is a large city.',
    REFUSAL,
    '',
])
def test_grounded_rejects_unsupported_answers(response):
    assert not grounded(response, [EXAMPLE, SMITH])


def test_prompt_puts_evidence_before_question_and_states_refusal():
    prompt = build_prompt('Who is Perth?', [EXAMPLE, SMITH])
    assert prompt.index('[E1]') < prompt.index('[E2]') < prompt.index('Who is Perth?')
    assert REFUSAL in prompt


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *args):
        return None


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(app, 'db', FakeConn)
    monkeypatch.setattr(app.settings, 'min_similarity', 0.5)
    monkeypatch.setattr(app.settings, 'keyword_min_similarity', 0.35)

    def use(chunks, llm_reply=None):
        monkeypatch.setattr(app, 'retrieve', lambda q: (chunks, q, 'factual', '1'))
        prompts = []

        def generate(system, prompt):
            if llm_reply is None:
                raise AssertionError('LLM must not be called')
            prompts.append(prompt)
            return llm_reply

        monkeypatch.setattr(app.ollama, 'generate', generate)
        return prompts
    return use


def test_answer_refuses_without_llm_when_nothing_is_relevant(offline):
    offline([Chunk(1, 'x', 'u', 't', 'p', 0.44), Chunk(2, 'y', 'u', 't', 'p', 0.30)])
    result = app.answer('What is the capital of France?')
    assert result['answer'] == REFUSAL
    assert result['sources'] == []


def test_answer_sends_and_shows_only_relevant_chunks(offline):
    noise = Chunk(9, 'Unrelated kindergarten news text.', 'u9', 't9', 'p', 0.31)
    prompts = offline([SMITH, noise], 'The blacksmith is named Perth [E1].')
    result = app.answer('Who is the blacksmith?')
    assert 'kindergarten' not in prompts[0]
    assert [s['chunk_id'] for s in result['sources']] == [2]
    assert result['answer'] == 'The blacksmith is named Perth [E1].'


def test_answer_replaces_unsupported_llm_output_with_refusal(offline):
    offline([EXAMPLE], 'The capital of France is Paris [E1].')
    result = app.answer('What is the capital of France?')
    assert result['answer'] == REFUSAL
    assert result['sources'] == []


def test_page_key_normalizes_urls_and_names_sections():
    assert app.page_key('https://Nihol.uz/partners?x=1#top') == 'https://nihol.uz/partners?x=1'
    assert app.page_key('https://nihol.uz') == 'https://nihol.uz/'
    assert app.page_key('https://nihol.uz/partners', 'H3C: партнёр') == 'https://nihol.uz/partners#popup-h3c-партнёр'


@pytest.mark.parametrize('url', ['ftp://nihol.uz/x', 'https://user:pw@nihol.uz/', 'javascript:alert(1)', 'https:///nohost'])
def test_page_key_rejects_unusable_urls(url):
    with pytest.raises(ValueError):
        app.page_key(url)


APP_REQUEST = SimpleNamespace(url=SimpleNamespace(netloc='127.0.0.1:8000'))


def page_request(**extra):
    return app.PageRequest(url='https://nihol.uz/partners', title='Partners', text='H3C partner text ' * 5, **extra)


def test_saving_a_page_twice_is_a_duplicate(monkeypatch):
    monkeypatch.setattr(app, 'existing_document', lambda key: 5)
    monkeypatch.setattr(app, 'store_document', lambda *a: (_ for _ in ()).throw(AssertionError('must not store again')))
    assert app.api_ingest_page(page_request(), APP_REQUEST) == {'status': 'duplicate', 'document_id': 5}


def test_saving_a_new_popup_stores_browser_text(monkeypatch):
    calls = []
    monkeypatch.setattr(app, 'existing_document', lambda key: None)
    monkeypatch.setattr(app, 'store_document', lambda *a: calls.append(a) or {'status': 'ingested', 'chunks': 1})
    result = app.api_ingest_page(page_request(section='H3C'), APP_REQUEST)
    assert result == {'status': 'ingested', 'chunks': 1}
    assert calls == [('https://nihol.uz/partners#popup-h3c', 'Partners', ('H3C partner text ' * 5).strip(), 'browser')]


def test_page_endpoint_rejects_non_json_posts_from_websites():
    from fastapi.testclient import TestClient
    response = TestClient(app.app).post('/api/ingest/page', content='{"url":"https://a.uz/","title":"t","text":"' + 'x' * 50 + '"}',
                                        headers={'Content-Type': 'text/plain'})
    assert response.status_code == 422


def test_informative_terms_keep_rare_words_and_drop_filler_and_numbers():
    frequency = {'zaxarova': 1, 'nima': 73, 'dedi': 73, 'netapp': 4, '2022': 2}.get
    assert app.informative_terms('Zaxarova nima dedi? NetApp 2022 abc', lambda t: frequency(t, 0), total=521) == ['zaxarova', 'netapp']


def test_keyword_match_lowers_the_cutoff_but_not_to_zero(offline):
    name_match = Chunk(1, 'Zaxarova dedi: zavodlar potensial harbiy nishonlar.', 'u1', 't1', 'p', 0.42, keyword=True)
    no_match = Chunk(2, 'Unrelated listing of headlines about education.', 'u2', 't2', 'p', 0.42)
    weak_match = Chunk(3, 'Zaxarova mentioned in passing.', 'u3', 't3', 'p', 0.30, keyword=True)
    prompts = offline([name_match, no_match, weak_match], 'Zaxarova dedi: zavodlar potensial harbiy nishonlar [E1].')
    result = app.answer('Zaxarova nima dedi?')
    assert [s['chunk_id'] for s in result['sources']] == [1]
    assert 'Unrelated listing' not in prompts[0] and 'in passing' not in prompts[0]


class RecordingConn(FakeConn):
    def __init__(self, sql):
        self.sql = sql

    def execute(self, query, *args):
        self.sql.append(query)
        return self

    def fetchone(self):
        return (409, 521)


def recording_db(monkeypatch):
    sql = []
    monkeypatch.setattr(app, 'db', lambda: RecordingConn(sql))
    return sql


def test_clear_data_empties_every_table_but_keeps_them(monkeypatch):
    sql = recording_db(monkeypatch)
    assert app.api_data_clear(app.ClearRequest(confirm='DELETE')) == {'cleared': True, 'pages_deleted': 409}
    truncate = next(q for q in sql if q.startswith('TRUNCATE'))
    for table in ('documents', 'raw_documents', 'document_versions', 'chunks', 'embeddings', 'retrieval_traces', 'embedding_models'):
        assert table in truncate
    assert not any('DROP' in q.upper() for q in sql)


def test_clear_data_requires_typed_confirmation(monkeypatch):
    sql = recording_db(monkeypatch)
    with pytest.raises(app.HTTPException) as error:
        app.api_data_clear(app.ClearRequest(confirm='yes'))
    assert error.value.status_code == 400 and sql == []


def test_data_stats_counts_pages_and_chunks(monkeypatch):
    recording_db(monkeypatch)
    assert app.api_data_stats() == {'pages': 409, 'chunks': 521}


def test_the_app_never_saves_its_own_pages(monkeypatch):
    stored = []
    monkeypatch.setattr(app, 'store_document', lambda *a: stored.append(a) or {'status': 'ingested'})
    monkeypatch.setattr(app, 'existing_document', lambda key: None)
    own_page = app.PageRequest(url='http://127.0.0.1:8000/', title='RAG Reference', text='NASA X-59 samolyoti soatiga 1 625 kilometr ' * 3)
    with pytest.raises(app.HTTPException) as error:
        app.api_ingest_page(own_page, APP_REQUEST)
    assert error.value.status_code == 400 and stored == []


@pytest.mark.parametrize('url', ['http://localhost:8005/pages', 'http://127.0.0.1:8000/', 'http://127.5.5.5/x', 'http://[::1]:3000/', 'http://app.localhost/'])
def test_pages_from_this_computer_are_never_saved(monkeypatch, url):
    stored = []
    monkeypatch.setattr(app, 'store_document', lambda *a: stored.append(a) or {'status': 'ingested'})
    monkeypatch.setattr(app, 'existing_document', lambda key: None)
    request = app.PageRequest(url=url, title='Local app', text='Some local dashboard text that is long enough.')
    with pytest.raises(app.HTTPException) as error:
        app.api_ingest_page(request, SimpleNamespace(url=SimpleNamespace(netloc='127.0.0.1:9999')))
    assert error.value.status_code == 400 and stored == []


def test_internal_network_sites_can_still_be_saved(monkeypatch):
    monkeypatch.setattr(app, 'existing_document', lambda key: None)
    monkeypatch.setattr(app, 'store_document', lambda *a: {'status': 'ingested', 'chunks': 1})
    request = app.PageRequest(url='http://192.168.100.174/projects', title='Projects', text='Internal company projects page with enough text.')
    assert app.api_ingest_page(request, APP_REQUEST)['status'] == 'ingested'
