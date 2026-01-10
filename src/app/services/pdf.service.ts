import { Injectable, signal, computed } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Configurar worker do PDF.js - usando CDN compatível com a versão instalada
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';

export type FontFamily =
  | 'Arial'
  | 'Times New Roman'
  | 'Courier New'
  | 'Georgia'
  | 'Verdana';

export interface TextAnnotation {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  pageNumber: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface PencilPoint {
  x: number;
  y: number;
}

export interface PencilAnnotation {
  id: string;
  points: PencilPoint[];
  color: string;
  strokeWidth: number;
  opacity: number;
  pageNumber: number;
}

@Injectable({
  providedIn: 'root',
})
export class PdfService {
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private originalPdfBytes: ArrayBuffer | null = null;

  // Controle de renderização para evitar conflitos
  private renderingPage: Map<string, boolean> = new Map();
  // Controle de versão para cancelar renderizações obsoletas
  private renderVersion: Map<string, number> = new Map();

  // Usando signal para reatividade
  private annotationsSignal = signal<TextAnnotation[]>([]);
  private pencilAnnotationsSignal = signal<PencilAnnotation[]>([]);

  // Expor como readonly para o componente
  readonly annotations = this.annotationsSignal.asReadonly();
  readonly pencilAnnotations = this.pencilAnnotationsSignal.asReadonly();

  async loadPdf(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
    const arrayBuffer = await file.arrayBuffer();
    // Fazer uma cópia do ArrayBuffer para evitar "detached ArrayBuffer" ao exportar
    this.originalPdfBytes = arrayBuffer.slice(0);

    // Limpar estado de renderização anterior
    this.renderingPage.clear();

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.annotationsSignal.set([]);
    this.pencilAnnotationsSignal.set([]);

    return this.pdfDoc;
  }

  getPdfDocument(): pdfjsLib.PDFDocumentProxy | null {
    return this.pdfDoc;
  }

  getAnnotations(): TextAnnotation[] {
    return this.annotationsSignal();
  }

  addAnnotation(annotation: Omit<TextAnnotation, 'id'>): TextAnnotation {
    const newAnnotation: TextAnnotation = {
      ...annotation,
      id: crypto.randomUUID(),
    };
    this.annotationsSignal.update((list) => [...list, newAnnotation]);
    return newAnnotation;
  }

  updateAnnotation(id: string, updates: Partial<TextAnnotation>): void {
    this.annotationsSignal.update((list) =>
      list.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  }

  removeAnnotation(id: string): void {
    this.annotationsSignal.update((list) => list.filter((a) => a.id !== id));
  }

  // Métodos para anotações de lápis
  addPencilAnnotation(
    annotation: Omit<PencilAnnotation, 'id'>
  ): PencilAnnotation {
    const newAnnotation: PencilAnnotation = {
      ...annotation,
      id: crypto.randomUUID(),
    };
    this.pencilAnnotationsSignal.update((list) => [...list, newAnnotation]);
    return newAnnotation;
  }

  updatePencilAnnotation(id: string, updates: Partial<PencilAnnotation>): void {
    this.pencilAnnotationsSignal.update((list) =>
      list.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  }

  removePencilAnnotation(id: string): void {
    this.pencilAnnotationsSignal.update((list) =>
      list.filter((a) => a.id !== id)
    );
  }

  async renderPage(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number = 1.5
  ): Promise<{ width: number; height: number }> {
    if (!this.pdfDoc) {
      throw new Error('PDF não carregado');
    }

    const renderKey = `main-${pageNumber}`;

    // Incrementar versão para invalidar renderizações anteriores
    const currentVersion = (this.renderVersion.get(renderKey) || 0) + 1;
    this.renderVersion.set(renderKey, currentVersion);

    // Se já está renderizando, a versão anterior será invalidada
    if (this.renderingPage.get(renderKey)) {
      // Aguardar um pouco para a renderização anterior terminar
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.renderingPage.set(renderKey, true);

    try {
      const page = await this.pdfDoc.getPage(pageNumber);

      // Verificar se esta renderização ainda é válida
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        return { width: canvas.width, height: canvas.height };
      }

      const viewport = page.getViewport({ scale });

      // Limpar canvas antes de renderizar
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Não foi possível obter contexto do canvas');
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Verificar novamente antes de renderizar
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        return { width: canvas.width, height: canvas.height };
      }

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      } as any).promise;

      // Verificar após renderizar - se versão mudou, limpar canvas
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height };
      }

      return { width: viewport.width, height: viewport.height };
    } finally {
      this.renderingPage.set(renderKey, false);
    }
  }

  // Renderizar thumbnail em baixa resolução para a sidebar
  async renderThumbnail(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    maxWidth: number = 150
  ): Promise<void> {
    if (!this.pdfDoc) {
      throw new Error('PDF não carregado');
    }

    const renderKey = `thumb-${pageNumber}`;

    // Evitar renderização duplicada
    if (this.renderingPage.get(renderKey)) {
      return;
    }

    this.renderingPage.set(renderKey, true);

    try {
      const page = await this.pdfDoc.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });

      // Calcular escala para caber na largura máxima
      const scale = maxWidth / originalViewport.width;
      const viewport = page.getViewport({ scale });

      // Limpar canvas antes de renderizar
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Não foi possível obter contexto do canvas');
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;
      context.clearRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      } as any).promise;
    } finally {
      this.renderingPage.set(renderKey, false);
    }
  }

  async renderThumbnailWithAnnotations(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    maxWidth: number,
    annotations: TextAnnotation[],
    pencilAnnotations: PencilAnnotation[] = []
  ): Promise<void> {
    if (!this.pdfDoc) {
      throw new Error('Nenhum PDF carregado');
    }

    const renderKey = `thumb-annot-${pageNumber}`;

    // Incrementar versão para invalidar renderizações anteriores
    const currentVersion = (this.renderVersion.get(renderKey) || 0) + 1;
    this.renderVersion.set(renderKey, currentVersion);

    // Se já está renderizando, aguardar
    if (this.renderingPage.get(renderKey)) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      // Se versão mudou enquanto esperava, sair
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        return;
      }
    }

    this.renderingPage.set(renderKey, true);

    try {
      const page = await this.pdfDoc.getPage(pageNumber);

      // Verificar se ainda é válido
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        return;
      }

      const originalViewport = page.getViewport({ scale: 1 });

      // Calcular escala para caber na largura máxima
      const scale = maxWidth / originalViewport.width;
      const viewport = page.getViewport({ scale });

      // Limpar canvas antes de renderizar
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Não foi possível obter contexto do canvas');
      }

      canvas.height = viewport.height;
      canvas.width = viewport.width;
      context.clearRect(0, 0, canvas.width, canvas.height);

      // Verificar novamente
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        return;
      }

      await page.render({
        canvasContext: context,
        viewport: viewport,
        canvas: canvas,
      } as any).promise;

      // Verificar após renderizar
      if (this.renderVersion.get(renderKey) !== currentVersion) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      // Desenhar anotações no thumbnail
      const pageAnnotations = annotations.filter(
        (a) => a.pageNumber === pageNumber
      );
      for (const annotation of pageAnnotations) {
        const fontStyle = `${annotation.italic ? 'italic ' : ''}${
          annotation.bold ? 'bold ' : ''
        }`;
        context.font = `${fontStyle}${annotation.fontSize * scale}px ${
          annotation.fontFamily || 'Arial'
        }`;
        context.fillStyle = annotation.color;
        context.textBaseline = 'top';

        const textX = annotation.x * scale;
        const textY = annotation.y * scale;

        context.fillText(annotation.text, textX, textY);

        // Desenhar sublinhado se necessário
        if (annotation.underline) {
          const textWidth = context.measureText(annotation.text).width;
          const underlineY = textY + annotation.fontSize * scale * 1.1;
          context.beginPath();
          context.strokeStyle = annotation.color;
          context.lineWidth = Math.max(1, annotation.fontSize * scale * 0.05);
          context.moveTo(textX, underlineY);
          context.lineTo(textX + textWidth, underlineY);
          context.stroke();
        }
      }

      // Desenhar anotações de lápis no thumbnail
      const pagePencilAnnotations = pencilAnnotations.filter(
        (a) => a.pageNumber === pageNumber
      );
      for (const pencil of pagePencilAnnotations) {
        if (pencil.points.length < 2) continue;

        context.beginPath();
        context.strokeStyle = pencil.color;
        context.lineWidth = pencil.strokeWidth * scale;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.globalAlpha = pencil.opacity;

        context.moveTo(pencil.points[0].x * scale, pencil.points[0].y * scale);
        for (let i = 1; i < pencil.points.length; i++) {
          context.lineTo(
            pencil.points[i].x * scale,
            pencil.points[i].y * scale
          );
        }
        context.stroke();
        context.globalAlpha = 1;
      }
    } finally {
      this.renderingPage.set(renderKey, false);
    }
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16) / 255,
          g: parseInt(result[2], 16) / 255,
          b: parseInt(result[3], 16) / 255,
        }
      : { r: 0, g: 0, b: 0 };
  }

  async addNewPage(): Promise<number> {
    if (!this.originalPdfBytes) {
      throw new Error('PDF não carregado');
    }

    // Carregar o PDF atual com pdf-lib
    const pdfDoc = await PDFDocument.load(this.originalPdfBytes);

    // Pegar o tamanho da primeira página como referência (ou usar A4 padrão)
    const pages = pdfDoc.getPages();
    let width = 595.28; // A4 width em pontos
    let height = 841.89; // A4 height em pontos

    if (pages.length > 0) {
      const firstPage = pages[0];
      const size = firstPage.getSize();
      width = size.width;
      height = size.height;
    }

    // Adicionar nova página em branco
    pdfDoc.addPage([width, height]);

    // Salvar o PDF modificado
    const pdfBytes = await pdfDoc.save();
    this.originalPdfBytes = new Uint8Array(pdfBytes).buffer as ArrayBuffer;

    // Recarregar o documento no pdfjs
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    this.pdfDoc = await loadingTask.promise;

    // Retornar o número da nova página
    return this.pdfDoc.numPages;
  }

  async exportPdf(): Promise<Uint8Array> {
    if (!this.originalPdfBytes) {
      throw new Error('PDF não carregado');
    }

    const pdfDoc = await PDFDocument.load(this.originalPdfBytes);

    // Carregar todas as variantes de fonte necessárias
    const fonts = {
      Helvetica: await pdfDoc.embedFont(StandardFonts.Helvetica),
      'Helvetica-Bold': await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      'Helvetica-Oblique': await pdfDoc.embedFont(
        StandardFonts.HelveticaOblique
      ),
      'Helvetica-BoldOblique': await pdfDoc.embedFont(
        StandardFonts.HelveticaBoldOblique
      ),
      'Times-Roman': await pdfDoc.embedFont(StandardFonts.TimesRoman),
      'Times-Bold': await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
      'Times-Italic': await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
      'Times-BoldItalic': await pdfDoc.embedFont(
        StandardFonts.TimesRomanBoldItalic
      ),
      Courier: await pdfDoc.embedFont(StandardFonts.Courier),
      'Courier-Bold': await pdfDoc.embedFont(StandardFonts.CourierBold),
      'Courier-Oblique': await pdfDoc.embedFont(StandardFonts.CourierOblique),
      'Courier-BoldOblique': await pdfDoc.embedFont(
        StandardFonts.CourierBoldOblique
      ),
    };

    const pages = pdfDoc.getPages();

    // Aplicar anotações de texto
    for (const annotation of this.annotationsSignal()) {
      const page = pages[annotation.pageNumber - 1];
      if (!page) continue;

      const { height, width: pageWidth } = page.getSize();
      const color = this.hexToRgb(annotation.color);

      // Selecionar fonte baseado na família e estilo
      const font = this.selectFont(
        fonts,
        annotation.fontFamily,
        annotation.bold,
        annotation.italic
      );

      // Converter coordenadas do canvas para coordenadas do PDF
      // O PDF tem origem no canto inferior esquerdo
      const pdfY = height - annotation.y - annotation.fontSize;

      page.drawText(annotation.text, {
        x: annotation.x,
        y: pdfY,
        size: annotation.fontSize,
        font: font,
        color: rgb(color.r, color.g, color.b),
      });

      // Desenhar sublinhado se necessário
      if (annotation.underline) {
        const textWidth = font.widthOfTextAtSize(
          annotation.text,
          annotation.fontSize
        );
        const underlineY = pdfY - annotation.fontSize * 0.15;
        page.drawLine({
          start: { x: annotation.x, y: underlineY },
          end: { x: annotation.x + textWidth, y: underlineY },
          thickness: Math.max(0.5, annotation.fontSize * 0.05),
          color: rgb(color.r, color.g, color.b),
        });
      }
    }

    // Aplicar anotações de lápis
    for (const pencil of this.pencilAnnotationsSignal()) {
      const page = pages[pencil.pageNumber - 1];
      if (!page || pencil.points.length < 2) continue;

      const { height } = page.getSize();
      const color = this.hexToRgb(pencil.color);

      // Desenhar path suave usando curvas bezier
      this.drawSmoothPath(page, pencil.points, height, {
        color: rgb(color.r, color.g, color.b),
        strokeWidth: pencil.strokeWidth,
        opacity: pencil.opacity,
      });
    }

    return await pdfDoc.save();
  }

  /**
   * Desenha um path suave usando curvas bezier quadráticas
   */
  private drawSmoothPath(
    page: any,
    points: { x: number; y: number }[],
    pageHeight: number,
    options: { color: any; strokeWidth: number; opacity: number }
  ): void {
    if (points.length < 2) return;

    // Converter Y para coordenadas PDF (origem no canto inferior esquerdo)
    const convertY = (y: number) => pageHeight - y;

    if (points.length === 2) {
      // Apenas dois pontos - desenha linha reta
      page.drawLine({
        start: { x: points[0].x, y: convertY(points[0].y) },
        end: { x: points[1].x, y: convertY(points[1].y) },
        thickness: options.strokeWidth,
        color: options.color,
        opacity: options.opacity,
        lineCap: 1, // Round cap
      });
      return;
    }

    // Para múltiplos pontos, desenhar segmentos com round caps para suavidade
    // e usar pontos intermediários para criar curvas mais suaves
    const smoothedPoints = this.smoothPoints(points);

    for (let i = 0; i < smoothedPoints.length - 1; i++) {
      const start = smoothedPoints[i];
      const end = smoothedPoints[i + 1];

      page.drawLine({
        start: { x: start.x, y: convertY(start.y) },
        end: { x: end.x, y: convertY(end.y) },
        thickness: options.strokeWidth,
        color: options.color,
        opacity: options.opacity,
        lineCap: 1, // Round cap para suavizar junções
      });
    }
  }

  /**
   * Suaviza os pontos usando interpolação com curvas bezier
   */
  private smoothPoints(
    points: { x: number; y: number }[]
  ): { x: number; y: number }[] {
    if (points.length <= 2) return points;

    const result: { x: number; y: number }[] = [];

    // Adicionar primeiro ponto
    result.push(points[0]);

    // Interpolar pontos usando curvas bezier quadráticas
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      if (i < points.length - 2) {
        const p2 = points[i + 2];

        // Ponto de controle é p1, pontos de destino são interpolados
        // Adicionar pontos ao longo da curva bezier quadrática
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;
        const midX2 = (p1.x + p2.x) / 2;
        const midY2 = (p1.y + p2.y) / 2;

        // Interpolar pontos na curva
        for (let t = 0.25; t <= 1; t += 0.25) {
          // Bezier quadrática de mid -> p1 -> mid2
          const ct = 1 - t;
          const x = ct * ct * midX + 2 * ct * t * p1.x + t * t * midX2;
          const y = ct * ct * midY + 2 * ct * t * p1.y + t * t * midY2;
          result.push({ x, y });
        }
      } else {
        // Último segmento - adicionar ponto final
        result.push(p1);
      }
    }

    return result;
  }

  private selectFont(
    fonts: Record<string, any>,
    fontFamily: FontFamily,
    bold: boolean,
    italic: boolean
  ): any {
    // Mapear fontes da web para fontes PDF padrão
    let baseFontKey: string;

    switch (fontFamily) {
      case 'Times New Roman':
      case 'Georgia':
        baseFontKey = 'Times';
        break;
      case 'Courier New':
        baseFontKey = 'Courier';
        break;
      default:
        baseFontKey = 'Helvetica';
    }

    // Construir o nome da fonte com estilo
    let fontKey = baseFontKey;
    if (baseFontKey === 'Times') {
      if (bold && italic) fontKey = 'Times-BoldItalic';
      else if (bold) fontKey = 'Times-Bold';
      else if (italic) fontKey = 'Times-Italic';
      else fontKey = 'Times-Roman';
    } else {
      if (bold && italic) fontKey = `${baseFontKey}-BoldOblique`;
      else if (bold) fontKey = `${baseFontKey}-Bold`;
      else if (italic) fontKey = `${baseFontKey}-Oblique`;
    }

    return fonts[fontKey] || fonts['Helvetica'];
  }

  downloadPdf(
    pdfBytes: Uint8Array,
    filename: string = 'documento-editado.pdf'
  ): void {
    const blob = new Blob([new Uint8Array(pdfBytes)], {
      type: 'application/pdf',
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
  }

  reset(): void {
    this.pdfDoc = null;
    this.originalPdfBytes = null;
    this.annotationsSignal.set([]);
    this.pencilAnnotationsSignal.set([]);
    this.renderingPage.clear();
  }
}
