import { Component, input } from '@angular/core';


@Component({
  selector: 'app-loading-overlay',
  standalone: true,
  imports: [],
  templateUrl: './loading-overlay.component.html',
  styleUrl: './loading-overlay.component.scss',
})
export class LoadingOverlayComponent {
  isLoading = input.required<boolean>();
  message = input<string>('Processando...');
}
