import { defineContentScript } from 'wxt/sandbox';

export default defineContentScript({
  matches: ['*://*.bybit.com/*', '*://bybit.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    if ((window as any).__BYBIT_P2P_INTERCEPTOR_ACTIVE__) return;
    (window as any).__BYBIT_P2P_INTERCEPTOR_ACTIVE__ = true;

    console.log('[Bybit P2P Highlighter] WXT Page context script active (world: MAIN)');

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

    function isTargetUrl(url: any): boolean {
      if (!url || typeof url !== 'string') return false;
      return TARGET_PATTERNS.some(pattern => url.includes(pattern));
    }

    function getCleanUrl(resource: any): string {
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

    function broadcastData(data: any, url: string) {
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

    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch;
      window.fetch = function (...args: any[]) {
        const promise = originalFetch.apply(this, args as any);
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

    if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
      const xhrProto = window.XMLHttpRequest.prototype;
      const originalOpen = xhrProto.open;
      const originalSend = xhrProto.send;

      xhrProto.open = function (method: any, url: any) {
        (this as any).__bybit_url = getCleanUrl(url);
        return originalOpen.apply(this, arguments as any);
      };

      xhrProto.send = function () {
        const xhr = this as any;
        xhr.addEventListener('load', function () {
          try {
            const url = xhr.__bybit_url || '';
            if (isTargetUrl(url)) {
              let data: any = null;
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
        return originalSend.apply(this, arguments as any);
      };
    }

    // ==========================================
    // Part 2: rc-select Payment Auto-Selection
    // ==========================================
    const attemptedTriggers = new WeakSet();

    function isUsdtRubBuyPage(): boolean {
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

    function triggerElementEvents(element: HTMLElement) {
      if (!element) return;

      // 1. Invoke React props and React Fiber memoizedProps
      let curr: HTMLElement | null = element;
      let depth = 0;
      while (curr && depth < 5) {
        const obj = curr as any;
        for (const k in obj) {
          if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')) {
            const props = obj[k];
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
            const fiber = obj[k];
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

      // 2. Full native mouse & pointer event sequence with exact coordinates
      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const x = rect.left + (rect.width > 0 ? rect.width / 2 : 10);
      const y = rect.top + (rect.height > 0 ? rect.height / 2 : 10);

      const eventInit: MouseEventInit = {
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

    function findTargetOptionInRcDropdown(): HTMLElement | null {
      const dropdown = document.querySelector<HTMLElement>('.fiat-p2p__payment-select-dropdown') ||
                       document.querySelector<HTMLElement>('.rc-select-dropdown');
      if (!dropdown) return null;

      const options = Array.from(dropdown.querySelectorAll<HTMLElement>('.fiat-p2p__payment-select-option, [role="option"], .rc-select-item-option'));
      if (options.length === 0) return null;

      // Priority 1: Mobile Top-up
      let match = options.find(el => {
        const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]')!.getAttribute('title')) || '';
        const text = el.innerText || el.textContent || '';
        return title.includes('Mobile Top-up') || text.includes('Mobile Top-up');
      });

      // Priority 2: Bank Transfer
      if (!match) {
        match = options.find(el => {
          const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]')!.getAttribute('title')) || '';
          const text = el.innerText || el.textContent || '';
          return title.includes('Bank Transfer') || text.includes('Bank Transfer');
        });
      }

      return match || null;
    }

    function selectRcOption(optionElement: HTMLElement) {
      if (!optionElement) return;

      triggerElementEvents(optionElement);

      const innerContent = optionElement.querySelector<HTMLElement>('.rc-select-item-option-content') ||
                           optionElement.querySelector<HTMLElement>('[title]');
      if (innerContent && innerContent !== optionElement) {
        triggerElementEvents(innerContent);
      }

      const textSpan = optionElement.querySelector<HTMLElement>('.moly-text');
      if (textSpan && textSpan !== optionElement && textSpan !== innerContent) {
        triggerElementEvents(textSpan);
      }
    }

    function handlePaymentAutoSelection() {
      if (!isUsdtRubBuyPage()) return;

      const trigger = document.querySelector<HTMLElement>('.fiat-p2p__payment-select-comp--unselected') ||
                      document.querySelector<HTMLElement>('[data-guide="payment-method"] .fiat-p2p__payment-select-comp');

      if (!trigger) return;

      const currentText = (trigger.innerText || trigger.textContent || '').trim();
      if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
        return;
      }
      if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
        return;
      }

      // Check if dropdown is already open
      const openOption = findTargetOptionInRcDropdown();
      if (openOption) {
        attemptedTriggers.add(trigger);
        trigger.dataset.bybitPaymentAttempted = 'true';
        selectRcOption(openOption);
        return;
      }

      if (attemptedTriggers.has(trigger) || trigger.dataset.bybitPaymentAttempted === 'true') {
        return;
      }

      attemptedTriggers.add(trigger);
      trigger.dataset.bybitPaymentAttempted = 'true';

      document.body.classList.add('bybit-suppress-dropdown');

      const cursorPointer = trigger.querySelector<HTMLElement>('.cursor-pointer') || trigger;
      triggerElementEvents(cursorPointer);
      if (cursorPointer !== trigger) {
        triggerElementEvents(trigger);
      }

      let attempts = 0;
      const maxAttempts = 30; // 450ms max

      const interval = setInterval(() => {
        attempts++;

        const cur = (trigger.innerText || trigger.textContent || '').trim();
        if (cur.includes('Mobile Top-up') || cur.includes('Bank Transfer')) {
          clearInterval(interval);
          document.body.classList.remove('bybit-suppress-dropdown');
          return;
        }

        const targetOption = findTargetOptionInRcDropdown();
        if (targetOption) {
          clearInterval(interval);
          selectRcOption(targetOption);

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

    window.addEventListener('__BYBIT_SELECT_PAYMENT__', () => {
      handlePaymentAutoSelection();
    });

    const observer = new MutationObserver(() => {
      handlePaymentAutoSelection();
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    setInterval(handlePaymentAutoSelection, 250);
  }
});
