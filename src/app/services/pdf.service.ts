import { Injectable, signal, computed } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Configurar worker do PDF.js - usando CDN compatível com a versão instalada
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.530/build/pdf.worker.min.mjs';

export interface TextAnnotation {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
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

  // Expor como readonly para o componente
  readonly annotations = this.annotationsSignal.asReadonly();

  async loadPdf(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
    const arrayBuffer = await file.arrayBuffer();
    // Fazer uma cópia do ArrayBuffer para evitar "detached ArrayBuffer" ao exportar
    this.originalPdfBytes = arrayBuffer.slice(0);

    // Limpar estado de renderização anterior
    this.renderingPage.clear();

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.annotationsSignal.set([]);

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
    annotations: TextAnnotation[]
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
        context.font = `${annotation.fontSize * scale}px Arial`;
        context.fillStyle = annotation.color;
        context.textBaseline = 'top'; // Usar top para coincidir com CSS top
        context.fillText(
          annotation.text,
          annotation.x * scale,
          annotation.y * scale
        );
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
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    // Aplicar anotações de texto
    for (const annotation of this.annotationsSignal()) {
      const page = pages[annotation.pageNumber - 1];
      if (!page) continue;

      const { height } = page.getSize();
      const color = this.hexToRgb(annotation.color);

      // Converter coordenadas do canvas para coordenadas do PDF
      // O PDF tem origem no canto inferior esquerdo
      const pdfY = height - annotation.y - annotation.fontSize;

      page.drawText(annotation.text, {
        x: annotation.x,
        y: pdfY,
        size: annotation.fontSize,
        font: helveticaFont,
        color: rgb(color.r, color.g, color.b),
      });
    }

    return await pdfDoc.save();
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
    this.renderingPage.clear();
  }
}
