'use client';

import dynamic from 'next/dynamic';

const LineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false });
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false });
const Legend = dynamic(() => import('recharts').then(m => m.Legend), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });
const ReferenceLine = dynamic(() => import('recharts').then(m => m.ReferenceLine), { ssr: false });

export type ChartSeries = {
  key: string;
  label: string;
  color: string;
  /** Подчеркнуть аномалию на этой серии? */
  anomaly?: boolean;
};

export type ChartDataPoint = Record<string, string | number>;

export type ChartConfig = {
  type: 'line';
  title: string;
  description?: string;
  xAxisKey: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  yAxisUnit?: string;
  /** Провести вертикальную пунктирную линию на этом X */
  anomalyX?: string | number;
  anomalyLabel?: string;
  series: ChartSeries[];
  data: ChartDataPoint[];
  /** Текстовое описание данных для AI промпта */
  textSummary: string;
};

export function DataChart({ config }: { config: ChartConfig }) {
  const { data, series, xAxisKey, xAxisLabel, yAxisLabel, yAxisUnit, anomalyX, anomalyLabel, title, description } = config;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-gray-800">📊 {title}</h3>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -4, fontSize: 11, fill: '#9ca3af' } : undefined}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickFormatter={yAxisUnit ? (v) => `${v}${yAxisUnit}` : undefined}
            label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' } : undefined}
          />
          <Tooltip
            formatter={(value, name) => [
              `${value}${yAxisUnit ?? ''}`,
              series.find((s) => s.key === String(name))?.label ?? String(name),
            ]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
          />
          <Legend
            formatter={(value) => series.find((s) => s.key === value)?.label ?? value}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          {anomalyX !== undefined && (
            <ReferenceLine
              x={anomalyX}
              stroke="#ef4444"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: anomalyLabel ?? '⚠', position: 'top', fontSize: 11, fill: '#ef4444' }}
            />
          )}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={s.anomaly ? 2.5 : 1.5}
              dot={{ r: 3, fill: s.color }}
              activeDot={{ r: 5 }}
              strokeDasharray={s.anomaly ? undefined : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend: anomaly callout */}
      {series.some((s) => s.anomaly) && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
          ⚠ <strong>Аномалия:</strong>{' '}
          {series.find((s) => s.anomaly)?.label} показывает подозрительное поведение. Что могло это вызвать?
        </p>
      )}
    </div>
  );
}
