import { VariableClipboardService } from './VariableClipboardService';

describe('VariableClipboardService', () => {
  let service: VariableClipboardService;

  beforeEach(() => {
    service = new VariableClipboardService();
  });

  it('starts with an empty clipboard', () => {
    expect(service.clipboard()).toBeNull();
  });

  it('CopyVariable records the name/value in the clipboard signal', () => {
    service.CopyVariable('API_URL', 'https://example.com');

    expect(service.clipboard()).toEqual({ name: 'API_URL', value: 'https://example.com' });
  });

  it('CopyVariable overwrites whatever was previously copied', () => {
    service.CopyVariable('FIRST', 'one');
    service.CopyVariable('SECOND', 'two');

    expect(service.clipboard()).toEqual({ name: 'SECOND', value: 'two' });
  });

  it('CopyVariable never throws even when navigator.clipboard is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    expect(() => service.CopyVariable('NAME', 'value')).not.toThrow();
    expect(service.clipboard()).toEqual({ name: 'NAME', value: 'value' });

    if (original) Object.defineProperty(navigator, 'clipboard', original);
  });
});
