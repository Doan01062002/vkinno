import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  /** Mô tả ngắn dưới tiêu đề. */
  description?: ReactNode;
  /** Nút thao tác bên phải (vd. "Tạo đơn"). */
  actions?: ReactNode;
}

/** Tiêu đề đầu mỗi màn hình. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
