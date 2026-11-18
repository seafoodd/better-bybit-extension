/**
 * Bybit P2P Order Highlighter - Content Script
 * 1. Highlights keywords in terms text (green background, white text).
 * 2. Positions the badge right next to "Price xx.xx RUB xxs".
 * 3. Auto-selects "Mobile Top-up" (or fallback "Bank Transfer") on USDT/RUB buy pages.
 * 4. Renders a continuous solid green left stripe.
 */
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const state = {
    settings: {
      enabled: true,
      keywords: ['СБП', 'телефона'],
      highlightColor: 'emerald'
    },
    highlightTimeout: null
  };

  // 1. Settings & Themes
  function loadSettings() {
    try {
      api.storage.local.get(state.settings, (items) => {
        if (items) {
          state.settings = { ...state.settings, ...items };
          applyThemeColor(state.settings.highlightColor);
          scheduleHighlight(0);
        }
      });
    } catch (e) {}
  }

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

  try {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_STATUS') {
        sendResponse({
          enabled: state.settings.enabled,
          keywords: state.settings.keywords
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

  // 2. USDT/RUB Page Detection
  function isUsdtRubPage() {
    const href = window.location.href.toLowerCase();
    return href.includes('usdt') && href.includes('rub');
  }

  // 3. Auto-Select Payment Method ("Mobile Top-up" -> "Bank Transfer")
  function autoSelectPaymentMethod(card) {
    if (!isUsdtRubPage()) return;
    if (card.__paymentAutoSelected) return;

    // Find the payment method dropdown trigger inside the card
    const selectorEl = findPaymentMethodSelector(card);
    if (!selectorEl) return;

    const currentText = (selectorEl.textContent || '').trim();
    // If a payment method is already selected, mark as done
    if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
      card.__paymentAutoSelected = true;
      return;
    }

    // Only proceed if it is in the unselected placeholder state
    if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
      return;
    }

    card.__paymentAutoSelected = true;

    // Open the dropdown
    selectorEl.click();
    selectorEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    // Try finding and clicking the option
    function tryClickOption() {
      // Find all options in document
      const allElements = Array.from(document.querySelectorAll('div, li, span, p')).filter(el => {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
        const t = (el.textContent || '').trim();
        return t === 'Mobile Top-up' || t === 'Bank Transfer';
      });

      // Priority 1: Mobile Top-up
      let target = allElements.find(el => el.textContent.trim() === 'Mobile Top-up');
      // Priority 2: Bank Transfer
      if (!target) {
        target = allElements.find(el => el.textContent.trim() === 'Bank Transfer');
      }

      if (target) {
        target.click();
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        return true;
      }
      return false;
    }

    // Schedule attempts after dropdown opens
    setTimeout(() => {
      if (!tryClickOption()) {
        setTimeout(() => {
          if (!tryClickOption()) {
            setTimeout(tryClickOption, 250);
          }
        }, 150);
      }
    }, 100);
  }

  function findPaymentMethodSelector(card) {
    const candidates = Array.from(card.querySelectorAll('div, button, input')).filter(el => {
      const text = (el.textContent || '').trim();
      return text.includes('Select A Payment Method') || 
             text.includes('Select a payment method') || 
             text.includes('Select Payment Method') ||
             text.includes('Выберите способ оплаты') ||
             text.includes('Выберите метод оплаты');
    });

    if (candidates.length === 0) return null;

    // Return the innermost matching container or clickable element
    const target = candidates[candidates.length - 1];
    return target.closest('div[tabindex], div[class*="select"], button') || target;
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

  // 5. Highlight Keywords in Text Nodes (Green background + White text)
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
          if (parent.closest('.bybit-p2p-match-container')) {
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

  // 6. DOM Discovery & Card Processing
  function findOrderContainers() {
    // Look for all order cards / containers on the page
    const buttons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const txt = (btn.textContent || '').trim().toLowerCase();
      return txt.startsWith('buy') || txt.startsWith('sell') || 
             txt.startsWith('купить') || txt.startsWith('продать') ||
             txt === 'hide' || txt === 'скрыть';
    });

    if (buttons.length > 0) {
      const rows = [];
      buttons.forEach(btn => {
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

    return [];
  }

  function findExpandedCard(row) {
    const candidates = Array.from(row.querySelectorAll('div')).filter(div => {
      const text = div.textContent || '';
      return (text.includes('Advertiser Terms') || text.includes('Условия рекламодателя')) && 
             (text.includes('I will pay') || text.includes('Price') || text.includes('Buy'));
    });
    if (candidates.length > 0) {
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

  // Find the "Price xx.xx RUB xxs" element inside the expanded card
  function findPriceHeaderElement(card) {
    const candidates = Array.from(card.querySelectorAll('div, span, p')).filter(el => {
      const text = (el.textContent || '').trim();
      return (text.startsWith('Price') || text.startsWith('Цена')) && 
             (text.includes('RUB') || text.includes('USDT')) &&
             (text.includes('s') || text.includes('сек') || /\d+\.\d+/.test(text));
    });

    if (candidates.length === 0) return null;

    // Pick the most specific flex container that holds the price text
    let target = candidates[0];
    for (const c of candidates) {
      if (c.children.length > 0 && (c.innerText || '').includes('Price')) {
        target = c;
      }
    }
    return target;
  }

  // 7. Core Highlight Execution
  function highlightOrders() {
    // Clean up any old floating widget if present
    const oldWidget = document.getElementById('bybit-p2p-floating-widget');
    if (oldWidget) oldWidget.remove();

    if (!state.settings.enabled) {
      removeAllHighlights();
      return;
    }

    const keywords = getActiveKeywords();
    if (keywords.length === 0) {
      removeAllHighlights();
      return;
    }

    const containers = findOrderContainers();

    containers.forEach(row => {
      const expandedCard = findExpandedCard(row);

      // 1. Auto-select payment method if card is expanded on USDT/RUB page
      if (expandedCard) {
        autoSelectPaymentMethod(expandedCard);
      }

      // 2. Check if terms contain keywords
      const text = row.textContent || '';
      const matched = findMatchesInText(text, keywords);
      const isMatch = matched.length > 0;

      if (isMatch) {
        // Apply solid green left stripe
        row.classList.add('bybit-p2p-highlighted-order');
        if (expandedCard) {
          expandedCard.classList.add('bybit-p2p-highlighted-card');
        }

        // Highlight matched keywords inside text (green background, white text)
        highlightKeywordsInTextNodes(row, keywords);

        // Position badge immediately to the right of "Price xx.xx RUB xxs"
        renderBadgeNextToPrice(expandedCard || row, matched);
      } else {
        row.classList.remove('bybit-p2p-highlighted-order');
        if (expandedCard) expandedCard.classList.remove('bybit-p2p-highlighted-card');
        removeBadges(row);
      }
    });
  }

  // Place the badge immediately to the right of Price xx.xx RUB xxs
  function renderBadgeNextToPrice(container, matchedKeywords) {
    const priceHeader = findPriceHeaderElement(container);
    if (!priceHeader) return;

    let badgeContainer = priceHeader.querySelector('.bybit-p2p-match-container');
    if (!badgeContainer) {
      badgeContainer = document.createElement('span');
      badgeContainer.className = 'bybit-p2p-match-container';
      priceHeader.appendChild(badgeContainer);
    }

    const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');
    badgeContainer.innerHTML = `
      <span class="bybit-p2p-match-tag" title="Найдено в условиях">
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

  function scheduleHighlight(delay = 50) {
    if (state.highlightTimeout) {
      clearTimeout(state.highlightTimeout);
    }
    state.highlightTimeout = setTimeout(() => {
      highlightOrders();
    }, delay);
  }

  // 8. Mutation Observer & History routing
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
          const target = m.target;
          if (target && target.closest && target.closest('.bybit-p2p-match-container')) {
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
      if (state.settings.enabled && window.location.href.includes('p2p')) {
        highlightOrders();
      }
    }, 1500);

    window.addEventListener('popstate', () => scheduleHighlight(200));
    window.addEventListener('hashchange', () => scheduleHighlight(200));
  }

  // Initialization
  function init() {
    loadSettings();

    // Clean up any lingering floating widget
    const oldWidget = document.getElementById('bybit-p2p-floating-widget');
    if (oldWidget) oldWidget.remove();

    if (document.body) {
      setupObserver();
      scheduleHighlight(200);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        setupObserver();
        scheduleHighlight(200);
      });
    }

    console.log('[Bybit Highlighter] Extension active (v1.0.2)');
  }

  init();
})();
