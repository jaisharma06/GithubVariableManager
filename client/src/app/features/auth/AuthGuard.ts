import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/services/AuthService';

/**
 * Port of web/src/auth/RequireAuth.tsx.
 * A const holding a function is PascalCase per this project's "functions are PascalCase" rule
 * (docs/CodingStandards.md); the lint rule can't express that without type-aware linting, so
 * this one's spelled out explicitly below.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const AuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.token() ? true : router.createUrlTree(['/connect']);
};
