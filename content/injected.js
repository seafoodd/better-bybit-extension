/**
 * Bybit P2P Highlighter - Page Context Interceptor
 * Runs in the main page world to intercept XHR and Fetch responses
 * without interfering with Bybit's internal state.
 */
(() => {
  'use strict';

  if (window.__BYBIT_P2P_INTERCEPTOR_LOADED__) return;
  window.__BYBIT_P2P_INTERCEPTOR_LOADED__ = true;

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
      // Fast check if it looks like Bybit OTC item response JSON
      if (!text.includes('"result"') && !text.includes('"items"') && !text.includes('ret_code')) {
        return;
      }
      window.__BYBIT_P2P_LATEST__ = text;
      window.dispatchEvent(new CustomEvent('__BYBIT_P2P_DATA__', {
        detail: { text, url, timestamp: Date.now() }
      }));
    } catch (e) {
      console.warn('[Bybit P2P Highlighter Injected] broadcast error:', e);
    }
  }

  // 1. Hook window.fetch
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const resource = args[0];
        const url = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');
        if (isTargetUrl(url)) {
          const clone = response.clone();
          clone.text().then(text => {
            broadcastData(text, url);
          }).catch(() => {});
        }
      } catch (e) {}
      return response;
    };
  }

  // 2. Hook XMLHttpRequest
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const xhrProto = window.XMLHttpRequest.prototype;
    const originalOpen = xhrProto.open;
    const originalSend = xhrProto.send;

    xhrProto.open = function (method, url) {
      this.__bybit_url = url;
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

  console.log('[Bybit P2P Highlighter] Page network interceptor active');
})();
