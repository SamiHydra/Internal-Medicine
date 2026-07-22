import type { Workspace } from '@/config/navigation'
import type { RoleDefinition, UserRole } from '@/types/domain'

// The Clinical/Academic split lives on the server role registry, so a new role
// reaches the roster without a frontend edit. An empty set means the registry is
// missing (older server, or not loaded yet) and callers fall back to showing all.
export function visibleRoleKeysForWorkspace(
  roles: RoleDefinition[],
  workspace: Workspace,
) {
  return new Set<UserRole>(
    roles
      .filter((role) => role.workspace === 'both' || role.workspace === workspace)
      .map((role) => role.key),
  )
}
