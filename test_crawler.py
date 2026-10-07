from crawler import Crawler, same_site_links


def test_same_site_links_keeps_crawlable_pages_on_the_same_site_once():
    links = [
        'https://site.uz/about', 'https://www.site.uz/news/1#comments', 'https://site.uz/news/1',
        'https://other.uz/x', 'mailto:hi@site.uz', 'javascript:void(0)', 'https://site.uz/file.PDF',
        'https://site.uz/photo.jpg', 'https://site.uz/search?q=a', 'http://site.uz',
    ]
    assert same_site_links('https://site.uz/', links) == [
        'https://site.uz/about', 'https://www.site.uz/news/1', 'https://site.uz/news/1',
        'https://site.uz/search?q=a', 'http://site.uz/',
    ]


def make_site(graph, robots='', fail=()):
    visited = []

    def get_text(url):
        if url.endswith('/robots.txt'):
            if robots is None:
                raise ValueError('404')
            return robots
        raise ValueError('unexpected')

    def ingest_page(url):
        visited.append(url)
        if url in fail:
            raise ValueError('Unsupported content type')
        return {'status': 'ingested', 'chunks': 1, 'title': url, 'preview': '', 'links': graph.get(url, [])}

    return Crawler(get_text, ingest_page, delay=0, user_agent='RAGReference/1.0'), visited


GRAPH = {
    'https://s.uz/': ['https://s.uz/a', 'https://s.uz/b', 'https://x.uz/out'],
    'https://s.uz/a': ['https://s.uz/c', 'https://s.uz/'],
    'https://s.uz/b': ['https://s.uz/c', 'https://s.uz/private/p'],
    'https://s.uz/c': ['https://s.uz/d'],
}


def test_site_crawl_is_breadth_first_without_revisits():
    crawler, visited = make_site(GRAPH)
    crawler.run_site('https://s.uz/', limit=50)
    assert visited == ['https://s.uz/', 'https://s.uz/a', 'https://s.uz/b', 'https://s.uz/c',
                       'https://s.uz/private/p', 'https://s.uz/d']
    status = crawler.status()
    assert status['mode'] == 'site' and status['done'] == 6 and status['phase'] == 'finished'


def test_site_crawl_respects_limit_robots_and_failures():
    crawler, visited = make_site(GRAPH, robots='User-agent: *\nDisallow: /private/', fail={'https://s.uz/a'})
    crawler.run_site('https://s.uz/', limit=5)
    assert visited == ['https://s.uz/', 'https://s.uz/a', 'https://s.uz/b', 'https://s.uz/c', 'https://s.uz/d']
    status = crawler.status()
    assert status['done'] == 5 and status['failed'] == 1 and status['skipped'] == 1 and status['limit'] == 5


def test_site_crawl_without_robots_file_allows_everything():
    crawler, visited = make_site(GRAPH, robots=None)
    crawler.run_site('https://s.uz/', limit=50)
    assert 'https://s.uz/private/p' in visited


def test_stop_ends_the_site_crawl_early():
    crawler, visited = make_site(GRAPH)
    original = crawler.ingest_page

    def ingest_then_stop(url):
        crawler.stop()
        return original(url)

    crawler.ingest_page = ingest_then_stop
    crawler.run_site('https://s.uz/', limit=50)
    assert visited == ['https://s.uz/']
    assert crawler.status()['phase'] == 'stopped'
