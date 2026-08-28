import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VariableClipboardService } from '../../core/services/VariableClipboardService';
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

  it('hides the "Paste" affordance when the clipboard is empty', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Paste');
  });

  it('shows "Paste" once something is copied, and emits pasteVariable when clicked', () => {
    const clipboardService = TestBed.inject(VariableClipboardService);
    clipboardService.CopyVariable('API_URL', 'https://example.com');
    fixture.detectChanges();

    const pasteSpy = jasmine.createSpy('pasteVariable');
    fixture.componentInstance.pasteVariable.subscribe(pasteSpy);

    const pasteButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
      b.textContent?.includes('Paste'),
    )!;
    pasteButton.click();

    expect(pasteSpy).toHaveBeenCalled();
  });
});
