import { defineContentScript } from 'wxt/sandbox';
import { browser } from 'wxt/browser';
import './style.css';

import type { ExtensionRuntimeMessage } from '../../src/types/messages';
import {
  WINDOW_EVENT_DATA,
  WINDOW_EVENT_REQUEST_CACHE,
  POST_MESSAGE_TYPE_DATA,
  type WindowDataEventDetail
} from '../../src/types/messages';
import { storageService } from '../../src/services/storage';
import { otcStore } from '../../src/services/otcStore';
import {
  highlightTableOrders,
  processOpenOrders,
  cleanupRogueClasses,
  removeAllHighlights
} from '../../src/content/orderHighlighter';
import {
  DebounceScheduler,
  setupMutationObserver,
  setupRouteListeners
} from '../../src/content/observer';

export default defineContentScript({
  matches: ['*://*.bybit.com/*', '*://bybit.com/*'],
  runAt: 'document_start',
  main() {
    function applyThemeColor(color: string) {
      document.documentElement.setAttribute('data-bybit-theme', color || 'emerald');
    }

    function runHighlight() {
      const settings = storageService.getSettings();
      if (!settings.enabled) {
        removeAllHighlights();
        return;
      }

      cleanupRogueClasses();

      const keywords = (settings.keywords || [])
        .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
        .filter(k => k.length > 0);

      highlightTableOrders(keywords, otcStore);
      processOpenOrders(keywords);
    }

    const scheduler = new DebounceScheduler(runHighlight, 50);

    function handleIncomingData(rawText: string) {
      if (otcStore.processRawPayload(rawText)) {
        scheduler.schedule(20);
      }
    }

    // 1. Storage & Runtime Messaging
    storageService.watchSettings((newSettings) => {
      applyThemeColor(newSettings.highlightColor);
      scheduler.schedule(10);
    });

    try {
      (browser.runtime.onMessage.addListener as any)(
        (message: ExtensionRuntimeMessage, _sender: any, sendResponse: any) => {
          if (message.type === 'GET_STATUS') {
            const current = storageService.getSettings();
            sendResponse({
              enabled: current.enabled,
              keywords: current.keywords
            });
            return true;
          }
          if (message.type === 'UPDATE_SETTINGS') {
            const current = storageService.getSettings();
            const updated = { ...current, ...message.settings };
            storageService.saveSettings(updated);
            applyThemeColor(updated.highlightColor);
            scheduler.schedule(10);
            sendResponse({ success: true });
            return true;
          }
        }
      );
    } catch (e) {}

    // 2. Intercepted Network Data Listeners
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || !event.data || event.data.type !== POST_MESSAGE_TYPE_DATA) {
        return;
      }
      handleIncomingData(event.data.text);
    });

    window.addEventListener(WINDOW_EVENT_DATA, ((event: CustomEvent<WindowDataEventDetail>) => {
      if (event.detail && event.detail.text) {
        handleIncomingData(event.detail.text);
      }
    }) as EventListener);

    // Request cached network data from MAIN world script
    try {
      window.dispatchEvent(new CustomEvent(WINDOW_EVENT_REQUEST_CACHE));
    } catch (e) {}

    // 3. Lifecycle Initialization
    async function init() {
      const settings = await storageService.loadSettings();
      applyThemeColor(settings.highlightColor);

      const oldWidget = document.getElementById('bybit-p2p-floating-widget');
      if (oldWidget) oldWidget.remove();

      setupMutationObserver(() => scheduler.schedule(50));
      setupRouteListeners(() => scheduler.schedule(100));

      setInterval(() => {
        if (storageService.getSettings().enabled) {
          runHighlight();
        }
      }, 500);

      scheduler.schedule(100);

      console.log('[Bybit Highlighter] WXT Extension active (v1.1.0)');
    }

    if (document.body) {
      init();
    } else {
      document.addEventListener('DOMContentLoaded', () => init());
    }
  }
});
