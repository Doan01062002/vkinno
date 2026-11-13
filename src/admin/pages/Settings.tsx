import { PageHeader } from '../components/PageHeader';
import { errorMessage } from '../lib/api';
import { AuditLogs } from './AuditLogs';
import { BackupPanel } from './settings/BackupPanel';
import { ColumnMaps } from './settings/ColumnMaps';
import { CompanyForm } from './settings/CompanyForm';
import { SettingsTabs } from './settings/SettingsTabs';
import { TelegramForm } from './settings/TelegramForm';
import { useSettings } from './settings/useSettings';
import { Users } from './Users';

export type SettingsTab = 'company' | 'telegram' | 'columns' | 'users' | 'audit' | 'backup';

const TITLES: Record<SettingsTab, string> = {
  company: 'Thông tin công ty và mẫu in',
  telegram: 'Thông báo Telegram',
  columns: 'Ánh xạ cột file sàn',
  users: 'Tài khoản',
  audit: 'Nhật ký thao tác',
  backup: 'Sao lưu dữ liệu',
};

/** Cài đặt (ADMIN): mỗi tab là một route con của /cai-dat. */
export function Settings({ tab }: { tab: SettingsTab }) {
  const needsSettings = tab === 'company' || tab === 'telegram' || tab === 'columns';
  const settings = useSettings(needsSettings);
  return (
    <>
      <PageHeader title="Cài đặt" description={TITLES[tab]} />
      <SettingsTabs />
      {needsSettings && settings.isError && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage(settings.error)}{' '}
          <button type="button" className="underline" onClick={() => void settings.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      {needsSettings && settings.isLoading && <p className="text-sm text-muted">Đang tải…</p>}
      {tab === 'company' && settings.data && <CompanyForm settings={settings.data} />}
      {tab === 'telegram' && settings.data && <TelegramForm settings={settings.data} />}
      {tab === 'columns' && settings.data && <ColumnMaps settings={settings.data} />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <AuditLogs />}
      {tab === 'backup' && <BackupPanel />}
    </>
  );
}
