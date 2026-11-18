/**
 * Bybit P2P Order Highlighter - Content Script
 * Receives intercepted Bybit P2P responses and highlights orders matching keywords (СБП, телефона).
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
      highlightColor: 'emerald', // emerald, amber, cyan, violet
      showRemarkPreview: true,
      dimNonMatching: false,
      hideNonMatching: false
    },
    itemsById: new Map(),
    itemsByKey: new Map(),
    itemsByNick: new Map(),
    itemsByUserId: new Map(),
    lastItemIds: [],
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

  // 2. Inject Page-Context Interceptor
  // Runs in the page's main world to avoid any Firefox Xray Vision cross-compartment permission errors
  function injectPageInterceptor() {
    try {
      const script = document.createElement('script');
      script.src = api.runtime.getURL('content/injected.js');
      script.async = false;
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[Bybit Highlighter] Script injection failed:', e);
    }

    // Listen for data dispatched by injected.js
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

      const newIds = [];
      items.forEach(item => {
        if (!item) return;
        if (item.id) {
          const strId = String(item.id);
          state.itemsById.set(strId, item);
          newIds.push(strId);
        }
        if (item.userId) {
          state.itemsByUserId.set(String(item.userId), item);
        }
        if (item.nickName) {
          const nickLower = item.nickName.trim().toLowerCase();
          state.itemsByNick.set(nickLower, item);
          const priceKey = `${nickLower}__${parseFloat(item.price || 0)}`;
          state.itemsByKey.set(priceKey, item);
        }
      });

      if (newIds.length > 0) {
        state.lastItemIds = newIds;
      }

      scheduleHighlight(30);
    } catch (e) {
      // Not JSON or other structure, ignore
    }
  }

  // 4. Keyword Matching Engine
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

  // 5. DOM Row Discovery
  function findAllOrderRows() {
    // Strategy A: Standard table rows
    const trs = Array.from(document.querySelectorAll('tbody tr, table tr')).filter(tr => 
      !tr.querySelector('th') && (tr.innerText || '').trim().length > 0
    );
    if (trs.length > 0) return trs;

    // Strategy B: CSS class rows
    const classRows = Array.from(document.querySelectorAll(
      'div[class*="trade-table__row"], div[class*="table-row"], div[class*="trade-row"], div[class*="advertiser-item"], div[class*="otc-item"]'
    ));
    if (classRows.length > 0) return classRows;

    // Strategy C: Find trade action buttons ("Buy", "Sell", "Купить", "Продать")
    const actionButtons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      return txt.startsWith('buy') || txt.startsWith('sell') || 
             txt.startsWith('купить') || txt.startsWith('продать');
    });

    if (actionButtons.length > 0) {
      const rows = [];
      actionButtons.forEach(btn => {
        let el = btn.parentElement;
        while (el && el !== document.body) {
          if (el.parentElement && el.parentElement.children.length >= 2) {
            const siblings = Array.from(el.parentElement.children);
            const siblingButtons = siblings.filter(s => s.querySelector && s.querySelector('button'));
            if (siblingButtons.length >= 2) {
              rows.push(el);
              break;
            }
          }
          el = el.parentElement;
        }
      });
      if (rows.length > 0) return rows;
    }

    return [];
  }

  // Associate a DOM row with an intercepted API item
  function findItemForOrderRow(row) {
    const rowHtml = row.innerHTML || '';
    const rowText = row.textContent || '';
    const rowTextLower = rowText.toLowerCase();

    // 1. Search by Item ID in attributes or HTML
    for (const [id, item] of state.itemsById.entries()) {
      if (rowHtml.includes(id)) {
        return item;
      }
    }

    // 2. Search by User ID (e.g. profile link)
    for (const [userId, item] of state.itemsByUserId.entries()) {
      if (rowHtml.includes(userId)) {
        return item;
      }
    }

    // 3. Search by Nickname + Price
    for (const [key, item] of state.itemsByKey.entries()) {
      if (item.nickName && rowText.includes(item.nickName)) {
        if (item.price && rowText.includes(item.price)) {
          return item;
        }
      }
    }

    // 4. Search by Nickname alone
    for (const [nick, item] of state.itemsByNick.entries()) {
      if (rowTextLower.includes(nick)) {
        return item;
      }
    }

    return null;
  }

  // 6. Highlight and Decorate Rows
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

      // Matches in seller remark (from API)
      const remarkMatches = item && item.remark ? findMatchesInText(item.remark, keywords) : [];
      // Matches directly in DOM row text (e.g. payment methods or notes)
      const textMatches = findMatchesInText(rowText, keywords);

      const allMatches = Array.from(new Set([...remarkMatches, ...textMatches]));
      const isMatch = allMatches.length > 0;

      if (isMatch) {
        matchedCount++;
        row.classList.add('bybit-p2p-highlighted-order');
        row.classList.remove('bybit-p2p-dimmed-order', 'bybit-p2p-hidden-order');

        // Render / Update Match Badge
        renderBadge(row, allMatches);

        // Render / Update Remark Preview if available and enabled
        if (state.settings.showRemarkPreview && item && item.remark) {
          renderRemarkBox(row, item.remark, keywords);
        } else {
          removeRemarkBox(row);
        }
      } else {
        row.classList.remove('bybit-p2p-highlighted-order');
        removeBadge(row);
        removeRemarkBox(row);

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

  function renderBadge(row, matchedKeywords) {
    let container = row.querySelector('.bybit-p2p-match-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'bybit-p2p-match-container';

      // Insert near payment methods cell or inside first column
      const targetCell = row.children[3] || row.children[0] || row;
      targetCell.appendChild(container);
    }

    const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');
    container.innerHTML = `
      <span class="bybit-p2p-match-tag" title="Найдено в условиях сделки">
        <span class="bybit-tag-icon">⚡</span>
        <span>${escapeHtml(labelText)}</span>
      </span>
    `;
  }

  function removeBadge(row) {
    const container = row.querySelector('.bybit-p2p-match-container');
    if (container) container.remove();
  }

  function renderRemarkBox(row, remark, keywords) {
    let box = row.querySelector('.bybit-p2p-remark-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'bybit-p2p-remark-box';

      // Attach to row
      if (row.tagName === 'TR') {
        const targetCell = row.children[3] || row.children[row.children.length - 1] || row.children[0];
        targetCell.appendChild(box);
      } else {
        row.appendChild(box);
      }
    }

    // Check if user already expanded it
    const isExpanded = box.getAttribute('data-expanded') === 'true';

    // Highlight keywords in remark text safely
    const highlightedHtml = highlightKeywordsInHtml(remark, keywords);

    box.innerHTML = `
      <div class="bybit-p2p-remark-header">
        <span>📝 Условия продавца:</span>
        <button type="button" class="bybit-remark-toggle-btn">${isExpanded ? 'Свернуть' : 'Подробнее'}</button>
      </div>
      <div class="bybit-p2p-remark-content ${isExpanded ? '' : 'bybit-collapsed'}">
        ${highlightedHtml}
      </div>
    `;

    const toggleBtn = box.querySelector('.bybit-remark-toggle-btn');
    const content = box.querySelector('.bybit-p2p-remark-content');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentlyExpanded = box.getAttribute('data-expanded') === 'true';
      if (currentlyExpanded) {
        box.setAttribute('data-expanded', 'false');
        content.classList.add('bybit-collapsed');
        toggleBtn.textContent = 'Подробнее';
      } else {
        box.setAttribute('data-expanded', 'true');
        content.classList.remove('bybit-collapsed');
        toggleBtn.textContent = 'Свернуть';
      }
    });
  }

  function removeRemarkBox(row) {
    const box = row.querySelector('.bybit-p2p-remark-box');
    if (box) box.remove();
  }

  function removeAllHighlights() {
    document.querySelectorAll('.bybit-p2p-highlighted-order').forEach(el => {
      el.classList.remove('bybit-p2p-highlighted-order');
    });
    document.querySelectorAll('.bybit-p2p-dimmed-order').forEach(el => {
      el.classList.remove('bybit-p2p-dimmed-order');
    });
    document.querySelectorAll('.bybit-p2p-hidden-order').forEach(el => {
      el.classList.remove('bybit-p2p-hidden-order');
    });
    document.querySelectorAll('.bybit-p2p-match-container').forEach(el => el.remove());
    document.querySelectorAll('.bybit-p2p-remark-box').forEach(el => el.remove());
  }

  function highlightKeywordsInHtml(text, keywords) {
    if (!text) return '';
    let escaped = escapeHtml(text);
    if (!keywords || keywords.length === 0) return escaped;

    // Create a safe regex matching any keyword case-insensitively
    const escapedKws = keywords.map(escapeRegExp).filter(Boolean);
    if (escapedKws.length === 0) return escaped;

    const regex = new RegExp(`(${escapedKws.join('|')})`, 'gi');
    return escaped.replace(regex, '<mark class="bybit-kw-highlight">$1</mark>');
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

  // 7. Floating On-Page Quick Widget
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

  // 8. Dynamic Updates via MutationObserver & Routing
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          const target = m.target;
          if (target && target.closest && (target.closest('#bybit-p2p-floating-widget') || target.closest('.bybit-p2p-remark-box'))) {
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

    // Periodic check to capture virtual lists or late renders
    setInterval(() => {
      if (state.settings.enabled && window.location.href.includes('otc')) {
        highlightOrders();
      }
    }, 2500);

    // Watch URL / History changes
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
