'use client';

interface MetricDeltaProps {
  label: string;
  value: string | number;
  isPositive: boolean;
}

export default function MetricDelta({ label, value, isPositive }: MetricDeltaProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
        isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
      }`}
    >
      {isPositive ? '▲' : '▼'} {label} {value}
    </span>
  );
}
