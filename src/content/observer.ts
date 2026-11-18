import { SELECTORS } from '../constants/selectors';

export class DebounceScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private callback: () => void, private defaultDelay: number = 50) {}

  public schedule(delay: number = this.defaultDelay): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.callback();
    }, delay);
  }

  public cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public triggerNow(): void {
    this.cancel();
    this.callback();
  }
}

export function setupMutationObserver(onMutate: () => void): () => void {
  const IGNORED_CLASSES = [
    SELECTORS.kwHighlight,
    SELECTORS.numberHighlight,
    SELECTORS.matchContainer,
    SELECTORS.prominentAllBtn
  ];

  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType === 1) {
            const el = node as HTMLElement;
            if (el.classList && IGNORED_CLASSES.some(cls => el.classList.contains(cls))) {
              continue;
            }
            shouldUpdate = true;
            break;
          }
        }
      }
      if (shouldUpdate) break;
    }

    if (shouldUpdate) {
      onMutate();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
  };
}

export function setupRouteListeners(onRouteChange: () => void): () => void {
  const onPopState = () => onRouteChange();
  const onHashChange = () => onRouteChange();

  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
  };
}
