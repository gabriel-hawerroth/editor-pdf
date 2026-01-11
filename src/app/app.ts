import { Component, ChangeDetectionStrategy } from '@angular/core';
import { PdfEditorComponent } from './components/pdf-editor/pdf-editor.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [PdfEditorComponent],
  template: '<app-pdf-editor></app-pdf-editor>',
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
