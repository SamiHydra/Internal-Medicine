/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'

import { workspaceForPath, type Workspace } from '@/config/navigation'

const STORAGE_KEY = 'stpaul:workspace'

type WorkspaceContextValue = {
  workspace: Workspace
  setWorkspace: (workspace: Workspace) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function readStoredWorkspace(): Workspace {
  if (typeof window === 'undefined') {
    return 'clinical'
  }

  return window.localStorage.getItem(STORAGE_KEY) === 'academic' ? 'academic' : 'clinical'
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const location = useLocation()
  const [workspace, setWorkspace] = useState<Workspace>(readStoredWorkspace)

  // A domain route is the source of truth for the workspace (so deep links flip
  // the mode, and shared routes inherit the last domain workspace). Adjusting
  // state during render is React's recommended alternative to a sync effect.
  const routeWorkspace = workspaceForPath(location.pathname)
  if (routeWorkspace && routeWorkspace !== workspace) {
    setWorkspace(routeWorkspace)
  }

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, workspace)
  }, [workspace])

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }

  return context
}
