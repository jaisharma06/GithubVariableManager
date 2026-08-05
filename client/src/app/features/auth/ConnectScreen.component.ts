import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/AuthService';
import { OAUTH_GATEWAY, type IOAuthGateway } from '../../core/gateways/IOAuthGateway';
import { ButtonComponent } from '../../shared/components/Button.component';
import { OAuthDeviceFlowComponent } from './OAuthDeviceFlow.component';

type ConnectTab = 'pat' | 'oauth';

/** Port of web/src/auth/ConnectScreen.tsx. */
@Component({
  selector: 'app-connect-screen',
  imports: [ButtonComponent, OAuthDeviceFlowComponent],
  templateUrl: './ConnectScreen.component.html',
})
export class ConnectScreenComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly oauthGateway = inject<IOAuthGateway>(OAUTH_GATEWAY);
  private readonly router = inject(Router);

  protected readonly tab = signal<ConnectTab>('pat');
  protected readonly tokenInput = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly connecting = signal(false);
  protected readonly oauthClientId = signal<string | null | 'loading'>('loading');

  async ngOnInit(): Promise<void> {
    try {
      this.oauthClientId.set(await this.oauthGateway.FetchOAuthClientId());
    } catch {
      this.oauthClientId.set(null);
    }
  }

  protected TabButtonClasses(active: boolean): string {
    return `flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
      active ? 'border-brand text-text' : 'border-transparent text-text-dim hover:text-text'
    }`;
  }

  protected HandleTokenInput(event: Event): void {
    this.tokenInput.set((event.target as HTMLInputElement).value);
  }

  protected async HandlePatSubmit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.tokenInput().trim()) return;
    this.connecting.set(true);
    this.error.set(null);
    try {
      await this.authService.ConnectWithToken(this.tokenInput().trim(), 'pat');
      await this.router.navigate(['/'], { replaceUrl: true });
    } catch {
      this.error.set(
        'GitHub rejected this token — check that it hasn’t expired and that it carries repo and admin:org scopes.',
      );
    } finally {
      this.connecting.set(false);
    }
  }

  protected async HandleOAuthSuccess(token: string): Promise<void> {
    await this.authService.ConnectWithToken(token, 'oauth');
    await this.router.navigate(['/'], { replaceUrl: true });
  }
}
