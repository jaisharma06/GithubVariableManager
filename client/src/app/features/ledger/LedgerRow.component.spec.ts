import { ComponentFixture, TestBed } from '@angular/core/testing';
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

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();
    buttons[2].click();

    expect(editSpy).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalled();
  });
});
