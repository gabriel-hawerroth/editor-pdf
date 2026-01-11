import {
  Component,
  ElementRef,
  signal,
  computed,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PdfService,
  TextAnnotation,
  FontFamily,
  PencilAnnotation,
} from '../../services/pdf.service';

// Components
import { UploadAreaComponent } from '../upload-area/upload-area.component';
import { EditorToolbarComponent, Tool } from '../editor-toolbar/editor-toolbar.component';
import { PagesSidebarComponent, PageItem } from '../pages-sidebar/pages-sidebar.component';
import { CanvasAreaComponent } from '../canvas-area/canvas-area.component';
import { AnnotationPropertiesComponent } from '../annotation-properties/annotation-properties.component';
import { PageNavigationComponent } from '../page-navigation/page-navigation.component';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-pdf-editor',
  standalone: true,
  imports: [
    CommonModule,
    UploadAreaComponent,
    EditorToolbarComponent,
    PagesSidebarComponent,
    CanvasAreaComponent,
    AnnotationPropertiesComponent,
    PageNavigationComponent,
    LoadingOverlayComponent,
  ],
  templateUrl: './pdf-editor.component.html',
  styleUrl: './pdf-editor.component.scss',
})
export class PdfEditorComponent implements OnDestroy {
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

  // Configurações do lápis
  pencilColor = signal('#000000');
  pencilStrokeWidth = signal(3);
  pencilOpacity = signal(1);

  // Conta-gotas
  eyedropperTarget = signal<'text' | 'pencil'>('pencil');
  eyedropperActive = signal(false);
  previousTool = signal<Tool>('select');

  // Configurações da borracha
  eraserSize = signal(20);
  eraserCursorVisible = signal(false);
  eraserCursorX = signal(0);
  eraserCursorY = signal(0);

  // Estado do lápis
  isDrawing = false;
  private currentPencilPoints: { x: number; y: number }[] = [];

  // Dimensões do canvas
  canvasWidth = signal(0);
  canvasHeight = signal(0);

  // Estado de arrastar (drag)
  isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragAnnotationStartX = 0;
  private dragAnnotationStartY = 0;
  shouldFocusTextInput = signal(false);

  // Sidebar de páginas
  showPagesSidebar = signal(true);

  // Canvas e annotation layer refs
  private pdfCanvas: HTMLCanvasElement | null = null;
  private annotationLayerElement: HTMLDivElement | null = null;

  // Usando computed com o signal do serviço para reatividade
  annotations = computed(() =>
    this.pdfService
      .annotations()
      .filter((a) => a.pageNumber === this.currentPage())
  );

  // Anotações de lápis da página atual
  pencilAnnotations = computed(() =>
    this.pdfService
      .pencilAnnotations()
      .filter((a) => a.pageNumber === this.currentPage())
  );

  // Array de páginas com IDs únicos para tracking otimizado
  pages = computed<PageItem[]>(() =>
    this.pdfService.pageIds().map((id, index) => ({
      id,
      displayNumber: index + 1,
    }))
  );

  // Snapshot de anotações para thumbnails
  private thumbnailAnnotationsSnapshot = signal<TextAnnotation[]>([]);
  private thumbnailPencilAnnotationsSnapshot = signal<PencilAnnotation[]>([]);

  // Mapa de anotações por página para os thumbnails
  annotationsByPage = computed(() => {
    const map = new Map<number, TextAnnotation[]>();
    for (const annotation of this.thumbnailAnnotationsSnapshot()) {
      const pageAnnotations = map.get(annotation.pageNumber) || [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageNumber, pageAnnotations);
    }
    return map;
  });

  pencilAnnotationsByPage = computed(() => {
    const map = new Map<number, PencilAnnotation[]>();
    for (const annotation of this.thumbnailPencilAnnotationsSnapshot()) {
      const pageAnnotations = map.get(annotation.pageNumber) || [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageNumber, pageAnnotations);
    }
    return map;
  });

  private updateThumbnailSnapshot(): void {
    this.thumbnailAnnotationsSnapshot.set([...this.pdfService.annotations()]);
    this.thumbnailPencilAnnotationsSnapshot.set([
      ...this.pdfService.pencilAnnotations(),
    ]);
  }

  private closeEditSidebar(): void {
    if (this.selectedAnnotation() !== null) {
      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
    }
  }

  constructor(private pdfService: PdfService) {}

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

  ngOnDestroy(): void {
    // Cleanup
  }

  // Canvas handlers
  onCanvasReady(canvas: HTMLCanvasElement): void {
    this.pdfCanvas = canvas;
  }

  onAnnotationLayerReady(layer: HTMLDivElement): void {
    this.annotationLayerElement = layer;
  }

  // File handling
  async onFileSelected(file: File): Promise<void> {
    this.isLoading.set(true);
    this.fileName.set(file.name);

    try {
      const pdfDoc = await this.pdfService.loadPdf(file);
      this.totalPages.set(pdfDoc.numPages);
      this.currentPage.set(1);
      this.pdfLoaded.set(true);
      this.updateThumbnailSnapshot();

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
        this.pdfCanvas,
        this.zoom()
      );
      this.canvasWidth.set(dimensions.width);
      this.canvasHeight.set(dimensions.height);

      this.drawAllPencilAnnotations();
    } catch (error) {
      console.error('Erro ao renderizar página:', error);
    }
  }

  // Navigation
  previousPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
      this.selectedAnnotation.set(null);
      this.renderCurrentPage();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
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
    this.showPagesSidebar.update((v) => !v);
  }

  // Page operations
  async addNewPage(): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      const newPageNumber = await this.pdfService.addNewPage();
      this.totalPages.set(newPageNumber);
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

  async removeCurrentPage(): Promise<void> {
    if (!this.pdfLoaded() || this.totalPages() <= 1) return;

    const confirmRemove = confirm(
      `Tem certeza que deseja remover a página ${this.currentPage()}? Esta ação não pode ser desfeita.`
    );
    if (!confirmRemove) return;

    this.isLoading.set(true);
    try {
      const pageToRemove = this.currentPage();
      const newTotalPages = await this.pdfService.removePage(pageToRemove);
      this.totalPages.set(newTotalPages);

      if (this.currentPage() > newTotalPages) {
        this.currentPage.set(newTotalPages);
      }

      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao remover página:', error);
      alert('Erro ao remover página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async rotatePageLeft(): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      await this.pdfService.rotatePageLeft(this.currentPage());
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao rotacionar página:', error);
      alert('Erro ao rotacionar página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async rotatePageRight(): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      await this.pdfService.rotatePageRight(this.currentPage());
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao rotacionar página:', error);
      alert('Erro ao rotacionar página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async flipPageVertical(): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      await this.pdfService.flipPageVertical(this.currentPage());
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao inverter página:', error);
      alert('Erro ao inverter página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async flipPageHorizontal(): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      await this.pdfService.flipPageHorizontal(this.currentPage());
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao inverter página:', error);
      alert('Erro ao inverter página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onPageReorder(event: { fromIndex: number; toIndex: number }): Promise<void> {
    if (!this.pdfLoaded()) return;

    this.isLoading.set(true);
    try {
      const { fromIndex, toIndex } = event;
      const currentPageIndex = this.currentPage() - 1;
      let newCurrentPage = this.currentPage();

      if (currentPageIndex === fromIndex) {
        newCurrentPage = toIndex + 1;
      } else if (fromIndex < currentPageIndex && toIndex >= currentPageIndex) {
        newCurrentPage = this.currentPage() - 1;
      } else if (fromIndex > currentPageIndex && toIndex <= currentPageIndex) {
        newCurrentPage = this.currentPage() + 1;
      }

      await this.pdfService.movePage(fromIndex, toIndex);

      this.currentPage.set(newCurrentPage);
      this.selectedAnnotation.set(null);
      this.updateThumbnailSnapshot();
      await this.renderCurrentPage();
    } catch (error) {
      console.error('Erro ao reordenar página:', error);
      alert('Erro ao reordenar página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  // Zoom
  zoomIn(): void {
    this.zoom.update((z) => Math.min(z + 0.25, 3));
    this.renderCurrentPage();
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(z - 0.25, 0.5));
    this.renderCurrentPage();
  }

  // Tool selection
  selectTool(tool: Tool): void {
    this.selectedTool.set(tool);
    if (tool === 'text') {
      this.closeEditSidebar();
    }
  }

  // Eyedropper
  async openEyedropper(target: 'text' | 'pencil'): Promise<void> {
    this.eyedropperTarget.set(target);

    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        const color = result.sRGBHex;
        this.applyEyedropperColor(color);
        return;
      } catch (e) {
        console.log('EyeDropper nativo falhou, usando modo alternativo');
      }
    }

    this.previousTool.set(this.selectedTool());
    this.eyedropperActive.set(true);
  }

  private applyEyedropperColor(color: string): void {
    const target = this.eyedropperTarget();

    if (target === 'text') {
      this.textColor.set(color);
      const selected = this.selectedAnnotation();
      if (selected) {
        this.pdfService.updateAnnotation(selected.id, { color });
        this.selectedAnnotation.set({ ...selected, color });
      }
    } else {
      this.pencilColor.set(color);
    }

    this.eyedropperActive.set(false);
    this.selectedTool.set(this.previousTool());
  }

  cancelEyedropper(): void {
    this.eyedropperActive.set(false);
    this.selectedTool.set(this.previousTool());
  }

  private getColorFromCanvas(event: MouseEvent): string | null {
    if (!this.pdfCanvas) return null;

    const canvas = this.pdfCanvas;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);

    const pixel = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    const color = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1]
      .toString(16)
      .padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;

    return color;
  }

  // Canvas mouse events
  onCanvasMouseDown(event: MouseEvent): void {
    if (this.eyedropperActive()) {
      const color = this.getColorFromCanvas(event);
      if (color) {
        this.applyEyedropperColor(color);
      }
      return;
    }

    if (this.selectedTool() === 'text') {
      if (!this.annotationLayerElement) return;

      const rect = this.annotationLayerElement.getBoundingClientRect();
      const x = (event.clientX - rect.left) / this.zoom();
      const y = (event.clientY - rect.top) / this.zoom();

      const annotation = this.pdfService.addAnnotation({
        text: 'Novo texto',
        x: x,
        y: y,
        fontSize: this.fontSize() / this.zoom(),
        color: this.textColor(),
        pageNumber: this.currentPage(),
        fontFamily: 'Arial',
        bold: false,
        italic: false,
        underline: false,
      });

      this.selectedAnnotation.set(annotation);
      this.selectedTool.set('select');
      this.shouldFocusTextInput.set(true);
    } else if (this.selectedTool() === 'select') {
      this.closeEditSidebar();
    } else if (this.selectedTool() === 'pencil') {
      this.startDrawing(event);
    } else if (this.selectedTool() === 'eraser') {
      this.startErasing(event);
    }
  }

  onAnnotationMouseDown(data: { annotation: TextAnnotation; event: MouseEvent }): void {
    if (this.selectedTool() === 'select') {
      this.isDragging = true;
      this.hasMoved = false;
      this.dragStartX = data.event.clientX;
      this.dragStartY = data.event.clientY;
      this.dragAnnotationStartX = data.annotation.x;
      this.dragAnnotationStartY = data.annotation.y;
      this.draggedAnnotation = data.annotation;

      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    }
  }

  // Drawing methods
  private startDrawing(event: MouseEvent): void {
    if (!this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.zoom();
    const y = (event.clientY - rect.top) / this.zoom();

    this.isDrawing = true;
    this.currentPencilPoints = [{ x, y }];

    document.addEventListener('mousemove', this.onPencilMove);
    document.addEventListener('mouseup', this.onPencilUp);
  }

  private onPencilMove = (event: MouseEvent): void => {
    if (!this.isDrawing || !this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.zoom();
    const y = (event.clientY - rect.top) / this.zoom();

    this.currentPencilPoints.push({ x, y });
    this.drawCurrentStroke();
  };

  private onPencilUp = (): void => {
    document.removeEventListener('mousemove', this.onPencilMove);
    document.removeEventListener('mouseup', this.onPencilUp);

    if (this.currentPencilPoints.length > 1) {
      this.pdfService.addPencilAnnotation({
        points: [...this.currentPencilPoints],
        color: this.pencilColor(),
        strokeWidth: this.pencilStrokeWidth(),
        opacity: this.pencilOpacity(),
        pageNumber: this.currentPage(),
      });
      this.updateThumbnailSnapshot();
    }

    this.isDrawing = false;
    this.currentPencilPoints = [];
    this.renderCurrentPage();
  };

  // Eraser methods
  private isErasing = false;
  private lastEraseX = 0;
  private lastEraseY = 0;

  private startErasing(event: MouseEvent): void {
    if (!this.annotationLayerElement) return;

    this.isErasing = true;
    const rect = this.annotationLayerElement.getBoundingClientRect();
    this.lastEraseX = event.clientX - rect.left;
    this.lastEraseY = event.clientY - rect.top;
    this.eraseAtPosition(event);

    document.addEventListener('mousemove', this.onEraserMove);
    document.addEventListener('mouseup', this.onEraserUp);
  }

  private onEraserMove = (event: MouseEvent): void => {
    if (!this.isErasing || !this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const dx = currentX - this.lastEraseX;
    const dy = currentY - this.lastEraseY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = this.eraserSize() / 4;
    const eraserRadiusScreen = this.eraserSize() / 2;

    if (distance > step) {
      const steps = Math.ceil(distance / step);

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = this.lastEraseX + dx * t;
        const interpY = this.lastEraseY + dy * t;
        this.eraseAtScreenCoords(interpX, interpY, eraserRadiusScreen);
      }
    } else {
      this.eraseAtScreenCoords(currentX, currentY, eraserRadiusScreen);
    }

    this.lastEraseX = currentX;
    this.lastEraseY = currentY;
  };

  private onEraserUp = (): void => {
    document.removeEventListener('mousemove', this.onEraserMove);
    document.removeEventListener('mouseup', this.onEraserUp);
    this.isErasing = false;
    this.updateThumbnailSnapshot();
  };

  onEraserCursorMove(event: MouseEvent): void {
    if (this.selectedTool() !== 'eraser' || !this.annotationLayerElement) {
      this.eraserCursorVisible.set(false);
      return;
    }

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    this.eraserCursorX.set(screenX - this.eraserSize() / 2);
    this.eraserCursorY.set(screenY - this.eraserSize() / 2);
    this.eraserCursorVisible.set(true);
  }

  onEraserCursorLeave(): void {
    this.eraserCursorVisible.set(false);
  }

  private eraseAtPosition(event: MouseEvent): void {
    if (!this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const eraserRadiusScreen = this.eraserSize() / 2;

    this.eraseAtScreenCoords(screenX, screenY, eraserRadiusScreen);
  }

  private eraseAtScreenCoords(
    screenX: number,
    screenY: number,
    radiusScreen: number
  ): void {
    const zoom = this.zoom();
    const pencilAnnotations = this.pencilAnnotations();
    let hasChanges = false;

    for (const pencil of pencilAnnotations) {
      const result = this.eraseFromPathScreenCoords(
        screenX,
        screenY,
        radiusScreen,
        pencil,
        zoom
      );

      if (result.modified) {
        hasChanges = true;

        this.pdfService.removePencilAnnotation(pencil.id);

        for (const segment of result.remainingSegments) {
          if (segment.length >= 2) {
            this.pdfService.addPencilAnnotation({
              points: segment,
              color: pencil.color,
              strokeWidth: pencil.strokeWidth,
              opacity: pencil.opacity,
              pageNumber: pencil.pageNumber,
            });
          }
        }
      }
    }

    if (hasChanges) {
      this.renderCurrentPage();
    }
  }

  private eraseFromPathScreenCoords(
    screenX: number,
    screenY: number,
    radiusScreen: number,
    pencil: PencilAnnotation,
    zoom: number
  ): { modified: boolean; remainingSegments: { x: number; y: number }[][] } {
    const points = pencil.points;
    const remainingSegments: { x: number; y: number }[][] = [];
    let currentSegment: { x: number; y: number }[] = [];
    let modified = false;

    const eraserDocX = screenX / zoom;
    const eraserDocY = screenY / zoom;
    const eraserDocRadius = radiusScreen / zoom;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const distanceToCenter = Math.sqrt(
        (eraserDocX - point.x) ** 2 + (eraserDocY - point.y) ** 2
      );

      const isInsideEraser = distanceToCenter <= eraserDocRadius;

      if (isInsideEraser) {
        modified = true;

        if (currentSegment.length > 0 && i > 0) {
          const prevPoint = points[i - 1];
          const intersection = this.getCircleLineIntersection(
            eraserDocX,
            eraserDocY,
            eraserDocRadius,
            prevPoint.x,
            prevPoint.y,
            point.x,
            point.y
          );
          if (intersection) {
            currentSegment.push(intersection);
          }
        }

        if (currentSegment.length >= 2) {
          remainingSegments.push([...currentSegment]);
        }
        currentSegment = [];
      } else {
        if (currentSegment.length === 0 && i > 0) {
          const prevPoint = points[i - 1];
          const prevDistance = Math.sqrt(
            (eraserDocX - prevPoint.x) ** 2 + (eraserDocY - prevPoint.y) ** 2
          );

          if (prevDistance <= eraserDocRadius) {
            const intersection = this.getCircleLineIntersection(
              eraserDocX,
              eraserDocY,
              eraserDocRadius,
              prevPoint.x,
              prevPoint.y,
              point.x,
              point.y
            );
            if (intersection) {
              currentSegment.push(intersection);
            }
          }
        }

        currentSegment.push(point);
      }
    }

    if (currentSegment.length >= 2) {
      remainingSegments.push(currentSegment);
    }

    return { modified, remainingSegments };
  }

  private getCircleLineIntersection(
    cx: number,
    cy: number,
    r: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): { x: number; y: number } | null {
    const dx = x2 - x1;
    const dy = y2 - y1;

    const fx = x1 - cx;
    const fy = y1 - cy;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;

    let discriminant = b * b - 4 * a * c;

    if (discriminant < 0 || a === 0) {
      return null;
    }

    discriminant = Math.sqrt(discriminant);

    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    if (t1 >= 0 && t1 <= 1) {
      return { x: x1 + t1 * dx, y: y1 + t1 * dy };
    }
    if (t2 >= 0 && t2 <= 1) {
      return { x: x1 + t2 * dx, y: y1 + t2 * dy };
    }

    return null;
  }

  private drawCurrentStroke(): void {
    if (!this.pdfCanvas || this.currentPencilPoints.length < 2) return;

    this.renderCurrentPage().then(() => {
      this.drawAllPencilAnnotations();
      this.drawTemporaryStroke();
    });
  }

  private drawTemporaryStroke(): void {
    if (!this.pdfCanvas || this.currentPencilPoints.length < 2) return;

    const canvas = this.pdfCanvas;
    const context = canvas.getContext('2d');
    if (!context) return;

    const zoom = this.zoom();

    context.beginPath();
    context.strokeStyle = this.pencilColor();
    context.lineWidth = this.pencilStrokeWidth() * zoom;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.globalAlpha = this.pencilOpacity();

    context.moveTo(
      this.currentPencilPoints[0].x * zoom,
      this.currentPencilPoints[0].y * zoom
    );

    for (let i = 1; i < this.currentPencilPoints.length; i++) {
      context.lineTo(
        this.currentPencilPoints[i].x * zoom,
        this.currentPencilPoints[i].y * zoom
      );
    }

    context.stroke();
    context.globalAlpha = 1;
  }

  drawAllPencilAnnotations(): void {
    if (!this.pdfCanvas) return;

    const canvas = this.pdfCanvas;
    const context = canvas.getContext('2d');
    if (!context) return;

    const zoom = this.zoom();

    for (const pencil of this.pencilAnnotations()) {
      if (pencil.points.length < 2) continue;

      context.beginPath();
      context.strokeStyle = pencil.color;
      context.lineWidth = pencil.strokeWidth * zoom;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.globalAlpha = pencil.opacity;

      context.moveTo(pencil.points[0].x * zoom, pencil.points[0].y * zoom);

      for (let i = 1; i < pencil.points.length; i++) {
        context.lineTo(pencil.points[i].x * zoom, pencil.points[i].y * zoom);
      }

      context.stroke();
      context.globalAlpha = 1;
    }
  }

  // Drag methods
  private hasMoved = false;
  private draggedAnnotation: TextAnnotation | null = null;

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.isDragging || !this.draggedAnnotation) return;

    const deltaX = (event.clientX - this.dragStartX) / this.zoom();
    const deltaY = (event.clientY - this.dragStartY) / this.zoom();

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      this.hasMoved = true;
    }

    if (this.hasMoved) {
      const newX = this.dragAnnotationStartX + deltaX;
      const newY = this.dragAnnotationStartY + deltaY;

      this.pdfService.updateAnnotation(this.draggedAnnotation.id, {
        x: newX,
        y: newY,
      });

      this.draggedAnnotation = { ...this.draggedAnnotation, x: newX, y: newY };
    }
  };

  private onMouseUp = (): void => {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    const annotation = this.draggedAnnotation;
    const wasDragging = this.hasMoved;

    this.isDragging = false;
    this.hasMoved = false;
    this.draggedAnnotation = null;

    if (!wasDragging && annotation) {
      this.selectedAnnotation.set(annotation);
      this.shouldFocusTextInput.set(true);
    } else if (wasDragging) {
      this.updateThumbnailSnapshot();
    }
  };

  // Annotation updates
  updateAnnotationText(text: string): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.updateAnnotation(selected.id, { text });
      this.selectedAnnotation.set({ ...selected, text });
    }
  }

  updateAnnotationFontSize(size: number): void {
    const selected = this.selectedAnnotation();
    if (selected && size > 0) {
      this.pdfService.updateAnnotation(selected.id, {
        fontSize: size / this.zoom(),
      });
      this.selectedAnnotation.set({
        ...selected,
        fontSize: size / this.zoom(),
      });
    }
  }

  updateAnnotationColor(color: string): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.updateAnnotation(selected.id, { color });
      this.selectedAnnotation.set({ ...selected, color });
    }
  }

  updateAnnotationFontFamily(fontFamily: FontFamily): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      this.pdfService.updateAnnotation(selected.id, { fontFamily });
      this.selectedAnnotation.set({ ...selected, fontFamily });
    }
  }

  toggleAnnotationBold(): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      const bold = !selected.bold;
      this.pdfService.updateAnnotation(selected.id, { bold });
      this.selectedAnnotation.set({ ...selected, bold });
    }
  }

  toggleAnnotationItalic(): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      const italic = !selected.italic;
      this.pdfService.updateAnnotation(selected.id, { italic });
      this.selectedAnnotation.set({ ...selected, italic });
    }
  }

  toggleAnnotationUnderline(): void {
    const selected = this.selectedAnnotation();
    if (selected) {
      const underline = !selected.underline;
      this.pdfService.updateAnnotation(selected.id, { underline });
      this.selectedAnnotation.set({ ...selected, underline });
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

  onAnnotationFocused(): void {
    this.shouldFocusTextInput.set(false);
  }

  // Download and reset
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
  }
}
