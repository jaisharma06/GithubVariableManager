import { Routes } from '@angular/router';
import { AuthGuard } from './features/auth/AuthGuard';

// Direct port of web/src/App.tsx's route table, using `loadComponent` per route rather than
// static `component:` imports — this is the code-splitting the migration plan calls for (React
// Router's static <Route element={...}> has no equivalent lazy form without extra setup; Angular
// Router's does, for free). Each route's component, and everything it alone depends on, ships as
// its own chunk instead of bloating the initial bundle every route pays for.
//
// DashboardShellComponent reads whichever of 'org'/'owner'+'repo' the matched route provided
// (see its own paramMap handling) rather than having two separate components the way
// OrgDashboard/RepoDashboard split it in React.
export const routes: Routes = [
  {
    path: 'connect',
    loadComponent: () => import('./features/auth/ConnectScreen.component').then((m) => m.ConnectScreenComponent),
  },
  {
    path: '',
    loadComponent: () => import('./features/scope-picker/ScopePicker.component').then((m) => m.ScopePickerComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'o/:org',
    loadComponent: () => import('./features/dashboard/DashboardShell.component').then((m) => m.DashboardShellComponent),
    canActivate: [AuthGuard],
  },
  {
    path: 'r/:owner/:repo',
    loadComponent: () => import('./features/dashboard/DashboardShell.component').then((m) => m.DashboardShellComponent),
    canActivate: [AuthGuard],
  },
  { path: '**', redirectTo: '' },
];
