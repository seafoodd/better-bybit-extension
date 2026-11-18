/**
 * Bybit P2P Highlighter - Page Context Network Interceptor
 * Runs in the webpage's main JavaScript context.
 * Intercepts Bybit P2P responses directly with zero cross-compartment wrappers.
 */
(() => {
  'use strict';

  if (window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__) return;
  window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__ = true;

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

  function broadcastData(text, url) {
    if (!text || typeof text !== 'string') return;
    try {
      // Must contain something that looks like OTC item list
      if (!text.includes('result') || !text.includes('items')) {
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

  // 1. Hook window.fetch synchronously (returns native Promise without alteration)
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      try {
        const resource = args[0];
        const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
        if (isTargetUrl(url)) {
          promise.then(response => {
            try {
              const clone = response.clone();
              clone.text().then(text => {
                broadcastData(text, url);
              }).catch(() => {});
            } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) {}
      return promise;
    };
  }

  // 2. Hook XMLHttpRequest
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const xhrProto = window.XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;

    xhrProto.open = function (method, url) {
      this.__bybit_url = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
      return originalOpen.apply(this, arguments);
    };

    xhrProto.send = function () {
      const xhr = this;
      xhr.addEventListener('load', function () {
        try {
          const url = xhr.__bybit_url || '';
          if (isTargetUrl(url)) {
            broadcastData(xhr.responseText, url);
          }
        } catch (e) {}
      });
      return originalSend.apply(this, arguments);
    };
  }

  console.log('[Bybit P2P Highlighter] Interceptor hooked in page context');
})();
