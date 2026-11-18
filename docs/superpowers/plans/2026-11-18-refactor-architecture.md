# Full TypeScript Architecture Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the entire Bybit P2P Highlighter extension into a modular, clean, type-safe architecture following modern WebExtension & TypeScript best practices, without changing any user-facing behavior or breaking existing features.

**Architecture:** Separate concerns into focused single-responsibility modules: domain types, centralized constants, pure utilities, storage and OTC data store services, dedicated content domain modules (page detection, payment auto-selection, amount input handling, keyword/number matching, and table highlighting), and slim entrypoints.

**Tech Stack:** TypeScript 5.7, WXT (Vite 6), WebExtensions API (Firefox MV3 + Chromium compatible).

**Spec:** Current working state in master (`entrypoints/content/index.ts`, `entrypoints/injected.content.ts`, `entrypoints/popup/main.ts`, `entrypoints/content/style.css`).

## Global Constraints

- Never break existing functionality (order row highlighting, badge positioning, keyword/number matching, amount click-to-fill, ALL button placement, payment auto-selection, popup settings sync, theme color variants).
- Preserve exact CSS classes, dataset attributes, and DOM structure conventions used by the content script and styles.
- Strict TypeScript: no unhandled `any` in new modules, strong interfaces for storage, API items, messages, and DOM handlers.
- Production build must succeed with `pnpm run zip:firefox` and pass `pnpm exec tsc --noEmit` without errors.

## Review Focus

1. `cleanNumberString` and number regex must continue to treat `18 715`, `19.000`, `19,000`, `15,000.00`, etc. exactly as before.
2. Background color rules and transparent `<tr>` rendering must not be altered in `style.css`.
3. Communication between page context (world: MAIN via `injected.content.ts`) and isolated content script (world: ISOLATED via `content/index.ts`) must continue to use `__BYBIT_P2P_DATA_EVENT__`, `__BYBIT_P2P_DATA__`, and `__BYBIT_SELECT_PAYMENT__`.
4. Storage schema in `browser.storage.local` must remain 100% backward compatible (`{ enabled: boolean, keywords: string[], highlightColor: string }`).
5. Native input event dispatching (`nativeInputValueSetter` + `Event('input')`) for Bybit's React forms must not be broken.

---

### Task 1: Shared Types & Constants (`src/types/`, `src/constants/`)

**Files:**
- Create: `src/types/settings.ts`
- Create: `src/types/otc.ts`
- Create: `src/types/messages.ts`
- Create: `src/constants/config.ts`
- Create: `src/constants/selectors.ts`

- [ ] Create `src/types/settings.ts` with `HighlightColor`, `Settings`, and `StorageSchema` types.
- [ ] Create `src/types/otc.ts` with `BybitOtcItem` and `RawOtcApiResponse`.
- [ ] Create `src/types/messages.ts` with message payloads for `UPDATE_SETTINGS`, `GET_STATUS`, and custom window events.
- [ ] Create `src/constants/config.ts` with `DEFAULT_SETTINGS`, `THEME_CONFIG`, `TARGET_URL_PATTERNS`, `DEFAULT_KEYWORDS`.
- [ ] Create `src/constants/selectors.ts` with centralized CSS selectors for Bybit's table rows, carousel cards, input containers, and payment elements.
- [ ] Verify types with `pnpm exec tsc --noEmit`.

---

### Task 2: Core Pure Utilities (`src/utils/`)

**Files:**
- Create: `src/utils/text.ts`
- Create: `src/utils/numbers.ts`
- Create: `src/utils/dom.ts`

- [ ] Create `src/utils/text.ts` implementing `escapeHtml` and `escapeRegExp`.
- [ ] Create `src/utils/numbers.ts` implementing `cleanNumberString`, `NUMBER_REGEX_PATTERN`, and `NUMBER_SEPARATOR_REGEX`.
- [ ] Create `src/utils/dom.ts` implementing `simulateUserClick`, `setNativeInputValue`, and `unwrapOldWrappers`.
- [ ] Write a verification node script to prove `cleanNumberString` and `NUMBER_REGEX_PATTERN` produce identical outputs on all test cases.
- [ ] Verify types with `pnpm exec tsc --noEmit`.

---

### Task 3: State & Data Services (`src/services/`)

**Files:**
- Create: `src/services/storage.ts`
- Create: `src/services/otcStore.ts`

- [ ] Create `src/services/storage.ts` with typed methods: `loadSettings()`, `saveSettings(settings)`, `watchSettings(onChange)`, and `notifyActiveTab(settings)`.
- [ ] Create `src/services/otcStore.ts` encapsulating `interceptedItems` and `interceptedItemsByNickPrice` in an `OtcStore` class with `processRawPayload(text: string): boolean`, `findByNick(nick: string)`, `findByNickAndPrice(nick: string, price: string)`.
- [ ] Verify types with `pnpm exec tsc --noEmit`.

---

### Task 4: Content Domain Modules (`src/content/`)

**Files:**
- Create: `src/content/pageDetector.ts`
- Create: `src/content/paymentSelector.ts`
- Create: `src/content/amountInput.ts`
- Create: `src/content/orderMatcher.ts`
- Create: `src/content/orderHighlighter.ts`
- Create: `src/content/observer.ts`

- [ ] Create `src/content/pageDetector.ts` with `isStrictUsdtRubBuyPage(card?: HTMLElement)` and `orderOffersTargetPaymentMethods(container: HTMLElement)`.
- [ ] Create `src/content/paymentSelector.ts` with `autoSelectPaymentMethod`, `findTargetPaymentOption`, and `findPaymentMethodSelector`.
- [ ] Create `src/content/amountInput.ts` with `exposeAllButton`, `insertPriceValue`, and `findPayAmountInput`.
- [ ] Create `src/content/orderMatcher.ts` with `findMatchesInText`, `findDescriptionContainer`, and `highlightKeywordsAndNumbers`.
- [ ] Create `src/content/orderHighlighter.ts` with `highlightTableOrders`, `processOpenOrders`, `renderTableRowBadge`, `renderBadgeNextToPrice`, `removeBadges`, `removeAllHighlights`, and `findOpenOrderContainers`.
- [ ] Create `src/content/observer.ts` with `setupMutationObserver`, `DebounceScheduler`, and route change listeners.
- [ ] Verify types with `pnpm exec tsc --noEmit`.

---

### Task 5: Slim Entrypoints Integration & Popup Refactoring

**Files:**
- Modify: `entrypoints/content/index.ts`
- Modify: `entrypoints/popup/main.ts`
- Modify: `entrypoints/injected.content.ts`

- [ ] Refactor `entrypoints/content/index.ts` to cleanly instantiate `OtcStore`, `storageService`, register listeners, and initialize the content controller.
- [ ] Refactor `entrypoints/popup/main.ts` to import shared `DEFAULT_SETTINGS`, `storageService`, and `escapeHtml`.
- [ ] Clean up `entrypoints/injected.content.ts` using shared types and constants where appropriate while preserving the standalone nature of MAIN world scripts.
- [ ] Verify types with `pnpm exec tsc --noEmit`.

---

### Task 6: End-to-End Build & Functional Verification

**Files:**
- Verify: `pnpm exec tsc --noEmit`
- Verify: `pnpm run zip:firefox`
- Update: `bybit-p2p-highlighter.zip`

- [ ] Run full typecheck: `pnpm exec tsc --noEmit`.
- [ ] Run production zip build: `pnpm run zip:firefox`.
- [ ] Update root `bybit-p2p-highlighter.zip`.
- [ ] Commit all changes with clean atomic git history.
