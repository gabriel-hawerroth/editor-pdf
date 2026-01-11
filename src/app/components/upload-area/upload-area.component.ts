import { Component, output, ElementRef, ViewChild } from '@angular/core';

@Component({
  selector: 'app-upload-area',
  standalone: true,
  templateUrl: './upload-area.component.html',
  styleUrl: './upload-area.component.scss',
})
export class UploadAreaComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  fileSelected = output<File>();

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.fileSelected.emit(input.files[0]);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      if (file.type === 'application/pdf') {
        this.fileSelected.emit(file);
      }
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  openFileDialog(): void {
    this.fileInput.nativeElement.click();
  }
}
