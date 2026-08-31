import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VariableClipboardService } from '../../core/services/VariableClipboardService';
import type { LedgerItem } from '../../core/Types';
import { LedgerRowComponent } from './LedgerRow.component';

describe('LedgerRowComponent', () => {
  let fixture: ComponentFixture<LedgerRowComponent>;

  const VARIABLE: LedgerItem = {
    id: 'variable:repository:acme-corp:widgets::API_URL',
    kind: 'variable',
    level: 'repository',
    scope: { org: 'acme-corp', repo: 'widgets' },
    name: 'API_URL',
    value: 'https://example.com',
    createdAt: '',
    updatedAt: '',
  };

  const SECRET: LedgerItem = {
    id: 'secret:repository:acme-corp:widgets::TOKEN',
    kind: 'secret',
    level: 'repository',
    scope: { org: 'acme-corp', repo: 'widgets' },
    name: 'TOKEN',
    visibility: 'all',
    createdAt: '',
    updatedAt: '',
  };

  async function CreateFixture(item: LedgerItem, hideValues = false): Promise<ComponentFixture<LedgerRowComponent>> {
    await TestBed.configureTestingModule({ imports: [LedgerRowComponent] }).compileComponents();
    const f = TestBed.createComponent(LedgerRowComponent);
    f.componentRef.setInput('item', item);
    f.componentRef.setInput('hideValues', hideValues);
    f.detectChanges();
    return f;
  }

  it('shows a variable name and its plaintext value', async () => {
    fixture = await CreateFixture(VARIABLE);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('API_URL');
    expect(text).toContain('https://example.com');
    expect(text).toContain('VAR');
  });

  it('masks a variable value when hideValues is true', async () => {
    fixture = await CreateFixture(VARIABLE, true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('https://example.com');
    expect(text).toContain('••••••••••••');
  });

  it('always masks a secret value and shows the write-only note, regardless of hideValues', async () => {
    fixture = await CreateFixture(SECRET, false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TOKEN');
    expect(text).toContain('SEC');
    expect(text).toContain('write-only');
  });

  it('emits editItem/copyItem/deleteItem when their buttons are clicked', async () => {
    fixture = await CreateFixture(VARIABLE);
    const editSpy = jasmine.createSpy('editItem');
    const copySpy = jasmine.createSpy('copyItem');
    const deleteSpy = jasmine.createSpy('deleteItem');
    fixture.componentInstance.editItem.subscribe(editSpy);
    fixture.componentInstance.copyItem.subscribe(copySpy);
    fixture.componentInstance.deleteItem.subscribe(deleteSpy);

    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[title="Edit"]') as HTMLButtonElement).click();
    (el.querySelector('[title^="Copy to other scopes"]') as HTMLButtonElement).click();
    (el.querySelector('[title="Delete"]') as HTMLButtonElement).click();

    expect(editSpy).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('shows a "copy value" action for a variable row and copies it to VariableClipboardService', async () => {
    fixture = await CreateFixture(VARIABLE);
    const clipboardService = TestBed.inject(VariableClipboardService);

    const copyValueButton = fixture.nativeElement.querySelector('[title="Copy value to clipboard"]') as HTMLButtonElement;
    expect(copyValueButton).toBeTruthy();
    copyValueButton.click();

    expect(clipboardService.clipboard()).toEqual({ name: 'API_URL', value: 'https://example.com' });
  });

  it('never shows a "copy value" action for a secret row', async () => {
    fixture = await CreateFixture(SECRET);

    expect(fixture.nativeElement.querySelector('[title="Copy value to clipboard"]')).toBeNull();
  });

  const COMPOSITE_VARIABLE: LedgerItem = {
    ...VARIABLE,
    name: 'CDN',
    value: '$(BASE_URL)/cdn',
    resolvedValue: 'https://example.com/cdn',
    unresolvedReferences: [],
  };

  it('shows the resolved value and a composite badge for a composite variable, with the raw formula in a tooltip', async () => {
    fixture = await CreateFixture(COMPOSITE_VARIABLE);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('https://example.com/cdn');
    expect(text).toContain('ƒ(x)');
    const formulaEl = (fixture.nativeElement as HTMLElement).querySelector('[title^="Formula: "]') as HTMLElement;
    expect(formulaEl.title).toContain('$(BASE_URL)/cdn');
  });

  it('shows broken-reference styling when a composite variable has unresolved references', async () => {
    fixture = await CreateFixture({ ...COMPOSITE_VARIABLE, unresolvedReferences: ['BASE_URL'] });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('https://example.com/cdn'); // still shown, broken reference stays visible in place
    const brokenEl = (fixture.nativeElement as HTMLElement).querySelector('.text-danger');
    expect(brokenEl).toBeTruthy();
  });

  it('offers a "flatten to today\'s resolved value" action for a composite variable, and emits flattenItem when clicked', async () => {
    fixture = await CreateFixture(COMPOSITE_VARIABLE);
    const flattenSpy = jasmine.createSpy('flattenItem');
    fixture.componentInstance.flattenItem.subscribe(flattenSpy);

    const flattenButton = fixture.nativeElement.querySelector('[title^="Flatten to today\'s resolved value"]') as HTMLButtonElement;
    expect(flattenButton).toBeTruthy();
    flattenButton.click();

    expect(flattenSpy).toHaveBeenCalled();
  });

  it('never offers the flatten action for a plain (non-composite) variable', async () => {
    fixture = await CreateFixture(VARIABLE);

    expect(fixture.nativeElement.querySelector('[title^="Flatten to today\'s resolved value"]')).toBeNull();
  });

  it('never offers the flatten action for a secret row', async () => {
    fixture = await CreateFixture(SECRET);

    expect(fixture.nativeElement.querySelector('[title^="Flatten to today\'s resolved value"]')).toBeNull();
  });
});
