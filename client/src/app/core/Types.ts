// Shared domain types — direct port of web/src/api/types.ts. Kept framework-agnostic (no
// Angular imports) so they can be used by Gateways, Services, and Facades alike without coupling
// any of them to each other.

export type ItemKind = 'variable' | 'secret';
export type ItemLevel = 'organization' | 'repository' | 'environment';
export type SecretVisibility = 'all' | 'private' | 'selected';

export interface ScopeRef {
  org: string;
  repo?: string;
  env?: string;
}

export interface LedgerItem {
  id: string;
  kind: ItemKind;
  level: ItemLevel;
  scope: ScopeRef;
  name: string;
  value?: string;
  visibility?: SecretVisibility;
  createdAt: string;
  updatedAt: string;
  /**
   * Composite-variable formula (Azure-App-Config-style `$(OtherVarName)` text, variables only —
   * never present on a secret). Populated server-side by every `GET /api/ledger` read
   * (`api/Services/LedgerService.cs`'s post-fan-out pass) only when this item's name is tracked in
   * its scope's hidden manifest variable (`api/Services/CompositeManifestService.cs`) — undefined
   * for every plain, non-composite variable. This is now the source of "what to show/edit as the
   * formula" — `value` no longer serves that role: `value` is always the real, already-resolved
   * GitHub literal (works immediately in any Actions workflow run), while `formula` is the raw
   * `$(NAME)` text recoverable via Sync.
   */
  formula?: string;
  /**
   * `formula` resolved fresh against CURRENT sibling values on every read (never cached) —
   * repurposed as a staleness signal now that `value` is always already-resolved: `resolvedValue !==
   * value` means a dependency changed since this item's last create/update/sync, surfaced in the UI
   * as "stale — click Sync". Also how a broken reference to another composite naturally surfaces,
   * with no separate code path. Undefined for every plain, non-composite variable and every secret.
   */
  resolvedValue?: string;
  /** Reference names inside `formula` that don't currently exist anywhere in this item's scope chain — shown as a broken/unresolved indicator, not blocked at save time. */
  unresolvedReferences?: string[];
}

export interface GithubEnvironment {
  name: string;
  id: number;
}

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
}

export interface GithubOrg {
  login: string;
  avatarUrl: string;
}

export interface Viewer {
  login: string;
  avatarUrl: string;
}

export interface PublicKey {
  key_id: string;
  key: string;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: number | null;
}

export interface RunnerLabel {
  id: number;
  name: string;
  type: string;
}

export interface Runner {
  id: number;
  name: string;
  os: string;
  status: 'online' | 'offline';
  busy: boolean;
  labels: RunnerLabel[];
}

/** The org (or org+repo) currently being managed — port of api/hooks.ts's DashboardScope. */
export interface DashboardScope {
  org: string;
  repo?: string;
}

export interface GithubWorkflow {
  id: number;
  name: string;
  path: string;
  state: 'active' | 'deleted' | 'disabled_fork' | 'disabled_inactivity' | 'disabled_manually';
}

export interface WorkflowRun {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  runNumber: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  commitMessage: string | null;
}

export interface WorkflowRunJobStep {
  name: string;
  number: number;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowRunJob {
  id: number;
  name: string;
  status: string | null;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: WorkflowRunJobStep[];
}

export interface WorkflowRunDetail {
  id: number;
  name: string | null;
  displayTitle: string | null;
  commitMessage: string | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  runNumber: number;
  runAttempt: number;
  headBranch: string | null;
  headSha: string | null;
  actorLogin: string | null;
  actorAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  runStartedAt: string | null;
  htmlUrl: string;
  jobs: WorkflowRunJob[];
}
