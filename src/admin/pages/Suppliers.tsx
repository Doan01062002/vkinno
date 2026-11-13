import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { useListQuery } from '../lib/queries';
import { SupplierFormDialog, type SupplierRow } from './suppliers/SupplierFormDialog';

const COLUMNS: Column<SupplierRow>[] = [
  { key: 'name', header: 'Nhà cung cấp', cell: (s) => <span className="font-medium text-fg">{s.name}</span> },
  { key: 'phone', header: 'SĐT', cell: (s) => s.phone || '—' },
  { key: 'email', header: 'Email', cell: (s) => s.email || '—' },
  { key: 'tax_code', header: 'Mã số thuế', cell: (s) => s.tax_code || '—' },
  { key: 'is_active', header: 'Trạng thái', cell: (s) => (s.is_active === 1 ? 'Đang hợp tác' : 'Ngừng hợp tác') },
];

/** Danh sách nhà cung cấp; bấm dòng để xem phiếu nhập của nhà cung cấp đó. */
export function Suppliers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const query = useListQuery<SupplierRow>('/suppliers', { q, page, page_size: 50 });

  return (
    <>
      <PageHeader title="Nhà cung cấp" description="Nơi nhập hàng, kèm các phiếu nhập kho." />
      <DataTable
        columns={COLUMNS}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(s) => navigate(`/nha-cung-cap/${s.id}`)}
        search={{
          value: q,
          placeholder: 'Tìm tên, SĐT, email hoặc mã số thuế',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            Thêm nhà cung cấp
          </Button>
        }
        empty="Chưa có nhà cung cấp nào"
      />
      <SupplierFormDialog open={creating} supplier={null} onClose={() => setCreating(false)} />
    </>
  );
}
