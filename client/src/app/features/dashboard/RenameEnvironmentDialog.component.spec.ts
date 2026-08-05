import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeEnvironmentsGateway,
  CreateFakeScopesGateway,
  CreateFakeSecretsGateway,
  CreateFakeVariablesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { RenameEnvironmentDialogComponent } from './RenameEnvironmentDialog.component';

describe('RenameEnvironmentDialogComponent', () => {
  let fixture: ComponentFixture<RenameEnvironmentDialogComponent>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;
  let fakeVariablesGateway: ReturnType<typeof CreateFakeVariablesGateway>;

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
    fakeVariablesGateway = CreateFakeVariablesGateway();

    await TestBed.configureTestingModule({
      imports: [RenameEnvironmentDialogComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: CreateFakeSecretsGateway() },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RenameEnvironmentDialogComponent);
    fixture.componentRef.setInput('org', 'acme-corp');
    fixture.componentRef.setInput('repo', 'widgets');
    fixture.componentRef.setInput('oldName', 'staging');
    fixture.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    fixture.componentRef.setInput('items', [STAGING_VARIABLE]);
  });

  afterEach(() => ClearFakeSession());

  it('pre-fills the new-name field with the current name', () => {
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    expect(input.value).toBe('staging');
  });

  it(
    'creates the new environment, copies variables, then deletes the old one, and emits renamed',
    fakeAsync(() => {
      fixture.detectChanges();
      fakeEnvironmentsGateway.CreateEnvironment.and.resolveTo();
      fakeEnvironmentsGateway.DeleteEnvironment.and.resolveTo();
      fakeVariablesGateway.CreateVariable.and.resolveTo();

      const renamedSpy = jasmine.createSpy('renamed');
      fixture.componentInstance.renamed.subscribe(renamedSpy);

      const input = fixture.nativeElement.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
      input.value = 'production';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      // Three chained mutations (create env -> copy the variable -> delete old env), each its
      // own onMutate/mutationFn microtask hop — flush repeatedly rather than guess a single tick.
      tick();
      tick();
      tick();
      fixture.detectChanges();

      expect(fakeEnvironmentsGateway.CreateEnvironment).toHaveBeenCalledWith('acme-corp', 'widgets', 'production');
      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets', env: 'production' },
        'environment',
        'API_URL',
        'https://staging.example.com',
      );
      expect(fakeEnvironmentsGateway.DeleteEnvironment).toHaveBeenCalledWith('acme-corp', 'widgets', 'staging');
      expect(renamedSpy).toHaveBeenCalledWith({ oldName: 'staging', newName: 'production' });
    }),
  );

  it(
    'does not delete the old environment when it still has secrets, unless acknowledged',
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
      fakeEnvironmentsGateway.CreateEnvironment.and.resolveTo();
      fakeVariablesGateway.CreateVariable.and.resolveTo();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('can’t be carried over');

      const input = fixture.nativeElement.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
      input.value = 'production';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      tick();
      tick();
      tick();
      fixture.detectChanges();

      expect(fakeEnvironmentsGateway.DeleteEnvironment).not.toHaveBeenCalled();
    }),
  );
});
