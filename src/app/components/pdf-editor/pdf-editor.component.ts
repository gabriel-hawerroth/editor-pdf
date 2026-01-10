import { Component, ElementRef, ViewChild, signal, computed, AfterViewChecked, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PdfService, TextAnnotation } from '../../services/pdf.service';
import { PageThumbnailComponent } from '../page-thumbnail/page-thumbnail.component';

type Tool = 'select' | 'text';

@Component({
  selector: 'app-pdf-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, PageThumbnailComponent],
  templateUrl: './pdf-editor.component.html',
  styleUrl: './pdf-editor.component.scss'
})
export class PdfEditorComponent implements AfterViewChecked, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('pdfCanvas') pdfCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationLayer') annotationLayer!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInput!: ElementRef<HTMLInputElement>;
  @ViewChild('canvasWrapper') canvasWrapper!: ElementRef<HTMLDivElement>;;

  // Estado reativo
  pdfLoaded = signal(false);
  currentPage = signal(1);
  totalPages = signal(0);
  zoom = signal(1.5);
  selectedTool = signal<Tool>('select');
  selectedAnnotation = signal<TextAnnotation | null>(null);
  isLoading = signal(false);
  fileName = signal('');

  // Configurações de texto
  fontSize = signal(16);
  textColor = signal('#000000');

  // Dimensões do canvas
  canvasWidth = signal(0);
  canvasHeight = signal(0);

  // Estado de arrastar (drag)
  isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragAnnotationStartX = 0;
  private dragAnnotationStartY = 0;
  private shouldFocusTextInput = false;

  // Sidebar de páginas
  showPagesSidebar = signal(true);

  // Usando computed com o signal do serviço para reatividade
  annotations = computed(() => 
    this.pdfService.annotations().filter(a => a.pageNumber === this.currentPage())
  );

  // Array de números de páginas para o ngFor
  pages = computed(() => 
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

  // Snapshot de anotações para thumbnails - só atualiza em momentos específicos
  // (quando sidebar fecha, drag termina, ou PDF é carregado)
  private thumbnailAnnotationsSnapshot = signal<TextAnnotation[]>([]);
  
  // Mapa de anotações por página para os thumbnails (baseado no snapshot)
  annotationsByPage = computed(() => {
    const map = new Map<number, TextAnnotation[]>();
    for (const annotation of this.thumbnailAnnotationsSnapshot()) {
      const pageAnnotations = map.get(annotation.pageNumber) || [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageNumber, pageAnnotations);
    }
    return map;
  });

  // Método para atualizar snapshot dos thumbnails
  private updateThumbnailSnapshot(): void {
    this.thumbnailAnnotationsSnapshot.set([...this.pdfService.annotations()]);
  }

  // Método centralizado para fechar sidebar e atualizar thumbnails
  private closeEditSidebar(): void {
    if (this.selectedAnnotation() !== null) {
      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
    }
  }

  constructor(private pdfService: PdfService) {}

  // Interceptar Ctrl+Scroll para zoom customizado
  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent): void {
    if (event.ctrlKey && this.pdfLoaded()) {
      event.preventDefault();
      
      if (event.deltaY < 0) {
        this.zoomIn();
      } else {
        this.zoomOut();
      }
    }
  }

  ngAfterViewChecked(): void {
    // Auto focus no campo de texto após adicionar uma anotação
    if (this.shouldFocusTextInput && this.textInput?.nativeElement) {
      this.textInput.nativeElement.focus();
      this.textInput.nativeElement.select();
      this.shouldFocusTextInput = false;
    }
  }

  ngOnDestroy(): void {
    // Cleanup se necessário
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.loadPdf(input.files[0]);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0];
      if (file.type === 'application/pdf') {
        this.loadPdf(file);
      }
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  async loadPdf(file: File): Promise<void> {
    this.isLoading.set(true);
    this.fileName.set(file.name);

    try {
      const pdfDoc = await this.pdfService.loadPdf(file);
      this.totalPages.set(pdfDoc.numPages);
      this.currentPage.set(1);
      this.pdfLoaded.set(true);
      this.updateThumbnailSnapshot();
      
      // Aguardar o próximo ciclo para garantir que o canvas está no DOM
      setTimeout(() => this.renderCurrentPage(), 0);
    } catch (error) {
      console.error('Erro ao carregar PDF:', error);
      alert('Erro ao carregar o arquivo PDF. Verifique se o arquivo é válido.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async renderCurrentPage(): Promise<void> {
    if (!this.pdfCanvas) return;

    try {
      const dimensions = await this.pdfService.renderPage(
        this.currentPage(),
        this.pdfCanvas.nativeElement,
        this.zoom()
      );
      this.canvasWidth.set(dimensions.width);
      this.canvasHeight.set(dimensions.height);
    } catch (error) {
      console.error('Erro ao renderizar página:', error);
    }
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
      this.selectedAnnotation.set(null);
      this.renderCurrentPage();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
      this.selectedAnnotation.set(null);
      this.renderCurrentPage();
    }
  }

  goToPage(pageNumber: number): void {
    if (pageNumber >= 1 && pageNumber <= this.totalPages()) {
      this.currentPage.set(pageNumber);
      this.selectedAnnotation.set(null);
      this.renderCurrentPage();
    }
  }

  togglePagesSidebar(): void {
    this.showPagesSidebar.update(v => !v);
  }

  async addNewPage(): Promise<void> {
    if (!this.pdfLoaded()) return;
    
    this.isLoading.set(true);
    try {
      const newPageNumber = await this.pdfService.addNewPage();
      this.totalPages.set(newPageNumber);
      // Navegar para a nova página
      this.currentPage.set(newPageNumber);
      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao adicionar nova página:', error);
      alert('Erro ao adicionar nova página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  zoomIn(): void {
    this.zoom.update(z => Math.min(z + 0.25, 3));
    this.renderCurrentPage();
  }

  zoomOut(): void {
    this.zoom.update(z => Math.max(z - 0.25, 0.5));
    this.renderCurrentPage();
  }

  selectTool(tool: Tool): void {
    this.selectedTool.set(tool);
    if (tool === 'text') {
      this.closeEditSidebar();
    }
  }

  onCanvasMouseDown(event: MouseEvent): void {
    if (this.selectedTool() === 'text') {
      const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
      const x = (event.clientX - rect.left) / this.zoom();
      const y = (event.clientY - rect.top) / this.zoom();

      const annotation = this.pdfService.addAnnotation({
        text: 'Novo texto',
        x: x,
        y: y,
        fontSize: this.fontSize() / this.zoom(),
        color: this.textColor(),
        pageNumber: this.currentPage()
      });

      this.selectedAnnotation.set(annotation);
      this.selectedTool.set('select');
      // Ativar auto focus no campo de texto
      this.shouldFocusTextInput = true;
    } else if (this.selectedTool() === 'select') {
      // Clicou fora de qualquer anotação - fechar sidebar
      this.closeEditSidebar();
    }
  }

  // Métodos de arrastar (drag)
  private hasMoved = false;
  private draggedAnnotation: TextAnnotation | null = null;

  onAnnotationMouseDown(annotation: TextAnnotation, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    
    if (this.selectedTool() === 'select') {
      this.isDragging = true;
      this.hasMoved = false;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragAnnotationStartX = annotation.x;
      this.dragAnnotationStartY = annotation.y;
      this.draggedAnnotation = annotation;

      // Adicionar listeners globais para capturar movimento fora do elemento
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    }
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.isDragging || !this.draggedAnnotation) return;

    const deltaX = (event.clientX - this.dragStartX) / this.zoom();
    const deltaY = (event.clientY - this.dragStartY) / this.zoom();

    // Só considera como movimento se deslocou mais de 3 pixels
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      this.hasMoved = true;
    }

    if (this.hasMoved) {
      const newX = this.dragAnnotationStartX + deltaX;
      const newY = this.dragAnnotationStartY + deltaY;

      this.pdfService.updateAnnotation(this.draggedAnnotation.id, { x: newX, y: newY });
      
      // Atualizar referência local para manter a posição sincronizada
      this.draggedAnnotation = { ...this.draggedAnnotation, x: newX, y: newY };
    }
  };

  private onMouseUp = (): void => {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    const annotation = this.draggedAnnotation;
    const wasDragging = this.hasMoved;

    // Resetar estados
    this.isDragging = false;
    this.hasMoved = false;
    this.draggedAnnotation = null;

    // Se NÃO arrastou (foi apenas um clique), abrir sidebar para edição
    if (!wasDragging && annotation) {
      this.selectedAnnotation.set(annotation);
      // Ativar auto focus no campo de texto
      this.shouldFocusTextInput = true;
    } else if (wasDragging) {
      // Atualizar thumbnails após arrastar
      this.updateThumbnailSnapshot();
    }
  };

  updateAnnotationText(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.updateAnnotation(selected.id, { text: input.value });
      this.selectedAnnotation.set({ ...selected, text: input.value });
    }
  }

  updateAnnotationFontSize(event: Event): void {
    const input = event.target as HTMLInputElement;
    const size = parseInt(input.value, 10);
    const selected = this.selectedAnnotation();
    if (selected && size > 0) {
      this.pdfService.updateAnnotation(selected.id, { fontSize: size / this.zoom() });
      this.selectedAnnotation.set({ ...selected, fontSize: size / this.zoom() });
    }
  }

  updateAnnotationColor(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.updateAnnotation(selected.id, { color: input.value });
      this.selectedAnnotation.set({ ...selected, color: input.value });
    }
  }

  deleteSelectedAnnotation(): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.removeAnnotation(selected.id);
      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
    }
  }

  async downloadPdf(): Promise<void> {
    this.isLoading.set(true);
    try {
      const pdfBytes = await this.pdfService.exportPdf();
      const newFileName = this.fileName().replace('.pdf', '-editado.pdf');
      this.pdfService.downloadPdf(pdfBytes, newFileName);
    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      alert('Erro ao exportar o PDF.');
    } finally {
      this.isLoading.set(false);
    }
  }

  resetEditor(): void {
    this.pdfService.reset();
    this.pdfLoaded.set(false);
    this.currentPage.set(1);
    this.totalPages.set(0);
    this.selectedAnnotation.set(null);
    this.fileName.set('');
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  openFileDialog(): void {
    this.fileInput.nativeElement.click();
  }

  // Helper para posicionar anotações
  getAnnotationStyle(annotation: TextAnnotation) {
    return {
      left: `${annotation.x * this.zoom()}px`,
      top: `${annotation.y * this.zoom()}px`,
      fontSize: `${annotation.fontSize * this.zoom()}px`,
      color: annotation.color
    };
  }

  isSelected(annotation: TextAnnotation): boolean {
    return this.selectedAnnotation()?.id === annotation.id;
  }
}
