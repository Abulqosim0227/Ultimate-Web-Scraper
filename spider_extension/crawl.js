const RagCrawl = (() => {
  const AGENT = 'ragreference';
  const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|gz|mp3|mp4|avi|mov|webm|docx?|xlsx?|pptx?|exe|apk|css|js|xml|json|rss)$/i;

  function pageUrl(href, base, origin) {
    let url;
    try { url = new URL(href, base); } catch { return null; }
    if (url.origin !== origin || !/^https?:$/.test(url.protocol) || NOT_A_PAGE.test(url.pathname)) return null;
    url.hash = '';
    return url.href;
  }

  function rulePattern(path) {
    const anchored = path.endsWith('$');
    const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
  }

  function parseRobots(text) {
    const groups = [];
    let current = null, lastWasAgent = false;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim(), colon = line.indexOf(':');
      if (colon < 0) continue;
      const field = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
      if (field === 'user-agent') {
        if (!lastWasAgent) groups.push(current = {agents: [], rules: []});
        current.agents.push(value.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (current && value && (field === 'allow' || field === 'disallow')) {
        current.rules.push({allow: field === 'allow', length: value.length, pattern: rulePattern(value)});
      }
    }
    const group = groups.find(g => g.agents.some(a => a !== '*' && AGENT.includes(a))) || groups.find(g => g.agents.includes('*'));
    const rules = group ? group.rules : [];
    return url => {
      const {pathname, search} = new URL(url);
      let best = null;
      for (const rule of rules) {
        if (rule.pattern.test(pathname + search) && (!best || rule.length > best.length || (rule.length === best.length && rule.allow))) best = rule;
      }
      return !best || best.allow;
    };
  }

  return {pageUrl, parseRobots};
})();
