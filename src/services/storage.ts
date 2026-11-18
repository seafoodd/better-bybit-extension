import { browser } from 'wxt/browser';
import type { Settings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../constants/config';
import type { UpdateSettingsMessage } from '../types/messages';

export class StorageService {
  private currentSettings: Settings = { ...DEFAULT_SETTINGS };

  public getSettings(): Settings {
    return { ...this.currentSettings };
  }

  public async loadSettings(): Promise<Settings> {
    try {
      const stored = await browser.storage.local.get(this.currentSettings);
      if (stored) {
        this.currentSettings = { ...this.currentSettings, ...(stored as Partial<Settings>) };
      }
    } catch (e) {
      console.warn('[Bybit Highlighter] Failed to load settings from storage:', e);
    }
    return this.getSettings();
  }

  public async saveSettings(newSettings: Settings): Promise<void> {
    this.currentSettings = { ...newSettings };
    try {
      await browser.storage.local.set(this.currentSettings);
      await this.notifyActiveTab(this.currentSettings);
    } catch (e) {
      console.warn('[Bybit Highlighter] Failed to save settings to storage:', e);
    }
  }

  public watchSettings(onChange: (settings: Settings) => void): () => void {
    const listener = (changes: Record<string, { oldValue?: any; newValue?: any }>, area: string) => {
      if (area === 'local') {
        let changed = false;
        for (const [key, change] of Object.entries(changes)) {
          if ((this.currentSettings as any)[key] !== change.newValue) {
            (this.currentSettings as any)[key] = change.newValue;
            changed = true;
          }
        }
        if (changed) {
          onChange(this.getSettings());
        }
      }
    };

    browser.storage.onChanged.addListener(listener as any);
    return () => {
      browser.storage.onChanged.removeListener(listener as any);
    };
  }

  public async notifyActiveTab(settings: Settings): Promise<void> {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];
      if (activeTab && activeTab.id) {
        const msg: UpdateSettingsMessage = {
          type: 'UPDATE_SETTINGS',
          settings
        };
        browser.tabs.sendMessage(activeTab.id, msg).catch(() => {});
      }
    } catch (e) {
      // Tab may not have content script injected or active
    }
  }
}

export const storageService = new StorageService();
