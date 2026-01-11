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
  template: `
    <div
      class="thumbnail-container"
      [class.active]="isActive"
      [class.loading]="isLoading"
      [class.drag-over]="isDragOver"
      draggable="true"
      (click)="onSelect()"
      (dragstart)="onDragStart($event)"
      (dragend)="onDragEnd($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <div class="drag-handle" title="Arraste para reordenar">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 8h16M4 16h16"
          />
        </svg>
      </div>
      <canvas #thumbnailCanvas class="thumbnail-canvas"></canvas>
      @if (isLoading) {
      <div class="thumbnail-loader">
        <div class="spinner-small"></div>
      </div>
      }
      <span class="page-number">{{ pageNumber }}</span>
    </div>
  `,
  styles: [
    `
      .thumbnail-container {
        position: relative;
        cursor: pointer;
        border: 2px solid transparent;
        border-radius: 4px;
        overflow: hidden;
        transition: all 0.2s ease;
        background-color: #f0f0f0;
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          border-color: #a5b4fc;
          transform: scale(1.02);

          .drag-handle {
            opacity: 1;
          }
        }

        &.active {
          border-color: #4f46e5;
          box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.3);
        }

        &.loading {
          .thumbnail-canvas {
            opacity: 0.3;
          }
        }

        &.drag-over {
          border-color: #22c55e;
          background-color: rgba(34, 197, 94, 0.1);
          transform: scale(1.05);
        }

        &.dragging {
          opacity: 0.5;
          transform: scale(0.95);
        }
      }

      .drag-handle {
        position: absolute;
        top: 4px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        background-color: rgba(0, 0, 0, 0.6);
        border-radius: 4px;
        padding: 2px 8px;
        opacity: 0;
        transition: opacity 0.2s ease;
        cursor: grab;

        &:active {
          cursor: grabbing;
        }

        svg {
          width: 16px;
          height: 16px;
          color: white;
          display: block;
        }
      }

      .thumbnail-canvas {
        display: block;
        width: 100%;
        height: auto;
        background-color: white;
      }

      .thumbnail-loader {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      .spinner-small {
        width: 24px;
        height: 24px;
        border: 3px solid rgba(79, 70, 229, 0.3);
        border-top-color: #4f46e5;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .page-number {
        position: absolute;
        bottom: 4px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
      }
    `,
  ],
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
