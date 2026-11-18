/**
 * Bybit P2P Highlighter - Page Context Script (world: MAIN)
 * 1. Intercepts Bybit P2P network payloads directly in page context.
 * 2. Directly executes payment method auto-selection with full access to React props and Fiber.
 */
(() => {
  'use strict';

  if (window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__) return;
  window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__ = true;

  console.log('[Bybit P2P Highlighter] Page context script active');

  // ==========================================
  // Part 1: Network Interceptor
  // ==========================================
  const TARGET_PATTERNS = [
    '/fiat/otc/item/online',
    '/fiat/otc/item/',
    '/fiat/otc/',
    '/otc/item/',
    'online'
  ];

  function isTargetUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return TARGET_PATTERNS.some(pattern => url.includes(pattern));
  }

  function getCleanUrl(resource) {
    if (!resource) return '';
    if (typeof resource === 'string') return resource;
    if (typeof resource.url === 'string') return resource.url;
    if (typeof resource.href === 'string') return resource.href;
    try {
      return resource.toString();
    } catch (e) {
      return '';
    }
  }

  function broadcastData(data, url) {
    try {
      let text = '';
      if (typeof data === 'string') {
        text = data;
      } else if (typeof data === 'object' && data !== null) {
        text = JSON.stringify(data);
      }
      if (!text || text.length < 10) return;

      if (!text.includes('result') && !text.includes('items') && !text.includes('ret_code')) {
        return;
      }

      window.postMessage({
        type: '__BYBIT_P2P_DATA__',
        text: text,
        url: url
      }, '*');
    } catch (e) {
      console.warn('[Bybit P2P Highlighter] broadcast error:', e);
    }
  }

  // Hook window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      try {
        const url = getCleanUrl(args[0]);
        if (isTargetUrl(url)) {
          promise.then(response => {
            try {
              const clone = response.clone();
              clone.text().then(text => {
                broadcastData(text, url);
              }).catch(() => {
                clone.json().then(json => broadcastData(json, url)).catch(() => {});
              });
            } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}
      return promise;
    };
  }

  // Hook XMLHttpRequest
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const xhrProto = window.XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;

    xhrProto.open = function (method, url) {
      this.__bybit_url = getCleanUrl(url);
      return originalOpen.apply(this, arguments);
    };

    xhrProto.send = function () {
      const xhr = this;
      xhr.addEventListener('load', function () {
        try {
          const url = xhr.__bybit_url || '';
          if (isTargetUrl(url)) {
            let data = null;
            if (xhr.responseType === 'json' || (xhr.response && typeof xhr.response === 'object')) {
              data = xhr.response;
            } else {
              try {
                data = xhr.responseText;
              } catch (err) {
                data = xhr.response;
              }
            }
            broadcastData(data, url);
          }
        } catch (e) {
          console.warn('[Bybit P2P Highlighter] XHR handler error:', e);
        }
      });
      return originalSend.apply(this, arguments);
    };
  }

  // ==========================================
  // Part 2: React-Native Payment Auto-Selection
  // ==========================================
  const attemptedPaymentComponents = new WeakSet();

  function isUsdtRubBuyPage() {
    const href = window.location.href.toLowerCase();
    const isSell = href.includes('/sell') || href.includes('side=1');
    if (isSell) return false;

    if (href.includes('usdt') && href.includes('rub')) {
      return true;
    }

    if (href.includes('p2p') || href.includes('fiat/trade/otc')) {
      const text = document.body ? document.body.innerText : '';
      return (text.includes('RUB') || href.includes('rub')) && (text.includes('USDT') || href.includes('usdt'));
    }

    return false;
  }

  function triggerFullClickSequence(element) {
    if (!element) return;

    // A. Invoke React props and React Fiber memoizedProps
    let curr = element;
    let depth = 0;
    while (curr && depth < 6) {
      for (const k in curr) {
        if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')) {
          const props = curr[k];
          if (props) {
            const fakeEvent = {
              bubbles: true,
              cancelable: true,
              composed: true,
              target: element,
              currentTarget: curr,
              preventDefault() {},
              stopPropagation() {}
            };
            if (typeof props.onClick === 'function') {
              try { props.onClick(fakeEvent); } catch (e) {}
            }
            if (typeof props.onMouseDown === 'function') {
              try { props.onMouseDown(fakeEvent); } catch (e) {}
            }
            if (typeof props.onSelect === 'function') {
              try { props.onSelect(fakeEvent); } catch (e) {}
            }
          }
        }
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
          const fiber = curr[k];
          if (fiber && fiber.memoizedProps) {
            const mp = fiber.memoizedProps;
            const fakeEvent = {
              bubbles: true,
              cancelable: true,
              composed: true,
              target: element,
              currentTarget: curr,
              preventDefault() {},
              stopPropagation() {}
            };
            if (typeof mp.onClick === 'function') {
              try { mp.onClick(fakeEvent); } catch (e) {}
            }
            if (typeof mp.onMouseDown === 'function') {
              try { mp.onMouseDown(fakeEvent); } catch (e) {}
            }
            if (typeof mp.onSelect === 'function') {
              try { mp.onSelect(fakeEvent); } catch (e) {}
            }
          }
        }
      }
      curr = curr.parentElement;
      depth++;
    }

    // B. Native pointer and mouse sequence with coordinates
    const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const x = rect.left + (rect.width > 0 ? rect.width / 2 : 10);
    const y = rect.top + (rect.height > 0 ? rect.height / 2 : 10);

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1
    };

    element.dispatchEvent(new MouseEvent('mouseenter', eventInit));
    element.dispatchEvent(new MouseEvent('mouseover', eventInit));
    element.dispatchEvent(new PointerEvent('pointerover', eventInit));
    element.dispatchEvent(new PointerEvent('pointerenter', eventInit));
    element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));

    try { element.focus(); } catch (e) {}

    const upInit = Object.assign({}, eventInit, { buttons: 0 });
    element.dispatchEvent(new PointerEvent('pointerup', upInit));
    element.dispatchEvent(new MouseEvent('mouseup', upInit));
    element.dispatchEvent(new MouseEvent('click', upInit));

    try { element.click(); } catch (e) {}
  }

  function findDropdownOptionElements(scopeRoot) {
    const root = scopeRoot || document;
    const all = Array.from(root.querySelectorAll('*'));
    let mobileEl = null;
    let bankEl = null;

    for (let i = 0; i < all.length; i++) {
      const el = all[i];

      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) continue;
      if (el.closest('.fiat-p2p__payment-select-comp')) continue;
      if (el.closest('.payment-tags-container') || el.classList.contains('trade-list-tag')) continue;
      if (el.closest('[class*="terms"], [class*="advertiser"]')) continue;

      const text = (el.innerText || el.textContent || '').trim();
      if (!text) continue;

      if (text.includes('Select A Payment Method') || text.includes('Select a payment method')) continue;
      if (text.includes('Cash Deposit') && text.includes('Mobile Top-up')) continue;
      if (text.includes('Cash Deposit') && text.includes('Bank Transfer')) continue;
      if (text.includes('Bank Transfer') && text.includes('Mobile Top-up')) continue;

      if (text.length > 40) continue;

      if (!mobileEl && text.includes('Mobile Top-up')) {
        mobileEl = el;
      }
      if (!bankEl && text.includes('Bank Transfer')) {
        bankEl = el;
      }
    }

    return { mobileEl, bankEl };
  }

  function clickTargetOptionAndParents(target) {
    if (!target) return;

    triggerFullClickSequence(target);

    if (target.parentElement && !target.parentElement.classList.contains('fiat-p2p__payment-select-comp')) {
      triggerFullClickSequence(target.parentElement);
    }

    const itemContainer = target.closest('li, div[role="option"], div[class*="item"], div[class*="option"]');
    if (itemContainer && itemContainer !== target && itemContainer !== target.parentElement) {
      triggerFullClickSequence(itemContainer);
    }
  }

  function handleAutoSelectPayment() {
    if (!isUsdtRubBuyPage()) return;

    // Identify unselected payment method box
    const unselectedComp = document.querySelector('.fiat-p2p__payment-select-comp--unselected') ||
                           document.querySelector('[data-guide="payment-method"] .fiat-p2p__payment-select-comp');

    if (!unselectedComp) return;

    const currentText = (unselectedComp.innerText || unselectedComp.textContent || '').trim();
    if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
      return;
    }
    if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
      return;
    }

    if (attemptedPaymentComponents.has(unselectedComp) || unselectedComp.dataset.bybitPaymentAttempted === 'true') {
      return;
    }

    const guideRoot = unselectedComp.closest('[data-guide="payment-method"]') || document;

    // 1. Check if dropdown option is ALREADY open / visible
    let options = findDropdownOptionElements(guideRoot);
    if (!options.mobileEl && !options.bankEl) {
      options = findDropdownOptionElements(document);
    }

    const immediateTarget = options.mobileEl || options.bankEl;
    if (immediateTarget) {
      attemptedPaymentComponents.add(unselectedComp);
      unselectedComp.dataset.bybitPaymentAttempted = 'true';

      clickTargetOptionAndParents(immediateTarget);
      return;
    }

    // 2. Dropdown not open yet. Latch attempted flag so it NEVER runs in an open/close loop
    attemptedPaymentComponents.add(unselectedComp);
    unselectedComp.dataset.bybitPaymentAttempted = 'true';

    // Suppress visual flicker
    document.body.classList.add('bybit-suppress-dropdown');

    // Click trigger elements
    const cursorPointer = unselectedComp.querySelector('.cursor-pointer') || unselectedComp;
    triggerFullClickSequence(cursorPointer);
    if (cursorPointer !== unselectedComp) {
      triggerFullClickSequence(unselectedComp);
    }

    // 3. Fast poll (every 15ms) for the option to mount
    let attempts = 0;
    const maxAttempts = 30; // 450ms max

    const interval = setInterval(() => {
      attempts++;

      const cur = (unselectedComp.innerText || unselectedComp.textContent || '').trim();
      if (cur.includes('Mobile Top-up') || cur.includes('Bank Transfer')) {
        clearInterval(interval);
        document.body.classList.remove('bybit-suppress-dropdown');
        return;
      }

      let currentOptions = findDropdownOptionElements(guideRoot);
      if (!currentOptions.mobileEl && !currentOptions.bankEl) {
        currentOptions = findDropdownOptionElements(document);
      }

      const target = currentOptions.mobileEl || currentOptions.bankEl;
      if (target) {
        clearInterval(interval);

        clickTargetOptionAndParents(target);

        setTimeout(() => {
          document.body.classList.remove('bybit-suppress-dropdown');
        }, 60);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        document.body.classList.remove('bybit-suppress-dropdown');
      }
    }, 15);
  }

  // Event listener from content script
  window.addEventListener('__BYBIT_SELECT_PAYMENT__', () => {
    handleAutoSelectPayment();
  });

  // Observe DOM for newly opened order forms
  const observer = new MutationObserver(() => {
    handleAutoSelectPayment();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  setInterval(handleAutoSelectPayment, 300);
})();
