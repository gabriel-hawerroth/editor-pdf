import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageThumbnailComponent } from '../page-thumbnail/page-thumbnail.component';
import { TextAnnotation, PencilAnnotation } from '../../services/pdf.service';

export interface PageItem {
  id: string;
  displayNumber: number;
}

@Component({
  selector: 'app-pages-sidebar',
  standalone: true,
  imports: [CommonModule, PageThumbnailComponent],
  templateUrl: './pages-sidebar.component.html',
  styleUrl: './pages-sidebar.component.scss',
})
export class PagesSidebarComponent {
  isOpen = input.required<boolean>();
  pages = input.required<PageItem[]>();
  currentPage = input.required<number>();
  annotationsByPage = input.required<Map<number, TextAnnotation[]>>();
  pencilAnnotationsByPage = input.required<Map<number, PencilAnnotation[]>>();

  closeSidebar = output<void>();
  openSidebar = output<void>();
  pageSelect = output<number>();
  pageReorder = output<{ fromIndex: number; toIndex: number }>();

  onPageSelect(pageNumber: number): void {
    this.pageSelect.emit(pageNumber);
  }

  onPageDrop(event: { fromIndex: number; toIndex: number }): void {
    this.pageReorder.emit(event);
  }
}
