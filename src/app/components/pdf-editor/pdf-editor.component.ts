import {
  Component,
  ElementRef,
  ViewChild,
  signal,
  computed,
  AfterViewChecked,
  HostListener,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PdfService,
  TextAnnotation,
  FontFamily,
  PencilAnnotation,
} from '../../services/pdf.service';
import { PageThumbnailComponent } from '../page-thumbnail/page-thumbnail.component';

type Tool = 'select' | 'text' | 'pencil' | 'eraser';

@Component({
  selector: 'app-pdf-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, PageThumbnailComponent],
  templateUrl: './pdf-editor.component.html',
  styleUrl: './pdf-editor.component.scss',
})
export class PdfEditorComponent implements AfterViewChecked, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('pdfCanvas') pdfCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationLayer') annotationLayer!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInput!: ElementRef<HTMLInputElement>;
  @ViewChild('canvasWrapper') canvasWrapper!: ElementRef<HTMLDivElement>;

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
  private shouldFocusTextInput = false;

  // Sidebar de páginas
  showPagesSidebar = signal(true);

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

  // Array de números de páginas para o ngFor
  pages = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

  // Snapshot de anotações para thumbnails - só atualiza em momentos específicos
  // (quando sidebar fecha, drag termina, ou PDF é carregado)
  private thumbnailAnnotationsSnapshot = signal<TextAnnotation[]>([]);
  private thumbnailPencilAnnotationsSnapshot = signal<PencilAnnotation[]>([]);

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

  pencilAnnotationsByPage = computed(() => {
    const map = new Map<number, PencilAnnotation[]>();
    for (const annotation of this.thumbnailPencilAnnotationsSnapshot()) {
      const pageAnnotations = map.get(annotation.pageNumber) || [];
      pageAnnotations.push(annotation);
      map.set(annotation.pageNumber, pageAnnotations);
    }
    return map;
  });

  // Método para atualizar snapshot dos thumbnails
  private updateThumbnailSnapshot(): void {
    this.thumbnailAnnotationsSnapshot.set([...this.pdfService.annotations()]);
    this.thumbnailPencilAnnotationsSnapshot.set([
      ...this.pdfService.pencilAnnotations(),
    ]);
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

      // Desenhar anotações de lápis após renderizar a página
      this.drawAllPencilAnnotations();
    } catch (error) {
      console.error('Erro ao renderizar página:', error);
    }
  }

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
    this.zoom.update((z) => Math.min(z + 0.25, 3));
    this.renderCurrentPage();
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(z - 0.25, 0.5));
    this.renderCurrentPage();
  }

  selectTool(tool: Tool): void {
    this.selectedTool.set(tool);
    if (tool === 'text') {
      this.closeEditSidebar();
    }
  }

  async openEyedropper(target: 'text' | 'pencil'): Promise<void> {
    this.eyedropperTarget.set(target);

    // Tentar usar a API nativa EyeDropper primeiro
    if ('EyeDropper' in window) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const result = await eyeDropper.open();
        const color = result.sRGBHex;
        this.applyEyedropperColor(color);
        return;
      } catch (e) {
        // Usuário cancelou ou erro - tentar modo alternativo
        console.log('EyeDropper nativo falhou, usando modo alternativo');
      }
    }

    // Modo alternativo: ativar modo de captura no canvas
    this.previousTool.set(this.selectedTool());
    this.eyedropperActive.set(true);
  }

  private applyEyedropperColor(color: string): void {
    const target = this.eyedropperTarget();

    if (target === 'text') {
      this.textColor.set(color);
      // Se há uma anotação selecionada, atualizar a cor dela também
      const selected = this.selectedAnnotation();
      if (selected) {
        this.pdfService.updateAnnotation(selected.id, { color });
        this.selectedAnnotation.set({ ...selected, color });
      }
    } else {
      this.pencilColor.set(color);
    }

    this.eyedropperActive.set(false);
    // Restaurar a ferramenta anterior
    this.selectedTool.set(this.previousTool());
  }

  cancelEyedropper(): void {
    this.eyedropperActive.set(false);
    this.selectedTool.set(this.previousTool());
  }

  private getColorFromCanvas(event: MouseEvent): string | null {
    if (!this.pdfCanvas) return null;

    const canvas = this.pdfCanvas.nativeElement;
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

  onCanvasMouseDown(event: MouseEvent): void {
    // Verificar se o conta-gotas está ativo
    if (this.eyedropperActive()) {
      const color = this.getColorFromCanvas(event);
      if (color) {
        this.applyEyedropperColor(color);
      }
      return;
    }

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
        pageNumber: this.currentPage(),
        fontFamily: 'Arial',
        bold: false,
        italic: false,
        underline: false,
      });

      this.selectedAnnotation.set(annotation);
      this.selectedTool.set('select');
      // Ativar auto focus no campo de texto
      this.shouldFocusTextInput = true;
    } else if (this.selectedTool() === 'select') {
      // Clicou fora de qualquer anotação - fechar sidebar
      this.closeEditSidebar();
    } else if (this.selectedTool() === 'pencil') {
      // Iniciar desenho com lápis
      this.startDrawing(event);
    } else if (this.selectedTool() === 'eraser') {
      // Iniciar modo de apagar
      this.startErasing(event);
    }
  }

  // Métodos de desenho com lápis
  private startDrawing(event: MouseEvent): void {
    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.zoom();
    const y = (event.clientY - rect.top) / this.zoom();

    this.isDrawing = true;
    this.currentPencilPoints = [{ x, y }];

    document.addEventListener('mousemove', this.onPencilMove);
    document.addEventListener('mouseup', this.onPencilUp);
  }

  private onPencilMove = (event: MouseEvent): void => {
    if (!this.isDrawing) return;

    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
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

  // Métodos de borracha
  private isErasing = false;
  private lastEraseX = 0;
  private lastEraseY = 0;

  private startErasing(event: MouseEvent): void {
    this.isErasing = true;
    // Calcular posição relativa ao annotation-layer
    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
    this.lastEraseX = event.clientX - rect.left;
    this.lastEraseY = event.clientY - rect.top;
    this.eraseAtPosition(event);

    document.addEventListener('mousemove', this.onEraserMove);
    document.addEventListener('mouseup', this.onEraserUp);
  }

  private onEraserMove = (event: MouseEvent): void => {
    if (!this.isErasing) return;

    // Durante o arraste, precisamos usar getBoundingClientRect porque o evento vem do document
    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    // Interpolar entre a última posição e a atual para apagar continuamente
    const dx = currentX - this.lastEraseX;
    const dy = currentY - this.lastEraseY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const step = this.eraserSize() / 4; // Passos menores para maior precisão
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
    if (this.selectedTool() !== 'eraser') {
      this.eraserCursorVisible.set(false);
      return;
    }

    // Calcular posição relativa ao annotation-layer
    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // O cursor visual é posicionado no centro do mouse
    this.eraserCursorX.set(screenX - this.eraserSize() / 2);
    this.eraserCursorY.set(screenY - this.eraserSize() / 2);
    this.eraserCursorVisible.set(true);
  }

  // Retorna o tamanho visual real da borracha considerando o zoom
  getEraserVisualSize(): number {
    return this.eraserSize();
  }

  private eraseAtPosition(event: MouseEvent): void {
    // Calcular posição relativa ao annotation-layer
    const rect = this.annotationLayer.nativeElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    // O raio da borracha em pixels de tela
    const eraserRadiusScreen = this.eraserSize() / 2;

    this.eraseAtScreenCoords(screenX, screenY, eraserRadiusScreen);
  }

  private eraseAtScreenCoords(
    screenX: number,
    screenY: number,
    radiusScreen: number
  ): void {
    const zoom = this.zoom();

    // Verificar cada traço de lápis
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

        // Remover o traço original
        this.pdfService.removePencilAnnotation(pencil.id);

        // Adicionar os segmentos restantes como novos traços
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

  private eraseAtDocumentPosition(
    x: number,
    y: number,
    eraserRadius: number
  ): void {
    const zoom = this.zoom();
    // Converter para coordenadas de tela
    this.eraseAtScreenCoords(x * zoom, y * zoom, eraserRadius * zoom);
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

    // Centro da borracha em coordenadas de documento
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

        // Se o ponto anterior estava fora, calcular o ponto de interseção
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

        // Salvar o segmento atual se tiver pontos suficientes
        if (currentSegment.length >= 2) {
          remainingSegments.push([...currentSegment]);
        }
        currentSegment = [];
      } else {
        // Ponto está fora da borracha

        // Se estamos começando um novo segmento após apagar
        if (currentSegment.length === 0 && i > 0) {
          const prevPoint = points[i - 1];
          const prevDistance = Math.sqrt(
            (eraserDocX - prevPoint.x) ** 2 + (eraserDocY - prevPoint.y) ** 2
          );

          // Se o ponto anterior estava dentro, calcular ponto de saída
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

    // Adicionar o último segmento se existir
    if (currentSegment.length >= 2) {
      remainingSegments.push(currentSegment);
    }

    return { modified, remainingSegments };
  }

  // Calcula o ponto de interseção entre um segmento de linha e um círculo
  // Retorna o ponto mais próximo de (x1, y1)
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

    // Dois possíveis pontos de interseção
    const t1 = (-b - discriminant) / (2 * a);
    const t2 = (-b + discriminant) / (2 * a);

    // Retornar o ponto que está no segmento (0 <= t <= 1)
    // e mais próximo do ponto inicial
    if (t1 >= 0 && t1 <= 1) {
      return { x: x1 + t1 * dx, y: y1 + t1 * dy };
    }
    if (t2 >= 0 && t2 <= 1) {
      return { x: x1 + t2 * dx, y: y1 + t2 * dy };
    }

    return null;
  }

  private eraseFromPath(
    px: number,
    py: number,
    radius: number,
    pencil: PencilAnnotation
  ): { modified: boolean; remainingSegments: { x: number; y: number }[][] } {
    // Delegar para a versão com coordenadas de tela
    const zoom = this.zoom();
    return this.eraseFromPathScreenCoords(
      px * zoom,
      py * zoom,
      radius * zoom,
      pencil,
      zoom
    );
  }

  private isPointNearPath(
    px: number,
    py: number,
    radius: number,
    points: { x: number; y: number }[],
    strokeWidth: number
  ): boolean {
    const hitDistance = radius + strokeWidth / 2;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (
        this.distanceToSegment(px, py, p1.x, p1.y, p2.x, p2.y) < hitDistance
      ) {
        return true;
      }
    }

    return false;
  }

  private distanceToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;

    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
  }

  private drawCurrentStroke(): void {
    if (!this.pdfCanvas || this.currentPencilPoints.length < 2) return;

    const canvas = this.pdfCanvas.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Renderizar a página primeiro para limpar traços anteriores temporários
    // e depois desenhar todos os traços persistentes + o atual
    this.renderCurrentPage().then(() => {
      this.drawAllPencilAnnotations();
      this.drawTemporaryStroke();
    });
  }

  private drawTemporaryStroke(): void {
    if (!this.pdfCanvas || this.currentPencilPoints.length < 2) return;

    const canvas = this.pdfCanvas.nativeElement;
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

    const canvas = this.pdfCanvas.nativeElement;
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

      this.pdfService.updateAnnotation(this.draggedAnnotation.id, {
        x: newX,
        y: newY,
      });

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
      this.pdfService.updateAnnotation(selected.id, {
        fontSize: size / this.zoom(),
      });
      this.selectedAnnotation.set({
        ...selected,
        fontSize: size / this.zoom(),
      });
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

  updateAnnotationFontFamily(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selected = this.selectedAnnotation();
    if (selected) {
      const fontFamily = select.value as any;
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
