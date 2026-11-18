import type { Settings } from './settings';

export type MessageType = 'GET_STATUS' | 'UPDATE_SETTINGS';

export interface GetStatusMessage {
  type: 'GET_STATUS';
}

export interface GetStatusResponse {
  enabled: boolean;
  keywords: string[];
}

export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  settings: Partial<Settings>;
}

export interface UpdateSettingsResponse {
  success: boolean;
}

export type ExtensionRuntimeMessage = GetStatusMessage | UpdateSettingsMessage;

// Window events for communication between MAIN world and ISOLATED world
export const WINDOW_EVENT_DATA = '__BYBIT_P2P_DATA_EVENT__';
export const WINDOW_EVENT_REQUEST_CACHE = '__BYBIT_REQUEST_LAST_DATA__';
export const WINDOW_EVENT_SELECT_PAYMENT = '__BYBIT_SELECT_PAYMENT__';
export const POST_MESSAGE_TYPE_DATA = '__BYBIT_P2P_DATA__';

export interface WindowDataEventDetail {
  text: string;
  url: string;
}
