'use client';

import dynamic from 'next/dynamic';

const RechartsRadarChart = dynamic(() => import('recharts').then(m => m.RadarChart), { ssr: false });
const Radar = dynamic(() => import('recharts').then(m => m.Radar), { ssr: false });
const PolarGrid = dynamic(() => import('recharts').then(m => m.PolarGrid), { ssr: false });
const PolarAngleAxis = dynamic(() => import('recharts').then(m => m.PolarAngleAxis), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false });

export const RUBRIC_LABELS: Record<string, string> = {
  problemFraming: 'Постановка',
  diagnosis: 'Диагностика',
  metricsThinking: 'Метрики',
  prioritization: 'Приоритизация',
  clarityStructure: 'Структура',
  tradeOffs: 'Риски',
};

export type RadarDataPoint = {
  subject: string;
  value: number;
  fullMark: number;
};

/**
 * Shared radar chart for rubric scores.
 * Accepts either raw scores object or pre-computed data array.
 */
export function CompetencyRadar({
  scores,
  data,
  height = 220,
  color = '#6366f1',
}: {
  scores?: Record<string, number>;
  data?: RadarDataPoint[];
  height?: number;
  color?: string;
}) {
  const chartData =
    data ??
    (scores
      ? Object.keys(RUBRIC_LABELS).map((k) => ({
          subject: RUBRIC_LABELS[k],
          value: parseFloat((scores[k] ?? 0).toFixed(2)),
          fullMark: 5,
        }))
      : null);

  if (!chartData || chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsRadarChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 11, fill: '#6b7280', fontFamily: 'var(--font-inter, sans-serif)' }}
        />
        <Radar
          name="avg"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.25}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
        />
      </RechartsRadarChart>
    </ResponsiveContainer>
  );
}
