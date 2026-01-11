import {
  Component,
  ElementRef,
  ViewChild,
  input,
  output,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
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
})
export class CanvasAreaComponent implements AfterViewInit, OnChanges {
  @ViewChild('pdfCanvas') pdfCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationLayer') annotationLayer!: ElementRef<HTMLDivElement>;

  // Inputs
  canvasWidth = input.required<number>();
  canvasHeight = input.required<number>();
  zoom = input.required<number>();
  selectedTool = input.required<Tool>();
  annotations = input.required<TextAnnotation[]>();
  pencilAnnotations = input.required<PencilAnnotation[]>();
  selectedAnnotation = input<TextAnnotation | null>(null);
  eyedropperActive = input<boolean>(false);
  eraserSize = input<number>(20);
  eraserCursorVisible = input<boolean>(false);
  eraserCursorX = input<number>(0);
  eraserCursorY = input<number>(0);

  // Outputs
  canvasReady = output<HTMLCanvasElement>();
  annotationLayerReady = output<HTMLDivElement>();
  canvasMouseDown = output<MouseEvent>();
  annotationMouseDown = output<{
    annotation: TextAnnotation;
    event: MouseEvent;
  }>();
  eraserCursorMove = output<MouseEvent>();
  eraserCursorLeave = output<void>();

  isDragging = false;

  ngAfterViewInit(): void {
    if (this.pdfCanvas) {
      this.canvasReady.emit(this.pdfCanvas.nativeElement);
    }
    if (this.annotationLayer) {
      this.annotationLayerReady.emit(this.annotationLayer.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Re-emit canvas when it becomes available
    if (changes['canvasWidth'] || changes['canvasHeight']) {
      setTimeout(() => {
        if (this.pdfCanvas) {
          this.canvasReady.emit(this.pdfCanvas.nativeElement);
        }
        if (this.annotationLayer) {
          this.annotationLayerReady.emit(this.annotationLayer.nativeElement);
        }
      }, 0);
    }
  }

  onCanvasMouseDown(event: MouseEvent): void {
    this.canvasMouseDown.emit(event);
  }

  onAnnotationMouseDown(annotation: TextAnnotation, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.annotationMouseDown.emit({ annotation, event });
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
