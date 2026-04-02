export enum UserRole {
  USER = 'USER',
  ADMIN_SUPER = 'ADMIN_SUPER',
  ADMIN_STAFF = 'ADMIN_STAFF',
}

export function isAdminRole(role: UserRole): boolean {
  return role === UserRole.ADMIN_SUPER || role === UserRole.ADMIN_STAFF;
}
