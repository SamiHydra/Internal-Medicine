import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

export function Sparkline({
  data,
  color = '#0f8ea8',
}: {
  data: Array<{ value: number | null }>
  color?: string
}) {
  const gradientId = useId().replace(/:/g, '')

  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.34} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            dataKey="value"
            type="monotone"
            stroke={color}
            fill={`url(#${gradientId})`}
            strokeWidth={2.75}
            dot={false}
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
