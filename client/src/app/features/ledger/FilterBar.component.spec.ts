import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_FILTERS } from './LedgerFilters';
import { FilterBarComponent } from './FilterBar.component';

describe('FilterBarComponent', () => {
  let fixture: ComponentFixture<FilterBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterBarComponent] }).compileComponents();
  });

  function CreateFixture(showOrgLevel: boolean, showRepoLevels: boolean): ComponentFixture<FilterBarComponent> {
    const f = TestBed.createComponent(FilterBarComponent);
    f.componentRef.setInput('filters', DEFAULT_FILTERS);
    f.componentRef.setInput('environments', [{ id: 1, name: 'staging' }]);
    f.componentRef.setInput('showOrgLevel', showOrgLevel);
    f.componentRef.setInput('showRepoLevels', showRepoLevels);
    f.detectChanges();
    return f;
  }

  it('only shows the Organization pill when showOrgLevel is true', () => {
    fixture = CreateFixture(false, true);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Organization');
  });

  it('shows the Organization pill when showOrgLevel is true', () => {
    fixture = CreateFixture(true, true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Organization');
  });

  it('hides the Repository/Environment pills and env select when showRepoLevels is false', () => {
    fixture = CreateFixture(true, false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Repository');
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
  });

  it('shows the Repository/Environment pills and env select when showRepoLevels is true', () => {
    fixture = CreateFixture(true, true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Repository');
    expect(text).toContain('Environment');
    expect(fixture.nativeElement.querySelector('select')).not.toBeNull();
  });

  it('emits filtersChange with the updated level when a level pill is clicked', () => {
    fixture = CreateFixture(true, true);
    const changeSpy = jasmine.createSpy('filtersChange');
    fixture.componentInstance.filtersChange.subscribe(changeSpy);

    const orgPill = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.trim() === 'Organization',
    )!;
    orgPill.click();

    expect(changeSpy).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, level: 'organization' });
  });

  it('emits filtersChange with the updated search text as the user types', () => {
    fixture = CreateFixture(true, true);
    const changeSpy = jasmine.createSpy('filtersChange');
    fixture.componentInstance.filtersChange.subscribe(changeSpy);

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'API_URL';
    input.dispatchEvent(new Event('input'));

    expect(changeSpy).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, search: 'API_URL' });
  });
});
