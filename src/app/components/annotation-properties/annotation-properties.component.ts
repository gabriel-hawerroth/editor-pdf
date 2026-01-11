import {
  Component,
  input,
  output,
  ElementRef,
  ViewChild,
  AfterViewChecked,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TextAnnotation, FontFamily } from '../../services/pdf.service';

@Component({
  selector: 'app-annotation-properties',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './annotation-properties.component.html',
  styleUrl: './annotation-properties.component.scss',
})
export class AnnotationPropertiesComponent implements AfterViewChecked {
  @ViewChild('textInput') textInput!: ElementRef<HTMLInputElement>;

  annotation = input.required<TextAnnotation | null>();
  zoom = input.required<number>();
  shouldFocus = input<boolean>(false);

  textChange = output<string>();
  fontSizeChange = output<number>();
  colorChange = output<string>();
  fontFamilyChange = output<FontFamily>();
  toggleBold = output<void>();
  toggleItalic = output<void>();
  toggleUnderline = output<void>();
  deleteAnnotation = output<void>();
  focused = output<void>();

  ngAfterViewChecked(): void {
    if (this.shouldFocus() && this.textInput?.nativeElement) {
      this.textInput.nativeElement.focus();
      this.textInput.nativeElement.select();
      this.focused.emit();
    }
  }

  onTextChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.textChange.emit(input.value);
  }

  onFontSizeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const size = parseInt(input.value, 10);
    if (size > 0) {
      this.fontSizeChange.emit(size);
    }
  }

  onColorChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.colorChange.emit(input.value);
  }

  onFontFamilyChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.fontFamilyChange.emit(select.value as FontFamily);
  }

  getDisplayFontSize(): string {
    const ann = this.annotation();
    if (!ann) return '16';
    return ((ann.fontSize ?? 16) * this.zoom()).toFixed(0);
  }
}
