import type { BybitOtcItem, RawOtcApiResponse } from '../types/otc';

export class OtcStore {
  private itemsByNick = new Map<string, BybitOtcItem>();
  private itemsByNickPrice = new Map<string, BybitOtcItem>();

  public get size(): number {
    return this.itemsByNick.size;
  }

  public extractItems(jsonObj: any): any[] {
    if (!jsonObj) return [];
    if (Array.isArray(jsonObj)) return jsonObj;
    if (jsonObj.result) {
      if (Array.isArray(jsonObj.result)) return jsonObj.result;
      if (Array.isArray(jsonObj.result.items)) return jsonObj.result.items;
      if (Array.isArray(jsonObj.result.data)) return jsonObj.result.data;
    }
    if (jsonObj.data) {
      if (Array.isArray(jsonObj.data)) return jsonObj.data;
      if (Array.isArray(jsonObj.data.items)) return jsonObj.data.items;
    }
    if (Array.isArray(jsonObj.items)) return jsonObj.items;
    return [];
  }

  public processRawPayload(rawText: string | RawOtcApiResponse): boolean {
    try {
      const data = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
      const items = this.extractItems(data);
      if (!items || items.length === 0) return false;

      let addedCount = 0;
      for (const item of items) {
        if (!item || !item.nickName) continue;
        const nick = String(item.nickName).trim();
        const price = item.price ? String(item.price).trim() : '';
        const cleanNick = nick.toLowerCase();
        const numPrice = parseFloat(price);
        const priceKey = !isNaN(numPrice) ? numPrice.toFixed(2) : price;

        const otcItem: BybitOtcItem = {
          id: String(item.id || ''),
          nickName: nick,
          price: price,
          minAmount: String(item.minAmount || ''),
          maxAmount: String(item.maxAmount || ''),
          quantity: String(item.quantity || ''),
          remark: String(item.remark || ''),
          payments: Array.isArray(item.payments) ? item.payments : []
        };

        this.itemsByNick.set(cleanNick, otcItem);
        if (priceKey) {
          this.itemsByNickPrice.set(`${cleanNick}_${priceKey}`, otcItem);
        }
        addedCount++;
      }

      return addedCount > 0;
    } catch (e) {
      console.warn('[Bybit P2P] Failed to process intercepted data:', e);
      return false;
    }
  }

  public findItem(cleanNick: string, priceKey?: string): BybitOtcItem | undefined {
    if (priceKey) {
      const item = this.itemsByNickPrice.get(`${cleanNick}_${priceKey}`);
      if (item) return item;
    }
    return this.itemsByNick.get(cleanNick);
  }

  public clear(): void {
    this.itemsByNick.clear();
    this.itemsByNickPrice.clear();
  }
}

export const otcStore = new OtcStore();
