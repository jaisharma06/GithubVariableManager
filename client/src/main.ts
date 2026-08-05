import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/App.config';
import { AppComponent } from './app/App.component';

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
