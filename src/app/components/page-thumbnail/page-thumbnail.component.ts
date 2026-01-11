import {
  Component,
  ElementRef,
  viewChild,
  effect,
  signal,
  input,
  output,
  inject,
  ChangeDetectionStrategy,
  untracked,
  OnDestroy,
} from '@angular/core';

import {
  PdfService,
  TextAnnotation,
  PencilAnnotation,
} from '../../services/pdf.service';

@Component({
  selector: 'app-page-thumbnail',
  standalone: true,
  imports: [],
  templateUrl: './page-thumbnail.component.html',
  styleUrls: ['./page-thumbnail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.dragging]': 'isDragging()',
  },
})
export class PageThumbnailComponent implements OnDestroy {
  private readonly pdfService = inject(PdfService);
  private readonly elementRef = inject(ElementRef);

  // Signal-based ViewChild
  readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('thumbnailCanvas');

  // Signal inputs
  readonly pageId = input.required<string>();
  readonly pageNumber = input.required<number>();
  readonly isActive = input<boolean>(false);
  readonly annotations = input<TextAnnotation[]>([]);
  readonly pencilAnnotations = input<PencilAnnotation[]>([]);

  // Signal outputs
  readonly pageSelect = output<number>();
  readonly pageDrop = output<{ fromIndex: number; toIndex: number }>();

  // Signal-based state
  readonly isDragging = signal(false);
  readonly isDragOver = signal(false);
  readonly isLoading = signal(true);

  private readonly isRendered = signal(false);
  private readonly lastRenderedPageId = signal('');
  private readonly isRenderingInProgress = signal(false);
  private pendingRender = false;
  private observer: IntersectionObserver | null = null;
  private isVisible = false;

  constructor() {
    // Setup IntersectionObserver when canvas is available
    effect(() => {
      const canvas = this.canvasRef();
      if (canvas && !this.observer) {
        untracked(() => this.setupIntersectionObserver());
      }
    });

    // Unified effect for all render triggers
    effect(() => {
      const currentPageId = this.pageId();
      const canvas = this.canvasRef();
      // Track annotation changes
      const annotations = this.annotations();
      const pencilAnnotations = this.pencilAnnotations();

      if (!canvas) return;

      untracked(() => {
        // Only render if visible (intersection observer will handle initial render)
        if (!this.isVisible) return;

        const needsFullRender = currentPageId !== this.lastRenderedPageId();
        const needsAnnotationUpdate = this.isRendered() && !needsFullRender;

        if (needsFullRender) {
          this.isRendered.set(false);
          this.isLoading.set(true);
          this.renderThumbnail();
        } else if (needsAnnotationUpdate) {
          this.renderThumbnail();
        }
      });
    });
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
          if (entry.isIntersecting && !this.isRendered()) {
            this.renderThumbnail();
          }
        });
      },
      { threshold: 0.1 }
    );

    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private async renderThumbnail(): Promise<void> {
    const canvas = this.canvasRef();
    if (!canvas) return;

    // Prevent concurrent renders on the same canvas
    if (this.isRenderingInProgress()) {
      this.pendingRender = true;
      return;
    }

    this.isRenderingInProgress.set(true);

    try {
      await this.pdfService.renderThumbnailWithAnnotations(
        this.pageNumber(),
        canvas.nativeElement,
        140,
        this.annotations(),
        this.pencilAnnotations()
      );
      this.isRendered.set(true);
      this.lastRenderedPageId.set(this.pageId());
    } catch (error) {
      console.error(
        `Erro ao renderizar thumbnail da página ${this.pageNumber()}:`,
        error
      );
    } finally {
      this.isLoading.set(false);
      this.isRenderingInProgress.set(false);

      // If a render was requested while we were rendering, do it now
      if (this.pendingRender) {
        this.pendingRender = false;
        this.renderThumbnail();
      }
    }
  }

  onSelect(): void {
    this.pageSelect.emit(this.pageNumber());
  }

  onDragStart(event: DragEvent): void {
    this.isDragging.set(true);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'text/plain',
        (this.pageNumber() - 1).toString()
      );
    }
  }

  onDragEnd(): void {
    this.isDragging.set(false);
    this.isDragOver.set(false);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    if (event.dataTransfer) {
      const fromIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
      const toIndex = this.pageNumber() - 1;

      if (fromIndex !== toIndex && !isNaN(fromIndex)) {
        this.pageDrop.emit({ fromIndex, toIndex });
      }
    }
  }
}
