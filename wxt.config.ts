import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Bybit P2P Order Highlighter',
    description: 'Highlights Bybit P2P orders matching keywords (like СБП, телефона) in seller remarks and payment terms.',
    permissions: ['storage'],
    host_permissions: [
      '*://*.bybit.com/*',
      '*://bybit.com/*'
    ],
    browser_specific_settings: {
      gecko: {
        id: 'bybit-p2p-highlighter@antigravity',
        strict_min_version: '109.0'
      }
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    },
    action: {
      default_title: 'Bybit P2P Highlighter',
      default_icon: {
        '16': 'icons/icon-16.png',
        '48': 'icons/icon-48.png',
        '128': 'icons/icon-128.png'
      }
    }
  }
});
