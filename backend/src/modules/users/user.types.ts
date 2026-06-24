export type UserRole = 'admin' | 'developer';
export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** User shape safe to return over the API (no password hash). */
export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  /** When provided, re-hashes and replaces the password. */
  password?: string;
  role?: UserRole;
  status?: UserStatus;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
