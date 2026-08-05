import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OAUTH_GATEWAY, type DeviceCode, type IOAuthGateway } from '../../core/gateways/IOAuthGateway';
import { OAuthDeviceFlowComponent } from './OAuthDeviceFlow.component';

const FAKE_DEVICE: DeviceCode = {
  deviceCode: 'dc',
  userCode: 'ABCD-1234',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
};

describe('OAuthDeviceFlowComponent', () => {
  let fixture: ComponentFixture<OAuthDeviceFlowComponent>;
  let fakeGateway: jasmine.SpyObj<IOAuthGateway>;

  beforeEach(async () => {
    fakeGateway = jasmine.createSpyObj<IOAuthGateway>('IOAuthGateway', [
      'FetchOAuthClientId',
      'StartDeviceFlow',
      'PollDeviceToken',
    ]);

    await TestBed.configureTestingModule({
      imports: [OAuthDeviceFlowComponent],
      providers: [{ provide: OAUTH_GATEWAY, useValue: fakeGateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(OAuthDeviceFlowComponent);
    fixture.detectChanges();
  });

  it('shows a "Continue with GitHub" button initially', () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Continue with GitHub');
  });

  it('shows the device code once StartDeviceFlow resolves', fakeAsync(() => {
    fakeGateway.StartDeviceFlow.and.resolveTo(FAKE_DEVICE);
    fakeGateway.PollDeviceToken.and.resolveTo({ status: 'pending' });

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    tick();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ABCD-1234');
  }));

  it('emits success once polling reports success', fakeAsync(() => {
    fakeGateway.StartDeviceFlow.and.resolveTo(FAKE_DEVICE);
    fakeGateway.PollDeviceToken.and.resolveTo({ status: 'success', token: 'gho_abc' });

    const successSpy = jasmine.createSpy('success');
    fixture.componentInstance.success.subscribe(successSpy);

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    tick(); // StartDeviceFlow resolves, scheduling the first poll
    tick(FAKE_DEVICE.interval * 1000); // fire that poll's timer and let PollDeviceToken resolve

    expect(successSpy).toHaveBeenCalledWith('gho_abc');
  }));

  it('shows an error and a retry button when the code expires', fakeAsync(() => {
    fakeGateway.StartDeviceFlow.and.resolveTo(FAKE_DEVICE);
    fakeGateway.PollDeviceToken.and.resolveTo({ status: 'expired' });

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    tick();
    tick(FAKE_DEVICE.interval * 1000);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This code expired');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Try again');
  }));
});
