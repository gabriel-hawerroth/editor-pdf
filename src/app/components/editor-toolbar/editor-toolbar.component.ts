import { Component, input, output, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type Tool = 'select' | 'text' | 'pencil' | 'eraser';

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.scss',
})
export class EditorToolbarComponent {
  // Inputs
  fileName = input.required<string>();
  selectedTool = model.required<Tool>();
  zoom = input.required<number>();
  totalPages = input.required<number>();
  isLoading = input.required<boolean>();

  // Text options
  fontSize = model.required<number>();
  textColor = model.required<string>();

  // Pencil options
  pencilColor = model.required<string>();
  pencilStrokeWidth = model.required<number>();
  pencilOpacity = model.required<number>();

  // Eraser options
  eraserSize = model.required<number>();

  // Eyedropper state
  eyedropperActive = input<boolean>(false);
  eyedropperTarget = input<'text' | 'pencil'>('pencil');

  // Outputs
  resetEditor = output<void>();
  addNewPage = output<void>();
  removeCurrentPage = output<void>();
  rotatePageLeft = output<void>();
  rotatePageRight = output<void>();
  flipPageVertical = output<void>();
  flipPageHorizontal = output<void>();
  zoomIn = output<void>();
  zoomOut = output<void>();
  downloadPdf = output<void>();
  openEyedropper = output<'text' | 'pencil'>();

  selectTool(tool: Tool): void {
    this.selectedTool.set(tool);
  }

  onEyedropper(target: 'text' | 'pencil'): void {
    this.openEyedropper.emit(target);
  }
}
