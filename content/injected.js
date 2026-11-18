/**
 * Bybit P2P Highlighter - Page Context Network Interceptor
 * Runs in the webpage's main JavaScript context.
 * Intercepts Bybit P2P responses directly with zero cross-compartment wrappers.
 */
(() => {
  'use strict';

  if (window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__) return;
  window.__BYBIT_P2P_INTERCEPTOR_ACTIVE__ = true;

  console.log('[Bybit P2P Highlighter] Interceptor active in page context');

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

      // Ensure it contains items or result
      if (!text.includes('result') && !text.includes('items') && !text.includes('ret_code')) {
        return;
      }

      console.log('[Bybit P2P Highlighter] Intercepted P2P items payload, length:', text.length);

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

  // 2. Hook XMLHttpRequest
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
            // CRITICAL FIX: If responseType is 'json', accessing xhr.responseText
            // throws InvalidStateError! We must check responseType and xhr.response!
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
})();
