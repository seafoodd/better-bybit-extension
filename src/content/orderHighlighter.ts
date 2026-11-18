import { SELECTORS } from '../constants/selectors';
import type { OtcStore } from '../services/otcStore';
import { escapeHtml } from '../utils/text';
import { autoSelectPaymentMethod } from './paymentSelector';
import { exposeAllButton } from './amountInput';
import { findMatchesInText, highlightKeywordsAndNumbers } from './orderMatcher';

export function findOpenOrderContainers(): HTMLElement[] {
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
    if (tr && tr.id !== 'root' && !tr.classList.contains('otc__root') && tr !== (document.body as any)) {
      if (!result.includes(tr)) {
        result.push(tr);
      }
      return;
    }

    // 2. If inside a carousel card
    const card = header.closest<HTMLElement>(SELECTORS.carouselCards);
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

export function findPriceHeaderElement(container: HTMLElement): HTMLElement | null {
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

export function renderTableRowBadge(
  element: HTMLElement,
  priceEl: HTMLElement,
  matchedKeywords: string[],
  remark: string
): void {
  const targetParent = priceEl.parentElement || priceEl;

  // Remove existing badges in other positions of this card
  element.querySelectorAll(`.${SELECTORS.matchContainer}`).forEach(b => {
    if (b.parentElement !== targetParent) b.remove();
  });

  let badge = targetParent.querySelector<HTMLElement>(`.${SELECTORS.matchContainer}`);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = SELECTORS.matchContainer;
    if (priceEl.nextSibling) {
      targetParent.insertBefore(badge, priceEl.nextSibling);
    } else {
      targetParent.appendChild(badge);
    }
  }

  const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');
  const tooltipText = remark ? `⚡ Найдено в условиях: ${labelText}\n\nУсловия мерчанта:\n${remark}` : `⚡ Найдено в условиях: ${labelText}`;

  badge.innerHTML = `
    <span class="${SELECTORS.matchTag}" title="${escapeHtml(tooltipText)}">
      <span class="bybit-tag-icon">⚡</span>
      <span>${escapeHtml(labelText)}</span>
    </span>
  `;
}

export function renderBadgeNextToPrice(card: HTMLElement, matchedKeywords: string[]): void {
  const priceHeader = findPriceHeaderElement(card);
  if (!priceHeader) return;

  card.querySelectorAll(`.${SELECTORS.matchContainer}`).forEach(b => {
    if (b.parentElement !== priceHeader) b.remove();
  });

  let badgeContainer = priceHeader.querySelector<HTMLElement>(`.${SELECTORS.matchContainer}`);
  if (!badgeContainer) {
    badgeContainer = document.createElement('span');
    badgeContainer.className = SELECTORS.matchContainer;
    priceHeader.appendChild(badgeContainer);
  }

  const labelText = matchedKeywords.map(k => k.toUpperCase()).join(' • ');
  badgeContainer.innerHTML = `
    <span class="${SELECTORS.matchTag}" title="Найдено в условиях">
      <span class="bybit-tag-icon">⚡</span>
      <span>${escapeHtml(labelText)}</span>
    </span>
  `;
}

export function removeBadges(card: HTMLElement): void {
  card.querySelectorAll(`.${SELECTORS.matchContainer}`).forEach(el => el.remove());
}

export function highlightTableOrders(keywords: string[], otcStore: OtcStore): void {
  // 1. Regular order rows in table
  const rows = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.tableRows));

  const validRows = rows.filter(tr => {
    if (tr.classList.contains(SELECTORS.carouselRowClass)) return false;
    if (tr.textContent?.includes('Advertiser Terms') || tr.textContent?.includes('Условия рекламодателя')) return false;
    return tr.querySelector(SELECTORS.advertiserName) && tr.querySelector(SELECTORS.priceAmount);
  });

  // 2. Carousel cards
  const carouselCards = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.carouselCards)).filter(card => {
    return card.querySelector(SELECTORS.advertiserName) && card.querySelector(SELECTORS.priceAmount);
  });

  const allOrderElements: HTMLElement[] = [...validRows, ...carouselCards];

  allOrderElements.forEach(element => {
    const nameEl = element.querySelector<HTMLElement>(SELECTORS.advertiserName);
    const priceEl = element.querySelector<HTMLElement>(SELECTORS.priceAmount);
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
    const matchedItem = otcStore.findItem(cleanName, priceKey);

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
      element.classList.add(SELECTORS.highlightedOrder);
      renderTableRowBadge(element, priceEl, matchedKeywords, remark);
    } else {
      element.classList.remove(SELECTORS.highlightedOrder);
      element.querySelectorAll(`.${SELECTORS.matchContainer}`).forEach(el => el.remove());
    }
  });
}

export function processOpenOrders(keywords: string[]): void {
  const openOrders = findOpenOrderContainers();
  openOrders.forEach(card => {
    if (card.id === 'root' || card.classList.contains('otc__root') || card === (document.body as any)) {
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
      card.classList.add(SELECTORS.highlightedCard);
      renderBadgeNextToPrice(card, matched);
    } else {
      card.classList.remove(SELECTORS.highlightedCard);
      card.classList.remove(SELECTORS.highlightedOrder);
      removeBadges(card);
    }
  });
}

export function cleanupRogueClasses(): void {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.classList.remove(SELECTORS.highlightedCard, SELECTORS.highlightedOrder);
  }
  document.querySelectorAll('.otc__root, table, tbody, thead, .trade-table, [class*="table-wrapper"], [class*="dynamic"]').forEach(el => {
    el.classList.remove(SELECTORS.highlightedCard, SELECTORS.highlightedOrder);
  });
}

export function removeAllHighlights(): void {
  document.querySelectorAll(`.${SELECTORS.highlightedOrder}`).forEach(el => {
    el.classList.remove(SELECTORS.highlightedOrder);
  });
  document.querySelectorAll(`.${SELECTORS.highlightedCard}`).forEach(el => {
    el.classList.remove(SELECTORS.highlightedCard);
  });
  document.querySelectorAll(`.${SELECTORS.matchContainer}`).forEach(el => el.remove());
  document.querySelectorAll(`.${SELECTORS.kwHighlight}, .${SELECTORS.numberHighlight}`).forEach(el => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent || ''), el);
      parent.normalize();
    }
  });
  document.querySelectorAll(`.${SELECTORS.prominentAllBtn}`).forEach(el => el.remove());
  document.querySelectorAll(`.${SELECTORS.allInputRow}`).forEach(el => el.classList.remove(SELECTORS.allInputRow));
  document.querySelectorAll(`.${SELECTORS.nativeAllHidden}`).forEach(el => {
    el.classList.remove(SELECTORS.nativeAllHidden);
    (el as HTMLElement).style.display = '';
  });
}
