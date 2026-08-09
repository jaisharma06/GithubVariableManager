import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeEnvironmentsGateway,
  CreateFakeOAuthGateway,
  CreateFakeScopesGateway,
  CreateFakeSecretsGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { RenameEnvironmentDialogComponent } from './RenameEnvironmentDialog.component';

describe('RenameEnvironmentDialogComponent', () => {
  let fixture: ComponentFixture<RenameEnvironmentDialogComponent>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;

  const STAGING_VARIABLE: LedgerItem = {
    id: 'variable:environment:acme-corp:widgets:staging:API_URL',
    kind: 'variable',
    level: 'environment',
    scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
    name: 'API_URL',
    value: 'https://staging.example.com',
    createdAt: '',
    updatedAt: '',
  };

  beforeEach(async () => {
    SeedFakeSession();

    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();

    await TestBed.configureTestingModule({
      imports: [RenameEnvironmentDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: SECRETS_GATEWAY, useValue: CreateFakeSecretsGateway() },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RenameEnvironmentDialogComponent);
    fixture.componentRef.setInput('org', 'acme-corp');
    fixture.componentRef.setInput('repo', 'widgets');
    fixture.componentRef.setInput('oldName', 'staging');
    fixture.componentRef.setInput('items', [STAGING_VARIABLE]);
  });

  afterEach(() => ClearFakeSession());

  function TypeNewName(newName: string): void {
    const input = fixture.nativeElement.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    input.value = newName;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function Submit(): void {
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('pre-fills the new-name field with the current name', () => {
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    expect(input.value).toBe('staging');
  });

  it(
    'sends one RenameEnvironment request and emits renamed on success',
    fakeAsync(() => {
      fixture.detectChanges();
      fakeEnvironmentsGateway.RenameEnvironment.and.resolveTo({
        listVariablesError: null,
        variablesCopied: 1,
        variableCopyFailures: [],
        oldEnvironmentDeleted: true,
        oldEnvironmentDeleteError: null,
      });

      const renamedSpy = jasmine.createSpy('renamed');
      fixture.componentInstance.renamed.subscribe(renamedSpy);

      TypeNewName('production');
      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeEnvironmentsGateway.RenameEnvironment).toHaveBeenCalledWith({
        org: 'acme-corp',
        repo: 'widgets',
        oldName: 'staging',
        newName: 'production',
        deleteOldAnyway: false,
      });
      expect(renamedSpy).toHaveBeenCalledWith({ oldName: 'staging', newName: 'production' });
    }),
  );

  it(
    'reports variable copy failures as an error and does not emit renamed',
    fakeAsync(() => {
      fixture.detectChanges();
      fakeEnvironmentsGateway.RenameEnvironment.and.resolveTo({
        listVariablesError: null,
        variablesCopied: 0,
        variableCopyFailures: [{ name: 'API_URL', error: 'Forbidden' }],
        oldEnvironmentDeleted: false,
        oldEnvironmentDeleteError: null,
      });

      const renamedSpy = jasmine.createSpy('renamed');
      fixture.componentInstance.renamed.subscribe(renamedSpy);

      TypeNewName('production');
      Submit();
      tick();
      fixture.detectChanges();

      expect(renamedSpy).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('failed to copy');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('left in place');
    }),
  );

  it(
    'passes deleteOldAnyway through to the request when the environment still has secrets',
    fakeAsync(() => {
      fixture.componentRef.setInput('items', [
        STAGING_VARIABLE,
        {
          id: 'secret:environment:acme-corp:widgets:staging:TOKEN',
          kind: 'secret',
          level: 'environment',
          scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' },
          name: 'TOKEN',
          createdAt: '',
          updatedAt: '',
        } satisfies LedgerItem,
      ]);
      fixture.detectChanges();
      fakeEnvironmentsGateway.RenameEnvironment.and.resolveTo({
        listVariablesError: null,
        variablesCopied: 1,
        variableCopyFailures: [],
        oldEnvironmentDeleted: false,
        oldEnvironmentDeleteError: null,
      });

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('can’t be carried over');

      const checkbox = fixture.nativeElement.querySelector('input[type="checkbox"]') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      TypeNewName('production');
      Submit();
      tick();
      fixture.detectChanges();

      // The decision of whether the old environment can be deleted (secrets present, unless
      // acknowledged) is now made server-side — this only asserts the flag was sent correctly,
      // not that DeleteEnvironment itself was called (that call no longer happens client-side).
      expect(fakeEnvironmentsGateway.RenameEnvironment).toHaveBeenCalledWith({
        org: 'acme-corp',
        repo: 'widgets',
        oldName: 'staging',
        newName: 'production',
        deleteOldAnyway: true,
      });
    }),
  );
});
