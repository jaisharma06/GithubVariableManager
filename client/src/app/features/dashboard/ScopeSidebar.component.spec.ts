import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ENVIRONMENTS_GATEWAY } from '../../core/gateways/IEnvironmentsGateway';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { CreateFakeEnvironmentsGateway, CreateFakeScopesGateway, ProvideTestQueryClient } from '../../core/testing/TestDoubles';
import { DEFAULT_FILTERS } from '../ledger/LedgerFilters';
import { ScopeSidebarComponent, type ScopeNavigateEvent } from './ScopeSidebar.component';

describe('ScopeSidebarComponent', () => {
  let fixture: ComponentFixture<ScopeSidebarComponent>;
  let fakeEnvironmentsGateway: ReturnType<typeof CreateFakeEnvironmentsGateway>;

  beforeEach(async () => {
    fakeEnvironmentsGateway = CreateFakeEnvironmentsGateway();

    await TestBed.configureTestingModule({
      imports: [ScopeSidebarComponent],
      providers: [
        provideRouter([]),
        ProvideTestQueryClient(),
        { provide: ENVIRONMENTS_GATEWAY, useValue: fakeEnvironmentsGateway },
        { provide: SCOPES_GATEWAY, useValue: CreateFakeScopesGateway() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScopeSidebarComponent);
    fixture.componentRef.setInput('org', 'acme-corp');
    fixture.componentRef.setInput('repo', 'widgets');
    fixture.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    fixture.componentRef.setInput('showOrgLevel', true);
    fixture.componentRef.setInput('filters', DEFAULT_FILTERS);
    fixture.detectChanges();
  });

  it('emits navigate({ level: "organization" }) when the Organization row is clicked', () => {
    const navigateSpy = jasmine.createSpy('navigate');
    fixture.componentInstance.navigate.subscribe(navigateSpy);

    const buttons = fixture.nativeElement.querySelectorAll('button');
    const orgButton = Array.from(buttons).find((b) => (b as HTMLButtonElement).textContent?.includes('Organization')) as HTMLButtonElement;
    orgButton.click();

    expect(navigateSpy).toHaveBeenCalledWith({ level: 'organization' } as ScopeNavigateEvent);
  });

  it('lists the given environments and emits renameEnvironment/deleteEnvironment on their icon buttons', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('staging');

    const renameSpy = jasmine.createSpy('renameEnvironment');
    fixture.componentInstance.renameEnvironment.subscribe(renameSpy);
    (fixture.nativeElement.querySelector('[title=\'Rename environment "staging"\']') as HTMLButtonElement).click();
    expect(renameSpy).toHaveBeenCalledWith('staging');

    const deleteSpy = jasmine.createSpy('deleteEnvironment');
    fixture.componentInstance.deleteEnvironment.subscribe(deleteSpy);
    (fixture.nativeElement.querySelector('[title=\'Delete environment "staging"\']') as HTMLButtonElement).click();
    expect(deleteSpy).toHaveBeenCalledWith('staging');
  });

  it('creates a new environment via EnvironmentsFacade and closes the form on success', fakeAsync(() => {
    fakeEnvironmentsGateway.CreateEnvironment.and.resolveTo();

    const openButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.includes('New environment'),
    )!;
    openButton.click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'production';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    tick();
    fixture.detectChanges();

    expect(fakeEnvironmentsGateway.CreateEnvironment).toHaveBeenCalledWith('acme-corp', 'widgets', 'production');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('New environment');
  }));
});
