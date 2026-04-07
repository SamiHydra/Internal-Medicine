import type { ReactNode } from 'react'

import { AdminPageHero } from '@/components/admin/admin-page-hero'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <AdminPageHero
      eyebrow={eyebrow ?? 'Department'}
      title={title}
      description={description}
      actions={actions}
    />
  )
}
