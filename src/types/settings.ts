export type HighlightColor = 'emerald' | 'amber' | 'cyan' | 'violet';

export interface Settings {
  enabled: boolean;
  keywords: string[];
  highlightColor: HighlightColor;
  [key: string]: any;
}
