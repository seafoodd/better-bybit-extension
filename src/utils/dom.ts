export function simulateUserClick(target: HTMLElement): void {
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

  try {
    target.focus();
  } catch (e) {}

  const upOpts = Object.assign({}, opts, { buttons: 0 });
  target.dispatchEvent(new PointerEvent('pointerup', upOpts));
  target.dispatchEvent(new MouseEvent('mouseup', upOpts));
  target.dispatchEvent(new MouseEvent('click', upOpts));
  try {
    target.click();
  } catch (e) {}
}

export function setNativeInputValue(input: HTMLInputElement, value: string): void {
  input.focus();

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function unwrapOldWrappers(container: HTMLElement): void {
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
