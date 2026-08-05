import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SectionHeaderComponent } from './SectionHeader.component';

describe('SectionHeaderComponent', () => {
  let fixture: ComponentFixture<SectionHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SectionHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(SectionHeaderComponent);
    fixture.componentRef.setInput('level', 'environment');
    fixture.componentRef.setInput('scopeLabel', 'staging');
    fixture.componentRef.setInput('description', 'Only deployments to "staging" can use these.');
    fixture.detectChanges();
  });

  it('shows the level label, scope label, and description', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Environment');
    expect(text).toContain('staging');
    expect(text).toContain('Only deployments to "staging" can use these.');
  });

  it('emits add when the "+ Add" button is clicked', () => {
    const addSpy = jasmine.createSpy('add');
    fixture.componentInstance.add.subscribe(addSpy);

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();

    expect(addSpy).toHaveBeenCalled();
  });
});
