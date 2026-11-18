/**
 * Bybit P2P Order Highlighter - Content Script
 * Highlights keywords in Bybit P2P orders (СБП, телефона) with green background & white text,
 * positions the badge at the top, and renders a clean, solid green left stripe.
 */
(() => {
  'use strict';

  // Cross-browser compatibility wrapper
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // State
  const state = {
    settings: {
      enabled: true,
      keywords: ['СБП', 'телефона'],
      highlightColor: 'emerald',
      dimNonMatching: false,
      hideNonMatching: false
    },
    itemsById: new Map(),
    itemsByKey: new Map(),
    itemsByNick: new Map(),
    itemsByUserId: new Map(),
    matchedCount: 0,
    totalRowsCount: 0,
    highlightTimeout: null
  };

  // 1. Load and sync settings
  function loadSettings() {
    try {
      api.storage.local.get(state.settings, (items) => {
        if (items) {
          state.settings = { ...state.settings, ...items };
          applyThemeColor(state.settings.highlightColor);
          scheduleHighlight(0);
        }
      });
    } catch (e) {
      console.warn('[Bybit Highlighter] Storage get failed:', e);
    }
  }

  // Listen for storage changes
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        let changed = false;
        for (const [key, change] of Object.entries(changes)) {
          if (state.settings[key] !== change.newValue) {
            state.settings[key] = change.newValue;
            changed = true;
          }
        }
        if (changed) {
          applyThemeColor(state.settings.highlightColor);
          scheduleHighlight(10);
        }
      }
    });
  } catch (e) {}

  // Listen for direct messages from popup
  try {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_STATUS') {
        sendResponse({
          enabled: state.settings.enabled,
          keywords: state.settings.keywords,
          matchedCount: state.matchedCount,
          totalRowsCount: state.totalRowsCount,
          itemsCached: state.itemsById.size
        });
        return true;
      }
      if (message.type === 'UPDATE_SETTINGS') {
        state.settings = { ...state.settings, ...message.settings };
        applyThemeColor(state.settings.highlightColor);
        scheduleHighlight(10);
        sendResponse({ success: true });
        return true;
      }
    });
  } catch (e) {}

  function applyThemeColor(color) {
    document.documentElement.setAttribute('data-bybit-theme', color || 'emerald');
  }

  // 2. Inject Page-Context Interceptor Fallback
  function injectPageInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = api.runtime.getURL('content/injected.js');
      script.async = false;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {}

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__BYBIT_P2P_DATA__' && event.data.text) {
        processApiPayload(event.data.text, event.data.url);
      }
    });
  }

  // 3. Process API Payload
  function processApiPayload(text, url) {
    if (!text || typeof text !== 'string') return;
    try {
      const data = JSON.parse(text);
      let items = [];

      if (Array.isArray(data?.result?.items)) {
        items = data.result.items;
      } else if (Array.isArray(data?.result?.list)) {
        items = data.result.list;
      } else if (Array.isArray(data?.items)) {
        items = data.items;
      } else if (Array.isArray(data?.result)) {
        items = data.result;
      }

      if (!items || items.length === 0) return;

      items.forEach(item => {
        if (!item) return;
        if (item.id) state.itemsById.set(String(item.id), item);
        if (item.userId) state.itemsByUserId.set(String(item.userId), item);
        if (item.nickName) {
          const nickLower = item.nickName.trim().toLowerCase();
          state.itemsByNick.set(nickLower, item);
          const priceKey = `${nickLower}__${parseFloat(item.price || 0)}`;
          state.itemsByKey.set(priceKey, item);
        }
      });

      scheduleHighlight(10);
    } catch (e) {}
  }

  // 4. Keyword Matching
  function getActiveKeywords() {
    if (!state.settings.keywords || !Array.isArray(state.settings.keywords)) {
      return ['сбп', 'телефона'];
    }
    return state.settings.keywords
      .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
      .filter(k => k.length > 0);
  }

  function findMatchesInText(text, keywords) {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase();
    const matched = [];
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.push(kw);
      }
    }
    return matched;
  }

  // 5. DOM Discovery
  function findAllOrderRows() {
    const allButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      return txt.startsWith('buy') || txt.startsWith('sell') || 
             txt.startsWith('купить') || txt.startsWith('продать') ||
             txt === 'hide' || txt === 'скрыть';
    });

    if (allButtons.length > 0) {
      const rows = [];
      allButtons.forEach(btn => {
        let cur = btn.parentElement;
        while (cur && cur !== document.body) {
          const parent = cur.parentElement;
          if (parent) {
            const siblingButtons = Array.from(parent.children).filter(child => {
              return child.querySelector && child.querySelector('button');
            });
            if (siblingButtons.length >= 2) {
              const text = cur.textContent || '';
              if (text.includes('RUB') || text.includes('USDT') || text.includes('Order') || text.includes('Заказ')) {
                rows.push(cur);
                break;
              }
            }
          }
          cur = cur.parentElement;
        }
      });

      if (rows.length > 0) {
        return Array.from(new Set(rows));
      }
    }

    const trs = Array.from(document.querySelectorAll('tbody tr, table tr')).filter(tr => {
      const text = tr.innerText || '';
      return !tr.querySelector('th') && (text.includes('RUB') || text.includes('USDT') || text.includes('Buy') || text.includes('Купить'));
    });
    if (trs.length > 0) return trs;

    return Array.from(document.querySelectorAll(
      'div[class*="trade-table__row"], div[class*="table-row"], div[class*="trade-row"], div[class*="advertiser-item"], div[class*="otc-item"]'
    ));
  }

  function findItemForOrderRow(row) {
    const rowHtml = row.innerHTML || '';
    const rowText = (row.textContent || '').trim();
    const rowTextLower = rowText.toLowerCase();

    for (const [id, item] of state.itemsById.entries()) {
      if (rowHtml.includes(id)) return item;
    }

    for (const [userId, item] of state.itemsByUserId.entries()) {
      if (rowHtml.includes(userId)) return item;
    }

    for (const [key, item] of state.itemsByKey.entries()) {
      if (item.nickName) {
        const nickLower = item.nickName.trim().toLowerCase();
        if (rowTextLower.includes(nickLower)) {
          if (item.price && rowText.includes(item.price)) return item;
        }
      }
    }

    for (const [nick, item] of state.itemsByNick.entries()) {
      if (rowTextLower.includes(nick)) return item;
    }

    return null;
  }

  // 6. Highlight Keywords in Text Nodes (Green background + White text)
  function highlightKeywordsInTextNodes(container, keywords) {
    if (!container || !keywords || keywords.length === 0) return;

    const escapedKws = keywords.map(escapeRegExp).filter(Boolean);
    if (escapedKws.length === 0) return;
    const regex = new RegExp(`(${escapedKws.join('|')})`, 'gi');

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !regex.test(node.nodeValue)) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (['script', 'style', 'input', 'textarea', 'button', 'mark'].includes(tag)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('.bybit-p2p-match-container') || parent.closest('#bybit-p2p-floating-widget')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(node => {
      const parent = node.parentElement;
      if (!parent) return;
      const text = node.nodeValue;
      regex.lastIndex = 0;
      if (!regex.test(text)) return;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      text.replace(regex, (match, p1, offset) => {
        if (offset > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, offset)));
        }
        const mark = document.createElement('mark');
        mark.className = 'bybit-kw-highlight';
        mark.textContent = match;
        frag.appendChild(mark);
        lastIdx = offset + match.length;
        return match;
      });
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }

      parent.replaceChild(frag, node);
    });
  }

  // 7. Highlight and Decorate Rows
  function highlightOrders() {
    if (!state.settings.enabled) {
      removeAllHighlights();
      updateFloatingWidget(0, 0);
      return;
    }

    const keywords = getActiveKeywords();
    if (keywords.length === 0) {
      removeAllHighlights();
      updateFloatingWidget(0, 0);
      return;
    }

    const rows = findAllOrderRows();
    state.totalRowsCount = rows.length;
    let matchedCount = 0;

    rows.forEach(row => {
      const item = findItemForOrderRow(row);
      const rowText = row.textContent || '';

      const remarkMatches = item && item.remark ? findMatchesInText(item.remark, keywords) : [];
      const textMatches = findMatchesInText(rowText, keywords);

      const allMatches = Array.from(new Set([...remarkMatches, ...textMatches]));
      const isMatch = allMatches.length > 0;

      if (isMatch) {
        matchedCount++;

        // A. Apply clean green left stripe to row
        row.classList.add('bybit-p2p-highlighted-order');
        row.classList.remove('bybit-p2p-dimmed-order', 'bybit-p2p-hidden-order');

        // B. If row is expanded, find the expanded card and apply green left stripe to it as well
        const expandedCard = findExpandedCard(row);
        if (expandedCard) {
          expandedCard.classList.add('bybit-p2p-highlighted-card');
        }

        // C. Highlight matching keywords inside the text (green background, white text)
        highlightKeywordsInTextNodes(row, keywords);

        // D. Place badge AT THE TOP (in title of Advertiser Terms or next to payment methods)
        renderTopBadge(row, expandedCard, allMatches);
      } else {
        row.classList.remove('bybit-p2p-highlighted-order');
        const expandedCard = findExpandedCard(row);
        if (expandedCard) expandedCard.classList.remove('bybit-p2p-highlighted-card');
        removeBadges(row);

        if (state.settings.hideNonMatching) {
          row.classList.add('bybit-p2p-hidden-order');
          row.classList.remove('bybit-p2p-dimmed-order');
        } else if (state.settings.dimNonMatching) {
          row.classList.add('bybit-p2p-dimmed-order');
          row.classList.remove('bybit-p2p-hidden-order');
        } else {
          row.classList.remove('bybit-p2p-dimmed-order', 'bybit-p2p-hidden-order');
        }
      }
    });

    state.matchedCount = matchedCount;
    updateFloatingWidget(matchedCount, rows.length);
  }

  function findExpandedCard(row) {
    // Look for the expanded container with "Advertiser Terms" or "I will pay"
    const candidates = Array.from(row.querySelectorAll('div')).filter(div => {
      const text = div.textContent || '';
      return text.includes('Advertiser Terms') || text.includes('Условия рекламодателя') || text.includes('I will pay');
    });
    if (candidates.length > 0) {
      // Find the outermost card container for this section
      let card = candidates[0];
      while (card && card.parentElement && card.parentElement !== row) {
        if (card.parentElement.children.length === 1 || card.parentElement.classList.contains('bybit-p2p-highlighted-order')) {
          break;
        }
        card = card.parentElement;
      }
      return card;
    }
    return null;
  }

  // Render badge AT THE TOP (never at the bottom)
  function renderTopBadge(row, expandedCard, matchedKeywords) {
    const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');

    // 1. If card is expanded: place badge right next to "Advertiser Terms" heading
    if (expandedCard) {
      let termsHeader = null;
      const allHeadings = Array.from(expandedCard.querySelectorAll('h1, h2, h3, h4, div, span'));
      for (const el of allHeadings) {
        const text = (el.textContent || '').trim();
        if (text === 'Advertiser Terms' || text === 'Условия рекламодателя' || text.startsWith('Advertiser Terms')) {
          termsHeader = el;
          break;
        }
      }

      if (termsHeader) {
        let badge = termsHeader.querySelector('.bybit-p2p-match-container');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'bybit-p2p-match-container';
          termsHeader.appendChild(badge);
        }
        badge.innerHTML = `
          <span class="bybit-p2p-match-tag">
            <span class="bybit-tag-icon">⚡</span>
            <span>${escapeHtml(labelText)}</span>
          </span>
        `;
        return;
      }
    }

    // 2. On the top row: place next to payment methods at the top
    let targetCell = null;
    for (const child of row.children) {
      const text = child.textContent || '';
      if (text.includes('Top-up') || text.includes('Transfer') || text.includes('Bank') || text.includes('Cash')) {
        targetCell = child;
        break;
      }
    }
    if (!targetCell) {
      targetCell = row.children[3] || row.children[0] || row;
    }

    let badge = targetCell.querySelector('.bybit-p2p-match-container');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bybit-p2p-match-container';
      targetCell.appendChild(badge);
    }
    badge.innerHTML = `
      <span class="bybit-p2p-match-tag">
        <span class="bybit-tag-icon">⚡</span>
        <span>${escapeHtml(labelText)}</span>
      </span>
    `;
  }

  function removeBadges(row) {
    row.querySelectorAll('.bybit-p2p-match-container').forEach(el => el.remove());
  }

  function removeAllHighlights() {
    document.querySelectorAll('.bybit-p2p-highlighted-order').forEach(el => {
      el.classList.remove('bybit-p2p-highlighted-order');
    });
    document.querySelectorAll('.bybit-p2p-highlighted-card').forEach(el => {
      el.classList.remove('bybit-p2p-highlighted-card');
    });
    document.querySelectorAll('.bybit-p2p-dimmed-order').forEach(el => {
      el.classList.remove('bybit-p2p-dimmed-order');
    });
    document.querySelectorAll('.bybit-p2p-hidden-order').forEach(el => {
      el.classList.remove('bybit-p2p-hidden-order');
    });
    document.querySelectorAll('.bybit-p2p-match-container').forEach(el => el.remove());
    document.querySelectorAll('.bybit-kw-highlight').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 8. Floating On-Page Quick Widget
  function updateFloatingWidget(matched, total) {
    if (!state.settings.enabled) {
      const widget = document.getElementById('bybit-p2p-floating-widget');
      if (widget) widget.style.display = 'none';
      return;
    }

    let widget = document.getElementById('bybit-p2p-floating-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'bybit-p2p-floating-widget';
      document.body.appendChild(widget);
    }

    widget.style.display = 'flex';
    const mainKw = (state.settings.keywords && state.settings.keywords[0]) || 'СБП';

    widget.innerHTML = `
      <span class="bybit-fw-badge">⚡</span>
      <span class="bybit-fw-counter"><strong>${matched}</strong> / ${total} ${escapeHtml(mainKw)}</span>
      <span class="bybit-fw-divider"></span>
      <button class="bybit-fw-btn ${state.settings.dimNonMatching ? 'active' : ''}" id="bybit-fw-dim-toggle" title="Затемнить остальные заказы">👁️</button>
      <button class="bybit-fw-btn ${state.settings.hideNonMatching ? 'active' : ''}" id="bybit-fw-filter-toggle" title="Показать только подходящие">🔍</button>
    `;

    const dimBtn = widget.querySelector('#bybit-fw-dim-toggle');
    dimBtn.addEventListener('click', () => {
      state.settings.dimNonMatching = !state.settings.dimNonMatching;
      if (state.settings.dimNonMatching) state.settings.hideNonMatching = false;
      api.storage.local.set({ dimNonMatching: state.settings.dimNonMatching, hideNonMatching: false });
      scheduleHighlight(0);
    });

    const filterBtn = widget.querySelector('#bybit-fw-filter-toggle');
    filterBtn.addEventListener('click', () => {
      state.settings.hideNonMatching = !state.settings.hideNonMatching;
      if (state.settings.hideNonMatching) state.settings.dimNonMatching = false;
      api.storage.local.set({ hideNonMatching: state.settings.hideNonMatching, dimNonMatching: false });
      scheduleHighlight(0);
    });
  }

  function scheduleHighlight(delay = 50) {
    if (state.highlightTimeout) {
      clearTimeout(state.highlightTimeout);
    }
    state.highlightTimeout = setTimeout(() => {
      highlightOrders();
    }, delay);
  }

  // 9. Dynamic Updates via MutationObserver & Routing
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          const target = m.target;
          if (target && target.closest && (target.closest('#bybit-p2p-floating-widget') || target.closest('.bybit-p2p-match-container'))) {
            continue;
          }
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) {
        scheduleHighlight(100);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (state.settings.enabled && window.location.href.includes('otc')) {
        highlightOrders();
      }
    }, 2000);

    window.addEventListener('popstate', () => scheduleHighlight(200));
    window.addEventListener('hashchange', () => scheduleHighlight(200));
  }

  // Initialization
  function init() {
    loadSettings();
    injectPageInterceptor();

    if (document.body) {
      setupObserver();
      scheduleHighlight(200);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        setupObserver();
        scheduleHighlight(200);
      });
    }

    console.log('[Bybit Highlighter] Extension initialized successfully');
  }

  init();
})();
