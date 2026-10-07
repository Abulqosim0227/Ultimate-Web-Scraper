const RagReader = (() => {
  const MIN_ARTICLE_CHARS = 500;
  const MIN_DIALOG_CHARS = 20;
  const MIN_IMAGE_WIDTH = 200;
  const SKIP = 'nav,aside,script,style,noscript,template,svg,select,textarea,input,[hidden]';
  const SCREEN_READER_HIDDEN = '[aria-hidden="true"]';
  const CONTROL_TEXT = 'button,[role="button"]';
  const PAGE_CHROME = 'header,footer';
  const BLOCK = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dt,dd,figcaption,caption,tr,div,section,article';
  const CLUTTER = /(^|[\s_-])(tags?|share|sharing|social|breadcrumbs?|related|comments?|newsletter|subscribe|advert|ads?|banner|promo|sponsor|cookie|widget)([\s_-]|$)/i;
  const DIALOG = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';

  function visible(el) {
    if (!el.checkVisibility) return true;
    return el.checkVisibility({visibilityProperty: true}) || getComputedStyle(el).display === 'contents';
  }

  function textLength(el) {
    return (el.innerText || '').trim().length;
  }

  function pageRoot() {
    const articles = [...document.querySelectorAll('article')].filter(a => visible(a) && textLength(a) >= MIN_ARTICLE_CHARS);
    if (articles.length) return articles.reduce((a, b) => (textLength(b) > textLength(a) ? b : a));
    const main = document.querySelector('main,[role="main"]');
    return main && visible(main) && textLength(main) >= MIN_ARTICLE_CHARS ? main : document.body;
  }

  function openDialog() {
    const marked = [...document.querySelectorAll(DIALOG)].filter(d => visible(d) && textLength(d) >= MIN_DIALOG_CHARS);
    if (marked.length) return marked[marked.length - 1];
    for (let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const chars = textLength(el);
      return chars >= MIN_DIALOG_CHARS && chars < textLength(document.body) * 0.8 ? el : null;
    }
    return null;
  }

  function dialogTitle(dialog) {
    const labelId = dialog.getAttribute('aria-labelledby');
    const heading = (labelId && document.getElementById(labelId)) || dialog.querySelector('h1,h2,h3,h4,h5,h6,[class*="title"]');
    const source = (heading && heading.textContent.trim()) || dialog.innerText.trim();
    return source.split('\n')[0].slice(0, 120);
  }

  function isClutter(el) {
    if (el.tagName === 'A' && (/\btag\b/i.test(el.rel) || el.textContent.trim().startsWith('#'))) return true;
    const names = `${typeof el.className === 'string' ? el.className : ''} ${el.id}`;
    return CLUTTER.test(names);
  }

  const isInline = el => getComputedStyle(el).display === 'inline';

  function collect(root, exclude) {
    const items = [], parts = [];
    let lastBlock = null, lastParent = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.data.trim() && !node.parentElement.closest(CONTROL_TEXT) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (node === exclude || node.matches(SKIP) || !visible(node)) return NodeFilter.FILTER_REJECT;
        if (node.tagName !== 'IMG' && (node.matches(SCREEN_READER_HIDDEN) || isClutter(node))) return NodeFilter.FILTER_REJECT;
        if (node.matches(PAGE_CHROME) && !node.closest('article,dialog,[role="dialog"]')) return NodeFilter.FILTER_REJECT;
        return node.tagName === 'IMG' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.getBoundingClientRect().width >= MIN_IMAGE_WIDTH) items.push({el: node});
        continue;
      }
      const parent = node.parentElement, block = parent.closest(BLOCK);
      if (parts.length && block !== lastBlock) parts.push('\n');
      else if (parts.length && parent !== lastParent && !(isInline(parent) && isInline(lastParent))) parts.push(' ');
      lastBlock = block;
      lastParent = parent;
      parts.push(node.data.replace(/\s+/g, ' '));
      for (const m of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        items.push({range, node, start: m.index});
      }
    }
    const text = parts.join('').replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
    return {items, text};
  }

  function readPage() {
    const root = pageRoot();
    const page = collect(root, openDialog());
    const heading = [...document.querySelectorAll('h1')].find(visible);
    if (root !== document.body && heading && !root.contains(heading)) {
      const top = collect(heading, null);
      page.items.unshift(...top.items);
      page.text = `${top.text}\n${page.text}`;
    }
    return {root, ...page};
  }

  function readDialog(dialog) {
    return {el: dialog, title: dialogTitle(dialog), ...collect(dialog, null)};
  }

  function measure(items) {
    const ox = scrollX, oy = scrollY;
    for (const item of items) {
      const r = (item.range || item.el).getBoundingClientRect();
      Object.assign(item, {x: r.left + ox, y: r.top + oy, w: r.width, h: r.height});
    }
  }

  function signature(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return `${text.length}:${h.toString(36)}`;
  }

  return {readPage, readDialog, openDialog, measure, signature};
})();
