import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber, formatVnd } from '../../lib/format';
import type { SalesRow } from './sheets';

/** Biểu đồ doanh thu và lãi gộp theo kỳ. Tải chậm (React.lazy) để recharts không nằm trong gói chính. */
export default function ReportChart({ rows, variant }: { rows: SalesRow[]; variant: 'line' | 'bar' }) {
  const data = rows.map((r) => ({ key: r.key, revenue: r.revenue_vnd, profit: r.gross_profit_vnd }));
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
      <XAxis dataKey="key" tick={{ fontSize: 12 }} />
      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => formatNumber(v)} width={80} />
      <Tooltip formatter={(v) => formatVnd(Number(v))} />
      <Legend />
    </>
  );
  return (
    <div className="h-72 w-full text-muted" role="img" aria-label="Biểu đồ doanh thu và lãi gộp">
      <ResponsiveContainer width="100%" height="100%">
        {variant === 'bar' ? (
          <BarChart data={data}>
            {common}
            <Bar dataKey="revenue" name="Doanh thu" fill="#2563eb" />
            <Bar dataKey="profit" name="Lãi gộp" fill="#16a34a" />
          </BarChart>
        ) : (
          <LineChart data={data}>
            {common}
            <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke="#2563eb" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="profit" name="Lãi gộp" stroke="#16a34a" strokeWidth={2} dot={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
