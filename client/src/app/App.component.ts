import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The root shell — just a router host. Phase 0 had this render a placeholder message directly;
 * now that '/connect' is real, routed content (which supplies its own full-viewport layout),
 * this stays a thin wrapper so routed pages aren't nested inside a second min-h-screen container.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './App.component.html',
})
export class AppComponent {}
