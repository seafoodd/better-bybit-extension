/**
 * Bybit P2P Order Highlighter - Content Script
 * 1. Highlights keywords in terms text (green background, white text).
 * 2. Positions the badge right next to "Price xx.xx RUB xxs".
 * 3. Single-shot instant auto-selection of "Mobile Top-up" (or "Bank Transfer") strictly on USDT/RUB buy page.
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

  // 2. Strict USDT/RUB Page Detection
  function isUsdtRubBuyPage() {
    const href = window.location.href.toLowerCase();
    if (href.includes('usdt') && href.includes('rub')) {
      return true;
    }
    const body = document.body ? document.body.innerText : '';
    if (body.includes('RUB') && body.includes('USDT')) {
      return true;
    }
    return false;
  }

  // 3. User Simulation Click (React 18 & Moly/BDS compatible)
  const processedContainers = new WeakSet();

  function simulateUserClick(target) {
    if (!target) return;

    const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const x = rect.left + (rect.width > 0 ? rect.width / 2 : 5);
    const y = rect.top + (rect.height > 0 ? rect.height / 2 : 5);

    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1
    };

    target.dispatchEvent(new MouseEvent('mouseenter', opts));
    target.dispatchEvent(new MouseEvent('mouseover', opts));
    target.dispatchEvent(new PointerEvent('pointerover', opts));
    target.dispatchEvent(new PointerEvent('pointerenter', opts));
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));

    try { target.focus(); } catch (e) {}

    const upOpts = Object.assign({}, opts, { buttons: 0 });
    target.dispatchEvent(new PointerEvent('pointerup', upOpts));
    target.dispatchEvent(new MouseEvent('mouseup', upOpts));
    target.dispatchEvent(new MouseEvent('click', upOpts));
    try { target.click(); } catch (e) {}
  }

  function clickTargetOption(targetOption) {
    if (!targetOption) return;

    // 1. Click target and its option row container
    const itemContainer = targetOption.closest('li, div[role="option"], div[class*="item"], div[class*="option"]') || targetOption;
    simulateUserClick(itemContainer);
    if (targetOption !== itemContainer) {
      simulateUserClick(targetOption);
    }
    const inner = targetOption.querySelector('span, div, p');
    if (inner && inner !== targetOption) {
      simulateUserClick(inner);
    }

    // 2. Dispatch to page-context script (MAIN world)
    try {
      window.dispatchEvent(new CustomEvent('__BYBIT_SELECT_PAYMENT__'));
    } catch (e) {}
  }

  // 4. Single-Shot Auto-Select Payment Method ("Mobile Top-up" -> "Bank Transfer")
  function autoSelectPaymentMethod(container) {
    if (!isUsdtRubBuyPage()) return;

    // Notify page-context script (MAIN world) to attempt React-level selection
    try {
      window.dispatchEvent(new CustomEvent('__BYBIT_SELECT_PAYMENT__'));
    } catch (e) {}

    // Strict latch - NEVER process the same container twice to prevent infinite loops
    if (processedContainers.has(container) || container.dataset.bybitPaymentAttempted === 'true') {
      return;
    }

    const selectorEl = findPaymentMethodSelector(container);
    if (!selectorEl) return;

    const currentText = (selectorEl.innerText || selectorEl.textContent || '').trim();

    // If a payment method is already selected, mark done and stop
    if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
      processedContainers.add(container);
      container.dataset.bybitPaymentAttempted = 'true';
      return;
    }

    // Only proceed if it is in the unselected placeholder state ("Select A Payment Method")
    if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
      return;
    }

    // Check if dropdown option is ALREADY open / visible
    const initialTarget = findTargetPaymentOption(container);
    if (initialTarget) {
      processedContainers.add(container);
      container.dataset.bybitPaymentAttempted = 'true';
      clickTargetOption(initialTarget);
      return;
    }

    // Lock immediately: selectorEl will NEVER be clicked again
    processedContainers.add(container);
    container.dataset.bybitPaymentAttempted = 'true';

    // Hide visual popup flicker
    document.body.classList.add('bybit-suppress-dropdown');

    // Click the selector trigger once
    const cursorPointer = selectorEl.querySelector('.cursor-pointer') || selectorEl;
    simulateUserClick(cursorPointer);
    if (cursorPointer !== selectorEl) {
      simulateUserClick(selectorEl);
    }

    // Poll rapidly (every 15ms) for the dropdown items to appear
    let attempts = 0;
    const maxAttempts = 30; // 450ms max

    const pollInterval = setInterval(() => {
      attempts++;

      // Check if already selected
      const curText = (selectorEl.innerText || selectorEl.textContent || '').trim();
      if (curText.includes('Mobile Top-up') || curText.includes('Bank Transfer')) {
        clearInterval(pollInterval);
        document.body.classList.remove('bybit-suppress-dropdown');
        return;
      }

      // Find the dropdown option
      const targetOption = findTargetPaymentOption(container);

      if (targetOption) {
        clearInterval(pollInterval);
        clickTargetOption(targetOption);

        setTimeout(() => {
          document.body.classList.remove('bybit-suppress-dropdown');
        }, 60);
        return;
      }

      // Stop after max attempts
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        document.body.classList.remove('bybit-suppress-dropdown');
      }
    }, 15);
  }

  function findTargetPaymentOption() {
    // 1. Directly check Bybit's portalled rc-select dropdown on document.body
    const dropdown = document.querySelector('.fiat-p2p__payment-select-dropdown') ||
                     document.querySelector('.rc-select-dropdown');
    if (dropdown) {
      const options = Array.from(dropdown.querySelectorAll('.fiat-p2p__payment-select-option, [role="option"], .rc-select-item-option'));
      if (options.length > 0) {
        // Priority 1: Mobile Top-up
        let match = options.find(el => {
          const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]').getAttribute('title')) || '';
          const text = el.innerText || el.textContent || '';
          return title.includes('Mobile Top-up') || text.includes('Mobile Top-up');
        });

        // Priority 2: Bank Transfer
        if (!match) {
          match = options.find(el => {
            const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]').getAttribute('title')) || '';
            const text = el.innerText || el.textContent || '';
            return title.includes('Bank Transfer') || text.includes('Bank Transfer');
          });
        }

        if (match) return match;
      }
    }

    return null;
  }

  function findPaymentMethodSelector(container) {
    // 1. Direct class match for Bybit's unselected payment component
    const directComp = container.querySelector('.fiat-p2p__payment-select-comp--unselected') ||
                       container.querySelector('[data-guide="payment-method"] .fiat-p2p__payment-select-comp');
    if (directComp) return directComp;

    // 2. Candidate text search
    const candidates = Array.from(container.querySelectorAll('*')).filter(el => {
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

    const target = candidates[candidates.length - 1];
    return target.closest('.fiat-p2p__payment-select-comp, div[tabindex], div[class*="select"], button') || target;
  }

  // 5. Keyword Matching
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

  // 7. Find Open Expanded Order Container (Across the whole document)
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

    return candidates[0];
  }

  // 8. Core Highlight & Auto-Select Execution
  function highlightOrders() {
    const oldWidget = document.getElementById('bybit-p2p-floating-widget');
    if (oldWidget) oldWidget.remove();

    if (!state.settings.enabled) {
      removeAllHighlights();
      return;
    }

    const keywords = getActiveKeywords();
    const openOrders = findOpenOrderContainers();

    openOrders.forEach(card => {
      // 1. Single-Shot Auto-Select Payment Method (USDT / RUB only)
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

  // 9. Mutation Observer & Routing
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
    }, 600);

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

    console.log('[Bybit Highlighter] Extension active (v1.0.9)');
  }

  init();
})();
