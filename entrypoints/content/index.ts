import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import './style.css';

export default defineContentScript({
  matches: ['*://*.bybit.com/*', '*://bybit.com/*'],
  runAt: 'document_start',
  main() {
    interface Settings {
      enabled: boolean;
      keywords: string[];
      highlightColor: string;
      [key: string]: any;
    }

    const state: {
      settings: Settings;
      highlightTimeout: any;
    } = {
      settings: {
        enabled: true,
        keywords: ['СБП', 'телефона'],
        highlightColor: 'emerald'
      },
      highlightTimeout: null
    };

    // 1. Settings & Themes
    async function loadSettings() {
      try {
        const items = await browser.storage.local.get(state.settings);
        if (items) {
          state.settings = { ...state.settings, ...(items as Partial<Settings>) };
          applyThemeColor(state.settings.highlightColor);
          scheduleHighlight(0);
        }
      } catch (e) {}
    }

    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          let changed = false;
          for (const [key, change] of Object.entries(changes)) {
            if ((state.settings as any)[key] !== change.newValue) {
              (state.settings as any)[key] = change.newValue;
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
      (browser.runtime.onMessage.addListener as any)((message: any, sender: any, sendResponse: any) => {
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

    function applyThemeColor(color: string) {
      document.documentElement.setAttribute('data-bybit-theme', color || 'emerald');
    }

    // ==========================================
    // Intercepted API Data Storage & Processing
    // ==========================================
    interface BybitOtcItem {
      id: string;
      nickName: string;
      price: string;
      minAmount: string;
      maxAmount: string;
      quantity: string;
      remark: string;
      payments: string[];
    }

    const interceptedItems = new Map<string, BybitOtcItem>();
    const interceptedItemsByNickPrice = new Map<string, BybitOtcItem>();

    function extractItems(jsonObj: any): any[] {
      if (!jsonObj) return [];
      if (Array.isArray(jsonObj)) return jsonObj;
      if (jsonObj.result) {
        if (Array.isArray(jsonObj.result)) return jsonObj.result;
        if (Array.isArray(jsonObj.result.items)) return jsonObj.result.items;
        if (Array.isArray(jsonObj.result.data)) return jsonObj.result.data;
      }
      if (jsonObj.data) {
        if (Array.isArray(jsonObj.data)) return jsonObj.data;
        if (Array.isArray(jsonObj.data.items)) return jsonObj.data.items;
      }
      if (Array.isArray(jsonObj.items)) return jsonObj.items;
      return [];
    }

    function processInterceptedData(rawText: string) {
      try {
        const data = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
        const items = extractItems(data);
        if (!items || items.length === 0) return;

        items.forEach((item: any) => {
          if (!item || !item.nickName) return;
          const nick = String(item.nickName).trim();
          const price = item.price ? String(item.price).trim() : '';
          const cleanNick = nick.toLowerCase();
          const numPrice = parseFloat(price);
          const priceKey = !isNaN(numPrice) ? numPrice.toFixed(2) : price;

          const otcItem: BybitOtcItem = {
            id: String(item.id || ''),
            nickName: nick,
            price: price,
            minAmount: String(item.minAmount || ''),
            maxAmount: String(item.maxAmount || ''),
            quantity: String(item.quantity || ''),
            remark: String(item.remark || ''),
            payments: Array.isArray(item.payments) ? item.payments : []
          };

          interceptedItems.set(cleanNick, otcItem);
          if (priceKey) {
            interceptedItemsByNickPrice.set(`${cleanNick}_${priceKey}`, otcItem);
          }
        });

        scheduleHighlight(20);
      } catch (e) {
        console.warn('[Bybit P2P] Failed to process intercepted data:', e);
      }
    }

    // 2. Strict USDT/RUB Buy Page Detection (Blocks sell page and non-USDT/RUB pairs)
    function isStrictUsdtRubBuyPage(card?: HTMLElement): boolean {
      const href = window.location.href.toLowerCase();

      // Strictly reject sell URLs and sell parameters
      if (href.includes('/sell') || href.includes('side=1') || href.includes('side=sell') || href.includes('actiontype=0')) {
        return false;
      }

      // Check card action button
      if (card) {
        const cardText = card.textContent || '';
        if (cardText.includes('Sell USDT') || cardText.includes('Продать USDT')) {
          return false;
        }
        const mainBtn = card.querySelector('button.moly-btn, button[class*="btn"]');
        const mainBtnText = (mainBtn?.textContent || '').trim().toLowerCase();
        if (mainBtnText === 'sell' || mainBtnText === 'продать') {
          return false;
        }
      }

      // Must be Buy
      const isBuy = href.includes('/buy') || href.includes('side=0') || href.includes('side=buy') || href.includes('actiontype=1');
      if (!isBuy) {
        return false;
      }

      // Must be USDT and RUB
      const isUsdt = href.includes('/usdt') || href.includes('token=usdt') || href.includes('coin=usdt');
      const isRub = href.includes('/rub') || href.includes('fiat=rub') || href.includes('currency=rub');

      return Boolean(isUsdt && isRub);
    }

    // Check if the seller offers Mobile Top-up or Bank Transfer
    function orderOffersTargetPaymentMethods(container: HTMLElement): boolean {
      // 1. If rc-select dropdown is already open in DOM, check its options
      const dropdown = document.querySelector<HTMLElement>('.fiat-p2p__payment-select-dropdown, .rc-select-dropdown');
      if (dropdown) {
        const ddText = dropdown.textContent || '';
        if (ddText.includes('Mobile Top-up') || ddText.includes('Bank Transfer')) {
          return true;
        }
      }

      // 2. Check the container and parent / sibling table rows
      let textToCheck = container.textContent || '';
      if (container.previousElementSibling) {
        textToCheck += ' ' + (container.previousElementSibling.textContent || '');
      }

      const cardTr = container.closest('tr');
      if (cardTr) {
        textToCheck += ' ' + (cardTr.textContent || '');
        if (cardTr.previousElementSibling) {
          textToCheck += ' ' + (cardTr.previousElementSibling.textContent || '');
        }
      }

      // 3. Check any visible payment tags in the DOM
      const tags = document.querySelectorAll('.payment-tags-container, [class*="payment-tag"], [class*="trade-list-tag"]');
      tags.forEach(tag => {
        textToCheck += ' ' + (tag.textContent || '');
      });

      return textToCheck.includes('Mobile Top-up') || textToCheck.includes('Bank Transfer');
    }

    // 3. User Simulation Click
    const processedContainers = new WeakSet();

    function simulateUserClick(target: HTMLElement) {
      if (!target) return;

      const rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const x = rect.left + (rect.width > 0 ? rect.width / 2 : 5);
      const y = rect.top + (rect.height > 0 ? rect.height / 2 : 5);

      const opts: MouseEventInit = {
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

    function clickTargetOption(targetOption: HTMLElement) {
      if (!targetOption) return;

      const itemContainer = targetOption.closest<HTMLElement>('li, div[role="option"], div[class*="item"], div[class*="option"]') || targetOption;
      simulateUserClick(itemContainer);
      if (targetOption !== itemContainer) {
        simulateUserClick(targetOption);
      }
      const inner = targetOption.querySelector<HTMLElement>('span, div, p');
      if (inner && inner !== targetOption) {
        simulateUserClick(inner);
      }

      try {
        window.dispatchEvent(new CustomEvent('__BYBIT_SELECT_PAYMENT__'));
      } catch (e) {}
    }

    // 4. Single-Shot Auto-Select Payment Method
    function autoSelectPaymentMethod(container: HTMLElement) {
      if (!isStrictUsdtRubBuyPage(container)) return;

      // CRITICAL: Only proceed if seller offers Mobile Top-up or Bank Transfer. If not, do NOT even try!
      if (!orderOffersTargetPaymentMethods(container)) {
        return;
      }

      try {
        window.dispatchEvent(new CustomEvent('__BYBIT_SELECT_PAYMENT__'));
      } catch (e) {}

      if (processedContainers.has(container) || container.dataset.bybitPaymentAttempted === 'true') {
        return;
      }

      const selectorEl = findPaymentMethodSelector(container);
      if (!selectorEl) return;

      const currentText = (selectorEl.innerText || selectorEl.textContent || '').trim();

      if (currentText.includes('Mobile Top-up') || currentText.includes('Bank Transfer')) {
        processedContainers.add(container);
        container.dataset.bybitPaymentAttempted = 'true';
        return;
      }

      if (!currentText.toLowerCase().includes('select') && !currentText.toLowerCase().includes('выберите')) {
        return;
      }

      const initialTarget = findTargetPaymentOption();
      if (initialTarget) {
        processedContainers.add(container);
        container.dataset.bybitPaymentAttempted = 'true';
        clickTargetOption(initialTarget);
        return;
      }

      processedContainers.add(container);
      container.dataset.bybitPaymentAttempted = 'true';

      document.body.classList.add('bybit-suppress-dropdown');

      const cursorPointer = selectorEl.querySelector<HTMLElement>('.cursor-pointer') || selectorEl;
      simulateUserClick(cursorPointer);
      if (cursorPointer !== selectorEl) {
        simulateUserClick(selectorEl);
      }

      let attempts = 0;
      const maxAttempts = 30;

      const pollInterval = setInterval(() => {
        attempts++;

        const curText = (selectorEl.innerText || selectorEl.textContent || '').trim();
        if (curText.includes('Mobile Top-up') || curText.includes('Bank Transfer')) {
          clearInterval(pollInterval);
          document.body.classList.remove('bybit-suppress-dropdown');
          return;
        }

        const targetOption = findTargetPaymentOption();
        if (targetOption) {
          clearInterval(pollInterval);
          clickTargetOption(targetOption);

          setTimeout(() => {
            document.body.classList.remove('bybit-suppress-dropdown');
          }, 60);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          document.body.classList.remove('bybit-suppress-dropdown');
        }
      }, 15);
    }

    function findTargetPaymentOption(): HTMLElement | null {
      const dropdown = document.querySelector<HTMLElement>('.fiat-p2p__payment-select-dropdown') ||
                       document.querySelector<HTMLElement>('.rc-select-dropdown');
      if (dropdown) {
        const options = Array.from(dropdown.querySelectorAll<HTMLElement>('.fiat-p2p__payment-select-option, [role="option"], .rc-select-item-option'));
        if (options.length > 0) {
          let match = options.find(el => {
            const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]')!.getAttribute('title')) || '';
            const text = el.innerText || el.textContent || '';
            return title.includes('Mobile Top-up') || text.includes('Mobile Top-up');
          });

          if (!match) {
            match = options.find(el => {
              const title = el.getAttribute('title') || (el.querySelector('[title]') && el.querySelector('[title]')!.getAttribute('title')) || '';
              const text = el.innerText || el.textContent || '';
              return title.includes('Bank Transfer') || text.includes('Bank Transfer');
            });
          }

          if (match) return match;
        }
      }

      return null;
    }

    function findPaymentMethodSelector(container: HTMLElement): HTMLElement | null {
      const directComp = container.querySelector<HTMLElement>('.fiat-p2p__payment-select-comp--unselected') ||
                         container.querySelector<HTMLElement>('[data-guide="payment-method"] .fiat-p2p__payment-select-comp');
      if (directComp) return directComp;

      const candidates = Array.from(container.querySelectorAll<HTMLElement>('*')).filter(el => {
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
      return target.closest<HTMLElement>('.fiat-p2p__payment-select-comp, div[tabindex], div[class*="select"], button') || target;
    }

    // 5. Price / Amount Input & "ALL" Button Handling
    function cleanNumberString(val: string): string {
      if (!val) return '';
      let s = val.trim();
      // Strip trailing .00 or ,00 (cents/kopecks) if present
      s = s.replace(/[.,]00(?!\d)/, '');
      // Strip all spaces, non-breaking spaces, dots, and commas
      s = s.replace(/[\s\u00a0\u202f\u2000-\u200b.,]/g, '');
      return s;
    }

    function unwrapOldWrappers(container: HTMLElement) {
      // Clean up any legacy dummy wrappers inserted by previous runs
      const wrappers = Array.from(container.querySelectorAll<HTMLElement>('div.bybit-all-input-row'));
      wrappers.forEach(w => {
        if (!w.classList.contains('moly-space-item') && !w.classList.contains('moly-space-item-last') && w.parentElement) {
          const p = w.parentElement;
          while (w.firstChild) {
            p.insertBefore(w.firstChild, w);
          }
          w.remove();
        }
      });
    }

    function findPayAmountInput(container: HTMLElement): HTMLInputElement | null {
      // 1. Direct Bybit amount-input selector
      const directInput = container.querySelector<HTMLInputElement>(
        '[data-guide="amount-input"] input, .fiat-p2p__amount-input-container input, .fiat-p2p__amount-input-field input'
      );
      if (directInput) return directInput;

      // 2. Search under "I will pay" / "Я заплачу" label
      const allLabels = Array.from(container.querySelectorAll<HTMLElement>('*'));
      for (const el of allLabels) {
        if (el.children.length > 2) continue;
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (t === 'i will pay' || t === 'я заплачу' || t.startsWith('i will pay') || t.startsWith('я заплачу')) {
          const row = el.closest('div[class*="item"], div[class*="field"], div[class*="row"], div[class*="wrapper"]') || el.parentElement;
          if (row) {
            const input = row.querySelector<HTMLInputElement>('input');
            if (input) return input;
            if (row.nextElementSibling) {
              const nextInput = row.nextElementSibling.querySelector<HTMLInputElement>('input');
              if (nextInput) return nextInput;
            }
          }
        }
      }

      // 3. Search for input with placeholder containing ~ (which is the amount limits)
      const inputsWithTilde = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(input => (input.placeholder || '').includes('~'));
      if (inputsWithTilde) return inputsWithTilde;

      // 4. First text/number input in the container
      const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"]):not([type="radio"])'));
      return inputs[0] || null;
    }

    function insertPriceValue(container: HTMLElement, value: string) {
      const payInput = findPayAmountInput(container);
      if (!payInput) return;

      const sanitizedValue = cleanNumberString(value);

      payInput.focus();

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(payInput, sanitizedValue);
      } else {
        payInput.value = sanitizedValue;
      }

      payInput.dispatchEvent(new Event('input', { bubbles: true }));
      payInput.dispatchEvent(new Event('change', { bubbles: true }));

      payInput.classList.add('bybit-input-flashed');
      setTimeout(() => {
        payInput.classList.remove('bybit-input-flashed');
      }, 350);
    }

    // Expose the "All" button prominently to the right of the price input (Strictly ONE button outside input)
    function exposeAllButton(container: HTMLElement) {
      unwrapOldWrappers(container);

      const payInput = findPayAmountInput(container);
      if (!payInput) return;

      // Find the outer input field container (.fiat-p2p__amount-input-field or .moly-input)
      const inputField = container.querySelector<HTMLElement>('.fiat-p2p__amount-input-field') ||
                         payInput.closest<HTMLElement>('.fiat-p2p__amount-input-field, .moly-input') ||
                         payInput.parentElement;
      if (!inputField || !inputField.parentElement) return;

      // The native parent container (.moly-space-item-last) gets flex row layout
      const parentRow = inputField.parentElement;
      parentRow.classList.add('bybit-all-input-row');

      // 1. Hide Bybit's native internal orange "All" text/button inside inputField so it never appears inside input
      const fieldLeaves = Array.from(inputField.querySelectorAll<HTMLElement>('*'));
      for (const el of fieldLeaves) {
        if (el.tagName === 'INPUT' || el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'PATH') continue;
        if (el.classList.contains('bybit-prominent-all-btn')) {
          el.remove();
          continue;
        }
        const t = (el.textContent || '').trim().toLowerCase();
        if ((t === 'all' || t === 'все' || t === 'max') && el.children.length === 0) {
          el.classList.add('bybit-native-all-hidden');
          el.style.setProperty('display', 'none', 'important');
        }
      }

      // 2. Remove ANY .bybit-prominent-all-btn inside inputField or elsewhere in container that is misplaced
      container.querySelectorAll('.bybit-prominent-all-btn').forEach(btn => {
        if (btn.parentElement !== parentRow) {
          btn.remove();
        }
      });

      // 3. Ensure EXACTLY ONE .bybit-prominent-all-btn exists as a direct child of parentRow
      const existingBtns = Array.from(parentRow.querySelectorAll<HTMLButtonElement>(':scope > .bybit-prominent-all-btn'));
      let externalAllBtn = existingBtns[0] || null;

      if (existingBtns.length > 1) {
        for (let i = 1; i < existingBtns.length; i++) {
          existingBtns[i].remove();
        }
      }

      if (!externalAllBtn) {
        externalAllBtn = document.createElement('button');
        externalAllBtn.type = 'button';
        externalAllBtn.className = 'bybit-prominent-all-btn';
        externalAllBtn.textContent = 'ALL';
        externalAllBtn.title = 'Ввести максимальную сумму (All)';

        externalAllBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Search live for native All button in suffix
          const suffix = inputField.querySelector<HTMLElement>('.fiat-p2p__amount-input-suffix') || inputField;
          let targetNativeAll: HTMLElement | null = null;
          const leaves = Array.from(suffix.querySelectorAll<HTMLElement>('*'));
          for (const el of leaves) {
            if (el.tagName === 'INPUT' || el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'PATH') continue;
            const t = (el.textContent || '').trim().toLowerCase();
            if ((t === 'all' || t === 'все' || t === 'max') && el.children.length === 0) {
              targetNativeAll = el;
              break;
            }
          }

          if (targetNativeAll) {
            simulateUserClick(targetNativeAll);
          } else {
            // Fallback: extract max value from placeholder
            const placeholder = payInput.placeholder || '';
            const maxMatch = placeholder.match(/~\s*([\d\s,.]+)/) || placeholder.match(/([\d\s,.]+)\s*$/);
            if (maxMatch && maxMatch[1]) {
              insertPriceValue(container, cleanNumberString(maxMatch[1]));
            }
          }
        });

        parentRow.appendChild(externalAllBtn);
      } else {
        // Ensure externalAllBtn is placed AFTER inputField
        if (externalAllBtn.previousElementSibling !== inputField) {
          parentRow.appendChild(externalAllBtn);
        }
      }
    }

    // 6. Keyword & 3+ Digit Number Highlighting
    function getActiveKeywords(): string[] {
      if (!state.settings.keywords || !Array.isArray(state.settings.keywords)) {
        return ['сбп', 'телефона'];
      }
      return state.settings.keywords
        .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
        .filter(k => k.length > 0);
    }

    function findMatchesInText(text: string, keywords: string[]): string[] {
      if (!text || typeof text !== 'string') return [];
      const lower = text.toLowerCase();
      const matched: string[] = [];
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matched.push(kw);
        }
      }
      return matched;
    }

    function findDescriptionContainer(card: HTMLElement): HTMLElement | null {
      const candidates = Array.from(card.querySelectorAll<HTMLElement>('*'));
      for (const el of candidates) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t === 'Advertiser Terms' || t === 'Условия рекламодателя') {
          return el.closest('div[class*="terms"], div[class*="left"], div[class*="content"]') || el.parentElement;
        }
      }
      return card.querySelector<HTMLElement>('.left-content, [class*="terms"], [class*="advertiser"]');
    }

    function highlightKeywordsAndNumbers(container: HTMLElement, keywords: string[]) {
      if (!container) return;

      const escapedKws = keywords.map(escapeRegExp).filter(Boolean);
      const kwPattern = escapedKws.length > 0 ? escapedKws.join('|') : null;
      // Match numbers with at least 3 digits (supports 19000, 19 000, 19.000, 19,000, 18 715, etc.)
      const sep = '(?:[\\s\\u00a0\\u202f\\u2000-\\u200b]+|[.,])';
      const numPattern = `(?<!\\d)(?:\\d{1,3}(?:${sep}\\d{3})+(?:[.,]00)?|\\d{3,}(?:[.,]00)?)(?!\\d)`;

      let fullRegex: RegExp;
      if (kwPattern) {
        fullRegex = new RegExp(`(${kwPattern})|(${numPattern})`, 'gi');
      } else {
        fullRegex = new RegExp(`()|(${numPattern})`, 'gi');
      }

      // Restrict text highlighting to the Advertiser Terms / Description
      const descContainer = findDescriptionContainer(container) || container;

      const walker = document.createTreeWalker(
        descContainer,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            fullRegex.lastIndex = 0;
            if (!fullRegex.test(node.nodeValue)) {
              return NodeFilter.FILTER_REJECT;
            }
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName.toLowerCase();
            if (['script', 'style', 'input', 'textarea', 'button', 'mark'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('.bybit-p2p-match-container') || parent.closest('.bybit-prominent-all-btn')) {
              return NodeFilter.FILTER_REJECT;
            }
            if (parent.closest('[data-guide="payment-method"]') || parent.closest('.right-action')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const textNodes: Node[] = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach(node => {
        const parent = node.parentElement;
        if (!parent) return;
        const text = node.nodeValue || '';
        fullRegex.lastIndex = 0;
        if (!fullRegex.test(text)) return;

        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        fullRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = fullRegex.exec(text)) !== null) {
          const matchStr = match[0];
          const offset = match.index;
          const isKw = Boolean(match[1]);
          const isNum = Boolean(match[2]);

          if (offset > lastIdx) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx, offset)));
          }

          if (isKw) {
            // Keyword: Green background, white text
            const mark = document.createElement('mark');
            mark.className = 'bybit-kw-highlight';
            mark.textContent = matchStr;
            frag.appendChild(mark);
          } else if (isNum) {
            // Number (3+ digits): Gray background, clickable to insert into price field
            const numMark = document.createElement('mark');
            numMark.className = 'bybit-number-highlight';
            numMark.textContent = matchStr;
            const cleanVal = cleanNumberString(matchStr);
            numMark.dataset.number = cleanVal;
            numMark.title = `Нажмите, чтобы ввести ${cleanVal} в поле цены`;

            numMark.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              insertPriceValue(container, cleanVal);
            });

            frag.appendChild(numMark);
          }

          lastIdx = offset + matchStr.length;
        }

        if (lastIdx < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        }

        parent.replaceChild(frag, node);
      });
    }

    // 7. Find Open Expanded Order Containers (Strictly isolated to order cards, never #root)
    function findOpenOrderContainers(): HTMLElement[] {
      // Find leaf headers containing "Advertiser Terms" or "Условия рекламодателя"
      const allHeaders = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el => {
        if (el.id === 'root' || el.tagName === 'BODY' || el.tagName === 'HTML' || el.classList.contains('otc__root')) {
          return false;
        }
        if (el.children.length > 2) return false;
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        return t === 'advertiser terms' || t === 'условия рекламодателя';
      });

      if (allHeaders.length === 0) return [];

      const result: HTMLElement[] = [];

      allHeaders.forEach(header => {
        // 1. If header is inside a table row (TR), use that TR
        const tr = header.closest('tr');
        if (tr && tr.id !== 'root' && !tr.classList.contains('otc__root') && tr !== document.body as any) {
          if (!result.includes(tr)) {
            result.push(tr);
          }
          return;
        }

        // 2. If inside a carousel card
        const card = header.closest<HTMLElement>('.new-user-ads-carousel-card');
        if (card && !result.includes(card)) {
          result.push(card);
          return;
        }

        // 3. Otherwise find the nearest local detail container (stop before table/tbody/main)
        const detail = header.closest<HTMLElement>('[class*="detail"], [class*="collapse"], [class*="terms"]');
        if (detail && !result.includes(detail)) {
          result.push(detail);
        }
      });

      return result;
    }

    function findPriceHeaderElement(container: HTMLElement): HTMLElement | null {
      const candidates = Array.from(container.querySelectorAll<HTMLElement>('*')).filter(el => {
        const t = (el.innerText || el.textContent || '').trim();
        return (t.startsWith('Price') || t.startsWith('Цена')) && 
               (t.includes('RUB') || t.includes('USDT')) &&
               !t.includes('I will pay') && 
               !t.includes('Advertiser Terms');
      });

      if (candidates.length === 0) return null;
      return candidates[0];
    }

    // 8. Table Row & Carousel Card Highlighting
    function renderTableRowBadge(element: HTMLElement, priceEl: HTMLElement, matchedKeywords: string[], remark: string) {
      const targetParent = priceEl.parentElement || priceEl;

      // Remove existing badges in other positions of this card
      element.querySelectorAll('.bybit-p2p-match-container').forEach(b => {
        if (b.parentElement !== targetParent) b.remove();
      });

      let badge = targetParent.querySelector<HTMLElement>('.bybit-p2p-match-container');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bybit-p2p-match-container';
        if (priceEl.nextSibling) {
          targetParent.insertBefore(badge, priceEl.nextSibling);
        } else {
          targetParent.appendChild(badge);
        }
      }

      const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');
      const tooltipText = remark ? `⚡ Найдено в условиях: ${labelText}\n\nУсловия мерчанта:\n${remark}` : `⚡ Найдено в условиях: ${labelText}`;

      badge.innerHTML = `
        <span class="bybit-p2p-match-tag" title="${escapeHtml(tooltipText)}">
          <span class="bybit-tag-icon">⚡</span>
          <span>${escapeHtml(labelText)}</span>
        </span>
      `;
    }

    function highlightTableOrders(keywords: string[]) {
      // 1. Regular order rows in table
      const rows = Array.from(document.querySelectorAll<HTMLElement>(
        '.trade-table__tbody > tr, tr[data-guide*="ad-listing"], tbody tr, .trade-list__row'
      ));

      const validRows = rows.filter(tr => {
        if (tr.classList.contains('new-user-ads-carousel-row')) return false;
        if (tr.textContent?.includes('Advertiser Terms') || tr.textContent?.includes('Условия рекламодателя')) return false;
        return tr.querySelector('.advertiser-name') && tr.querySelector('.price-amount');
      });

      // 2. Carousel cards
      const carouselCards = Array.from(document.querySelectorAll<HTMLElement>('.new-user-ads-carousel-card')).filter(card => {
        return card.querySelector('.advertiser-name') && card.querySelector('.price-amount');
      });

      const allOrderElements: HTMLElement[] = [...validRows, ...carouselCards];

      allOrderElements.forEach(element => {
        const nameEl = element.querySelector<HTMLElement>('.advertiser-name');
        const priceEl = element.querySelector<HTMLElement>('.price-amount');
        if (!nameEl || !priceEl) return;

        const rawName = (nameEl.innerText || nameEl.textContent || '').trim();
        const cleanName = rawName.toLowerCase();

        let priceKey = '';
        const pText = (priceEl.innerText || priceEl.textContent || '').replace(/[^\d.]/g, '');
        const pNum = parseFloat(pText);
        if (!isNaN(pNum)) {
          priceKey = pNum.toFixed(2);
        }

        // Match with intercepted API data
        let matchedItem = priceKey ? interceptedItemsByNickPrice.get(`${cleanName}_${priceKey}`) : undefined;
        if (!matchedItem) {
          matchedItem = interceptedItems.get(cleanName);
        }

        let matchedKeywords: string[] = [];
        let remark = '';

        if (matchedItem) {
          remark = matchedItem.remark || '';
          const textToSearch = `${remark} ${matchedItem.nickName || ''}`;
          matchedKeywords = findMatchesInText(textToSearch, keywords);
        }

        // Fallback: check DOM text
        if (matchedKeywords.length === 0) {
          const domText = element.textContent || '';
          matchedKeywords = findMatchesInText(domText, keywords);
        }

        if (matchedKeywords.length > 0) {
          element.classList.add('bybit-p2p-highlighted-order');
          renderTableRowBadge(element, priceEl, matchedKeywords, remark);
        } else {
          element.classList.remove('bybit-p2p-highlighted-order');
          element.querySelectorAll('.bybit-p2p-match-container').forEach(el => el.remove());
        }
      });
    }

    // 9. Core Highlight & Processing Loop
    function highlightOrders() {
      const oldWidget = document.getElementById('bybit-p2p-floating-widget');
      if (oldWidget) oldWidget.remove();

      if (!state.settings.enabled) {
        removeAllHighlights();
        return;
      }

      const keywords = getActiveKeywords();

      // Clean up any rogue classes from root and parent containers
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.classList.remove('bybit-p2p-highlighted-card', 'bybit-p2p-highlighted-order');
      }
      document.querySelectorAll('.otc__root, table, tbody, thead, .trade-table, [class*="table-wrapper"], [class*="dynamic"]').forEach(el => {
        el.classList.remove('bybit-p2p-highlighted-card', 'bybit-p2p-highlighted-order');
      });

      // 1. Highlight all table orders and carousel cards immediately from intercepted data
      highlightTableOrders(keywords);

      // 2. Process open/expanded order containers
      const openOrders = findOpenOrderContainers();
      openOrders.forEach(card => {
        if (card.id === 'root' || card.classList.contains('otc__root') || card === document.body as any) {
          return;
        }

        // Payment Auto-Selection (Strictly USDT/RUB Buy page, only if seller offers target methods)
        autoSelectPaymentMethod(card);

        // Expose the "ALL" button prominently
        exposeAllButton(card);

        // Highlight keywords and 3+ digit numbers in description
        highlightKeywordsAndNumbers(card, keywords);

        // Render badge next to Price in expanded card
        const text = card.textContent || '';
        const matched = findMatchesInText(text, keywords);
        const isMatch = matched.length > 0;

        if (isMatch) {
          card.classList.add('bybit-p2p-highlighted-card');
          renderBadgeNextToPrice(card, matched);
        } else {
          card.classList.remove('bybit-p2p-highlighted-card');
          card.classList.remove('bybit-p2p-highlighted-order');
          removeBadges(card);
        }
      });
    }

    function renderBadgeNextToPrice(card: HTMLElement, matchedKeywords: string[]) {
      const priceHeader = findPriceHeaderElement(card);
      if (!priceHeader) return;

      card.querySelectorAll('.bybit-p2p-match-container').forEach(b => {
        if (b.parentElement !== priceHeader) b.remove();
      });

      let badgeContainer = priceHeader.querySelector<HTMLElement>('.bybit-p2p-match-container');
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

    function removeBadges(card: HTMLElement) {
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
      document.querySelectorAll('.bybit-kw-highlight, .bybit-number-highlight').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent || ''), el);
          parent.normalize();
        }
      });
      document.querySelectorAll('.bybit-prominent-all-btn').forEach(el => el.remove());
      document.querySelectorAll('.bybit-all-input-row').forEach(el => el.classList.remove('bybit-all-input-row'));
      document.querySelectorAll('.bybit-native-all-hidden').forEach(el => {
        el.classList.remove('bybit-native-all-hidden');
        (el as HTMLElement).style.display = '';
      });
    }

    function escapeHtml(str: string): string {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeRegExp(string: string): string {
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

    function setupObserver() {
      const observer = new MutationObserver((mutations) => {
        let shouldUpdate = false;
        for (const m of mutations) {
          if (m.type === 'childList') {
            for (const node of Array.from(m.addedNodes)) {
              if (node.nodeType === 1) {
                const el = node as HTMLElement;
                if (el.classList && (
                  el.classList.contains('bybit-kw-highlight') ||
                  el.classList.contains('bybit-number-highlight') ||
                  el.classList.contains('bybit-p2p-match-container') ||
                  el.classList.contains('bybit-prominent-all-btn')
                )) continue;
                shouldUpdate = true;
                break;
              }
            }
          }
          if (shouldUpdate) break;
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
      }, 500);

      window.addEventListener('popstate', () => scheduleHighlight(100));
      window.addEventListener('hashchange', () => scheduleHighlight(100));
    }

    async function init() {
      await loadSettings();

      const oldWidget = document.getElementById('bybit-p2p-floating-widget');
      if (oldWidget) oldWidget.remove();

      // Listen for intercepted network data
      window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.type !== '__BYBIT_P2P_DATA__') {
          return;
        }
        processInterceptedData(event.data.text);
      });

      window.addEventListener('__BYBIT_P2P_DATA_EVENT__', (event: any) => {
        if (event.detail && event.detail.text) {
          processInterceptedData(event.detail.text);
        }
      });

      // Request cached network data from MAIN world script
      try {
        window.dispatchEvent(new CustomEvent('__BYBIT_REQUEST_LAST_DATA__'));
      } catch (e) {}

      if (document.body) {
        setupObserver();
        scheduleHighlight(100);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          setupObserver();
          scheduleHighlight(100);
        });
      }

      console.log('[Bybit Highlighter] WXT Extension active (v1.1.0)');
    }

    init();
  }
});
