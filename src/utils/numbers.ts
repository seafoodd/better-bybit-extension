import { escapeRegExp } from './text';

export const NUMBER_SEPARATOR_REGEX = '(?:[\\s\\u00a0\\u202f\\u2000-\\u200b]+|[.,])';

export const NUMBER_REGEX_PATTERN = `(?<!\\d)(?:\\d{1,3}(?:${NUMBER_SEPARATOR_REGEX}\\d{3})+(?:[.,]00)?|\\d{3,}(?:[.,]00)?)(?!\\d)`;

export function cleanNumberString(val: string): string {
  if (!val) return '';
  let s = val.trim();
  // Strip trailing .00 or ,00 (cents/kopecks) if present
  s = s.replace(/[.,]00(?!\d)/, '');
  // Strip all spaces, non-breaking spaces, dots, and commas
  s = s.replace(/[\s\u00a0\u202f\u2000-\u200b.,]/g, '');
  return s;
}

export function buildFullMatchRegex(keywords: string[]): RegExp {
  const escapedKws = keywords.map(escapeRegExp).filter(Boolean);
  const kwPattern = escapedKws.length > 0 ? escapedKws.join('|') : null;

  if (kwPattern) {
    return new RegExp(`(${kwPattern})|(${NUMBER_REGEX_PATTERN})`, 'gi');
  }
  return new RegExp(`()|(${NUMBER_REGEX_PATTERN})`, 'gi');
}
