import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export type SettingsMap = Record<string, unknown>;

/** Khoá cache chung của /settings; `useCompany` dùng khoá con nên invalidate theo tiền tố này là đủ. */
export const SETTINGS_KEY = '/settings';

export function useSettings(enabled = true) {
  return useQuery({ queryKey: [SETTINGS_KEY], enabled, queryFn: () => apiFetch<SettingsMap>('/settings') });
}

export const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
