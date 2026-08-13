import enRaw from './en.json';
import zhRaw from './zh-CN.json';

export type MessageKey = keyof typeof enRaw;
export type StudioLanguage = 'en' | 'zh-CN';

const zhRecord = zhRaw as Partial<Record<MessageKey, string>>;
const zhCN = Object.fromEntries(
  (Object.keys(enRaw) as MessageKey[]).map((k) => [k, zhRecord[k] ?? enRaw[k]]),
) as Record<MessageKey, string>;

export const messages: Record<StudioLanguage, Record<MessageKey, string>> = {
  en: enRaw,
  'zh-CN': zhCN,
};
