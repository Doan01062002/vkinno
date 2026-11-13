import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { PageHeader } from '../components/PageHeader';
import { ProductPicker, type PriceTier } from '../components/ProductPicker';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch, fieldErrors, type ListResult } from '../lib/api';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { canEditQuote } from '../lib/quoteFlow';
import { useDebounced } from '../lib/useDebounced';
import type { CustomerRow } from './customers/types';
import { QuoteActions } from './quotes/QuoteActions';
import { QuotePrintSection } from './quotes/QuotePrintSection';
import { quoteKey, type QuoteDetailData } from './quotes/types';

interface Line {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number | null;
}

interface FormProps {
  quote: QuoteDetailData | null;
  /** Khách của báo giá đã lưu (để biết bảng giá). */
  savedCustomer: CustomerRow | null;
}

/** Biểu mẫu soạn báo giá. Báo giá đã chốt (không còn DRAFT/SENT) chỉ xem. */
function QuoteForm({ quote, savedCustomer }: FormProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const editable = !quote || canEditQuote(quote.status);

  const [customer, setCustomer] = useState<CustomerRow | null>(savedCustomer);
  const [search, setSearch] = useState('');
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? '');
  const [lines, setLines] = useState<Line[]>(
    quote?.items.map((i) => ({ sku: i.sku, name: i.product_name, quantity: i.quantity, unitPrice: i.unit_price })) ?? [],
  );
  const [discount, setDiscount] = useState<number | null>(quote?.discount_vnd ?? 0);
  const [shippingFee, setShippingFee] = useState<number | null>(quote?.shipping_fee_vnd ?? 0);
  const [note, setNote] = useState(quote?.note ?? '');
  const [printing, setPrinting] = useState(false);
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const debounced = useDebounced(search.trim(), 300);
  const customers = useQuery({
    queryKey: ['/customers', 'quote-picker', debounced],
    enabled: editable,
    queryFn: () =>
      apiFetch<ListResult<CustomerRow>>('/customers', { query: { type: 'B2B', q: debounced, page_size: 20 } }),
  });
  const found = customers.data?.items ?? [];
  const options = customer && !found.some((c) => c.id === customer.id) ? [customer, ...found] : found;

  const tier: PriceTier = customer?.price_tier ?? 'RETAIL';
  const subtotal = lines.reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0);
  const total = subtotal - (discount ?? 0) + (shippingFee ?? 0);

  const buildBody = () => ({
    customer_id: customer?.id ?? 0,
    valid_until: validUntil || null,
    discount_vnd: discount ?? 0,
    shipping_fee_vnd: shippingFee ?? 0,
    note: note.trim(),
    items: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price: l.unitPrice ?? 0 })),
  });
  const initialJson = useRef(JSON.stringify(buildBody()));
  const dirty = !!quote && JSON.stringify(buildBody()) !== initialJson.current;

  const addLine = (sku: string, qty: number, p: { name: string; unit_price_vnd: number }) =>
    setLines((cur) =>
      cur.some((l) => l.sku === sku)
        ? cur.map((l) => (l.sku === sku ? { ...l, quantity: l.quantity + qty } : l))
        : [...cur, { sku, name: p.name, quantity: qty, unitPrice: p.unit_price_vnd }],
    );
  const patchLine = (sku: string, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: (body: unknown) =>
      apiFetch<QuoteDetailData>(quote ? `/quotes/${quote.id}` : '/quotes', { method: quote ? 'PUT' : 'POST', json: body }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['/quotes'] });
      qc.setQueryData(quoteKey(saved.id), saved);
      toast.success(quote ? 'Đã lưu báo giá.' : `Đã tạo báo giá ${saved.code}.`);
      if (!quote) navigate(`/bao-gia/${saved.id}`, { replace: true });
    },
    onError: (e, body) => {
      setErrors(fieldErrors(e));
      setFormError(e instanceof ApiClientError ? e.message : '');
      if (quote) void qc.invalidateQueries({ queryKey: quoteKey(quote.id) });
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate(body) } });
      } else toast.error(e);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!customer) next.customer_id = 'Vui lòng chọn khách hàng.';
    if (lines.length === 0) next.items = 'Báo giá cần ít nhất một sản phẩm.';
    if (lines.some((l) => l.unitPrice === null)) next.items = 'Mỗi dòng cần có đơn giá.';
    if ((discount ?? 0) > subtotal) next.discount_vnd = 'Giảm giá không được lớn hơn tạm tính.';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length > 0) return;
    save.mutate(buildBody());
  };

  const picked = Object.fromEntries(lines.map((l) => [l.sku, l.quantity]));
  const readOnly = !editable;

  return (
    <>
      <PageHeader
        title={
          quote ? (
            <span className="flex flex-wrap items-center gap-3">
              {quote.code}
              <StatusBadge kind="quote" value={quote.status} />
            </span>
          ) : (
            'Tạo báo giá'
          )
        }
        description={quote ? `Tạo ${formatDate(quote.created_at, { time: true })}` : 'Giá mặc định theo bảng giá của khách; có thể sửa từng dòng.'}
        actions={
          <>
            <Link to="/bao-gia" className={buttonClass('secondary')}>
              Quay lại danh sách
            </Link>
            {quote && (
              <Button variant="secondary" onClick={() => setPrinting((v) => !v)}>
                <Printer size={16} aria-hidden />
                In báo giá
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4">
        {quote && <QuoteActions quote={quote} dirty={dirty} />}
        {quote?.status === 'EXPIRED' && (
          <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
            Báo giá đã hết hạn nên không thể sửa, chấp nhận hay chuyển thành đơn. Hãy tạo báo giá mới.
          </p>
        )}
        {printing && quote && <QuotePrintSection quote={quote} customer={customer} />}

        <form onSubmit={submit} noValidate className="space-y-4">
          {formError && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <section aria-label="Khách hàng" className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
            {editable && (
              <Field label="Tìm khách sỉ" htmlFor="quote-cus-search">
                <input
                  id="quote-cus-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tên, SĐT hoặc công ty"
                  className={inputClass}
                />
              </Field>
            )}
            <Field
              label="Khách hàng"
              htmlFor="quote-customer"
              required
              error={errors.customer_id}
              hint={customer ? `Bảng giá: ${customer.price_tier === 'WHOLESALE' ? 'sỉ' : 'lẻ'}` : undefined}
            >
              <select
                id="quote-customer"
                value={customer?.id ?? ''}
                disabled={!editable || save.isPending}
                onChange={(e) => setCustomer(options.find((c) => String(c.id) === e.target.value) ?? null)}
                className={inputClass}
                aria-invalid={errors.customer_id ? true : undefined}
              >
                <option value="">— Chọn khách sỉ —</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name ? `${c.name} · ${c.company_name}` : c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hiệu lực đến" htmlFor="quote-valid" error={errors.valid_until}>
              <input
                id="quote-valid"
                type="date"
                value={validUntil}
                disabled={!editable}
                onChange={(e) => setValidUntil(e.target.value)}
                className={inputClass}
              />
            </Field>
          </section>

          <section aria-label="Sản phẩm" className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">Sản phẩm</h2>
            {errors.items && (
              <p role="alert" className="text-sm text-danger">
                {errors.items}
              </p>
            )}
            {lines.length > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {lines.map((l) => (
                  <li key={l.sku} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-sm font-medium text-fg">{l.name}</p>
                      <p className="text-xs text-muted">{l.sku}</p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      aria-label={`Số lượng ${l.sku}`}
                      value={l.quantity}
                      disabled={readOnly}
                      onChange={(e) => patchLine(l.sku, { quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                      className={`${inputClass} w-24`}
                    />
                    <MoneyInput
                      value={l.unitPrice}
                      disabled={readOnly}
                      onChange={(v) => patchLine(l.sku, { unitPrice: v })}
                      className="w-36"
                      placeholder="Đơn giá"
                    />
                    <span className="w-28 text-right text-sm font-medium text-fg" aria-label={`Thành tiền ${l.sku}`}>
                      {formatVnd(l.quantity * (l.unitPrice ?? 0))}
                    </span>
                    {editable && (
                      <Button variant="ghost" size="sm" aria-label={`Xoá ${l.sku}`} onClick={() => setLines((cur) => cur.filter((x) => x.sku !== l.sku))}>
                        <Trash2 size={16} aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <>
                <ProductPicker priceTier={tier} picked={picked} limitToAvailable={false} disabled={save.isPending} onPick={addLine} />
                {lines.length > 0 && (
                  <p className="text-xs text-muted">Giá các dòng đã thêm giữ nguyên; sản phẩm thêm sau lấy theo bảng giá của khách.</p>
                )}
              </>
            )}
          </section>

          <section aria-label="Tổng tiền" className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
            <Field label="Phí vận chuyển" htmlFor="quote-ship" error={errors.shipping_fee_vnd}>
              <MoneyInput id="quote-ship" value={shippingFee} disabled={readOnly} onChange={setShippingFee} />
            </Field>
            <Field label="Giảm giá" htmlFor="quote-discount" error={errors.discount_vnd}>
              <MoneyInput id="quote-discount" value={discount} disabled={readOnly} onChange={setDiscount} invalid={!!errors.discount_vnd} />
            </Field>
            <Field label="Ghi chú" htmlFor="quote-note" className="sm:col-span-2" error={errors.note}>
              <textarea id="quote-note" rows={2} value={note} disabled={readOnly} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </Field>
            <dl className="space-y-1 text-sm sm:col-span-2 sm:ml-auto sm:w-72">
              <div className="flex justify-between">
                <dt className="text-muted">Tạm tính ({formatNumber(lines.length)} dòng)</dt>
                <dd>{formatVnd(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Giảm giá</dt>
                <dd>{formatVnd(discount ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Phí vận chuyển</dt>
                <dd>{formatVnd(shippingFee ?? 0)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold">
                <dt>Tổng cộng</dt>
                <dd data-testid="total">{formatVnd(total)}</dd>
              </div>
            </dl>
          </section>

          {editable && (
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending} disabled={save.isPending}>
                {quote ? 'Lưu báo giá' : 'Tạo báo giá'}
              </Button>
            </div>
          )}
        </form>
      </div>
    </>
  );
}

/** Tạo mới (`/bao-gia/moi`) hoặc xem/sửa (`/bao-gia/:id`) một báo giá. */
export function QuoteEdit() {
  const { id } = useParams();
  const quote = useQuery({
    queryKey: quoteKey(id ?? ''),
    enabled: !!id,
    queryFn: () => apiFetch<QuoteDetailData>(`/quotes/${id}`),
  });
  const customerId = quote.data?.customer_id ?? null;
  const customer = useQuery({
    queryKey: ['/customers', 'detail', String(customerId)],
    enabled: customerId !== null,
    queryFn: () => apiFetch<CustomerRow>(`/customers/${customerId}`),
  });

  if (!id) return <QuoteForm quote={null} savedCustomer={null} />;
  if (quote.isPending || (customerId !== null && customer.isPending)) return <p className="text-sm text-muted">Đang tải…</p>;
  if (quote.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        Không tải được báo giá.{' '}
        <Link to="/bao-gia" className="underline">
          Quay lại danh sách
        </Link>
      </p>
    );
  }
  // key: nạp lại biểu mẫu khi báo giá đổi (lưu, đổi trạng thái) để phản ánh đúng bản đã lưu.
  return <QuoteForm key={JSON.stringify(quote.data)} quote={quote.data} savedCustomer={customer.data ?? null} />;
}
