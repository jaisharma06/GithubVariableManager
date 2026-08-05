import { Component, OnDestroy, computed, inject, output, signal } from '@angular/core';
import { ButtonComponent } from '../../shared/components/Button.component';
import { OAUTH_GATEWAY, type DeviceCode, type IOAuthGateway } from '../../core/gateways/IOAuthGateway';

type OAuthDeviceFlowState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; device: DeviceCode; copied: boolean }
  | { phase: 'error'; message: string };

/**
 * Port of web/src/auth/OAuthDeviceFlow.tsx. The original's `cancelledRef`/`timerRef` pattern
 * (plus a "reset on mount" effect specifically to survive React StrictMode's dev-only
 * mount→cleanup→remount cycle) becomes plain instance fields cleaned up in `ngOnDestroy` —
 * Angular doesn't double-invoke lifecycle hooks the way StrictMode does, so there's nothing to
 * work around here.
 */
@Component({
  selector: 'app-oauth-device-flow',
  imports: [ButtonComponent],
  templateUrl: './OAuthDeviceFlow.component.html',
})
export class OAuthDeviceFlowComponent implements OnDestroy {
  private readonly oauthGateway = inject<IOAuthGateway>(OAUTH_GATEWAY);

  readonly success = output<string>();

  protected readonly state = signal<OAuthDeviceFlowState>({ phase: 'idle' });

  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.phase === 'error' ? s.message : '';
  });
  protected readonly waitingDevice = computed(() => {
    const s = this.state();
    return s.phase === 'waiting' ? s.device : null;
  });
  protected readonly waitingCopied = computed(() => {
    const s = this.state();
    return s.phase === 'waiting' && s.copied;
  });

  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private cancelled = false;

  ngOnDestroy(): void {
    this.cancelled = true;
    if (this.timer) clearTimeout(this.timer);
  }

  protected async Start(): Promise<void> {
    this.state.set({ phase: 'starting' });
    try {
      const device = await this.oauthGateway.StartDeviceFlow();
      if (this.cancelled) return;
      this.deadline = Date.now() + device.expiresIn * 1000;

      this.state.set({ phase: 'waiting', device, copied: false });
      this.SchedulePoll(device, device.interval);

      // Best-effort — clipboard permission prompts (or their absence) must never block sign-in.
      navigator.clipboard?.writeText(device.userCode).then(
        () => {
          if (!this.cancelled) {
            const current = this.state();
            if (current.phase === 'waiting') this.state.set({ ...current, copied: true });
          }
        },
        () => {
          // clipboard access denied/unavailable — the code is still visible to copy by hand
        },
      );
    } catch (err) {
      if (this.cancelled) return;
      this.state.set({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Could not start GitHub sign-in.',
      });
    }
  }

  private SchedulePoll(device: DeviceCode, intervalSeconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.Poll(device, intervalSeconds), intervalSeconds * 1000);
  }

  private async Poll(device: DeviceCode, intervalSeconds: number): Promise<void> {
    if (this.cancelled) return;

    if (Date.now() > this.deadline) {
      this.state.set({ phase: 'error', message: 'This code expired before it was approved. Try again.' });
      return;
    }

    const result = await this.oauthGateway.PollDeviceToken(device.deviceCode);
    if (this.cancelled) return;

    switch (result.status) {
      case 'success':
        this.success.emit(result.token);
        return;
      case 'pending':
        this.SchedulePoll(device, intervalSeconds);
        return;
      case 'slow_down':
        this.SchedulePoll(device, result.interval);
        return;
      case 'denied':
        this.state.set({ phase: 'error', message: 'Sign-in was declined on GitHub. Try again.' });
        return;
      case 'expired':
        this.state.set({ phase: 'error', message: 'This code expired. Try again.' });
        return;
      case 'error':
        this.state.set({ phase: 'error', message: result.message });
        return;
    }
  }
}
