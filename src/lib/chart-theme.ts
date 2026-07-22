// Shared chart styling for the academic dashboards, mirroring the restrained
// blue / navy / gold / steel palette and white-gradient panels used on the
// admin analytics dashboard.

import { createElement } from 'react'

export const academicChartPalette = {
  ink: '#005db6',
  carbon: '#315f8c',
  slate: '#002147',
  steel: '#6c7f95',
  mist: '#f0b429',
  cloud: '#95abc4',
} as const

// Gridlines are solid hairlines one step off the surface. Dashing is reserved
// for threshold/reference rules, where "this is a limit, not data" is the point.
export const chartGridStroke = '#e6ecf3'

export const chartTick = { fill: '#64748b', fontSize: 12, fontWeight: 500 }

/**
 * Morning-session lateness. Two classes only: the column's height already says
 * how late a session was, so colour is left to say the one thing height cannot
 * - whether this morning needs looking at. Spending the hue on severity too
 * would double-encode the same number.
 *
 * Steel and gold are the clinical dashboard's own tones, so "quiet" and "needs
 * attention" read identically across both workspaces. Gold sits under 3:1 on
 * white, so it never carries meaning alone: the legend names both classes and
 * counts them, the worst column is directly labelled, and the table view
 * carries every value.
 */
export const delayBandPalette = {
  onTime: '#6c7f95',
  late: '#f0b429',
} as const

/**
 * Teaching delivery, in the clinical dashboard's blue/gold pairing - blue for
 * what happened, gold for what needs chasing. Same relief as above: a legend
 * names both series.
 */
export const deliveryPalette = {
  held: '#005db6',
  notHeld: '#f0b429',
} as const

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

/**
 * Shared Recharts <Legend> configuration. A legend is mandatory wherever two or
 * more series share a plot, so identity never rests on colour matching alone.
 * The label wears a text token - the coloured dot beside it carries the
 * identity, because a mid-tone series hue is not legible as body text.
 */
export const chartLegendProps = {
  iconType: 'circle' as const,
  iconSize: 9,
  align: 'left' as const,
  verticalAlign: 'top' as const,
  wrapperStyle: { paddingLeft: 24, paddingBottom: 16 },
  formatter: (value: string) =>
    createElement(
      'span',
      { style: { color: '#52606d', fontSize: 13, fontWeight: 500 } },
      value,
    ),
}
