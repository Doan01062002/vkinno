import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, KeyRound, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable, listProps, type Column } from '../components/DataTable';
import { Field, inputClass } from '../components/Field';
import { FormDialog } from '../components/FormDialog';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { apiFetch, errorMessage } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { useListQuery } from '../lib/queries';
import {
  BLOG_SKUS,
  PostStatusBadge,
  STATUS_META,
  parseList,
  type BlogStatus,
  type PostListRow,
  type PostStatus,
  type RunRow,
  type TopicRow,
} from './blog/types';

export type BlogTab = 'posts' | 'topics' | 'settings';

const TABS = [
  { to: '/bai-viet', label: 'Bài viết', end: true },
  { to: '/bai-viet/chu-de', label: 'Chủ đề chờ viết', end: false },
  { to: '/bai-viet/tu-dong', label: 'Tự viết bằng AI', end: false },
];

const DESCRIPTIONS: Record<BlogTab, string> = {
  posts: 'Cẩm nang trên web (/cam-nang): duyệt bài AI soạn, sửa, đăng hoặc gỡ.',
  topics: 'Hàng đợi từ khoá. Mỗi ngày AI lấy chủ đề ưu tiên cao nhất (số nhỏ trước) để viết 1 bài.',
  settings: 'Gemini viết 1 bài lúc 02:00 mỗi ngày. Mặc định bài vào "Chờ duyệt", người duyệt bấm Đăng.',
};

const STATUS_KEY = ['/blog/status'];

/** Mục Bài viết (ADMIN): 3 tab là 3 route con của /bai-viet. */
export function Blog({ tab }: { tab: BlogTab }) {
  return (
    <>
      <PageHeader title="Bài viết" description={DESCRIPTIONS[tab]} />
      <nav aria-label="Bài viết" className="mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap ${
                isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {tab === 'posts' && <PostsTab />}
      {tab === 'topics' && <TopicsTab />}
      {tab === 'settings' && <AutoTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bài viết
// ---------------------------------------------------------------------------

const POST_COLUMNS: Column<PostListRow>[] = [
  {
    key: 'title',
    header: 'Bài viết',
    cell: (p) => (
      <div className="min-w-0">
        <p className="font-medium text-fg line-clamp-2">{p.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">
          /cam-nang/{p.slug}
          {p.quality_notes.includes('CHẶN') && <span className="ml-2 font-medium text-danger">· chưa đạt kiểm tra</span>}
        </p>
      </div>
    ),
  },
  { key: 'status', header: 'Trạng thái', cell: (p) => <PostStatusBadge status={p.status} /> },
  {
    key: 'origin',
    header: 'Nguồn',
    cell: (p) =>
      p.origin === 'ai' ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Bot size={14} aria-hidden /> AI
        </span>
      ) : (
        <span className="text-xs text-muted">Viết tay</span>
      ),
  },
  { key: 'word_count', header: 'Số chữ', align: 'right', cell: (p) => <span className="tabular-nums">{formatNumber(p.word_count)}</span> },
  { key: 'published_at', header: 'Ngày đăng', cell: (p) => (p.published_at ? formatDate(p.published_at, { time: false }) : '—') },
];

function PostsTab() {
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<PostStatus | ''>('');
  const [page, setPage] = useState(1);
  const query = useListQuery<PostListRow>('/blog/posts', { q, status, page, page_size: 50 });
  const counts = (query.data as unknown as { counts?: Partial<Record<PostStatus, number>> } | undefined)?.counts ?? {};
  const create = useMutation({
    mutationFn: () => apiFetch<{ id: number }>('/blog/posts', { method: 'POST', json: { title: `Bài viết mới ${Date.now() % 100000}` } }),
    onSuccess: (r) => navigate(`/bai-viet/${r.id}`),
    onError: (e) => toast.error(e),
  });

  return (
    <>
      {(counts.review ?? 0) > 0 && status !== 'review' && (
        <button
          type="button"
          onClick={() => {
            setStatus('review');
            setPage(1);
          }}
          className="mb-3 flex w-full items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-left text-sm font-medium text-warning"
        >
          <Sparkles size={16} aria-hidden /> {counts.review} bài AI đang chờ duyệt — bấm để xem
        </button>
      )}
      <DataTable
        columns={POST_COLUMNS}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        onRowClick={(p) => navigate(`/bai-viet/${p.id}`)}
        search={{
          value: q,
          placeholder: 'Tìm tiêu đề hoặc từ khoá',
          onChange: (v) => {
            setQ(v);
            setPage(1);
          },
        }}
        filters={
          <select
            aria-label="Lọc trạng thái"
            className={`${inputClass} w-auto`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PostStatus | '');
              setPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            {(Object.keys(STATUS_META) as PostStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
                {counts[s] ? ` (${counts[s]})` : ''}
              </option>
            ))}
          </select>
        }
        actions={
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            <Plus size={16} aria-hidden /> Viết bài tay
          </Button>
        }
        empty="Chưa có bài viết nào"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Chủ đề
// ---------------------------------------------------------------------------

const TOPIC_STATUS: Record<TopicRow['status'], { label: string; className: string }> = {
  pending: { label: 'Chờ viết', className: 'bg-primary/10 text-primary' },
  used: { label: 'Đã viết', className: 'bg-success/10 text-success' },
  failed: { label: 'Lỗi 3 lần', className: 'bg-danger/10 text-danger' },
  skipped: { label: 'Bỏ qua', className: 'bg-muted/10 text-muted' },
};

function TopicsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<TopicRow | null>(null);
  const query = useListQuery<TopicRow>('/blog/topics', { page, page_size: 50 });
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/blog') });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiFetch(`/blog/topics/${id}`, { method: 'PUT', json: body }),
    onSuccess: refresh,
    onError: (e) => toast.error(e),
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiFetch(`/blog/topics/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
      toast.success('Đã xoá chủ đề');
    },
    onError: (e) => toast.error(e),
  });

  const columns: Column<TopicRow>[] = [
    { key: 'priority', header: 'Ưu tiên', align: 'right', className: 'w-20', cell: (t) => <span className="tabular-nums">{t.priority}</span> },
    {
      key: 'primary_keyword',
      header: 'Từ khoá / hướng bài',
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-fg">{t.primary_keyword}</p>
          {t.angle && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{t.angle}</p>}
          {t.last_error && t.status !== 'used' && <p className="mt-0.5 line-clamp-1 text-xs text-danger">Lỗi gần nhất: {t.last_error}</p>}
        </div>
      ),
    },
    {
      key: 'skus',
      header: 'Sản phẩm',
      cell: (t) => (
        <span className="text-xs text-muted">
          {parseList<string>(t.related_skus_json)
            .map((s) => BLOG_SKUS.find((b) => b.sku === s)?.label ?? s)
            .join(', ') || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Trạng thái',
      cell: (t) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TOPIC_STATUS[t.status].className}`}>
          {TOPIC_STATUS[t.status].label}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (t) =>
        t.status === 'used' ? (
          t.post_id ? (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/bai-viet/${t.post_id}`)}>
              Xem bài
            </Button>
          ) : null
        ) : (
          <div className="flex justify-end gap-1">
            {t.status === 'pending' ? (
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: t.id, body: { status: 'skipped' } })}>
                Bỏ qua
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: t.id, body: { status: 'pending' } })}>
                Viết lại
              </Button>
            )}
            <Button size="sm" variant="ghost" aria-label={`Xoá chủ đề ${t.primary_keyword}`} onClick={() => setDeleting(t)}>
              <Trash2 size={14} aria-hidden />
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        {...listProps(query.data)}
        page={page}
        loading={query.isFetching}
        onPageChange={setPage}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Thêm chủ đề
          </Button>
        }
        empty="Hàng đợi trống — thêm chủ đề để AI có việc viết"
      />
      <TopicDialog open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Xoá chủ đề?"
        message={`Xoá "${deleting?.primary_keyword}" khỏi hàng đợi. Không hoàn tác được.`}
        confirmLabel="Xoá"
        danger
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function TopicDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [keyword, setKeyword] = useState('');
  const [angle, setAngle] = useState('');
  const [priority, setPriority] = useState('5');
  const [skus, setSkus] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setKeyword('');
      setAngle('');
      setPriority('5');
      setSkus([]);
    }
  }, [open]);
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/blog/topics', {
        method: 'POST',
        json: { primary_keyword: keyword, angle, related_skus: skus, priority: Number(priority) || 0 },
      }),
    onSuccess: () => {
      toast.success('Đã thêm chủ đề');
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e),
  });
  return (
    <FormDialog
      open={open}
      title="Thêm chủ đề"
      onClose={onClose}
      onSubmit={() => save.mutate()}
      submitLabel="Thêm"
      submitting={save.isPending}
      submitDisabled={keyword.trim().length < 3}
    >
      <Field label="Từ khoá chính" htmlFor="tp-kw" required hint="Cụm khách hay gõ trên Google, vd. “tẩy cặn canxi vòi sen”.">
        <input id="tp-kw" className={inputClass} value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={120} required />
      </Field>
      <Field label="Hướng bài / ý định tìm kiếm" htmlFor="tp-angle" hint="Người đọc cần gì, nên nhấn mạnh điều gì.">
        <textarea id="tp-angle" rows={3} className={inputClass} value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={500} />
      </Field>
      <Field label="Ưu tiên (số nhỏ viết trước)" htmlFor="tp-pri">
        <input id="tp-pri" type="number" min={0} className={`${inputClass} w-32`} value={priority} onChange={(e) => setPriority(e.target.value)} />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-fg">Sản phẩm liên quan (tối đa 4)</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {BLOG_SKUS.map((s) => (
            <label key={s.sku} className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={skus.includes(s.sku)}
                disabled={!skus.includes(s.sku) && skus.length >= 4}
                onChange={(e) => setSkus((cur) => (e.target.checked ? [...cur, s.sku] : cur.filter((x) => x !== s.sku)))}
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Tự viết bằng AI
// ---------------------------------------------------------------------------

const RUN_STATUS: Record<RunRow['status'], { label: string; className: string }> = {
  ok: { label: 'Đã viết', className: 'bg-success/10 text-success' },
  rejected: { label: 'Chưa đạt', className: 'bg-warning/10 text-warning' },
  error: { label: 'Lỗi', className: 'bg-danger/10 text-danger' },
  skipped: { label: 'Bỏ qua', className: 'bg-muted/10 text-muted' },
};

function AutoTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: () => apiFetch<BlogStatus>('/blog/status') });
  const [form, setForm] = useState({ enabled: true, auto_publish: false, model: '', author: '' });
  const [confirmAuto, setConfirmAuto] = useState(false);
  useEffect(() => {
    if (status.data) {
      const s = status.data;
      setForm({ enabled: s.enabled, auto_publish: s.auto_publish, model: s.model, author: s.author });
    }
  }, [status.data]);
  const save = useMutation({
    mutationFn: () => apiFetch('/blog/settings', { method: 'PUT', json: form }),
    onSuccess: () => {
      toast.success('Đã lưu cài đặt');
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e) => toast.error(e),
  });
  const generate = useMutation({
    mutationFn: () => apiFetch<{ status: string; message: string; post_id?: number }>('/blog/generate', { method: 'POST', json: {} }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/blog') });
      if (r.post_id) {
        toast.success(r.message, { action: { label: 'Mở bài', onClick: () => navigate(`/bai-viet/${r.post_id}`) } });
      } else if (r.status === 'error') toast.error(r.message);
      else toast.success(r.message);
    },
    onError: (e) => toast.error(e),
  });

  if (status.isLoading) return <p className="text-sm text-muted">Đang tải…</p>;
  if (status.isError || !status.data)
    return (
      <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
        {errorMessage(status.error)}
      </p>
    );
  const s = status.data;
  const left = Math.max(0, s.manual_runs_limit - s.manual_runs_today);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section aria-labelledby="ai-state" className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div>
          <h2 id="ai-state" className="text-base font-semibold text-fg">
            Trạng thái
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-subtle p-3">
              <dt className="text-xs text-muted">Khoá Gemini</dt>
              <dd className={`mt-0.5 flex items-center gap-1.5 font-medium ${s.has_api_key ? 'text-success' : 'text-danger'}`}>
                <KeyRound size={14} aria-hidden /> {s.has_api_key ? 'Đã nạp' : 'Chưa nạp'}
              </dd>
            </div>
            <div className="rounded-lg bg-subtle p-3">
              <dt className="text-xs text-muted">Chủ đề chờ viết</dt>
              <dd className={`mt-0.5 font-medium tabular-nums ${s.pending_topics < 7 ? 'text-warning' : 'text-fg'}`}>
                {s.pending_topics} {s.pending_topics < 7 && '· sắp hết'}
              </dd>
            </div>
          </dl>
          {!s.has_api_key && (
            <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
              Tạo khoá ở aistudio.google.com/apikey rồi tự nạp lên máy chủ:{' '}
              <code className="font-mono">npx.cmd wrangler secret put GEMINI_API_KEY --env staging</code>
            </p>
          )}
        </div>

        <form
          className="space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span>
              <span className="font-medium text-fg">Tự viết 1 bài mỗi ngày (02:00)</span>
              <span className="block text-xs text-muted">Tắt thì chỉ viết khi bấm “Viết thử ngay”.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.auto_publish}
              onChange={(e) => (e.target.checked ? setConfirmAuto(true) : setForm({ ...form, auto_publish: false }))}
            />
            <span>
              <span className="font-medium text-fg">Tự đăng không cần duyệt</span>
              <span className="block text-xs text-muted">Bài chưa đạt kiểm tra vẫn luôn giữ ở Nháp.</span>
            </span>
          </label>
          <Field label="Model Gemini" htmlFor="ai-model" hint="Gói miễn phí: gemini-3.8-flash hoặc gemini-3.5-flash-lite.">
            <input id="ai-model" className={inputClass} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="Tên tác giả hiển thị" htmlFor="ai-author" hint="Nên là người thật hoặc bộ phận có chuyên môn (E-E-A-T).">
            <input id="ai-author" className={inputClass} value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              Lưu cài đặt
            </Button>
            <Button
              variant="secondary"
              onClick={() => generate.mutate()}
              loading={generate.isPending}
              disabled={!s.has_api_key || left === 0 || s.pending_topics === 0}
            >
              <Sparkles size={16} aria-hidden /> Viết thử ngay ({left}/{s.manual_runs_limit})
            </Button>
          </div>
          {generate.isPending && <p className="text-xs text-muted">Gemini đang viết, thường mất 30–90 giây…</p>}
        </form>
      </section>

      <section aria-labelledby="ai-runs" className="rounded-xl border border-line bg-surface p-4">
        <h2 id="ai-runs" className="text-base font-semibold text-fg">
          10 lần chạy gần nhất
        </h2>
        {s.runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Chưa chạy lần nào.</p>
        ) : (
          <ol className="mt-3 divide-y divide-line">
            {s.runs.map((r) => (
              <li key={r.id} className="py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS[r.status].className}`}>
                    {RUN_STATUS[r.status].label}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDate(r.created_at)} · {r.trigger === 'cron' ? 'Tự động' : 'Bấm tay'}
                    {r.output_tokens > 0 && ` · ${formatNumber(r.prompt_tokens + r.output_tokens + r.thoughts_tokens)} token`}
                  </span>
                </div>
                <p className="mt-1 text-fg">
                  {r.post_id ? (
                    <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => navigate(`/bai-viet/${r.post_id}`)}>
                      {r.message}
                    </button>
                  ) : (
                    r.message
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={confirmAuto}
        title="Bật tự đăng không cần duyệt?"
        message="Bài AI sẽ lên web ngay khi viết xong. Google khuyến cáo phải kiểm chứng thủ công nội dung AI trước khi đăng; đăng hàng loạt không duyệt có thể bị coi là spam. Anh vẫn có thể gỡ bài sau."
        confirmLabel="Bật tự đăng"
        onConfirm={() => {
          setForm({ ...form, auto_publish: true });
          setConfirmAuto(false);
        }}
        onCancel={() => setConfirmAuto(false)}
      />
    </div>
  );
}
