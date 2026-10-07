importScripts('crawl.js');

const API = 'http://127.0.0.1:8000';
function isLocalMachine(url) {
  const host = new URL(url).hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]' || host === '0.0.0.0';
}
const MAX_TEXT = 500000;
const LIMITS = new Set([100, 500, 1000, 2000]);
const OUTCOMES = new Set(['ingested', 'duplicate', 'failed']);
const NEXT_PAGE_DELAY_MS = 1800, PAGE_TIMEOUT_MS = 30000, WATCHDOG = 'crawl-watchdog';

async function setBadge(enabled) {
  await chrome.action.setBadgeText({text: enabled ? 'ON' : ''});
  await chrome.action.setBadgeBackgroundColor({color: '#ff2bd6'});
}

chrome.action.onClicked.addListener(async () => {
  const {enabled} = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({enabled: !enabled});
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.enabled) setBadge(changes.enabled.newValue);
});

chrome.runtime.onStartup.addListener(async () => setBadge((await chrome.storage.local.get('enabled')).enabled));
chrome.runtime.onInstalled.addListener(async () => setBadge((await chrome.storage.local.get('enabled')).enabled));

async function call(path, body) {
  const options = body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {};
  const response = await fetch(API + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg).join('; ') : data.detail;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return data;
}

function savePage({url, title, text, section}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('This page cannot be saved');
  if (isLocalMachine(url)) throw new Error('Pages from this computer (localhost) are not saved');
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Page text is too large');
  return call('/api/ingest/page', {url, title: String(title || '').slice(0, 1000), text, section: section ? String(section).slice(0, 200) : null});
}

const getCrawl = async () => (await chrome.storage.session.get('crawl')).crawl || null;

function summary(crawl) {
  const {running, phase, host, limit, done, ingested, duplicate, failed, skipped, found, current} = crawl;
  return {running, phase, host, limit, done, ingested, duplicate, failed, skipped, found, current, next: running ? crawl.expected : null};
}

async function saveCrawl(crawl) {
  await chrome.storage.session.set({crawl});
  chrome.tabs.sendMessage(crawl.tabId, {type: 'crawlState', state: summary(crawl)}).catch(() => {});
}

async function finish(crawl, phase) {
  Object.assign(crawl, {running: false, phase, queue: []});
  await saveCrawl(crawl);
  chrome.alarms.clear(WATCHDOG);
  const robots = crawl.skipped ? ` · ${crawl.skipped} blocked by robots.txt` : '';
  chrome.notifications.create(`crawl-${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/128.png',
    title: phase === 'finished' ? 'RAG Spider: crawl finished' : 'RAG Spider: crawl stopped',
    message: `${crawl.host}: ${crawl.done} pages · ${crawl.ingested} added · ${crawl.duplicate} already saved · ${crawl.failed} failed${robots}`,
  });
  return summary(crawl);
}

async function goNext(crawl) {
  if (!crawl.queue.length || crawl.done >= crawl.limit) return finish(crawl, 'finished');
  const next = crawl.queue.shift();
  Object.assign(crawl, {expected: next, waitingSince: Date.now() + NEXT_PAGE_DELAY_MS});
  await saveCrawl(crawl);
  setTimeout(() => chrome.tabs.update(crawl.tabId, {url: next}).catch(() => {}), NEXT_PAGE_DELAY_MS);
  return summary(crawl);
}

function record(crawl, {url, title, outcome, links}) {
  crawl.done += 1;
  crawl[OUTCOMES.has(outcome) ? outcome : 'failed'] += 1;
  crawl.current = String(title || url).slice(0, 200);
  const allowed = RagCrawl.parseRobots(crawl.robots), seen = new Set(crawl.seen);
  for (const href of (Array.isArray(links) ? links : []).slice(0, 5000)) {
    const next = RagCrawl.pageUrl(href, url, crawl.origin);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    if (allowed(next)) crawl.queue.push(next); else crawl.skipped += 1;
  }
  crawl.seen = [...seen];
  crawl.found = crawl.seen.length;
}

async function startCrawl(tabId, message) {
  if (!LIMITS.has(message.limit)) throw new Error('Invalid page limit');
  if (typeof message.url !== 'string' || !/^https?:\/\//.test(message.url) || isLocalMachine(message.url)) throw new Error('This page cannot be crawled');
  const existing = await getCrawl();
  if (existing?.running) throw new Error('A crawl is already running. Stop it first.');
  const {origin, host} = new URL(message.url);
  const start = RagCrawl.pageUrl(message.url, message.url, origin);
  const crawl = {
    tabId, origin, host, robots: String(message.robots || '').slice(0, 100000), limit: message.limit,
    queue: [], seen: [start], done: 0, ingested: 0, duplicate: 0, failed: 0, skipped: 0, found: 1, current: '',
    running: true, phase: 'crawling', expected: start, waitingSince: Date.now(),
  };
  record(crawl, message);
  chrome.alarms.create(WATCHDOG, {periodInMinutes: 0.5});
  return goNext(crawl);
}

async function pageDone(tabId, message) {
  const crawl = await getCrawl();
  if (!crawl?.running || crawl.tabId !== tabId) return null;
  record(crawl, message);
  return goNext(crawl);
}

async function checkPage(tabId) {
  const crawl = await getCrawl();
  if (!crawl || crawl.tabId !== tabId) return {crawling: false, state: null};
  return {crawling: crawl.running, state: summary(crawl)};
}

async function stopCrawl(tabId) {
  const crawl = await getCrawl();
  return crawl?.running && crawl.tabId === tabId ? finish(crawl, 'stopped') : null;
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== WATCHDOG) return;
  const crawl = await getCrawl();
  if (!crawl?.running) return chrome.alarms.clear(WATCHDOG);
  if (Date.now() - crawl.waitingSince > PAGE_TIMEOUT_MS) {
    record(crawl, {url: crawl.expected, outcome: 'failed', links: []});
    goNext(crawl);
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const crawl = await getCrawl();
  if (crawl?.running && crawl.tabId === tabId) finish(crawl, 'stopped');
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;
  const crawl = await getCrawl();
  if (crawl?.running && crawl.tabId === tabId && new URL(change.url).origin !== crawl.origin) finish(crawl, 'stopped');
});

const HANDLERS = {
  savePage: (message) => savePage(message),
  crawlStart: (message, tabId) => startCrawl(tabId, message),
  crawlPage: (message, tabId) => pageDone(tabId, message),
  crawlCheck: (message, tabId) => checkPage(tabId),
  crawlStop: (message, tabId) => stopCrawl(tabId),
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !HANDLERS[message?.type]) return false;
  Promise.resolve()
    .then(() => HANDLERS[message.type](message, sender.tab?.id))
    .then(data => reply({ok: true, data}))
    .catch(e => reply({ok: false, error: e instanceof TypeError ? 'offline' : e.message}));
  return true;
});
