import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SCOPES_GATEWAY } from '../../core/gateways/IScopesGateway';
import { CreateFakeScopesGateway, ProvideTestQueryClient } from '../../core/testing/TestDoubles';
import { WaitFor } from '../../core/testing/WaitFor';
import { ScopePickerComponent } from './ScopePicker.component';

const STORAGE_KEY = 'ghvm.session';

describe('ScopePickerComponent', () => {
  let fixture: ComponentFixture<ScopePickerComponent>;
  let fakeScopesGateway: ReturnType<typeof CreateFakeScopesGateway>;

  beforeEach(async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token: 'tok', method: 'pat', viewer: { login: 'octocat', avatarUrl: '' } }),
    );
    sessionStorage.removeItem('ghvm.lastScope');

    fakeScopesGateway = CreateFakeScopesGateway();
    fakeScopesGateway.ListMyOrgs.and.resolveTo([{ login: 'acme-corp', avatarUrl: '' }]);
    fakeScopesGateway.ListMyRepos.and.resolveTo([
      { id: 1, name: 'widgets', fullName: 'acme-corp/widgets', owner: 'acme-corp', private: true },
    ]);

    await TestBed.configureTestingModule({
      imports: [ScopePickerComponent],
      providers: [provideRouter([]), ProvideTestQueryClient(), { provide: SCOPES_GATEWAY, useValue: fakeScopesGateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(ScopePickerComponent);
    // See core/testing/WaitFor.ts — TanStack Angular Query runs outside NgZone, so
    // whenStable()/fakeAsync can't observe its resolution; poll for real instead. Checked via the
    // DOM (not a protected query/loading signal) since that's what the component actually exposes.
    await WaitFor(fixture, () => !fixture.nativeElement.querySelector('.animate-pulse'));
  });

  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('lists the fetched organizations and repositories', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('acme-corp');
    expect(text).toContain('acme-corp/widgets');
  });

  it('filters both lists by the search query', () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'widgets';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('acme-corp/widgets');
    expect(text).not.toContain('No repositories matched');
    expect(text).toContain('No organizations matched');
  });

  it('shows "Connected as <login>"', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Connected as octocat');
  });

  it('navigates to /connect when Disconnect is clicked', () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const disconnectButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Disconnect')!;
    disconnectButton.click();
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/connect');
  });
});
