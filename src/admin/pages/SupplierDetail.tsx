import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { DOC_TYPE_LABELS, type DocType } from './kho/labels';
import { SupplierFormDialog, type SupplierRow } from './suppliers/SupplierFormDialog';

interface SupplierDoc {
  id: number;
  code: string;
  type: DocType;
  status: string;
  note: string;
  line_count: number;
  created_at: string;
  posted_at: string | null;
}

const COLUMNS: Column<SupplierDoc>[] = [
  { key: 'code', header: 'Mã phiếu', cell: (d) => <span className="font-medium text-fg">{d.code}</span> },
  { key: 'type', header: 'Loại', cell: (d) => DOC_TYPE_LABELS[d.type] ?? d.type },
  { key: 'status', header: 'Trạng thái', cell: (d) => <StatusBadge kind="doc" value={d.status} /> },
  { key: 'line_count', header: 'Số dòng', align: 'right' },
  { key: 'note', header: 'Ghi chú', cell: (d) => d.note || '—' },
  { key: 'created_at', header: 'Ngày tạo', cell: (d) => formatDate(d.created_at, { time: true }) },
  { key: 'posted_at', header: 'Ghi sổ lúc', cell: (d) => (d.posted_at ? formatDate(d.posted_at, { time: true }) : '—') },
];

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-fg">{children || '—'}</dd>
    </div>
  );
}

/** Chi tiết nhà cung cấp và các phiếu nhập kho của nhà cung cấp đó. */
export function SupplierDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(1);
  const supplier = useQuery({
    queryKey: ['/suppliers', 'detail', id],
    queryFn: () => apiFetch<SupplierRow>(`/suppliers/${id}`),
  });
  const docs = useListQuery<SupplierDoc>(`/suppliers/${id}/stock-docs`, { page, page_size: 20 });

  if (supplier.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (supplier.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        Không tải được nhà cung cấp.{' '}
        <Link to="/nha-cung-cap" className="underline">
          Quay lại danh sách
        </Link>
      </p>
    );
  }
  const s = supplier.data;
  return (
    <>
      <PageHeader
        title={s.name}
        description={s.is_active === 1 ? 'Đang hợp tác' : 'Ngừng hợp tác'}
        actions={
          <>
            <Link to="/nha-cung-cap" className={buttonClass('secondary')}>
              Quay lại danh sách
            </Link>
            <Button onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden />
              Sửa
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        <section aria-label="Thông tin nhà cung cấp" className="rounded-xl border border-line bg-surface p-4">
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Số điện thoại">{s.phone}</Info>
            <Info label="Email">{s.email}</Info>
            <Info label="Mã số thuế">{s.tax_code}</Info>
            <Info label="Địa chỉ">{s.address}</Info>
            <Info label="Ghi chú">{s.note}</Info>
          </dl>
        </section>
        <section aria-label="Phiếu nhập của nhà cung cấp" className="space-y-3">
          <h2 className="text-sm font-semibold text-fg">Phiếu nhập kho</h2>
          <DataTable
            columns={COLUMNS}
            {...listProps(docs.data)}
            page={page}
            pageSize={20}
            loading={docs.isFetching}
            onPageChange={setPage}
            onRowClick={(d) => navigate(`/kho/phieu/${d.id}`)}
            empty="Chưa có phiếu nhập nào từ nhà cung cấp này"
          />
        </section>
      </div>
      <SupplierFormDialog open={editing} supplier={s} onClose={() => setEditing(false)} />
    </>
  );
}
