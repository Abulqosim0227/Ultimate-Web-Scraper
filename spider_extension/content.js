(() => {
  if (window.__ragSpider) return;
  window.__ragSpider = true;

  const COLORS = ['#ff2bd6', '#38e1ff', '#3dff8f', '#ffc93d'];
  const READ_SPEED = 420, FOLLOW_SPEED = 700, FOOT_RADIUS = 24, MOUSE_PRIORITY_MS = 1500;
  const MIN_PAGE_TEXT = 200, MIN_POPUP_TEXT = 40;
  const CRAWL_SETTLE_MS = 1200, CRAWL_READ_MS = 2500;
  const MEASURE_MS = 700, WATCH_MS = 500, RESCAN_MS = 2000, REMEMBER_MS = 1000, MEMORY_LIMIT = 400;

  const mouse = {x: innerWidth * 0.6, y: innerHeight * 0.4, movedAt: 0};
  let host = null, ui = null, spider = null, frame = null, lastTime = 0, timers = [], crawling = false;
  let url = null, page = null, popup = null, inset = 0, measuredAt = 0;

  const STYLE = `
    :host{all:initial}
    canvas{position:fixed;inset:0;pointer-events:none}
    .panel{position:fixed;right:16px;bottom:16px;width:310px;pointer-events:auto;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
      color:#e8ebf0;background:#0d0f12;border:1px solid #2a2f37;border-radius:14px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
    .head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    .head b{font-size:14px;color:#38e1ff}
    .state{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #2a2f37;color:#a9b0bb;word-break:break-word}
    .state div+div{margin-top:4px}
    .ok{color:#3dff8f}.dup{color:#ffc93d}.err{color:#ff8a80}
    button,select{font:inherit;color:inherit;border-radius:9px;border:1px solid #2a2f37;background:#171a20;min-height:36px;padding:0 10px;cursor:pointer}
    button:hover{border-color:#38e1ff}
    button:focus-visible,select:focus-visible{outline:2px solid #38e1ff;outline-offset:2px}
    button:disabled{opacity:.5;cursor:not-allowed}
    .x{min-height:28px;width:28px;padding:0;border-color:transparent;background:none;font-size:18px;line-height:1}
    .row{display:flex;gap:6px}
    .start{flex:1;background:#ff2bd6;border-color:#ff2bd6;color:#fff;font-weight:600}
    .start:hover{filter:brightness(1.08);border-color:#ff2bd6}
    .stop{flex:1}
    .stat{margin-top:8px;color:#a9b0bb;min-height:19px;word-break:break-word}
    .stat b{color:#fff}
    .bar{height:3px;border-radius:3px;background:#2a2f37;margin-top:8px;overflow:hidden}
    .bar i{display:block;height:100%;width:0;background:#38e1ff;transition:width .4s}
    [hidden]{display:none!important}`;

  const escapeHtml = s => String(s).replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[c]));
  const errorText = e => (e === 'offline' ? 'RAG app is not running at 127.0.0.1:8000' : escapeHtml(e));

  function connected() {
    try { return Boolean(chrome.runtime?.id); } catch { return false; }
  }

  function disconnect() {
    cancelAnimationFrame(frame);
    timers.forEach(clearInterval);
    host?.remove();
    host = ui = spider = page = popup = url = null;
  }

  const guarded = fn => () => (connected() ? fn() : disconnect());

  function send(message) {
    return new Promise(resolve => {
      if (!connected()) { disconnect(); return resolve({ok: false, error: 'Extension was reloaded, refresh this page'}); }
      try { chrome.runtime.sendMessage(message, r => resolve(r || {ok: false, error: chrome.runtime.lastError?.message || 'No reply'})); }
      catch { resolve({ok: false, error: 'Extension was reloaded, refresh this page'}); }
    });
  }

  function look(i) {
    const mix = Math.imul(i + 1, 2654435761) >>> 0;
    return {color: COLORS[mix % COLORS.length], fill: (mix >>> 5) % 5 === 0};
  }

  function makeView(found, section) {
    return {
      ...found, section, sig: RagReader.signature(found.text), read: 0, saved: '', dirty: false,
      key: `read:${location.href.split('#')[0]}${section ? `#${section}` : ''}`,
    };
  }

  function markRead(view, index, now) {
    const item = view.items[index];
    if (item.at) return;
    Object.assign(item, {at: now}, look(index));
    view.read += 1;
    view.dirty = true;
  }

  async function restore(view) {
    if (!connected()) return;
    const stored = (await chrome.storage.local.get(view.key).catch(() => ({})))[view.key];
    if (!stored || stored.sig !== view.sig) return;
    for (const [a, b] of stored.ranges) for (let i = a; i <= b && i < view.items.length; i++) markRead(view, i, 1);
    view.dirty = false;
    showState();
  }

  function remember(view) {
    if (!view || !view.dirty) return;
    if (!connected()) return disconnect();
    const ranges = [];
    view.items.forEach((item, i) => {
      if (!item.at) return;
      const last = ranges[ranges.length - 1];
      if (last && last[1] === i - 1) last[1] = i; else ranges.push([i, i]);
    });
    chrome.storage.local.set({[view.key]: {sig: view.sig, ranges, t: Date.now()}}).catch(() => {});
    view.dirty = false;
  }

  async function pruneMemory() {
    if (!connected()) return;
    const all = await chrome.storage.local.get(null).catch(() => ({}));
    const old = Object.entries(all).filter(([k]) => k.startsWith('read:')).sort((a, b) => b[1].t - a[1].t).slice(MEMORY_LIMIT);
    if (old.length) chrome.storage.local.remove(old.map(([k]) => k)).catch(() => {});
  }

  const httpStatus = () => performance.getEntriesByType('navigation')[0]?.responseStatus || 200;

  async function save(view) {
    const minimum = view.section ? MIN_POPUP_TEXT : MIN_PAGE_TEXT, status = httpStatus();
    let outcome = 'failed';
    if (!view.section && status >= 400) view.saved = `<span class="dup">error page (HTTP ${status}), not saved</span>`;
    else if (view.text.length < minimum) view.saved = '<span class="dup">not enough text to save</span>';
    else {
      view.saved = 'saving...';
      showState();
      const r = await send({type: 'savePage', url: location.href, title: view.section ? view.title : document.title, text: view.text, section: view.section});
      outcome = r.ok ? (r.data.status === 'ingested' ? 'ingested' : 'duplicate') : 'failed';
      if (!r.ok) view.saved = `<span class="err">not saved: ${errorText(r.error)}</span>`;
      else if (outcome === 'ingested') view.saved = '<span class="ok">saved to your database</span>';
      else view.saved = '<span class="dup">already in your database</span>';
    }
    showState();
    return outcome;
  }

  function showState() {
    if (!ui) return;
    const line = (label, view) => `<div>${label}: ${view.saved || 'reading'} · read <b>${view.read}</b> / ${view.items.length}</div>`;
    ui.state.innerHTML = (page ? line('This page', page) : '<div>Looking for text on this page...</div>')
      + (popup ? line(`Popup «${escapeHtml(popup.title.slice(0, 40))}»`, popup) : '');
    host.dataset.read = (page?.read || 0) + (popup?.read || 0);
  }

  function loadPage() {
    remember(page);
    url = location.href;
    popup = null;
    page = makeView(RagReader.readPage(), null);
    RagReader.measure(page.items);
    showState();
    page.saving = restore(page).then(() => save(page));
    return page.saving;
  }

  function rescan() {
    if (popup || !page) return;
    const fresh = RagReader.readPage();
    if (Math.abs(fresh.text.length - page.text.length) < 40) return;
    const done = new Map();
    for (const item of page.items) {
      if (!item.at || !item.node) continue;
      if (!done.has(item.node)) done.set(item.node, new Set());
      done.get(item.node).add(item.start);
    }
    const next = makeView(fresh, null);
    next.saved = page.saved;
    next.items.forEach((item, i) => { if (item.node && done.get(item.node)?.has(item.start)) markRead(next, i, 1); });
    RagReader.measure(next.items);
    page = next;
    showState();
  }

  function watch() {
    if (location.href !== url) return loadPage();
    const dialog = RagReader.openDialog();
    if (!dialog) {
      if (popup) { remember(popup); popup = null; showState(); }
      return;
    }
    const found = RagReader.readDialog(dialog);
    if (popup && popup.sig === RagReader.signature(found.text)) return;
    remember(popup);
    popup = makeView(found, found.title || 'popup');
    RagReader.measure(popup.items);
    showState();
    restore(popup).then(() => save(popup));
  }

  function fixedAncestor(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const position = getComputedStyle(e).position;
      if (position === 'fixed' || position === 'sticky') return e;
    }
    return null;
  }

  function coveredTop() {
    if (!page?.root) return 0;
    const r = page.root.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 200), 1), innerWidth - 1);
    let top = 0;
    for (let y = 1; y < innerHeight / 3; y = Math.max(y + 8, top + 1)) {
      const bar = fixedAncestor(document.elementFromPoint(x, y));
      if (!bar) break;
      top = Math.max(top, bar.getBoundingClientRect().bottom);
    }
    return top;
  }

  const activeView = () => popup || page;
  const onScreen = (item, top) => item.w > 0 && item.y + item.h > scrollY + top && item.y < scrollY + innerHeight;

  function nearestUnread(view, top) {
    let best = null, score = Infinity;
    for (const item of view.items) {
      if (item.at || !onScreen(item, top)) continue;
      const s = Math.abs(item.x + item.w / 2 - spider.x) + 2.5 * Math.abs(item.y + item.h / 2 - spider.y);
      if (s < score) { best = item; score = s; }
    }
    return best;
  }

  function readAround(x, y, radius, now) {
    const view = activeView();
    if (!view) return;
    const top = popup ? 0 : inset;
    view.items.forEach((item, i) => {
      if (item.at || !onScreen(item, top)) return;
      const nx = Math.max(item.x, Math.min(x, item.x + item.w)), ny = Math.max(item.y, Math.min(y, item.y + item.h));
      if (Math.hypot(nx - x, ny - y) <= radius) markRead(view, i, now);
    });
  }

  function update(dt, now) {
    if (now - measuredAt > MEASURE_MS) {
      if (page) RagReader.measure(page.items);
      if (popup) RagReader.measure(popup.items);
      if (!popup) inset = coveredTop();
      measuredAt = now;
    }
    const view = activeView();
    const followMouse = now - mouse.movedAt < MOUSE_PRIORITY_MS;
    const target = !followMouse && view && nearestUnread(view, popup ? 0 : inset);
    if (target) spider.walk(target.x + target.w / 2, target.y + target.h / 2, READ_SPEED, dt);
    else spider.walk(mouse.x + scrollX, mouse.y + scrollY, FOLLOW_SPEED, dt);
    readAround(spider.x, spider.y, spider.radius, now);
    spider.step(dt, (x, y) => readAround(x, y, FOOT_RADIUS, now));
    if (popup?.dirty || page?.dirty) showState();
  }

  function drawItems(ctx, view, top, now) {
    const ox = scrollX, oy = scrollY;
    for (const item of view.items) {
      if (!item.at || !onScreen(item, top)) continue;
      ctx.shadowBlur = now - item.at < 400 ? 14 : 0;
      ctx.shadowColor = item.color;
      const x = item.x - ox - 2, y = item.y - oy - 1, w = item.w + 4, h = item.h + 2;
      if (item.fill || !item.range) { ctx.fillStyle = item.color + '55'; ctx.fillRect(x, y, w, h); }
      ctx.strokeStyle = item.color;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.shadowBlur = 0;
  }

  function popupBox() {
    const shown = popup.items.filter(item => item.w > 0);
    if (!shown.length) return null;
    const nodes = shown.filter(item => item.node).map(item => item.node);
    if (nodes.length) {
      const span = document.createRange();
      span.setStartBefore(nodes[0]);
      span.setEndAfter(nodes[nodes.length - 1]);
      const card = span.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? span.commonAncestorContainer : span.commonAncestorContainer.parentElement;
      const r = card.getBoundingClientRect();
      if (r.width < innerWidth - 4) return {x: r.left, y: r.top, w: r.width, h: r.height};
    }
    const pad = 24, left = Math.min(...shown.map(i => i.x)), top = Math.min(...shown.map(i => i.y));
    const right = Math.max(...shown.map(i => i.x + i.w)), bottom = Math.max(...shown.map(i => i.y + i.h));
    return {x: left - scrollX - pad, y: top - scrollY - pad, w: right - left + pad * 2, h: bottom - top + pad * 2};
  }

  function draw(now) {
    const ctx = ui.canvas.getContext('2d');
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.lineWidth = 1.5;
    if (page) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, inset, innerWidth, innerHeight);
      const box = popup && popupBox();
      if (box) ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip('evenodd');
      drawItems(ctx, page, inset, now);
      ctx.restore();
    }
    if (popup) drawItems(ctx, popup, 0, now);
    spider.draw(ctx, scrollX, scrollY);
  }

  function loop(time) {
    if (!ui) return;
    if (!connected()) return disconnect();
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    if (!document.hidden) { update(dt, time); draw(time); }
    frame = requestAnimationFrame(loop);
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pageLinks = () => [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))].slice(0, 5000);

  async function startPage() {
    url = location.href;
    const r = await send({type: 'crawlCheck'});
    const check = r.ok ? r.data : {crawling: false, state: null};
    if (check.state) showCrawl(check.state);
    if (!check.crawling) return loadPage();
    crawling = true;
    await sleep(CRAWL_SETTLE_MS);
    if (!ui) return;
    const outcome = await loadPage();
    await sleep(CRAWL_READ_MS);
    if (ui && crawling) send({type: 'crawlPage', url: location.href, title: document.title, outcome, links: pageLinks()});
  }

  async function startCrawl() {
    ui.start.disabled = true;
    const outcome = await (page?.saving || Promise.resolve('failed'));
    const robots = await fetch('/robots.txt', {credentials: 'include'}).then(r => (r.ok ? r.text() : '')).catch(() => '');
    const r = await send({type: 'crawlStart', url: location.href, title: document.title, limit: Number(ui.limit.value), robots, outcome, links: pageLinks()});
    if (!ui) return;
    ui.start.disabled = false;
    if (!r.ok) { ui.stat.innerHTML = `<span class="err">${errorText(r.error)}</span>`; return; }
    crawling = true;
    showCrawl(r.data);
  }

  function stopCrawl() {
    crawling = false;
    send({type: 'crawlStop'});
  }

  function showCrawl(s) {
    if (!ui) return;
    ui.start.hidden = s.running; ui.stop.hidden = !s.running; ui.limit.disabled = s.running;
    const total = Math.min(s.found, s.limit);
    ui.bar.style.width = s.phase === 'finished' ? '100%' : total ? `${Math.round((s.done / total) * 100)}%` : '0';
    const counts = `<b>${s.done}</b> / ${s.limit} pages · added <b>${s.ingested}</b> · already saved ${s.duplicate} · failed ${s.failed}${s.skipped ? ` · blocked by robots ${s.skipped}` : ''}`;
    const where = escapeHtml(s.host);
    if (s.running) ui.stat.innerHTML = `Crawling ${where}: ${counts}${s.current ? `<br>Last saved: ${escapeHtml(s.current.slice(0, 70))}` : ''}`;
    else ui.stat.innerHTML = `${s.phase === 'finished' ? 'Finished' : 'Stopped'} ${where}: ${counts}`;
  }

  function sizeCanvas() {
    const ratio = devicePixelRatio || 1;
    ui.canvas.width = innerWidth * ratio; ui.canvas.height = innerHeight * ratio;
    ui.canvas.style.width = innerWidth + 'px'; ui.canvas.style.height = innerHeight + 'px';
    ui.canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function build() {
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const root = host.attachShadow({mode: 'closed'});
    root.innerHTML = `<style>${STYLE}</style><canvas></canvas>
      <section class="panel" aria-label="RAG spider">
        <div class="head"><b>RAG spider</b><button class="x" type="button" aria-label="Hide spider">&times;</button></div>
        <div class="state" role="status"></div>
        <div class="row">
          <select aria-label="Page limit"><option value="100">100 pages</option><option value="500">500 pages</option><option value="1000">1000 pages</option><option value="2000">2000 pages</option></select>
          <button class="start" type="button">Crawl whole site</button>
          <button class="stop" type="button" hidden>Stop</button>
        </div>
        <div class="stat">The spider visits every page of this website, reads and saves it, and notifies you when it is done. Use another tab meanwhile.</div>
        <div class="bar"><i></i></div>
      </section>`;
    ui = {
      canvas: root.querySelector('canvas'), start: root.querySelector('.start'), stop: root.querySelector('.stop'),
      limit: root.querySelector('select'), stat: root.querySelector('.stat'), bar: root.querySelector('.bar i'), state: root.querySelector('.state'),
    };
    root.querySelector('.x').addEventListener('click', guarded(() => chrome.storage.local.set({enabled: false})));
    ui.start.addEventListener('click', startCrawl);
    ui.stop.addEventListener('click', stopCrawl);
    document.documentElement.append(host);
    sizeCanvas();
    spider = new RagSpider(mouse.x + scrollX, mouse.y + scrollY);
    startPage();
    pruneMemory();
    timers = [
      setInterval(guarded(watch), WATCH_MS), setInterval(guarded(rescan), RESCAN_MS),
      setInterval(guarded(() => { remember(page); remember(popup); }), REMEMBER_MS),
    ];
    lastTime = performance.now();
    frame = requestAnimationFrame(loop);
  }

  function teardown() {
    remember(page); remember(popup);
    if (crawling) stopCrawl();
    disconnect();
  }

  addEventListener('mousemove', e => Object.assign(mouse, {x: e.clientX, y: e.clientY, movedAt: performance.now()}), {passive: true});
  addEventListener('resize', () => { if (ui) sizeCanvas(); });
  addEventListener('pagehide', () => { remember(page); remember(popup); });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== 'crawlState') return;
    crawling = message.state.running;
    showCrawl(message.state);
  });
  chrome.storage.onChanged.addListener(changes => {
    if (!changes.enabled) return;
    changes.enabled.newValue ? (host || build()) : teardown();
  });
  chrome.storage.local.get('enabled').then(({enabled}) => { if (enabled) build(); });
})();
