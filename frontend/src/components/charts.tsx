'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { formatBRL, formatDateBR } from '@/lib/format';
import type { CashflowPoint } from '@/lib/types';

// Cores dos tokens do design: verde = recebido/sucesso, laranja = pendente.
const COLOR_SUCCESS = '#71a93d';
const COLOR_WARNING = '#ff6400';
const COLOR_DANGER = '#b5342f';
const COLOR_TRACK = '#cdd4c4';

function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function ChartTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; fill: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-sand-200 bg-white px-3.5 py-2.5 shadow-pop">
      <p className="mb-1 text-xs font-semibold text-sand-500">
        {label ? formatDateBR(label) : ''}
      </p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="flex items-center gap-2 text-sm text-sand-700">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.fill }}
          />
          <span>{entry.dataKey === 'receivedCents' ? 'Recebido' : 'Pendente'}</span>
          <span className="money ml-auto font-bold">{formatBRL(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function CashflowChart({ data }: { data: CashflowPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={3} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e5eadf" />
          <XAxis
            dataKey="day"
            tickFormatter={shortDay}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#687563' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(value: number) =>
              (value / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
            }
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: '#8b9884' }}
            width={56}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(140,199,79,0.10)' }} />
          <Bar dataKey="receivedCents" fill={COLOR_SUCCESS} radius={[5, 5, 0, 0]} maxBarSize={26} />
          <Bar dataKey="pendingCents" fill={COLOR_WARNING} radius={[5, 5, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- Donut (cards "Status das cobranças" / "Taxa de recebimento") ---------------- */

export interface DonutSegment {
  name: string;
  value: number;
  color: 'success' | 'warning' | 'danger' | 'track';
}

const DONUT_COLOR: Record<DonutSegment['color'], string> = {
  success: COLOR_SUCCESS,
  warning: COLOR_WARNING,
  danger: COLOR_DANGER,
  track: COLOR_TRACK
};

/**
 * Donut do design: anel de 96px com rótulo central. Recebe valores absolutos;
 * quando tudo é zero, mostra só o trilho neutro.
 */
export function DonutChart({
  segments,
  centerLabel,
  centerClassName
}: {
  segments: DonutSegment[];
  centerLabel: string;
  centerClassName?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const data = total > 0 ? segments.filter((segment) => segment.value > 0) : [{ name: '—', value: 1, color: 'track' as const }];
  return (
    <div className="relative h-24 w-24 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={33}
            outerRadius={48}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((segment) => (
              <Cell key={segment.name} fill={DONUT_COLOR[segment.color]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className={centerClassName ?? 'text-[15px] font-bold text-sand-900'}>
          {centerLabel}
        </span>
      </div>
    </div>
  );
}

/** Linha de legenda dos donuts (quadradinho colorido + nome + valor). */
export function DonutLegendRow({
  color,
  label,
  value
}: {
  color: DonutSegment['color'];
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-[3px]"
        style={{ backgroundColor: DONUT_COLOR[color] }}
      />
      <span className="flex-1 text-xs font-medium text-sand-600">{label}</span>
      <span className="text-xs font-bold text-sand-900">{value}</span>
    </div>
  );
}
