import { createContext, useContext } from 'react';
import type { Locale } from '../shared/types';
export const LocaleContext = createContext<Locale>('zh');
export function useT() {
  const locale = useContext(LocaleContext);
  return (zh: string, en: string) => (locale === 'zh' ? zh : en);
}
