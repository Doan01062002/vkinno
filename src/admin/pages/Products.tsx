import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { buttonClass } from '../components/Button';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useMe } from '../lib/auth';
import { formatNumber, formatVnd } from '../lib/format';
import { useListQuery } from '../lib/queries';

export interface ProductRow {
  sku: string;
  name: string;
  unit: string;
  category: string;
  price_vnd: number;
  wholesale_price_vnd: number | null;
  stock_qty: number;
  cost_avg_vnd?: number;
  is_active: number;
  is_combo: number;
  image_url: string;
}

/** Danh sách sản phẩm: tìm theo tên/SKU, lọc đang bán/ngừng bán; bấm dòng để sửa. */
export function Products() {
  const navigate = useNavigate();
  const { isAdmin } = useMe();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState('');
  const query = useListQuery<ProductRow>('/products', { q, page, page_size: 50, is_active: active });

  const showCost = isAdmin && (query.data?.items ?? []).some((p) => p.cost_avg_vnd !== undefined);
  const columns: Column<ProductRow>[] = [
    {
      key: 'name',
      header: 'Sản phẩm',
      cell: (p) => (
        <div className="flex items-center gap-3">
          {p.image_url ? (
            <img src={p.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg border border-line bg-subtle" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="line-clamp-2 font-medium break-words text-fg">{p.name}</p>
            <p className="text-xs text-muted">
              {p.sku}
              {p.is_combo ? ' · Combo' : ''}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'category', header: 'Danh mục', cell: (p) => p.category || '—' },
    { key: 'price_vnd', header: 'Giá bán', align: 'right', cell: (p) => formatVnd(p.price_vnd) },
    {
      key: 'wholesale_price_vnd',
      header: 'Giá sỉ',
      align: 'right',
      cell: (p) => (p.wholesale_price_vnd == null ? '—' : formatVnd(p.wholesale_price_vnd)),
    },
    ...(showCost
      ? [
          {
            key: 'cost_avg_vnd',
            header: 'Giá vốn BQ',
            align: 'right' as const,
            cell: (p: ProductRow) => (p.cost_avg_vnd === undefined ? '—' : formatVnd(p.cost_avg_vnd)),
          },
        ]
      : []),
    { key: 'stock_qty', header: 'Tồn', align: 'right', cell: (p) => `${formatNumber(p.stock_qty)} ${p.unit}` },
    {
      key: 'is_active',
      header: 'Trạng thái',
      cell: (p) => (
        <span className={p.is_active ? 'text-success' : 'text-muted'}>{p.is_active ? 'Đang bán' : 'Ngừng bán'}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Sản phẩm" description="Danh mục sản phẩm, giá bán và combo." />
      <DataTable
        columns={columns}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        rowKey={(p) => p.sku}
        onPageChange={setPage}
        onRowClick={(p) => navigate(`/san-pham/${encodeURIComponent(p.sku)}`)}
        search={{
          value: q,
          placeholder: 'Tìm theo tên hoặc SKU',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <select
            aria-label="Trạng thái bán"
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} sm:w-40`}
          >
            <option value="">Tất cả</option>
            <option value="1">Đang bán</option>
            <option value="0">Ngừng bán</option>
          </select>
        }
        actions={
          <Link to="/san-pham/moi" className={buttonClass('primary')}>
            <Plus size={16} aria-hidden />
            Thêm sản phẩm
          </Link>
        }
        empty="Chưa có sản phẩm nào"
      />
    </>
  );
}
