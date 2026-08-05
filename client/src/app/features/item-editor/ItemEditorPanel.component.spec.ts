import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeScopesGateway,
  CreateFakeSecretsGateway,
  CreateFakeVariablesGateway,
  ProvideTestQueryClient,
  SeedFakeSession,
} from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { ItemEditorPanelComponent } from './ItemEditorPanel.component';

const EXISTING_VARIABLE: LedgerItem = {
  id: 'variable:repository:acme-corp:widgets::API_URL',
  kind: 'variable',
  level: 'repository',
  scope: { org: 'acme-corp', repo: 'widgets' },
  name: 'API_URL',
  value: 'https://example.com',
  createdAt: '',
  updatedAt: '',
};

describe('ItemEditorPanelComponent', () => {
  let fixture: ComponentFixture<ItemEditorPanelComponent>;
  let fakeVariablesGateway: ReturnType<typeof CreateFakeVariablesGateway>;
  let fakeSecretsGateway: ReturnType<typeof CreateFakeSecretsGateway>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeVariablesGateway = CreateFakeVariablesGateway();
    fakeSecretsGateway = CreateFakeSecretsGateway();
    fakeScopesGateway = CreateFakeScopesGateway();

    await TestBed.configureTestingModule({
      imports: [ItemEditorPanelComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: fakeSecretsGateway },
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemEditorPanelComponent);
    fixture.componentRef.setInput('scope', { org: 'acme-corp', repo: 'widgets' });
    fixture.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    fixture.componentRef.setInput('items', [EXISTING_VARIABLE]);
    fixture.componentRef.setInput('showOrgLevel', true);
  });

  afterEach(() => ClearFakeSession());

  function GetInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('input[placeholder="API_URL"]') as HTMLInputElement;
  }

  function GetTextarea(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  }

  function Submit(): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  }

  it('shows "Add" and defaults to the repository level for a new item', () => {
    fixture.componentRef.setInput('initial', null);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Add');
    expect(fixture.nativeElement.querySelector('select')?.value).toBe('repository');
  });

  it('shows "Edit" with the level/type locked to plain text for an existing item', () => {
    fixture.componentRef.setInput('initial', EXISTING_VARIABLE);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Edit');
    expect(text).toContain('API_URL');
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(GetInput().value).toBe('API_URL');
    expect(GetTextarea().value).toBe('https://example.com');
  });

  it('rejects an invalid name', () => {
    fixture.componentRef.setInput('initial', null);
    fixture.detectChanges();

    const input = GetInput();
    input.value = '1BAD NAME';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Letters, numbers, and underscores only.');
  });

  it(
    'creates a new variable',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      fakeVariablesGateway.CreateVariable.and.resolveTo();

      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      GetInput().value = 'NEW_VAR';
      GetInput().dispatchEvent(new Event('input'));
      GetTextarea().value = 'hello';
      GetTextarea().dispatchEvent(new Event('input'));
      fixture.detectChanges();

      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets' },
        'repository',
        'NEW_VAR',
        'hello',
      );
      expect(closedSpy).toHaveBeenCalled();
    }),
  );

  it(
    'saves changes to an existing variable, including a rename',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', EXISTING_VARIABLE);
      fixture.detectChanges();
      fakeVariablesGateway.UpdateVariable.and.resolveTo();

      GetInput().value = 'API_URL_2';
      GetInput().dispatchEvent(new Event('input'));
      fixture.detectChanges();

      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeVariablesGateway.UpdateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets' },
        'repository',
        'API_URL',
        'API_URL_2',
        'https://example.com',
      );
    }),
  );

  it('shows the rename note for a secret whose name is being changed', () => {
    const existingSecret: LedgerItem = { ...EXISTING_VARIABLE, id: 'secret:1', kind: 'secret', value: undefined };
    fixture.componentRef.setInput('initial', existingSecret);
    fixture.detectChanges();

    GetInput().value = 'TOKEN_2';
    GetInput().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain("can’t be renamed directly");
  });

  it(
    'replicates a new variable to checked environments',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.componentRef.setInput('items', []);
      fixture.detectChanges();
      fakeVariablesGateway.CreateVariable.and.resolveTo();

      GetInput().value = 'NEW_VAR';
      GetInput().dispatchEvent(new Event('input'));
      GetTextarea().value = 'hello';
      GetTextarea().dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const replicateCheckbox = fixture.nativeElement.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      replicateCheckbox.click();
      fixture.detectChanges();

      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets' },
        'repository',
        'NEW_VAR',
        'hello',
      );
      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets', env: 'staging' },
        'environment',
        'NEW_VAR',
        'hello',
      );
    }),
  );

  it('loads org repos once "Selected repositories" is chosen for an org-level secret', async () => {
    fixture.componentRef.setInput('initial', null);
    fixture.componentRef.setInput('scope', { org: 'acme-corp' });
    fixture.detectChanges();
    fakeScopesGateway.ListOrgRepos.and.resolveTo([
      { id: 1, name: 'widgets', fullName: 'acme-corp/widgets', owner: 'acme-corp', private: true },
    ]);

    const kindSecretButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Secret',
    )!;
    kindSecretButton.click();
    fixture.detectChanges();

    const visibilitySelect = Array.from(fixture.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>).find(
      (s) => s.querySelector('option[value="selected"]'),
    )!;
    visibilitySelect.value = 'selected';
    visibilitySelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    await WaitFor(fixture, () => (fixture.nativeElement as HTMLElement).textContent?.includes('widgets') ?? false);

    expect(fakeScopesGateway.ListOrgRepos).toHaveBeenCalledWith('acme-corp');
  });

  it('emits closed on Escape', () => {
    fixture.componentRef.setInput('initial', null);
    fixture.detectChanges();
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closedSpy);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closedSpy).toHaveBeenCalled();
  });
});
