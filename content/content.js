/**
 * Bybit P2P Order Highlighter - Content Script
 * 1. Highlights keywords in terms text (green background, white text).
 * 2. Positions the badge right next to "Price xx.xx RUB xxs".
 * 3. Instant auto-selection of "Mobile Top-up" (or "Bank Transfer") strictly on USDT/RUB buy page.
 * 4. Solid continuous green left stripe.
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

  // 2. Strict USDT/RUB Buy Page Detection
  function isUsdtRubBuyPage() {
    const href = window.location.href.toLowerCase();
    const isP2p = href.includes('p2p') || href.includes('fiat/trade/otc') || href.includes('otc');
    const isBuy = href.includes('/buy') || href.includes('side=1') || href.includes('side=buy');
    const isUsdtRub = href.includes('usdt/rub') || (href.includes('usdt') && href.includes('rub'));
    return isP2p && isBuy && isUsdtRub;
  }

  // 3. Instant Auto-Select Payment Method ("Mobile Top-up" -> "Bank Transfer")
  function autoSelectPaymentMethod(container) {
    if (!isUsdtRubBuyPage()) return;
    if (container.__paymentAutoSelected) return;

    // Find the payment method selector trigger inside this open card
    const selectorEl = findPaymentMethodSelector(container);
    if (!selectorEl) return;

    const currentText = (selectorEl.textContent || '').trim();
    // If a payment method is already selected, mark as done
    if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
      container.__paymentAutoSelected = true;
      return;
    }

    // Only proceed if it is in the unselected placeholder state
    if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
      return;
    }

    container.__paymentAutoSelected = true;

    // Open dropdown trigger with full mouse/pointer events
    const triggerEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    triggerEvents.forEach(type => {
      selectorEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });

    // Helper to find and click the dropdown option (ignoring table row tags!)
    function findAndClickOption() {
      // Find all elements in document that contain "Mobile Top-up" or "Bank Transfer",
      // strictly ignoring the table row tags (.payment-tags-container and .trade-list-tag)
      const allCandidates = Array.from(document.querySelectorAll('*')).filter(el => {
        if (el.closest('.payment-tags-container') || el.classList.contains('trade-list-tag')) {
          return false;
        }
        if (el.closest('td[style*="width: 196px"]')) {
          return false;
        }
        const t = (el.innerText || el.textContent || '').trim();
        return t.includes('Mobile Top-up') || t.includes('Bank Transfer');
      });

      if (allCandidates.length === 0) return false;

      // Filter to leaf/row nodes (exclude parent wrapper holding all options)
      const optionRows = allCandidates.filter(el => {
        const t = (el.innerText || el.textContent || '').trim();
        if (t.includes('Cash Deposit to Bank') && t.includes('Mobile Top-up')) {
          return false;
        }
        return (t.includes('Mobile Top-up') || t.includes('Bank Transfer')) && el.children.length <= 3;
      });

      if (optionRows.length === 0) return false;

      // Priority 1: Mobile Top-up
      let target = optionRows.find(el => (el.innerText || el.textContent || '').includes('Mobile Top-up'));
      // Priority 2: Bank Transfer
      if (!target) {
        target = optionRows.find(el => (el.innerText || el.textContent || '').includes('Bank Transfer'));
      }

      if (target) {
        // Dispatch full sequence of click events on target
        triggerEvents.forEach(type => {
          target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
        // Also dispatch on parent if target is a span/text node
        if (target.parentElement && target.parentElement !== container) {
          triggerEvents.forEach(type => {
            target.parentElement.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
        }
        return true;
      }

      return false;
    }

    // Fast polling: check every 20ms for up to 350ms so it clicks instantly upon mount
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (findAndClickOption() || attempts >= 18) {
        clearInterval(interval);
      }
    }, 20);
  }

  function findPaymentMethodSelector(container) {
    const candidates = Array.from(container.querySelectorAll('*')).filter(el => {
      // Must not be a table tag
      if (el.closest('.payment-tags-container') || el.classList.contains('trade-list-tag')) {
        return false;
      }
      const text = (el.innerText || el.textContent || '').trim();
      return text.includes('Select A Payment Method') || 
             text.includes('Select a payment method') || 
             text.includes('Select Payment Method') ||
             text.includes('Выберите способ оплаты') ||
             text.includes('Выберите метод оплаты');
    });

    if (candidates.length === 0) return null;

    // Return innermost element or its clickable wrapper
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

  // 6. Find Open Expanded Order Container (Across the whole document)
  function findOpenOrderContainers() {
    const candidates = Array.from(document.querySelectorAll('tr, div')).filter(el => {
      const text = el.textContent || '';
      return (text.includes('Advertiser Terms') || text.includes('Условия рекламодателя')) && 
             (text.includes('I will pay') || text.includes('Price') || text.includes('Buy'));
    });

    if (candidates.length === 0) return [];

    const result = [];
    candidates.forEach(c => {
      let outer = c;
      while (outer && outer.parentElement && outer.tagName !== 'TR' && outer.parentElement !== document.body) {
        if (outer.parentElement.tagName === 'TR') {
          outer = outer.parentElement;
          break;
        }
        outer = outer.parentElement;
      }
      if (outer && !result.includes(outer)) {
        result.push(outer);
      }
    });

    return result.length > 0 ? result : [candidates[0]];
  }

  // Find the exact element containing "Price xx.xx RUB xxs"
  function findPriceHeaderElement(container) {
    const candidates = Array.from(container.querySelectorAll('*')).filter(el => {
      const t = (el.innerText || el.textContent || '').trim();
      return (t.startsWith('Price') || t.startsWith('Цена')) && 
             (t.includes('RUB') || t.includes('USDT')) &&
             !t.includes('I will pay') && 
             !t.includes('Advertiser Terms');
    });

    if (candidates.length === 0) return null;

    // Pick the most specific container that has the Price text
    return candidates[0];
  }

  // 7. Core Highlight & Auto-Select Execution
  function highlightOrders() {
    // Ensure any old widget is removed
    const oldWidget = document.getElementById('bybit-p2p-floating-widget');
    if (oldWidget) oldWidget.remove();

    if (!state.settings.enabled) {
      removeAllHighlights();
      return;
    }

    const keywords = getActiveKeywords();
    const openOrders = findOpenOrderContainers();

    openOrders.forEach(card => {
      // 1. Instant Auto-Select Payment Method (USDT / RUB buy page only)
      autoSelectPaymentMethod(card);

      // 2. Check if terms contain keywords
      const text = card.textContent || '';
      const matched = findMatchesInText(text, keywords);
      const isMatch = matched.length > 0;

      if (isMatch) {
        // Apply solid green left stripe
        card.classList.add('bybit-p2p-highlighted-card');
        card.classList.add('bybit-p2p-highlighted-order');

        // Highlight matched keywords inside text (green background, white text)
        highlightKeywordsInTextNodes(card, keywords);

        // Position badge immediately to the right of "Price xx.xx RUB xxs"
        renderBadgeNextToPrice(card, matched);
      } else {
        card.classList.remove('bybit-p2p-highlighted-card');
        card.classList.remove('bybit-p2p-highlighted-order');
        removeBadges(card);
      }
    });
  }

  // Place badge immediately to the right of "Price xx.xx RUB xxs"
  function renderBadgeNextToPrice(card, matchedKeywords) {
    const priceHeader = findPriceHeaderElement(card);
    if (!priceHeader) return;

    // Remove any badges placed in wrong locations
    card.querySelectorAll('.bybit-p2p-match-container').forEach(b => {
      if (b.parentElement !== priceHeader) b.remove();
    });

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

  function removeBadges(card) {
    card.querySelectorAll('.bybit-p2p-match-container').forEach(el => el.remove());
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

  // 8. Mutation Observer & Routing
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
        scheduleHighlight(50);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (state.settings.enabled) {
        highlightOrders();
      }
    }, 800);

    window.addEventListener('popstate', () => scheduleHighlight(100));
    window.addEventListener('hashchange', () => scheduleHighlight(100));
  }

  // Initialization
  function init() {
    loadSettings();

    const oldWidget = document.getElementById('bybit-p2p-floating-widget');
    if (oldWidget) oldWidget.remove();

    if (document.body) {
      setupObserver();
      scheduleHighlight(100);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        setupObserver();
        scheduleHighlight(100);
      });
    }

    console.log('[Bybit Highlighter] Extension active (v1.0.4)');
  }

  init();
})();
