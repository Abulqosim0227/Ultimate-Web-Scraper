from __future__ import annotations

import re
import threading
from collections import deque
from typing import Callable
from urllib.parse import urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

NOT_A_PAGE = re.compile(r'\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|gz|mp3|mp4|avi|mov|webm|docx?|xlsx?|pptx?|exe|apk|css|js|xml|json|rss)$', re.I)
RECENT_LIMIT = 8


def site_key(url: str) -> str:
    return (urlsplit(url).hostname or '').lower().removeprefix('www.')


def same_site_links(start_url: str, links: list[str]) -> list[str]:
    key = site_key(start_url)
    pages: dict[str, None] = {}
    for link in links:
        p = urlsplit(link.strip())
        if p.scheme not in ('http', 'https') or not p.hostname or site_key(link) != key or NOT_A_PAGE.search(p.path):
            continue
        pages[urlunsplit((p.scheme, p.netloc.lower(), p.path or '/', p.query, ''))] = None
    return list(pages)


class Crawler:
    def __init__(self, get_text: Callable[[str], str], ingest_page: Callable[[str], dict], delay: float, user_agent: str):
        self.get_text = get_text
        self.ingest_page = ingest_page
        self.delay = delay
        self.user_agent = user_agent
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._state = self._fresh_state()

    @staticmethod
    def _fresh_state(**extra) -> dict:
        return {'running': False, 'phase': 'idle', 'mode': None, 'start_url': None, 'limit': None,
                'found': 0, 'done': 0, 'ingested': 0, 'unchanged': 0, 'failed': 0, 'skipped': 0,
                'current': None, 'recent': [], **extra}

    def _update(self, **changes) -> None:
        with self._lock:
            self._state = {**self._state, **changes}

    def _bump(self, key: str) -> None:
        with self._lock:
            self._state = {**self._state, key: self._state[key] + 1}

    def status(self) -> dict:
        with self._lock:
            return {**self._state, 'recent': list(self._state['recent'])}

    def _start(self, target: Callable, *args) -> bool:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return False
            self._thread = threading.Thread(target=target, args=args, daemon=True)
            self._thread.start()
            return True

    def start_site(self, start_url: str, limit: int) -> bool:
        return self._start(self.run_site, start_url, limit)

    def stop(self) -> None:
        self._stop.set()

    def _begin(self, **extra) -> None:
        self._stop.clear()
        with self._lock:
            self._state = self._fresh_state(running=True, **extra)

    def _finish(self) -> None:
        self._update(running=False, phase='stopped' if self._stop.is_set() else 'finished')

    def run_site(self, start_url: str, limit: int) -> None:
        self._begin(mode='site', phase='reading robots.txt', start_url=start_url, limit=limit)
        allowed = self._robots(start_url)
        self._update(phase='crawling', found=1)
        queue, seen = deque([start_url]), {start_url}
        while queue and self.status()['done'] < limit and not self._stop.is_set():
            url = queue.popleft()
            if not allowed(url):
                self._bump('skipped')
                continue
            result = self._crawl_one(url)
            for link in same_site_links(start_url, (result or {}).get('links', [])):
                if link not in seen:
                    seen.add(link)
                    queue.append(link)
            self._update(found=len(seen))
            self._stop.wait(self.delay)
        self._finish()

    def _robots(self, start_url: str) -> Callable[[str], bool]:
        p = urlsplit(start_url)
        try:
            lines = self.get_text(f'{p.scheme}://{p.netloc}/robots.txt').splitlines()
        except Exception:
            return lambda url: True
        parser = RobotFileParser()
        parser.parse(lines)
        return lambda url: parser.can_fetch(self.user_agent, url)

    def _crawl_one(self, url: str) -> dict | None:
        try:
            result = self.ingest_page(url)
            entry = {'url': url, 'status': result['status'], 'title': result.get('title', ''), 'chunks': result.get('chunks', 0)}
            current = {'url': url, 'title': result.get('title', '')}
        except Exception as exc:
            result, current = None, None
            entry = {'url': url, 'status': 'failed', 'title': '', 'error': str(exc)[:200]}
        with self._lock:
            s = self._state
            counter = entry['status'] if entry['status'] in ('ingested', 'unchanged') else 'failed'
            self._state = {**s, 'done': s['done'] + 1, counter: s[counter] + 1,
                           'current': current or s['current'],
                           'recent': [entry, *s['recent']][:RECENT_LIMIT]}
        return result
