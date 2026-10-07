const API = 'http://127.0.0.1:8000';
const APP_HOSTS = new Set(['127.0.0.1:8000', 'localhost:8000']);
const isAppPage = url => APP_HOSTS.has(new URL(url).host);
const LIMITS = new Set([100, 500, 1000, 2000]);
const MAX_TEXT = 500000;

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

async function handle(message) {
  if (message.type === 'status') return call('/api/crawl/status');
  if (message.type === 'stop') return call('/api/crawl/stop', {});
  if (message.type === 'savePage') {
    const {url, title, text, section} = message;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('This page cannot be saved');
    if (isAppPage(url)) throw new Error('The RAG app itself is not saved');
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Page text is too large');
    return call('/api/ingest/page', {url, title: String(title || '').slice(0, 1000), text, section: section ? String(section).slice(0, 200) : null});
  }
  if (message.type === 'start') {
    if (typeof message.url !== 'string' || !/^https?:\/\//.test(message.url)) throw new Error('This page cannot be crawled');
    if (!LIMITS.has(message.limit)) throw new Error('Invalid page limit');
    return call('/api/crawl/site', {url: message.url, limit: message.limit});
  }
  throw new Error('Unknown request');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message)
    .then(data => reply({ok: true, data}))
    .catch(e => reply({ok: false, error: e instanceof TypeError ? 'offline' : e.message}));
  return true;
});
