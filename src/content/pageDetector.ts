import { TARGET_PAYMENT_METHODS } from '../constants/config';
import { SELECTORS } from '../constants/selectors';

export function isStrictUsdtRubBuyPage(card?: HTMLElement): boolean {
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

export function orderOffersTargetPaymentMethods(container: HTMLElement): boolean {
  // 1. If rc-select dropdown is already open in DOM, check its options
  const dropdown = document.querySelector<HTMLElement>(SELECTORS.paymentDropdown);
  if (dropdown) {
    const ddText = dropdown.textContent || '';
    if (TARGET_PAYMENT_METHODS.some(m => ddText.includes(m))) {
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
  const tags = document.querySelectorAll(SELECTORS.paymentTags);
  tags.forEach(tag => {
    textToCheck += ' ' + (tag.textContent || '');
  });

  return TARGET_PAYMENT_METHODS.some(m => textToCheck.includes(m));
}
