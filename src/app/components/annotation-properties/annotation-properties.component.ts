import {
  Component,
  input,
  output,
  ElementRef,
  viewChild,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { TextAnnotation, FontFamily } from '../../services/pdf.service';

@Component({
  selector: 'app-annotation-properties',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './annotation-properties.component.html',
  styleUrl: './annotation-properties.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnotationPropertiesComponent {
  readonly textInput = viewChild<ElementRef<HTMLInputElement>>('textInput');

  readonly annotation = input.required<TextAnnotation | null>();
  readonly zoom = input.required<number>();
  readonly shouldFocus = input<boolean>(false);

  readonly textChange = output<string>();
  readonly fontSizeChange = output<number>();
  readonly colorChange = output<string>();
  readonly fontFamilyChange = output<FontFamily>();
  readonly toggleBold = output<void>();
  readonly toggleItalic = output<void>();
  readonly toggleUnderline = output<void>();
  readonly deleteAnnotation = output<void>();
  readonly focused = output<void>();

  constructor() {
    effect(() => {
      const shouldFocus = this.shouldFocus();
      const input = this.textInput();

      if (shouldFocus && input?.nativeElement) {
        input.nativeElement.focus();
        input.nativeElement.select();
        this.focused.emit();
      }
    });
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
