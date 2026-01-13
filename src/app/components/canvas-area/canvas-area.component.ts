import {
  Component,
  ElementRef,
  viewChild,
  input,
  output,
  effect,
  inject,
  Injector,
  afterNextRender,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextAnnotation, PencilAnnotation } from '../../services/pdf.service';

export type Tool = 'select' | 'text' | 'pencil' | 'eraser';

@Component({
  selector: 'app-canvas-area',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas-area.component.html',
  styleUrl: './canvas-area.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CanvasAreaComponent {
  private readonly injector = inject(Injector);

  // Signal-based ViewChild
  readonly pdfCanvas = viewChild<ElementRef<HTMLCanvasElement>>('pdfCanvas');
  readonly annotationLayer =
    viewChild<ElementRef<HTMLDivElement>>('annotationLayer');

  // Inputs
  readonly canvasWidth = input.required<number>();
  readonly canvasHeight = input.required<number>();
  readonly zoom = input.required<number>();
  readonly selectedTool = input.required<Tool>();
  readonly annotations = input.required<TextAnnotation[]>();
  readonly pencilAnnotations = input.required<PencilAnnotation[]>();
  readonly selectedAnnotation = input<TextAnnotation | null>(null);
  readonly eyedropperActive = input<boolean>(false);
  readonly eraserSize = input<number>(20);
  readonly eraserCursorVisible = input<boolean>(false);
  readonly eraserCursorX = input<number>(0);
  readonly eraserCursorY = input<number>(0);
  readonly isDragging = input<boolean>(false);

  // Outputs
  readonly canvasReady = output<HTMLCanvasElement>();
  readonly annotationLayerReady = output<HTMLDivElement>();
  readonly canvasMouseDown = output<MouseEvent>();
  readonly canvasTouchStart = output<TouchEvent>();
  readonly annotationMouseDown = output<{
    annotation: TextAnnotation;
    event: MouseEvent;
  }>();
  readonly annotationTouchStart = output<{
    annotation: TextAnnotation;
    event: TouchEvent;
  }>();
  readonly eraserCursorMove = output<MouseEvent>();
  readonly eraserCursorLeave = output<void>();

  constructor() {
    // Emit canvas refs when dimensions change
    effect(() => {
      // Track dimension changes
      this.canvasWidth();
      this.canvasHeight();

      // After render, emit the element references
      afterNextRender(
        () => {
          const canvas = this.pdfCanvas();
          const layer = this.annotationLayer();

          if (canvas) {
            this.canvasReady.emit(canvas.nativeElement);
          }
          if (layer) {
            this.annotationLayerReady.emit(layer.nativeElement);
          }
        },
        { injector: this.injector }
      );
    });
  }

  onCanvasMouseDown(event: MouseEvent): void {
    this.canvasMouseDown.emit(event);
  }

  onCanvasTouchStart(event: TouchEvent): void {
    this.canvasTouchStart.emit(event);
  }

  onAnnotationMouseDown(annotation: TextAnnotation, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.annotationMouseDown.emit({ annotation, event });
  }

  onAnnotationTouchStart(annotation: TextAnnotation, event: TouchEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.annotationTouchStart.emit({ annotation, event });
  }

  onEraserCursorMove(event: MouseEvent): void {
    this.eraserCursorMove.emit(event);
  }

  onEraserCursorLeave(): void {
    this.eraserCursorLeave.emit();
  }

  getAnnotationStyle(annotation: TextAnnotation) {
    return {
      left: `${annotation.x * this.zoom()}px`,
      top: `${annotation.y * this.zoom()}px`,
      fontSize: `${annotation.fontSize * this.zoom()}px`,
      color: annotation.color,
      fontFamily: annotation.fontFamily || 'Arial',
      fontWeight: annotation.bold ? 'bold' : 'normal',
      fontStyle: annotation.italic ? 'italic' : 'normal',
      textDecoration: annotation.underline ? 'underline' : 'none',
    };
  }

  isSelected(annotation: TextAnnotation): boolean {
    return this.selectedAnnotation()?.id === annotation.id;
  }
}
