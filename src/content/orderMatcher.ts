import { SELECTORS } from '../constants/selectors';
import { buildFullMatchRegex, cleanNumberString } from '../utils/numbers';
import { insertPriceValue } from './amountInput';

export function findMatchesInText(text: string, keywords: string[]): string[] {
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

export function findDescriptionContainer(card: HTMLElement): HTMLElement | null {
  const candidates = Array.from(card.querySelectorAll<HTMLElement>('*'));
  for (const el of candidates) {
    const t = (el.innerText || el.textContent || '').trim();
    if (t === 'Advertiser Terms' || t === 'Условия рекламодателя') {
      return el.closest('div[class*="terms"], div[class*="left"], div[class*="content"]') || el.parentElement;
    }
  }
  return card.querySelector<HTMLElement>('.left-content, [class*="terms"], [class*="advertiser"]');
}

export function highlightKeywordsAndNumbers(container: HTMLElement, keywords: string[]): void {
  if (!container) return;

  const fullRegex = buildFullMatchRegex(keywords);

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
        if (parent.closest(`.${SELECTORS.matchContainer}`) || parent.closest(`.${SELECTORS.prominentAllBtn}`)) {
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
        mark.className = SELECTORS.kwHighlight;
        mark.textContent = matchStr;
        frag.appendChild(mark);
      } else if (isNum) {
        // Number (3+ digits): Gray background, clickable to insert into price field
        const numMark = document.createElement('mark');
        numMark.className = SELECTORS.numberHighlight;
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
