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
      let clean = val.replace(/[\s\u00a0]/g, '');
      if (clean.includes(',') && clean.includes('.')) {
        clean = clean.replace(/,/g, '');
      } else if (clean.includes(',')) {
        if (/,\d{2}$/.test(clean)) {
          clean = clean.replace(',', '.');
        } else {
          clean = clean.replace(/,/g, '');
        }
      }
      return clean;
    }

    function findPayAmountInput(container: HTMLElement): HTMLInputElement | null {
      // 1. Search under "I will pay" / "Я заплачу" label
      const allLabels = Array.from(container.querySelectorAll<HTMLElement>('*'));
      for (const el of allLabels) {
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (t === 'i will pay' || t === 'я заплачу' || t.startsWith('i will pay')) {
          const fieldWrapper = el.closest('div[class*="item"], div[class*="field"], div[class*="row"]') || el.parentElement;
          if (fieldWrapper) {
            const input = fieldWrapper.querySelector<HTMLInputElement>('input');
            if (input) return input;
          }
          if (el.nextElementSibling) {
            const input = el.nextElementSibling.querySelector<HTMLInputElement>('input');
            if (input) return input;
          }
        }
      }

      // 2. Search for input with placeholder containing ~ (which is the amount limits)
      const inputsWithTilde = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find(input => (input.placeholder || '').includes('~'));
      if (inputsWithTilde) return inputsWithTilde;

      // 3. First text/number input in the container
      const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"]):not([type="radio"])'));
      return inputs[0] || null;
    }

    function insertPriceValue(container: HTMLElement, value: string) {
      const payInput = findPayAmountInput(container);
      if (!payInput) return;

      payInput.focus();

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(payInput, value);
      } else {
        payInput.value = value;
      }

      payInput.dispatchEvent(new Event('input', { bubbles: true }));
      payInput.dispatchEvent(new Event('change', { bubbles: true }));

      payInput.classList.add('bybit-input-flashed');
      setTimeout(() => {
        payInput.classList.remove('bybit-input-flashed');
      }, 350);
    }

    // Expose the "All" button prominently to the right of the price input
    function exposeAllButton(container: HTMLElement) {
      const payInput = findPayAmountInput(container);
      if (!payInput) return;

      // Find the input container (moly-input or input wrapper)
      const inputWrapper = payInput.closest<HTMLElement>('.moly-input, [class*="input"], div.relative') || payInput.parentElement;
      if (!inputWrapper || !inputWrapper.parentElement) return;

      // Check if already has externalAllBtn
      let rowWrapper = inputWrapper.parentElement;
      let externalAllBtn = rowWrapper.querySelector<HTMLButtonElement>('.bybit-prominent-all-btn');

      if (!externalAllBtn) {
        if (!rowWrapper.classList.contains('bybit-all-input-row')) {
          const wrapper = document.createElement('div');
          wrapper.className = 'bybit-all-input-row';
          inputWrapper.parentNode?.insertBefore(wrapper, inputWrapper);
          wrapper.appendChild(inputWrapper);
          rowWrapper = wrapper;
        }

        externalAllBtn = document.createElement('button');
        externalAllBtn.type = 'button';
        externalAllBtn.className = 'bybit-prominent-all-btn';
        externalAllBtn.textContent = 'ALL';
        externalAllBtn.title = 'Ввести максимальную сумму (All)';

        externalAllBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          // 1. Native All button click if found
          const allCandidates = Array.from(inputWrapper.querySelectorAll<HTMLElement>('*'));
          const nativeAllBtn = allCandidates.find(el => {
            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
            return t === 'all' || t === 'все' || t === 'max';
          });
          if (nativeAllBtn) {
            simulateUserClick(nativeAllBtn);
          }

          // 2. Also extract max value from placeholder (e.g. "1,813.00 ~ 1,813.00")
          const placeholder = payInput.placeholder || '';
          const maxMatch = placeholder.match(/~\s*([\d\s,.]+)/) || placeholder.match(/([\d\s,.]+)\s*$/);
          if (maxMatch && maxMatch[1]) {
            insertPriceValue(container, cleanNumberString(maxMatch[1]));
          }
        });

        rowWrapper.appendChild(externalAllBtn);
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
      // Match numbers with at least 3 digits (supports 24143, 16,200.00, 3 000, etc.)
      const numPattern = '(?<!\\d)(?:\\d{1,3}(?:[ ,.\\u00a0]\\d{3})+(?:[.,]\\d+)?|\\d{3,}(?:[.,]\\d+)?)(?!\\d)';

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

    // 7. Find Open Expanded Order Containers
    function findOpenOrderContainers(): HTMLElement[] {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('tr, div')).filter(el => {
        const text = el.textContent || '';
        return (text.includes('Advertiser Terms') || text.includes('Условия рекламодателя')) && 
               (text.includes('I will pay') || text.includes('Price') || text.includes('Buy'));
      });

      if (candidates.length === 0) return [];

      const result: HTMLElement[] = [];
      candidates.forEach(c => {
        let outer: HTMLElement | null = c;
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

    // 8. Core Highlight & Processing Loop
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
        // 1. Payment Auto-Selection (Strictly USDT/RUB Buy page, only if seller offers target methods)
        autoSelectPaymentMethod(card);

        // 2. Expose the "ALL" button prominently
        exposeAllButton(card);

        // 3. Highlight keywords and 3+ digit numbers in description
        highlightKeywordsAndNumbers(card, keywords);

        // 4. Render badge next to Price if keywords matched
        const text = card.textContent || '';
        const matched = findMatchesInText(text, keywords);
        const isMatch = matched.length > 0;

        if (isMatch) {
          card.classList.add('bybit-p2p-highlighted-card');
          card.classList.add('bybit-p2p-highlighted-order');
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
