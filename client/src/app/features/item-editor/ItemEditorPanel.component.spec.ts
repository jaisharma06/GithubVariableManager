import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { LEDGER_GATEWAY } from '../../core/gateways/ILedgerGateway';
import { OAUTH_GATEWAY } from '../../core/gateways/IOAuthGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { SECRETS_GATEWAY } from '../../core/gateways/ISecretsGateway';
import { VARIABLES_GATEWAY } from '../../core/gateways/IVariablesGateway';
import type { LedgerItem } from '../../core/Types';
import {
  ClearFakeSession,
  CreateFakeLedgerGateway,
  CreateFakeOAuthGateway,
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
  let fakeLedgerGateway: ReturnType<typeof CreateFakeLedgerGateway>;

  beforeEach(async () => {
    SeedFakeSession();
    fakeVariablesGateway = CreateFakeVariablesGateway();
    fakeSecretsGateway = CreateFakeSecretsGateway();
    fakeScopesGateway = CreateFakeScopesGateway();
    fakeLedgerGateway = CreateFakeLedgerGateway();

    await TestBed.configureTestingModule({
      imports: [ItemEditorPanelComponent],
      providers: [
        ProvideTestQueryClient(),
        { provide: VARIABLES_GATEWAY, useValue: fakeVariablesGateway },
        { provide: SECRETS_GATEWAY, useValue: fakeSecretsGateway },
        { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway },
        { provide: OAUTH_GATEWAY, useValue: CreateFakeOAuthGateway() },
        { provide: LEDGER_GATEWAY, useValue: fakeLedgerGateway },
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
      fakeVariablesGateway.CreateVariable.and.resolveTo({ manifestSynced: true });

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
      fakeVariablesGateway.UpdateVariable.and.resolveTo({ manifestSynced: true });

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
      fakeVariablesGateway.CreateVariable.and.resolveTo({ manifestSynced: true });
      fakeLedgerGateway.Copy.and.resolveTo([
        { target: { level: 'environment', scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' } }, ok: true },
      ]);

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
      // The replicate-to-environments path goes through CopyFacade.CopyTo -> ILedgerGateway.Copy,
      // one backend call fanning out over every checked environment — only the main submission
      // above still calls CreateVariable directly.
      expect(fakeLedgerGateway.Copy).toHaveBeenCalledWith(
        'variable',
        'NEW_VAR',
        'hello',
        [{ level: 'environment', scope: { org: 'acme-corp', repo: 'widgets', env: 'staging' } }],
        undefined,
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

  it(
    'shows a debounced live-resolve preview for a composite variable value',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      fakeLedgerGateway.ResolveVariable.and.resolveTo({
        resolvedValue: 'https://example.com/cdn',
        unresolvedReferences: [],
        circular: false,
      });

      GetInput().value = 'CDN';
      GetInput().dispatchEvent(new Event('input'));
      GetTextarea().value = '$(BASE_URL)/cdn';
      GetTextarea().dispatchEvent(new Event('input'));
      fixture.detectChanges();

      // Not called yet — still inside the debounce window.
      expect(fakeLedgerGateway.ResolveVariable).not.toHaveBeenCalled();

      tick(400);
      fixture.detectChanges();

      expect(fakeLedgerGateway.ResolveVariable).toHaveBeenCalledWith(
        { org: 'acme-corp', repo: 'widgets' },
        'repository',
        'CDN',
        '$(BASE_URL)/cdn',
      );
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('https://example.com/cdn');
    }),
  );

  it(
    'shows an unresolved-reference note without blocking submit',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      fakeLedgerGateway.ResolveVariable.and.resolveTo({
        resolvedValue: '$(NOT_YET_CREATED)/cdn',
        unresolvedReferences: ['NOT_YET_CREATED'],
        circular: false,
      });
      fakeVariablesGateway.CreateVariable.and.resolveTo({ manifestSynced: true });

      GetInput().value = 'CDN';
      GetInput().dispatchEvent(new Event('input'));
      GetTextarea().value = '$(NOT_YET_CREATED)/cdn';
      GetTextarea().dispatchEvent(new Event('input'));
      fixture.detectChanges();
      tick(400);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain("Doesn’t exist yet in this scope");

      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);
      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeVariablesGateway.CreateVariable).toHaveBeenCalled();
      expect(closedSpy).toHaveBeenCalled();
    }),
  );

  it(
    'blocks submit and shows an error when the live preview reports a circular reference',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      fakeLedgerGateway.ResolveVariable.and.resolveTo({
        resolvedValue: undefined,
        unresolvedReferences: [],
        circular: true,
        circularError: 'Circular reference detected: SELF -> SELF',
      });

      GetInput().value = 'SELF';
      GetInput().dispatchEvent(new Event('input'));
      GetTextarea().value = '$(SELF)';
      GetTextarea().dispatchEvent(new Event('input'));
      fixture.detectChanges();
      tick(400);
      fixture.detectChanges();

      Submit();
      tick();
      fixture.detectChanges();

      expect(fakeVariablesGateway.CreateVariable).not.toHaveBeenCalled();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Circular reference');
    }),
  );

  it('never triggers a resolve preview for a secret, even with a $(...)-shaped value', fakeAsync(() => {
    fixture.componentRef.setInput('initial', null);
    fixture.detectChanges();

    const kindSecretButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Secret',
    )!;
    kindSecretButton.click();
    fixture.detectChanges();

    GetTextarea().value = '$(SOMETHING)';
    GetTextarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    tick(400);

    expect(fakeLedgerGateway.ResolveVariable).not.toHaveBeenCalled();
  }));

  it('seeds the value box from a composite variable\'s formula, not its resolved literal, when opened for edit', () => {
    const existingComposite: LedgerItem = {
      ...EXISTING_VARIABLE,
      id: 'variable:repository:acme-corp:widgets::CDN',
      name: 'CDN',
      value: 'https://example.com/cdn',
      formula: '$(BASE_URL)/cdn',
    };
    fixture.componentRef.setInput('initial', existingComposite);
    fixture.detectChanges();

    // Round-tripping the resolved literal back as "the value" would silently detach this variable
    // from its formula on re-save (the literal doesn't match the composite regex, so the manifest
    // entry would get removed) — see ItemEditorPanel.component.ts's ngOnInit doc comment.
    expect(GetTextarea().value).toBe('$(BASE_URL)/cdn');
  });

  it(
    'shows a warning banner, without closing, when the variable write succeeds but the manifest sync fails',
    fakeAsync(() => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      fakeVariablesGateway.CreateVariable.and.resolveTo({ manifestSynced: false, manifestSyncError: 'Forbidden' });

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

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Forbidden');
      expect(closedSpy).not.toHaveBeenCalled();
    }),
  );

  it('emits closed on Escape', () => {
    fixture.componentRef.setInput('initial', null);
    fixture.detectChanges();
    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closedSpy);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(closedSpy).toHaveBeenCalled();
  });

  describe('composite-formula autocomplete', () => {
    const BASE_URL: LedgerItem = {
      id: 'variable:repository:acme-corp:widgets::BASE_URL',
      kind: 'variable',
      level: 'repository',
      scope: { org: 'acme-corp', repo: 'widgets' },
      name: 'BASE_URL',
      value: 'https://example.com',
      createdAt: '',
      updatedAt: '',
    };
    const BASE_PATH: LedgerItem = { ...BASE_URL, id: 'variable:repository:acme-corp:widgets::BASE_PATH', name: 'BASE_PATH' };

    function SetCaret(textarea: HTMLTextAreaElement, position: number): void {
      textarea.selectionStart = position;
      textarea.selectionEnd = position;
    }

    function SuggestionButtons(): HTMLButtonElement[] {
      return Array.from(fixture.nativeElement.querySelectorAll('button')).filter(
        (b): b is HTMLButtonElement => (b as HTMLButtonElement).classList.contains('font-mono'),
      );
    }

    it('shows filtered suggestions while typing an open $(...) reference', () => {
      fixture.componentRef.setInput('initial', null);
      fixture.componentRef.setInput('items', [EXISTING_VARIABLE, BASE_URL, BASE_PATH]);
      fixture.detectChanges();

      const textarea = GetTextarea();
      textarea.value = '$(BASE_';
      SetCaret(textarea, textarea.value.length);
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const names = SuggestionButtons().map((b) => b.textContent?.trim());
      expect(names).toEqual(['BASE_URL', 'BASE_PATH']);
    });

    it('excludes the item currently being edited from its own suggestions', () => {
      const composite: LedgerItem = { ...EXISTING_VARIABLE, name: 'API_URL', formula: '' };
      fixture.componentRef.setInput('initial', composite);
      fixture.componentRef.setInput('items', [composite, BASE_URL]);
      fixture.detectChanges();

      const textarea = GetTextarea();
      textarea.value = '$(API';
      SetCaret(textarea, textarea.value.length);
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(SuggestionButtons().map((b) => b.textContent?.trim())).toEqual([]);
    });

    it('selects a suggestion via ArrowDown + Enter, replacing the correct text range and moving the caret past the inserted ")"', () => {
      fixture.componentRef.setInput('initial', null);
      fixture.componentRef.setInput('items', [EXISTING_VARIABLE, BASE_URL, BASE_PATH]);
      fixture.detectChanges();

      const textarea = GetTextarea();
      textarea.value = 'prefix-$(BASE_';
      SetCaret(textarea, textarea.value.length);
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      fixture.detectChanges();
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      // ArrowDown moves from index 0 (BASE_URL) to index 1 (BASE_PATH).
      expect(GetTextarea().value).toBe('prefix-$(BASE_PATH)');
      expect(SuggestionButtons()).toEqual([]);
    });

    it('dismisses only the popup on Escape, leaving the panel open', () => {
      fixture.componentRef.setInput('initial', null);
      fixture.componentRef.setInput('items', [EXISTING_VARIABLE, BASE_URL]);
      fixture.detectChanges();
      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      const textarea = GetTextarea();
      textarea.value = '$(BASE_';
      SetCaret(textarea, textarea.value.length);
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(SuggestionButtons().length).toBeGreaterThan(0);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();

      expect(SuggestionButtons()).toEqual([]);
      expect(closedSpy).not.toHaveBeenCalled();
    });

    it('still closes the panel on Escape when no suggestions are open', () => {
      fixture.componentRef.setInput('initial', null);
      fixture.detectChanges();
      const closedSpy = jasmine.createSpy('closed');
      fixture.componentInstance.closed.subscribe(closedSpy);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(closedSpy).toHaveBeenCalled();
    });

    it('selects a suggestion via click without the textarea losing focus first', () => {
      fixture.componentRef.setInput('initial', null);
      fixture.componentRef.setInput('items', [EXISTING_VARIABLE, BASE_URL]);
      fixture.detectChanges();

      const textarea = GetTextarea();
      textarea.value = '$(BASE_';
      SetCaret(textarea, textarea.value.length);
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const button = SuggestionButtons()[0];
      // (mousedown) preventDefault is what keeps the textarea from blurring before (click) fires —
      // simulate both events the way a real click does.
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      fixture.detectChanges();

      expect(GetTextarea().value).toBe('$(BASE_URL)');
    });
  });
});
