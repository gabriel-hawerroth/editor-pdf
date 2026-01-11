import {
  Component,
  signal,
  computed,
  HostListener,
  OnDestroy,
  ChangeDetectionStrategy,
  inject,
  Injector,
  afterNextRender,
} from '@angular/core';

import {
  PdfService,
  TextAnnotation,
  FontFamily,
  PencilAnnotation,
} from '../../services/pdf.service';

// Components
import { UploadAreaComponent } from '../upload-area/upload-area.component';
import {
  EditorToolbarComponent,
  Tool,
} from '../editor-toolbar/editor-toolbar.component';
import {
  PagesSidebarComponent,
  PageItem,
} from '../pages-sidebar/pages-sidebar.component';
import { CanvasAreaComponent } from '../canvas-area/canvas-area.component';
import { AnnotationPropertiesComponent } from '../annotation-properties/annotation-properties.component';
import { PageNavigationComponent } from '../page-navigation/page-navigation.component';
import { LoadingOverlayComponent } from '../loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-pdf-editor',
  standalone: true,
  imports: [
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfEditorComponent implements OnDestroy {
  private readonly pdfService = inject(PdfService);
  private readonly injector = inject(Injector);

  // Estado reativo
  readonly pdfLoaded = signal(false);
  readonly currentPage = signal(1);
  readonly totalPages = signal(0);
  readonly zoom = signal(1.5);
  readonly selectedTool = signal<Tool>('select');
  readonly selectedAnnotation = signal<TextAnnotation | null>(null);
  readonly isLoading = signal(false);
  readonly fileName = signal('');

  // Configurações de texto
  readonly fontSize = signal(16);
  readonly textColor = signal('#000000');

  // Configurações do lápis
  readonly pencilColor = signal('#000000');
  readonly pencilStrokeWidth = signal(3);
  readonly pencilOpacity = signal(1);

  // Conta-gotas
  readonly eyedropperTarget = signal<'text' | 'pencil'>('pencil');
  readonly eyedropperActive = signal(false);
  readonly previousTool = signal<Tool>('select');

  // Configurações da borracha
  readonly eraserSize = signal(20);
  readonly eraserCursorVisible = signal(false);
  readonly eraserCursorX = signal(0);
  readonly eraserCursorY = signal(0);

  // Estado do lápis (convertido para signals)
  readonly isDrawing = signal(false);
  private readonly currentPencilPoints = signal<{ x: number; y: number }[]>([]);

  // Dimensões do canvas
  readonly canvasWidth = signal(0);
  readonly canvasHeight = signal(0);

  // Estado de arrastar (drag) - convertido para signals
  readonly isDragging = signal(false);
  private readonly dragStart = signal({ x: 0, y: 0 });
  private readonly dragAnnotationStart = signal({ x: 0, y: 0 });
  readonly shouldFocusTextInput = signal(false);

  // Sidebar de páginas
  readonly showPagesSidebar = signal(true);

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

      afterNextRender(() => this.renderCurrentPage(), {
        injector: this.injector,
      });
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

  async onPageReorder(event: {
    fromIndex: number;
    toIndex: number;
  }): Promise<void> {
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

  onAnnotationMouseDown(data: {
    annotation: TextAnnotation;
    event: MouseEvent;
  }): void {
    if (this.selectedTool() === 'select') {
      this.isDragging.set(true);
      this.hasMoved.set(false);
      this.dragStart.set({ x: data.event.clientX, y: data.event.clientY });
      this.dragAnnotationStart.set({
        x: data.annotation.x,
        y: data.annotation.y,
      });
      this.draggedAnnotation.set(data.annotation);

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

    this.isDrawing.set(true);
    this.currentPencilPoints.set([{ x, y }]);

    document.addEventListener('mousemove', this.onPencilMove);
    document.addEventListener('mouseup', this.onPencilUp);
  }

  private onPencilMove = (event: MouseEvent): void => {
    if (!this.isDrawing() || !this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.zoom();
    const y = (event.clientY - rect.top) / this.zoom();

    this.currentPencilPoints.update((pts) => [...pts, { x, y }]);
    this.drawCurrentStroke();
  };

  private onPencilUp = (): void => {
    document.removeEventListener('mousemove', this.onPencilMove);
    document.removeEventListener('mouseup', this.onPencilUp);

    const points = this.currentPencilPoints();
    if (points.length > 1) {
      this.pdfService.addPencilAnnotation({
        points: [...points],
        color: this.pencilColor(),
        strokeWidth: this.pencilStrokeWidth(),
        opacity: this.pencilOpacity(),
        pageNumber: this.currentPage(),
      });
      this.updateThumbnailSnapshot();
    }

    this.isDrawing.set(false);
    this.currentPencilPoints.set([]);
    this.renderCurrentPage();
  };

  // Eraser methods
  private readonly isErasing = signal(false);
  private readonly lastErasePos = signal({ x: 0, y: 0 });

  private startErasing(event: MouseEvent): void {
    if (!this.annotationLayerElement) return;

    this.isErasing.set(true);
    const rect = this.annotationLayerElement.getBoundingClientRect();
    this.lastErasePos.set({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    this.eraseAtPosition(event);

    document.addEventListener('mousemove', this.onEraserMove);
    document.addEventListener('mouseup', this.onEraserUp);
  }

  private onEraserMove = (event: MouseEvent): void => {
    if (!this.isErasing() || !this.annotationLayerElement) return;

    const rect = this.annotationLayerElement.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const lastPos = this.lastErasePos();
    const dx = currentX - lastPos.x;
    const dy = currentY - lastPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = this.eraserSize() / 4;
    const eraserRadiusScreen = this.eraserSize() / 2;

    if (distance > step) {
      const steps = Math.ceil(distance / step);

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const interpX = lastPos.x + dx * t;
        const interpY = lastPos.y + dy * t;
        this.eraseAtScreenCoords(interpX, interpY, eraserRadiusScreen);
      }
    } else {
      this.eraseAtScreenCoords(currentX, currentY, eraserRadiusScreen);
    }

    this.lastErasePos.set({ x: currentX, y: currentY });
  };

  private onEraserUp = (): void => {
    document.removeEventListener('mousemove', this.onEraserMove);
    document.removeEventListener('mouseup', this.onEraserUp);
    this.isErasing.set(false);
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
    const points = this.currentPencilPoints();
    if (!this.pdfCanvas || points.length < 2) return;

    this.renderCurrentPage().then(() => {
      this.drawAllPencilAnnotations();
      this.drawTemporaryStroke();
    });
  }

  private drawTemporaryStroke(): void {
    const points = this.currentPencilPoints();
    if (!this.pdfCanvas || points.length < 2) return;

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

    context.moveTo(points[0].x * zoom, points[0].y * zoom);

    for (let i = 1; i < points.length; i++) {
      context.lineTo(points[i].x * zoom, points[i].y * zoom);
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
  private readonly hasMoved = signal(false);
  private readonly draggedAnnotation = signal<TextAnnotation | null>(null);

  private onMouseMove = (event: MouseEvent): void => {
    const dragged = this.draggedAnnotation();
    if (!this.isDragging() || !dragged) return;

    const start = this.dragStart();
    const deltaX = (event.clientX - start.x) / this.zoom();
    const deltaY = (event.clientY - start.y) / this.zoom();

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      this.hasMoved.set(true);
    }

    if (this.hasMoved()) {
      const annotationStart = this.dragAnnotationStart();
      const newX = annotationStart.x + deltaX;
      const newY = annotationStart.y + deltaY;

      this.pdfService.updateAnnotation(dragged.id, {
        x: newX,
        y: newY,
      });

      this.draggedAnnotation.set({ ...dragged, x: newX, y: newY });
    }
  };

  private onMouseUp = (): void => {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    const annotation = this.draggedAnnotation();
    const wasDragging = this.hasMoved();

    this.isDragging.set(false);
    this.hasMoved.set(false);
    this.draggedAnnotation.set(null);

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
