import { Component, input, output } from '@angular/core';


@Component({
  selector: 'app-page-navigation',
  standalone: true,
  imports: [],
  templateUrl: './page-navigation.component.html',
  styleUrl: './page-navigation.component.scss',
})
export class PageNavigationComponent {
  currentPage = input.required<number>();
  totalPages = input.required<number>();

  previousPage = output<void>();
  nextPage = output<void>();
}
