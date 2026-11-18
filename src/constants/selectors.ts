export const SELECTORS = {
  // Table rows and cards
  tableRows: '.trade-table__tbody > tr, tr[data-guide*="ad-listing"], tbody tr, .trade-list__row',
  carouselCards: '.new-user-ads-carousel-card',
  carouselRowClass: 'new-user-ads-carousel-row',
  advertiserName: '.advertiser-name',
  priceAmount: '.price-amount',

  // Highlight classes
  highlightedOrder: 'bybit-p2p-highlighted-order',
  highlightedCard: 'bybit-p2p-highlighted-card',
  matchContainer: 'bybit-p2p-match-container',
  matchTag: 'bybit-p2p-match-tag',
  kwHighlight: 'bybit-kw-highlight',
  numberHighlight: 'bybit-number-highlight',

  // ALL button and input row classes
  allInputRow: 'bybit-all-input-row',
  prominentAllBtn: 'bybit-prominent-all-btn',
  nativeAllHidden: 'bybit-native-all-hidden',
  inputFlashed: 'bybit-input-flashed',

  // Amount inputs
  amountInputs: '[data-guide="amount-input"] input, .fiat-p2p__amount-input-container input, .fiat-p2p__amount-input-field input',
  amountInputField: '.fiat-p2p__amount-input-field',
  amountInputSuffix: '.fiat-p2p__amount-input-suffix',
  molyInput: '.moly-input',

  // Payment select
  paymentSelectTrigger: '.fiat-p2p__payment-select-comp--unselected, [data-guide="payment-method"] .fiat-p2p__payment-select-comp',
  paymentDropdown: '.fiat-p2p__payment-select-dropdown, .rc-select-dropdown',
  paymentOptions: '.fiat-p2p__payment-select-option, [role="option"], .rc-select-item-option',
  paymentTags: '.payment-tags-container, [class*="payment-tag"], [class*="trade-list-tag"]',
  suppressDropdown: 'bybit-suppress-dropdown'
} as const;
