import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { Field, inputClass } from '../components/Field';
import { MoneyInput } from '../components/MoneyInput';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch, fieldErrors } from '../lib/api';
import { useMe } from '../lib/auth';
import { formatNumber, formatVnd } from '../lib/format';
import { BomEditor, type BomRow } from './products/BomEditor';
import { ImageUploader } from './products/ImageUploader';

interface ProductDetail {
  sku: string;
  name: string;
  slug: string;
  price_vnd: number;
  listed_price_vnd: number;
  wholesale_price_vnd: number | null;
  unit: string;
  category: string;
  min_stock: number;
  shelf_label: string;
  is_active: number;
  is_combo: number;
  image_url: string;
  gallery_json: string;
  description: string;
  batch_code: string;
  expiry_date: string;
  stock_qty: number;
  reserved_qty: number;
  available: number;
  /** Chỉ có khi người xem là ADMIN. */
  cost_avg_vnd?: number;
  bom: BomRow[];
}

interface FormValues {
  sku: string;
  name: string;
  slug: string;
  price_vnd: number | null;
  listed_price_vnd: number | null;
  wholesale_price_vnd: number | null;
  unit: string;
  category: string;
  min_stock: number;
  shelf_label: string;
  is_active: boolean;
  is_combo: boolean;
  image_url: string;
  gallery: string;
  description: string;
  batch_code: string;
  expiry_date: string;
}

const EMPTY: FormValues = {
  sku: '',
  name: '',
  slug: '',
  price_vnd: null,
  listed_price_vnd: null,
  wholesale_price_vnd: null,
  unit: 'chai',
  category: '',
  min_stock: 10,
  shelf_label: '',
  is_active: true,
  is_combo: false,
  image_url: '',
  gallery: '',
  description: '',
  batch_code: '',
  expiry_date: '',
};

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseGallery(json: string): string {
  try {
    const arr: unknown = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').join('\n') : '';
  } catch {
    return '';
  }
}

const toValues = (p: ProductDetail): FormValues => ({
  sku: p.sku,
  name: p.name,
  slug: p.slug,
  price_vnd: p.price_vnd,
  listed_price_vnd: p.listed_price_vnd,
  wholesale_price_vnd: p.wholesale_price_vnd,
  unit: p.unit,
  category: p.category,
  min_stock: p.min_stock,
  shelf_label: p.shelf_label,
  is_active: p.is_active === 1,
  is_combo: p.is_combo === 1,
  image_url: p.image_url,
  gallery: parseGallery(p.gallery_json),
  description: p.description,
  batch_code: p.batch_code,
  expiry_date: p.expiry_date,
});

function toBody(v: FormValues, creating: boolean) {
  const gallery = v.gallery
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ...(creating ? { sku: v.sku.trim() } : {}),
    name: v.name.trim(),
    slug: v.slug.trim(),
    price_vnd: v.price_vnd,
    listed_price_vnd: v.listed_price_vnd,
    wholesale_price_vnd: v.wholesale_price_vnd,
    unit: v.unit.trim(),
    category: v.category.trim(),
    min_stock: v.min_stock,
    shelf_label: v.shelf_label.trim(),
    is_active: v.is_active ? 1 : 0,
    is_combo: v.is_combo ? 1 : 0,
    image_url: v.image_url.trim(),
    gallery_json: JSON.stringify(gallery),
    description: v.description,
    batch_code: v.batch_code.trim(),
    expiry_date: v.expiry_date,
  };
}

const needMoney = (v: number | null) => (v === null || v < 0 ? 'Vui lòng nhập số tiền.' : true);

function ProductForm({ product }: { product?: ProductDetail }) {
  const creating = !product;
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = useMe();
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getFieldState,
    setError,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: product ? toValues(product) : EMPTY });

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      creating
        ? apiFetch<ProductDetail>('/products', { method: 'POST', json: toBody(v, true) })
        : apiFetch<ProductDetail>(`/products/${encodeURIComponent(product.sku)}`, {
            method: 'PUT',
            json: toBody(v, false),
          }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['/products'] });
      void qc.invalidateQueries({ queryKey: ['/inventory'] });
      toast.success(creating ? 'Đã thêm sản phẩm.' : 'Đã lưu sản phẩm.');
      if (creating) navigate(saved.is_combo ? `/san-pham/${encodeURIComponent(saved.sku)}` : '/san-pham');
      else reset(toValues(saved));
    },
    onError: (e, v) => {
      const fe = fieldErrors(e);
      Object.entries(fe).forEach(([k, message]) => {
        const name = k === 'gallery_json' ? 'gallery' : k;
        if (name in EMPTY) setError(name as keyof FormValues, { message });
      });
      if (e instanceof ApiClientError && e.status === 0) {
        toast.error(e, { action: { label: 'Thử lại', onClick: () => save.mutate(v) } });
      } else toast.error(e);
    },
  });

  const imageUrl = watch('image_url');
  const isCombo = watch('is_combo');
  const showCost = isAdmin && product?.cost_avg_vnd !== undefined;

  return (
    <>
      <PageHeader
        title={creating ? 'Thêm sản phẩm' : product.name}
        description={creating ? undefined : `SKU ${product.sku}`}
        actions={
          <Link to="/san-pham" className={buttonClass('secondary')}>
            Quay lại danh sách
          </Link>
        }
      />
      <div className="space-y-4">
        <form
          noValidate
          onSubmit={handleSubmit((v) => save.mutate(v))}
          className="space-y-4 rounded-xl border border-line bg-surface p-4"
          aria-label="Thông tin sản phẩm"
        >
          {!creating && (
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-subtle p-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Tồn thực tế</dt>
                <dd className="font-medium text-fg">{formatNumber(product.stock_qty)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Đang giữ</dt>
                <dd className="font-medium text-fg">{formatNumber(product.reserved_qty)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Có thể bán</dt>
                <dd className="font-medium text-fg">{formatNumber(product.available)}</dd>
              </div>
              {showCost && (
                <div>
                  <dt className="text-xs text-muted">Giá vốn bình quân</dt>
                  <dd className="font-medium text-fg">{formatVnd(product.cost_avg_vnd)}</dd>
                </div>
              )}
            </dl>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SKU" htmlFor="p-sku" required error={errors.sku?.message}>
              <input
                id="p-sku"
                readOnly={!creating}
                className={inputClass}
                aria-invalid={errors.sku ? true : undefined}
                {...register('sku', {
                  validate: (v) => !creating || /^[A-Z0-9-]{3,60}$/.test(v.trim()) || 'SKU gồm chữ in hoa, số, dấu gạch ngang (3-60 ký tự).',
                  onChange: (e) => setValue('sku', e.target.value.toUpperCase(), { shouldValidate: !!errors.sku }),
                })}
              />
            </Field>
            <Field label="Tên sản phẩm" htmlFor="p-name" required error={errors.name?.message}>
              <input
                id="p-name"
                className={inputClass}
                aria-invalid={errors.name ? true : undefined}
                {...register('name', {
                  required: 'Vui lòng nhập tên sản phẩm.',
                  onChange: (e) => {
                    if (creating && !getFieldState('slug').isDirty) {
                      setValue('slug', slugify(e.target.value), { shouldValidate: false });
                    }
                  },
                })}
              />
            </Field>
            <Field
              label="Slug (đường dẫn)"
              htmlFor="p-slug"
              required
              error={errors.slug?.message}
              hint="Chữ thường, số, dấu gạch ngang."
            >
              <input
                id="p-slug"
                className={inputClass}
                aria-invalid={errors.slug ? true : undefined}
                {...register('slug', {
                  required: 'Vui lòng nhập slug.',
                  pattern: { value: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, message: 'Slug chỉ gồm chữ thường, số, dấu gạch ngang.' },
                })}
              />
            </Field>
            <Field label="Danh mục" htmlFor="p-category" error={errors.category?.message}>
              <input id="p-category" className={inputClass} {...register('category')} />
            </Field>
            <Field label="Giá bán lẻ" htmlFor="p-price" required error={errors.price_vnd?.message}>
              <Controller
                name="price_vnd"
                control={control}
                rules={{ validate: needMoney }}
                render={({ field }) => <MoneyInput {...field} id="p-price" invalid={!!errors.price_vnd} />}
              />
            </Field>
            <Field label="Giá niêm yết" htmlFor="p-listed" required error={errors.listed_price_vnd?.message}>
              <Controller
                name="listed_price_vnd"
                control={control}
                rules={{ validate: needMoney }}
                render={({ field }) => <MoneyInput {...field} id="p-listed" invalid={!!errors.listed_price_vnd} />}
              />
            </Field>
            <Field
              label="Giá sỉ"
              htmlFor="p-wholesale"
              error={errors.wholesale_price_vnd?.message}
              hint="Để trống nếu dùng giá bán lẻ."
            >
              <Controller
                name="wholesale_price_vnd"
                control={control}
                render={({ field }) => <MoneyInput {...field} id="p-wholesale" invalid={!!errors.wholesale_price_vnd} />}
              />
            </Field>
            <Field label="Đơn vị tính" htmlFor="p-unit" required error={errors.unit?.message}>
              <input id="p-unit" className={inputClass} {...register('unit', { required: 'Vui lòng nhập đơn vị tính.' })} />
            </Field>
            <Field
              label="Tồn tối thiểu"
              htmlFor="p-min"
              error={errors.min_stock?.message}
              hint="Cảnh báo sắp hết hàng khi số có thể bán thấp hơn mức này."
            >
              <input
                id="p-min"
                type="number"
                min={0}
                step={1}
                className={inputClass}
                {...register('min_stock', {
                  valueAsNumber: true,
                  validate: (v) => (Number.isInteger(v) && v >= 0) || 'Tồn tối thiểu phải là số nguyên từ 0.',
                })}
              />
            </Field>
            <Field label="Vị trí kệ" htmlFor="p-shelf" error={errors.shelf_label?.message}>
              <input id="p-shelf" className={inputClass} {...register('shelf_label')} />
            </Field>
            <Field label="Mã lô" htmlFor="p-batch" error={errors.batch_code?.message}>
              <input id="p-batch" className={inputClass} {...register('batch_code')} />
            </Field>
            <Field label="Hạn sử dụng" htmlFor="p-expiry" error={errors.expiry_date?.message}>
              <input id="p-expiry" type="date" className={inputClass} {...register('expiry_date')} />
            </Field>
          </div>

          <Field label="Mô tả" htmlFor="p-desc" error={errors.description?.message}>
            <textarea id="p-desc" rows={4} className={inputClass} {...register('description')} />
          </Field>

          <Field label="Ảnh sản phẩm" error={errors.image_url?.message}>
            <ImageUploader value={imageUrl} onChange={(url) => setValue('image_url', url, { shouldDirty: true })} />
          </Field>
          <Field
            label="Ảnh phụ"
            htmlFor="p-gallery"
            error={errors.gallery?.message}
            hint="Mỗi dòng một đường dẫn ảnh."
          >
            <textarea id="p-gallery" rows={3} className={inputClass} {...register('gallery')} />
          </Field>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" {...register('is_active')} />
              Đang bán
            </label>
            <div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" {...register('is_combo')} />
                Sản phẩm combo
              </label>
              {errors.is_combo?.message && (
                <p className="mt-1 text-xs text-danger" role="alert">
                  {errors.is_combo.message}
                </p>
              )}
            </div>
          </div>
          {creating && isCombo && (
            <p className="text-xs text-muted">Lưu sản phẩm trước, sau đó khai báo thành phần combo ở trang sửa.</p>
          )}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="submit" loading={save.isPending} disabled={save.isPending}>
              {creating ? 'Thêm sản phẩm' : 'Lưu thay đổi'}
            </Button>
          </div>
        </form>

        {!creating && product.is_combo === 1 && (
          <BomEditor key={JSON.stringify(product.bom)} sku={product.sku} initial={product.bom} />
        )}
      </div>
    </>
  );
}

/** Thêm (`/san-pham/moi`) hoặc sửa (`/san-pham/:sku`) sản phẩm. */
export function ProductEdit() {
  const { sku } = useParams();
  const query = useQuery({
    queryKey: ['/products', 'detail', sku],
    enabled: !!sku && sku !== 'moi',
    queryFn: () => apiFetch<ProductDetail>(`/products/${encodeURIComponent(sku as string)}`),
  });

  if (!sku || sku === 'moi') return <ProductForm />;
  if (query.isPending) return <p className="text-sm text-muted">Đang tải…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {query.error instanceof ApiClientError ? query.error.message : 'Không tải được sản phẩm.'}
      </p>
    );
  }
  return <ProductForm key={sku} product={query.data} />;
}
