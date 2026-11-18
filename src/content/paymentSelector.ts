import { SELECTORS } from '../constants/selectors';
import { WINDOW_EVENT_SELECT_PAYMENT } from '../types/messages';
import { simulateUserClick } from '../utils/dom';
import { isStrictUsdtRubBuyPage, orderOffersTargetPaymentMethods } from './pageDetector';

const processedContainers = new WeakSet<HTMLElement>();

export function clickTargetOption(targetOption: HTMLElement): void {
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
    window.dispatchEvent(new CustomEvent(WINDOW_EVENT_SELECT_PAYMENT));
  } catch (e) {}
}

export function findTargetPaymentOption(): HTMLElement | null {
  const dropdown = document.querySelector<HTMLElement>(SELECTORS.paymentDropdown);
  if (dropdown) {
    const options = Array.from(dropdown.querySelectorAll<HTMLElement>(SELECTORS.paymentOptions));
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

export function findPaymentMethodSelector(container: HTMLElement): HTMLElement | null {
  const directComp = container.querySelector<HTMLElement>(SELECTORS.paymentSelectTrigger);
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

export function autoSelectPaymentMethod(container: HTMLElement): void {
  if (!isStrictUsdtRubBuyPage(container)) return;

  // CRITICAL: Only proceed if seller offers Mobile Top-up or Bank Transfer. If not, do NOT even try!
  if (!orderOffersTargetPaymentMethods(container)) {
    return;
  }

  try {
    window.dispatchEvent(new CustomEvent(WINDOW_EVENT_SELECT_PAYMENT));
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

  document.body.classList.add(SELECTORS.suppressDropdown);

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
      document.body.classList.remove(SELECTORS.suppressDropdown);
      return;
    }

    const targetOption = findTargetPaymentOption();
    if (targetOption) {
      clearInterval(pollInterval);
      clickTargetOption(targetOption);

      setTimeout(() => {
        document.body.classList.remove(SELECTORS.suppressDropdown);
      }, 60);
      return;
    }

    if (attempts >= maxAttempts) {
      clearInterval(pollInterval);
      document.body.classList.remove(SELECTORS.suppressDropdown);
    }
  }, 15);
}
