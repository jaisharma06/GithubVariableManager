import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OAUTH_GATEWAY, type IOAuthGateway } from '../../core/gateways/IOAuthGateway';
import { ConnectScreenComponent } from './ConnectScreen.component';

describe('ConnectScreenComponent', () => {
  let fixture: ComponentFixture<ConnectScreenComponent>;
  let fakeOAuthGateway: jasmine.SpyObj<IOAuthGateway>;

  beforeEach(async () => {
    localStorage.removeItem('ghvm.session');

    fakeOAuthGateway = jasmine.createSpyObj<IOAuthGateway>('IOAuthGateway', [
      'FetchOAuthClientId',
      'StartDeviceFlow',
      'PollDeviceToken',
      'GetViewer',
    ]);
    fakeOAuthGateway.FetchOAuthClientId.and.resolveTo('client-id-123');

    await TestBed.configureTestingModule({
      imports: [ConnectScreenComponent],
      providers: [provideRouter([]), { provide: OAUTH_GATEWAY, useValue: fakeOAuthGateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectScreenComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('defaults to the personal-access-token tab', () => {
    expect(fixture.nativeElement.querySelector('#token-field')).not.toBeNull();
  });

  it('switches to the OAuth tab and shows the device-flow button once the client id loads', () => {
    const tabButtons = fixture.nativeElement.querySelectorAll('button');
    (tabButtons[1] as HTMLButtonElement).click(); // "GitHub OAuth" tab
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Continue with GitHub');
  });

  it('disables Connect until a token is entered', () => {
    const connectButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(connectButton.disabled).toBe(true);

    const input = fixture.nativeElement.querySelector('#token-field') as HTMLInputElement;
    input.value = 'ghp_test';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(connectButton.disabled).toBe(false);
  });
});
