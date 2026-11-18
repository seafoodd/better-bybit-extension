/**
 * Bybit P2P Order Highlighter - Popup Controller
 */
(() => {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  let currentSettings = {
    enabled: true,
    keywords: ['СБП', 'телефона'],
    highlightColor: 'emerald',
    showRemarkPreview: true,
    dimNonMatching: false,
    hideNonMatching: false
  };

  // DOM Elements
  const masterToggle = document.getElementById('master-toggle');
  const statusBanner = document.getElementById('status-banner');
  const statusText = document.getElementById('status-text');
  const keywordForm = document.getElementById('keyword-form');
  const keywordInput = document.getElementById('keyword-input');
  const tagsContainer = document.getElementById('tags-container');
  const quickChips = document.querySelectorAll('.quick-chip');
  const colorButtons = document.querySelectorAll('.color-btn');
  const showRemarkToggle = document.getElementById('show-remark-toggle');
  const dimToggle = document.getElementById('dim-toggle');
  const hideToggle = document.getElementById('hide-toggle');

  // 1. Load settings on popup open
  function init() {
    api.storage.local.get(currentSettings, (stored) => {
      if (stored) {
        currentSettings = { ...currentSettings, ...stored };
      }
      applySettingsToUI();
      queryActiveTabStatus();
    });

    setupEventListeners();
  }

  function applySettingsToUI() {
    masterToggle.checked = !!currentSettings.enabled;
    showRemarkToggle.checked = !!currentSettings.showRemarkPreview;
    dimToggle.checked = !!currentSettings.dimNonMatching;
    hideToggle.checked = !!currentSettings.hideNonMatching;

    // Color buttons
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

    // Remove buttons
    tagsContainer.querySelectorAll('.keyword-tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(btn.dataset.index, 10);
        removeKeyword(idx);
      });
    });
  }

  function addKeyword(word) {
    const trimmed = (word || '').trim();
    if (!trimmed) return;

    if (!currentSettings.keywords.some(k => k.toLowerCase() === trimmed.toLowerCase())) {
      currentSettings.keywords.push(trimmed);
      saveSettings();
      renderTags();
    }
  }

  function removeKeyword(index) {
    if (index >= 0 && index < currentSettings.keywords.length) {
      currentSettings.keywords.splice(index, 1);
      saveSettings();
      renderTags();
    }
  }

  function saveSettings() {
    api.storage.local.set(currentSettings, () => {
      notifyContentScript();
    });
  }

  function notifyContentScript() {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        api.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_SETTINGS',
          settings: currentSettings
        }, () => {
          // Ignore runtime errors if content script is not injected on this tab
          if (api.runtime.lastError) {}
          queryActiveTabStatus();
        });
      }
    });
  }

  function queryActiveTabStatus() {
    if (!currentSettings.enabled) {
      statusBanner.className = 'status-banner offline';
      statusText.textContent = 'Подсветка отключена';
      return;
    }

    api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url || !tab.url.includes('bybit.com')) {
        statusBanner.className = 'status-banner offline';
        statusText.textContent = 'Откройте страницу Bybit P2P';
        return;
      }

      api.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (response) => {
        if (api.runtime.lastError || !response) {
          statusBanner.className = 'status-banner';
          statusText.textContent = 'Bybit открыт (обновите страницу)';
          return;
        }

        statusBanner.className = 'status-banner';
        if (response.totalRowsCount > 0) {
          statusText.innerHTML = `Найдено <strong>${response.matchedCount}</strong> из <strong>${response.totalRowsCount}</strong> заказов`;
        } else {
          statusText.textContent = 'Ожидание списка заказов...';
        }
      });
    });
  }

  function setupEventListeners() {
    // Master Toggle
    masterToggle.addEventListener('change', () => {
      currentSettings.enabled = masterToggle.checked;
      saveSettings();
    });

    // Add keyword form
    keywordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addKeyword(keywordInput.value);
      keywordInput.value = '';
    });

    // Quick chips
    quickChips.forEach(chip => {
      chip.addEventListener('click', () => {
        addKeyword(chip.dataset.kw);
      });
    });

    // Color buttons
    colorButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        colorButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSettings.highlightColor = btn.dataset.color;
        saveSettings();
      });
    });

    // Checkboxes
    showRemarkToggle.addEventListener('change', () => {
      currentSettings.showRemarkPreview = showRemarkToggle.checked;
      saveSettings();
    });

    dimToggle.addEventListener('change', () => {
      currentSettings.dimNonMatching = dimToggle.checked;
      if (currentSettings.dimNonMatching) {
        currentSettings.hideNonMatching = false;
        hideToggle.checked = false;
      }
      saveSettings();
    });

    hideToggle.addEventListener('change', () => {
      currentSettings.hideNonMatching = hideToggle.checked;
      if (currentSettings.hideNonMatching) {
        currentSettings.dimNonMatching = false;
        dimToggle.checked = false;
      }
      saveSettings();
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
