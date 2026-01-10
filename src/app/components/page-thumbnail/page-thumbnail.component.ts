import { Component, ElementRef, Input, ViewChild, AfterViewInit, OnDestroy, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PdfService, TextAnnotation } from '../../services/pdf.service';

@Component({
  selector: 'app-page-thumbnail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="thumbnail-container" 
         [class.active]="isActive"
         [class.loading]="isLoading"
         (click)="onSelect()">
      <canvas #thumbnailCanvas class="thumbnail-canvas"></canvas>
      @if (isLoading) {
        <div class="thumbnail-loader">
          <div class="spinner-small"></div>
        </div>
      }
      <span class="page-number">{{ pageNumber }}</span>
    </div>
  `,
  styles: [`
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
      to { transform: rotate(360deg); }
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
  `]
})
export class PageThumbnailComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('thumbnailCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  
  @Input() pageNumber: number = 1;
  @Input() isActive: boolean = false;
  @Input() annotations: TextAnnotation[] = [];
  @Output() pageSelect = new EventEmitter<number>();

  isLoading = true;
  private observer: IntersectionObserver | null = null;
  private isRendered = false;

  constructor(
    private pdfService: PdfService,
    private elementRef: ElementRef
  ) {}

  ngAfterViewInit(): void {
    // Usar IntersectionObserver para lazy loading
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
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
    // Re-renderizar quando as anotações mudarem
    if (changes['annotations'] && this.isRendered && this.canvasRef) {
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
        this.annotations
      );
      this.isRendered = true;
    } catch (error) {
      console.error(`Erro ao renderizar thumbnail da página ${this.pageNumber}:`, error);
    } finally {
      this.isLoading = false;
    }
  }

  onSelect(): void {
    this.pageSelect.emit(this.pageNumber);
  }
}
