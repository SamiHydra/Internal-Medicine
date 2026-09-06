import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

import { FullPageSkeleton } from '@/components/layout/loading-skeletons'

const TabBarLabPage = lazy(() => import('@/pages/dev/tab-bar-lab'))
const HeaderLabPage = lazy(() => import('@/pages/dev/header-lab'))

export default function DevRoutes() {
  return (
    <Suspense fallback={<FullPageSkeleton label="Loading design lab" />}>
      <Routes>
        <Route path="tabs" element={<TabBarLabPage />} />
        <Route path="header" element={<HeaderLabPage />} />
      </Routes>
    </Suspense>
  )
}
