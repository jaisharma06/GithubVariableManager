import { Component, computed, input, signal } from '@angular/core';

/**
 * Port of web/src/components/Avatar.tsx. Shows the account's GitHub profile photo; falls back
 * to (and stays on, while the image loads or if it fails) the first-letter initial.
 */
@Component({
  selector: 'app-avatar',
  templateUrl: './Avatar.component.html',
})
export class AvatarComponent {
  readonly login = input.required<string>();
  readonly avatarUrl = input<string | undefined>(undefined);
  readonly size = input(24);

  protected readonly loaded = signal(false);
  protected readonly errored = signal(false);

  protected readonly initial = computed(() => this.login().trim().charAt(0).toUpperCase() || '?');
  protected readonly showImage = computed(() => Boolean(this.avatarUrl()) && !this.errored());
  protected readonly altText = computed(() => `${this.login()}'s avatar`);
}
