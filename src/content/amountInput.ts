import { SELECTORS } from '../constants/selectors';
import { simulateUserClick, setNativeInputValue, unwrapOldWrappers } from '../utils/dom';
import { cleanNumberString } from '../utils/numbers';

export function findPayAmountInput(container: HTMLElement): HTMLInputElement | null {
  // 1. Direct Bybit amount-input selector
  const directInput = container.querySelector<HTMLInputElement>(SELECTORS.amountInputs);
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

export function insertPriceValue(container: HTMLElement, value: string): void {
  const payInput = findPayAmountInput(container);
  if (!payInput) return;

  const sanitizedValue = cleanNumberString(value);

  setNativeInputValue(payInput, sanitizedValue);

  payInput.classList.add(SELECTORS.inputFlashed);
  setTimeout(() => {
    payInput.classList.remove(SELECTORS.inputFlashed);
  }, 350);
}

export function exposeAllButton(container: HTMLElement): void {
  unwrapOldWrappers(container);

  const payInput = findPayAmountInput(container);
  if (!payInput) return;

  // Find the outer input field container (.fiat-p2p__amount-input-field or .moly-input)
  const inputField = container.querySelector<HTMLElement>(SELECTORS.amountInputField) ||
                     payInput.closest<HTMLElement>(`${SELECTORS.amountInputField}, ${SELECTORS.molyInput}`) ||
                     payInput.parentElement;
  if (!inputField || !inputField.parentElement) return;

  // The native parent container (.moly-space-item-last) gets flex row layout
  const parentRow = inputField.parentElement;
  parentRow.classList.add(SELECTORS.allInputRow);

  // 1. Hide Bybit's native internal orange "All" text/button inside inputField so it never appears inside input
  const fieldLeaves = Array.from(inputField.querySelectorAll<HTMLElement>('*'));
  for (const el of fieldLeaves) {
    if (el.tagName === 'INPUT' || el.tagName === 'IMG' || el.tagName === 'SVG' || el.tagName === 'PATH') continue;
    if (el.classList.contains(SELECTORS.prominentAllBtn)) {
      el.remove();
      continue;
    }
    const t = (el.textContent || '').trim().toLowerCase();
    if ((t === 'all' || t === 'все' || t === 'max') && el.children.length === 0) {
      el.classList.add(SELECTORS.nativeAllHidden);
      el.style.setProperty('display', 'none', 'important');
    }
  }

  // 2. Remove ANY .bybit-prominent-all-btn inside inputField or elsewhere in container that is misplaced
  container.querySelectorAll(`.${SELECTORS.prominentAllBtn}`).forEach(btn => {
    if (btn.parentElement !== parentRow) {
      btn.remove();
    }
  });

  // 3. Ensure EXACTLY ONE .bybit-prominent-all-btn exists as a direct child of parentRow
  const existingBtns = Array.from(parentRow.querySelectorAll<HTMLButtonElement>(`:scope > .${SELECTORS.prominentAllBtn}`));
  let externalAllBtn = existingBtns[0] || null;

  if (existingBtns.length > 1) {
    for (let i = 1; i < existingBtns.length; i++) {
      existingBtns[i].remove();
    }
  }

  if (!externalAllBtn) {
    externalAllBtn = document.createElement('button');
    externalAllBtn.type = 'button';
    externalAllBtn.className = SELECTORS.prominentAllBtn;
    externalAllBtn.textContent = 'ALL';
    externalAllBtn.title = 'Ввести максимальную сумму (All)';

    externalAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Search live for native All button in suffix
      const suffix = inputField.querySelector<HTMLElement>(SELECTORS.amountInputSuffix) || inputField;
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
