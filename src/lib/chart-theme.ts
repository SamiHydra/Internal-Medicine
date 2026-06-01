// Shared chart styling for the academic dashboards, mirroring the restrained
// blue / navy / gold / steel palette and white-gradient panels used on the
// admin analytics dashboard.

export const academicChartPalette = {
  ink: '#005db6',
  carbon: '#315f8c',
  slate: '#002147',
  steel: '#6c7f95',
  mist: '#f0b429',
  cloud: '#95abc4',
} as const

export const chartGridStroke = 'rgba(148, 163, 184, 0.28)'

export const chartTick = { fill: '#64748b', fontSize: 12, fontWeight: 500 }

export const tooltipLineCursor = {
  stroke: 'rgba(0,93,182,0.22)',
  strokeWidth: 1.4,
  strokeDasharray: '4 5',
}

export const tooltipFillCursor = { fill: 'rgba(0,93,182,0.06)' }

export const lightTooltipStyle = {
  borderRadius: '8px',
  border: '1px solid rgba(190, 203, 219, 0.95)',
  backgroundColor: 'rgba(255,255,255,0.98)',
  boxShadow: '0 22px 45px -18px rgba(0,33,71,0.28)',
  color: '#000a1e',
  padding: '10px 12px',
}

export const lightTooltipLabelStyle = {
  color: '#002147',
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
}

export const lightTooltipItemStyle = {
  color: '#334155',
  fontSize: 12,
  fontWeight: 600,
  paddingTop: 3,
  paddingBottom: 3,
}

export const lineActiveDot = { r: 5.5, stroke: '#ffffff', strokeWidth: 2.5 }
