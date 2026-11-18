import { browser } from 'wxt/browser';

interface Settings {
  enabled: boolean;
  keywords: string[];
  highlightColor: string;
  [key: string]: any;
}

let currentSettings: Settings = {
  enabled: true,
  keywords: ['СБП', 'телефона'],
  highlightColor: 'emerald'
};

// DOM Elements
const masterToggle = document.getElementById('master-toggle') as HTMLInputElement;
const statusBanner = document.getElementById('status-banner') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const keywordForm = document.getElementById('keyword-form') as HTMLFormElement;
const keywordInput = document.getElementById('keyword-input') as HTMLInputElement;
const tagsContainer = document.getElementById('tags-container') as HTMLDivElement;
const quickChips = document.querySelectorAll<HTMLButtonElement>('.quick-chip');
const colorButtons = document.querySelectorAll<HTMLButtonElement>('.color-btn');

async function init() {
  try {
    const stored = await browser.storage.local.get(currentSettings);
    if (stored) {
      currentSettings = { ...currentSettings, ...(stored as Partial<Settings>) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }

  applySettingsToUI();
  updateStatusBanner();
  setupEventListeners();
}

function applySettingsToUI() {
  if (masterToggle) masterToggle.checked = !!currentSettings.enabled;

  colorButtons.forEach(btn => {
    if (btn.dataset.color === currentSettings.highlightColor) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderTags();
}

function renderTags() {
  if (!tagsContainer) return;
  tagsContainer.innerHTML = '';
  const keywords = currentSettings.keywords || [];

  if (keywords.length === 0) {
    tagsContainer.innerHTML = '<span style="color: #64748b; font-size: 11px;">Нет добавленных слов</span>';
    return;
  }

  keywords.forEach((kw, index) => {
    const tag = document.createElement('div');
    tag.className = 'keyword-tag';
    tag.innerHTML = `
      <span>${escapeHtml(kw)}</span>
      <button type="button" class="keyword-tag-remove" data-index="${index}" title="Удалить">×</button>
    `;
    tagsContainer.appendChild(tag);
  });

  tagsContainer.querySelectorAll<HTMLButtonElement>('.keyword-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index || '-1', 10);
      removeKeyword(idx);
    });
  });
}

function addKeyword(word: string) {
  const trimmed = (word || '').trim();
  if (!trimmed) return;

  if (!currentSettings.keywords.some(k => k.toLowerCase() === trimmed.toLowerCase())) {
    currentSettings.keywords.push(trimmed);
    saveSettings();
    renderTags();
  }
}

function removeKeyword(index: number) {
  if (index >= 0 && index < currentSettings.keywords.length) {
    currentSettings.keywords.splice(index, 1);
    saveSettings();
    renderTags();
  }
}

async function saveSettings() {
  try {
    await browser.storage.local.set(currentSettings);
    await notifyContentScript();
    updateStatusBanner();
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

async function notifyContentScript() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0] && tabs[0].id) {
      browser.tabs.sendMessage(tabs[0].id, {
        type: 'UPDATE_SETTINGS',
        settings: currentSettings
      }).catch(() => {});
    }
  } catch (e) {}
}

async function updateStatusBanner() {
  if (!statusBanner || !statusText) return;

  if (!currentSettings.enabled) {
    statusBanner.className = 'status-banner offline';
    statusText.textContent = 'Подсветка отключена';
    return;
  }

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !tab.url.includes('bybit.com')) {
      statusBanner.className = 'status-banner offline';
      statusText.textContent = 'Откройте страницу Bybit P2P';
      return;
    }

    statusBanner.className = 'status-banner';
    if (tab.url.includes('USDT/RUB') || tab.url.includes('usdt/rub')) {
      statusText.textContent = '🟢 Активно (USDT/RUB: авто-выбор Mobile Top-up)';
    } else {
      statusText.textContent = '🟢 Активно на Bybit P2P';
    }
  } catch (e) {
    statusBanner.className = 'status-banner';
    statusText.textContent = '🟢 Активно';
  }
}

function setupEventListeners() {
  masterToggle?.addEventListener('change', () => {
    currentSettings.enabled = masterToggle.checked;
    saveSettings();
  });

  keywordForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (keywordInput) {
      addKeyword(keywordInput.value);
      keywordInput.value = '';
    }
  });

  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.kw) {
        addKeyword(chip.dataset.kw);
      }
    });
  });

  colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      colorButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.color) {
        currentSettings.highlightColor = btn.dataset.color;
        saveSettings();
      }
    });
  });
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

document.addEventListener('DOMContentLoaded', init);
