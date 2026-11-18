export interface BybitOtcItem {
  id: string;
  nickName: string;
  price: string;
  minAmount: string;
  maxAmount: string;
  quantity: string;
  remark: string;
  payments: string[];
}

export interface RawOtcApiResponse {
  ret_code?: number;
  ret_msg?: string;
  result?: {
    items?: any[];
    data?: any[];
    [key: string]: any;
  } | any[];
  data?: {
    items?: any[];
    data?: any[];
    [key: string]: any;
  } | any[];
  items?: any[];
  [key: string]: any;
}
