import {
  Component,
  ElementRef,
  Input,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostBinding,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PdfService,
  TextAnnotation,
  PencilAnnotation,
} from '../../services/pdf.service';

@Component({
  selector: 'app-page-thumbnail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-thumbnail.component.html',
  styleUrls: ['./page-thumbnail.component.scss'],
})
export class PageThumbnailComponent
  implements AfterViewInit, OnDestroy, OnChanges
{
  @ViewChild('thumbnailCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() pageId: string = '';
  @Input() pageNumber: number = 1;
  @Input() isActive: boolean = false;
  @Input() annotations: TextAnnotation[] = [];
  @Input() pencilAnnotations: PencilAnnotation[] = [];
  @Output() pageSelect = new EventEmitter<number>();
  @Output() pageDrop = new EventEmitter<{
    fromIndex: number;
    toIndex: number;
  }>();

  @HostBinding('class.dragging') isDragging = false;
  isDragOver = false;

  isLoading = true;
  private observer: IntersectionObserver | null = null;
  private isRendered = false;
  // Armazena o pageId que foi renderizado no canvas
  private lastRenderedPageId = '';

  constructor(private pdfService: PdfService, private elementRef: ElementRef) {}

  ngAfterViewInit(): void {
    // Usar IntersectionObserver para lazy loading
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !this.isRendered) {
            this.renderThumbnail();
          }
        });
      },
      { threshold: 0.1 }
    );

    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Se apenas o pageNumber mudou mas o pageId não mudou,
    // significa que o componente foi reutilizado (mesmo conteúdo, posição diferente)
    // Não precisamos re-renderizar porque o canvas já tem o conteúdo correto
    if (changes['pageNumber'] && !changes['pageId']) {
      // Apenas o número de exibição mudou, canvas já está correto
      return;
    }

    // Se o pageId mudou, precisamos re-renderizar (novo conteúdo)
    if (changes['pageId'] && !changes['pageId'].firstChange) {
      if (this.pageId !== this.lastRenderedPageId && this.canvasRef) {
        this.isRendered = false;
        this.isLoading = true;
        this.renderThumbnail();
      }
    }
    // Re-renderizar quando as anotações mudarem
    else if (
      (changes['annotations'] || changes['pencilAnnotations']) &&
      this.isRendered &&
      this.canvasRef
    ) {
      this.renderThumbnail();
    }
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private async renderThumbnail(): Promise<void> {
    try {
      await this.pdfService.renderThumbnailWithAnnotations(
        this.pageNumber,
        this.canvasRef.nativeElement,
        140,
        this.annotations,
        this.pencilAnnotations
      );
      this.isRendered = true;
      this.lastRenderedPageId = this.pageId;
    } catch (error) {
      console.error(
        `Erro ao renderizar thumbnail da página ${this.pageNumber}:`,
        error
      );
    } finally {
      this.isLoading = false;
    }
  }

  onSelect(): void {
    this.pageSelect.emit(this.pageNumber);
  }

  onDragStart(event: DragEvent): void {
    this.isDragging = true;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'text/plain',
        (this.pageNumber - 1).toString()
      );
    }
  }

  onDragEnd(event: DragEvent): void {
    this.isDragging = false;
    this.isDragOver = false;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;

    if (event.dataTransfer) {
      const fromIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
      const toIndex = this.pageNumber - 1;

      if (fromIndex !== toIndex && !isNaN(fromIndex)) {
        this.pageDrop.emit({ fromIndex, toIndex });
      }
    }
  }
}
