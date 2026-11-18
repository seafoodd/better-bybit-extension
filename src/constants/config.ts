import type { Settings } from '../types/settings';

export const DEFAULT_KEYWORDS: readonly string[] = ['СБП', 'телефона'];

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  keywords: [...DEFAULT_KEYWORDS],
  highlightColor: 'emerald'
};

export const TARGET_URL_PATTERNS: readonly string[] = [
  '/fiat/otc/item/online',
  '/fiat/otc/item/',
  '/fiat/otc/',
  '/otc/item/online',
  '/otc/item/',
  'online'
];

export const TARGET_PAYMENT_METHODS: readonly string[] = [
  'Mobile Top-up',
  'Bank Transfer'
];
