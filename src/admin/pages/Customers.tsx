import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { formatNumber, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';
import { CustomerFormDialog } from './customers/CustomerFormDialog';
import { PRICE_TIER_LABELS, type CustomerRow } from './customers/types';

const COLUMNS: Column<CustomerRow>[] = [
  {
    key: 'name',
    header: 'Khách hàng',
    cell: (c) => (
      <div>
        <p className="font-medium text-fg">{c.name}</p>
        {c.company_name && <p className="text-xs text-muted">{c.company_name}</p>}
      </div>
    ),
  },
  { key: 'phone', header: 'SĐT' },
  { key: 'type', header: 'Loại', cell: (c) => (c.type === 'B2B' ? 'Sỉ' : 'Lẻ') },
  { key: 'price_tier', header: 'Bảng giá', cell: (c) => PRICE_TIER_LABELS[c.price_tier] ?? c.price_tier },
  { key: 'order_count', header: 'Số đơn', align: 'right', cell: (c) => formatNumber(c.order_count) },
  { key: 'total_spent_vnd', header: 'Tổng chi tiêu', align: 'right', cell: (c) => formatVnd(c.total_spent_vnd) },
];

/** Danh sách khách hàng: lọc lẻ/sỉ, tìm theo tên, SĐT, công ty, email. */
export function Customers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = useListQuery<CustomerRow>('/customers', { q, type, page, page_size: 50 });

  return (
    <>
      <PageHeader title="Khách hàng" description="Khách lẻ và khách sỉ (B2B), kèm tổng chi tiêu." />
      <DataTable
        columns={COLUMNS}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(c) => navigate(`/khach-hang/${c.id}`)}
        search={{
          value: q,
          placeholder: 'Tìm tên, SĐT, công ty hoặc email',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <select
            aria-label="Loại khách"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} sm:w-40`}
          >
            <option value="">Mọi loại</option>
            <option value="RETAIL">Khách lẻ</option>
            <option value="B2B">Khách sỉ</option>
          </select>
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            Thêm khách hàng
          </Button>
        }
        empty="Chưa có khách hàng nào"
      />
      <CustomerFormDialog
        open={creating}
        customer={null}
        onClose={() => setCreating(false)}
        onSaved={(c) => navigate(`/khach-hang/${c.id}`)}
      />
    </>
  );
}
