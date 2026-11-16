import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, buttonClass } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field, inputClass } from '../components/Field';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { ApiClientError, apiFetch, errorMessage } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { BLOG_SKUS, PostStatusBadge, parseList, type PostDetail, type PostStatus } from './blog/types';

interface FormState {
  title: string;
  slug: string;
  seo_title: string;
  meta_description: string;
  summary: string;
  content_html: string;
  faq: { q: string; a: string }[];
  image_url: string;
  image_alt: string;
  primary_keyword: string;
  related_skus: string[];
}

function toForm(p: PostDetail): FormState {
  return {
    title: p.title,
    slug: p.slug,
    seo_title: p.seo_title,
    meta_description: p.meta_description,
    summary: p.summary,
    content_html: p.content_html,
    faq: parseList<{ q: string; a: string }>(p.faq_json),
    image_url: p.image_url,
    image_alt: p.image_alt,
    primary_keyword: p.primary_keyword,
    related_skus: parseList<string>(p.related_skus_json),
  };
}

/** Bộ đếm ký tự: xanh trong khoảng khuyến nghị, cam ngoài khoảng. */
function Counter({ value, min, max }: { value: string; min: number; max: number }) {
  const n = value.trim().length;
  const ok = n >= min && n <= max;
  return (
    <span className={`tabular-nums ${ok ? 'text-success' : 'text-warning'}`}>
      {n} ký tự (nên {min}–{max})
    </span>
  );
}

/** Xem trước cách Google hiển thị kết quả. */
function SerpPreview({ form }: { form: FormState }) {
  const title = form.seo_title || form.title;
  const full = /vkinno/i.test(title) ? title : `${title} | VKINNO`;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Xem trước trên Google</p>
      <p className="mt-2 truncate text-xs text-muted">vkinno.vn › cam-nang › {form.slug}</p>
      <p className="mt-0.5 line-clamp-1 text-lg leading-snug text-[#1a0dab]">{full}</p>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{form.meta_description || form.summary}</p>
    </div>
  );
}

/** Sửa một bài cẩm nang: nội dung, SEO, FAQ, kiểm tra chất lượng, đăng/gỡ/xoá. */
export function BlogPostEdit() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['/blog/posts', id];
  const post = useQuery({ queryKey: key, queryFn: () => apiFetch<PostDetail>(`/blog/posts/${id}`) });
  const [form, setForm] = useState<FormState | null>(null);
  const [forceAsk, setForceAsk] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    if (post.data) setForm(toForm(post.data));
  }, [post.data]);

  const dirty = useMemo(() => post.data && form && JSON.stringify(toForm(post.data)) !== JSON.stringify(form), [post.data, form]);
  const invalidate = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/blog') });

  const save = useMutation({
    mutationFn: (f: FormState) => apiFetch<PostDetail>(`/blog/posts/${id}`, { method: 'PUT', json: f }),
    onSuccess: (p) => {
      qc.setQueryData(key, p);
      invalidate();
      toast.success('Đã lưu bài viết');
    },
    onError: (e) => toast.error(e),
  });

  const setStatus = useMutation({
    mutationFn: async ({ status, force }: { status: PostStatus; force?: boolean }) => {
      if (dirty && form) await apiFetch(`/blog/posts/${id}`, { method: 'PUT', json: form });
      return apiFetch<PostDetail>(`/blog/posts/${id}/status`, { method: 'POST', json: { status, force: Boolean(force) } });
    },
    onSuccess: (_p, v) => {
      setForceAsk(null);
      invalidate();
      toast.success(v.status === 'published' ? 'Đã đăng lên web' : v.status === 'archived' ? 'Đã gỡ khỏi web' : 'Đã đổi trạng thái');
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'QUALITY') {
        setForceAsk(((e.details as { blocking?: string[] }) ?? {}).blocking ?? []);
        return;
      }
      toast.error(e);
    },
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/blog/posts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Đã xoá bài');
      navigate('/bai-viet');
    },
    onError: (e) => toast.error(e),
  });

  if (post.isLoading || (!form && !post.isError)) return <p className="text-sm text-muted">Đang tải…</p>;
  if (post.isError || !post.data || !form)
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {errorMessage(post.error)}
      </p>
    );

  const p = post.data;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const previewUrl = `/cam-nang/${p.slug}${p.status === 'published' ? '' : '?xem-truoc=1'}`;
  const busy = save.isPending || setStatus.isPending;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="/bai-viet" aria-label="Về danh sách bài" className="text-muted hover:text-fg">
              <ArrowLeft size={20} aria-hidden />
            </Link>
            <span className="min-w-0">Sửa bài viết</span>
            <PostStatusBadge status={p.status} />
            {p.origin === 'ai' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Bot size={12} aria-hidden /> {p.ai_model ?? 'AI'}
              </span>
            )}
          </span>
        }
        description={`Tạo ${formatDate(p.created_at)} · cập nhật ${formatDate(p.updated_at)}${p.published_at ? ` · đăng ${formatDate(p.published_at)}` : ''}`}
        actions={
          <>
            <a href={previewUrl} target="_blank" rel="noopener" className={buttonClass('secondary')}>
              <ExternalLink size={16} aria-hidden /> {p.status === 'published' ? 'Xem trên web' : 'Xem trước'}
            </a>
            {p.status === 'published' ? (
              <Button variant="secondary" onClick={() => setStatus.mutate({ status: 'archived' })} loading={setStatus.isPending}>
                Gỡ khỏi web
              </Button>
            ) : (
              <Button onClick={() => setStatus.mutate({ status: 'published' })} loading={setStatus.isPending} disabled={busy}>
                <CheckCircle2 size={16} aria-hidden /> Duyệt & đăng
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
            <Field label="Tiêu đề (H1)" htmlFor="bp-title" required hint={<Counter value={form.title} min={30} max={70} />}>
              <input id="bp-title" className={inputClass} value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={150} required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Từ khoá chính" htmlFor="bp-kw">
                <input id="bp-kw" className={inputClass} value={form.primary_keyword} onChange={(e) => set('primary_keyword', e.target.value)} />
              </Field>
              <Field
                label="Đường dẫn"
                htmlFor="bp-slug"
                hint={p.status === 'published' ? 'Bài đã đăng: đổi đường dẫn sẽ làm link cũ hỏng.' : 'Chữ thường không dấu, nối bằng gạch.'}
              >
                <input id="bp-slug" className={`${inputClass} font-mono`} value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
              </Field>
            </div>
            <Field label="SEO title (thẻ title)" htmlFor="bp-seo" hint={<Counter value={form.seo_title} min={30} max={60} />}>
              <input id="bp-seo" className={inputClass} value={form.seo_title} onChange={(e) => set('seo_title', e.target.value)} maxLength={120} />
            </Field>
            <Field label="Meta description" htmlFor="bp-meta" hint={<Counter value={form.meta_description} min={140} max={160} />}>
              <textarea id="bp-meta" rows={2} className={inputClass} value={form.meta_description} onChange={(e) => set('meta_description', e.target.value)} maxLength={300} />
            </Field>
            <Field label="Sapo (đoạn tóm tắt đầu bài)" htmlFor="bp-sum" hint={<Counter value={form.summary} min={80} max={220} />}>
              <textarea id="bp-sum" rows={2} className={inputClass} value={form.summary} onChange={(e) => set('summary', e.target.value)} maxLength={600} />
            </Field>
          </section>

          <section className="rounded-xl border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <h2 className="text-sm font-semibold text-fg">Nội dung · {formatNumber(p.quality.wordCount)} chữ</h2>
              <div role="tablist" className="flex gap-1 rounded-lg bg-subtle p-0.5 text-xs">
                {(['edit', 'preview'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-md px-3 py-1 font-medium ${tab === t ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
                  >
                    {t === 'edit' ? 'HTML' : 'Xem nhanh'}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'edit' ? (
              <div className="p-4">
                <textarea
                  aria-label="Nội dung HTML"
                  rows={22}
                  spellCheck={false}
                  className={`${inputClass} font-mono text-xs leading-relaxed`}
                  value={form.content_html}
                  onChange={(e) => set('content_html', e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted">Thẻ cho phép: p, h2, h3, ul, ol, li, strong, em, a, table, blockquote. Thẻ khác tự bị lọc khi lưu.</p>
              </div>
            ) : (
              <div
                className="prose-admin max-h-[38rem] overflow-y-auto p-5 text-sm leading-relaxed text-fg [&_a]:text-primary [&_a]:underline [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mt-2 [&_table]:mt-3 [&_td]:border [&_td]:border-line [&_td]:p-1.5 [&_th]:border [&_th]:border-line [&_th]:bg-subtle [&_th]:p-1.5 [&_ul]:list-disc"
                // Nội dung đã qua bộ lọc thẻ ở máy chủ (sanitizeArticleHtml) khi lưu.
                dangerouslySetInnerHTML={{ __html: p.content_html }}
              />
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-fg">Câu hỏi thường gặp (FAQ) · {form.faq.length}</h2>
              <Button size="sm" variant="secondary" onClick={() => set('faq', [...form.faq, { q: '', a: '' }])} disabled={form.faq.length >= 10}>
                <Plus size={14} aria-hidden /> Thêm câu
              </Button>
            </div>
            {form.faq.map((f, i) => (
              <div key={i} className="grid gap-2 rounded-lg bg-subtle p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <input
                    aria-label={`Câu hỏi ${i + 1}`}
                    className={inputClass}
                    placeholder="Câu hỏi"
                    value={f.q}
                    onChange={(e) => set('faq', form.faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))}
                  />
                  <textarea
                    aria-label={`Trả lời ${i + 1}`}
                    rows={2}
                    className={inputClass}
                    placeholder="Trả lời 1–3 câu"
                    value={f.a}
                    onChange={(e) => set('faq', form.faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))}
                  />
                </div>
                <Button size="sm" variant="ghost" aria-label={`Xoá câu ${i + 1}`} onClick={() => set('faq', form.faq.filter((_, j) => j !== i))}>
                  <X size={14} aria-hidden />
                </Button>
              </div>
            ))}
          </section>

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
            <Button type="submit" loading={save.isPending} disabled={!dirty || setStatus.isPending}>
              Lưu thay đổi
            </Button>
            {dirty && <span className="text-xs text-warning">Có thay đổi chưa lưu</span>}
            <span className="flex-1" />
            {p.status !== 'published' && (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 size={16} aria-hidden /> Xoá bài
              </Button>
            )}
          </div>
        </form>

        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">Kiểm tra chất lượng</h2>
            {p.quality.blocking.length === 0 && p.quality.warnings.length === 0 && (
              <p className="mt-2 flex items-center gap-2 text-sm text-success">
                <CheckCircle2 size={16} aria-hidden /> Đạt mọi tiêu chí tự động.
              </p>
            )}
            {p.quality.blocking.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {p.quality.blocking.map((b) => (
                  <li key={b} className="flex gap-2 text-sm text-danger">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {b}
                  </li>
                ))}
              </ul>
            )}
            {p.quality.warnings.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {p.quality.warnings.map((w) => (
                  <li key={w} className="text-sm text-warning">
                    • {w}
                  </li>
                ))}
              </ul>
            )}
            {p.origin === 'ai' && (
              <p className="mt-3 rounded-lg bg-subtle px-3 py-2 text-xs leading-relaxed text-muted">
                Trước khi đăng, đọc kỹ: tỷ lệ pha, thời gian ủ, bề mặt không dùng được và mọi con số. AI có thể viết sai dù văn trôi chảy.
              </p>
            )}
            <p className="mt-2 text-xs text-muted">Kết quả kiểm tra theo bản đã lưu.</p>
          </section>

          <SerpPreview form={form} />

          <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-fg">Ảnh & sản phẩm</h2>
            {form.image_url && <img src={form.image_url} alt="" className="aspect-[16/9] w-full rounded-lg border border-line object-cover" />}
            <Field label="Đường dẫn ảnh" htmlFor="bp-img">
              <input id="bp-img" className={inputClass} value={form.image_url} onChange={(e) => set('image_url', e.target.value)} />
            </Field>
            <Field label="Mô tả ảnh (alt)" htmlFor="bp-alt">
              <input id="bp-alt" className={inputClass} value={form.image_alt} onChange={(e) => set('image_alt', e.target.value)} />
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-fg">Sản phẩm hiện cạnh bài</legend>
              {BLOG_SKUS.map((s) => (
                <label key={s.sku} className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="checkbox"
                    checked={form.related_skus.includes(s.sku)}
                    onChange={(e) =>
                      set('related_skus', e.target.checked ? [...form.related_skus, s.sku].slice(0, 6) : form.related_skus.filter((x) => x !== s.sku))
                    }
                  />
                  {s.label}
                </label>
              ))}
            </fieldset>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(forceAsk)}
        title="Bài chưa đạt kiểm tra — vẫn đăng?"
        message={
          <span className="block space-y-2">
            <span className="block">Bài còn các lỗi sau. Nên sửa trước khi đăng:</span>
            <span className="block text-danger">{(forceAsk ?? []).join(' ')}</span>
          </span>
        }
        confirmLabel="Vẫn đăng"
        danger
        busy={setStatus.isPending}
        onConfirm={() => setStatus.mutate({ status: 'published', force: true })}
        onCancel={() => setForceAsk(null)}
      />
      <ConfirmDialog
        open={deleting}
        title="Xoá bài viết?"
        message={`Xoá vĩnh viễn "${p.title}". Không hoàn tác được.`}
        confirmLabel="Xoá"
        danger
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDeleting(false)}
      />
    </>
  );
}
