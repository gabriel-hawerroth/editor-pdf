/**
 * Testes unitários para a lógica da borracha
 * Estes testes validam que a detecção de colisão está precisa
 */

describe('Eraser Logic', () => {
  // Função de detecção extraída para teste
  function isPointInsideEraser(
    eraserScreenX: number,
    eraserScreenY: number,
    eraserRadiusScreen: number,
    pointDocX: number,
    pointDocY: number,
    zoom: number
  ): boolean {
    // Converter ponto do documento para coordenadas de tela
    const pointScreenX = pointDocX * zoom;
    const pointScreenY = pointDocY * zoom;

    // Calcular distância em coordenadas de tela
    const distanceScreen = Math.sqrt(
      (eraserScreenX - pointScreenX) ** 2 + (eraserScreenY - pointScreenY) ** 2
    );

    return distanceScreen <= eraserRadiusScreen;
  }

  describe('isPointInsideEraser', () => {
    it('deve detectar ponto no centro da borracha', () => {
      // Borracha no centro (100, 100) com raio 10px, zoom 1x
      // Ponto em (100, 100) em coordenadas de documento
      expect(isPointInsideEraser(100, 100, 10, 100, 100, 1)).toBe(true);
    });

    it('deve detectar ponto na borda da borracha', () => {
      // Borracha no centro (100, 100) com raio 10px
      // Ponto em (110, 100) - exatamente na borda
      expect(isPointInsideEraser(100, 100, 10, 110, 100, 1)).toBe(true);
    });

    it('não deve detectar ponto fora da borracha', () => {
      // Borracha no centro (100, 100) com raio 10px
      // Ponto em (111, 100) - 1px fora da borda
      expect(isPointInsideEraser(100, 100, 10, 111, 100, 1)).toBe(false);
    });

    it('não deve detectar ponto claramente fora', () => {
      // Borracha no centro (100, 100) com raio 10px
      // Ponto em (150, 100) - 40px de distância
      expect(isPointInsideEraser(100, 100, 10, 150, 100, 1)).toBe(false);
    });

    it('deve funcionar corretamente com zoom 1.5x', () => {
      // Borracha em posição de tela (150, 150) com raio 15px (eraserSize=30)
      // Ponto em coordenadas de documento (100, 100) -> tela (150, 150) com zoom 1.5
      expect(isPointInsideEraser(150, 150, 15, 100, 100, 1.5)).toBe(true);

      // Ponto em (110, 100) documento -> (165, 150) tela
      // Distância: 15px, exatamente na borda
      expect(isPointInsideEraser(150, 150, 15, 110, 100, 1.5)).toBe(true);

      // Ponto em (111, 100) documento -> (166.5, 150) tela
      // Distância: 16.5px, fora
      expect(isPointInsideEraser(150, 150, 15, 111, 100, 1.5)).toBe(false);
    });

    it('deve funcionar corretamente com zoom 2x', () => {
      // Borracha em posição de tela (200, 200) com raio 20px
      // Ponto em coordenadas de documento (100, 100) -> tela (200, 200)
      expect(isPointInsideEraser(200, 200, 20, 100, 100, 2)).toBe(true);

      // Ponto em (110, 100) documento -> (220, 200) tela
      // Distância: 20px, exatamente na borda
      expect(isPointInsideEraser(200, 200, 20, 110, 100, 2)).toBe(true);

      // Ponto em (111, 100) documento -> (222, 200) tela
      // Distância: 22px, fora
      expect(isPointInsideEraser(200, 200, 20, 111, 100, 2)).toBe(false);
    });

    it('deve detectar ponto na diagonal', () => {
      // Borracha em (100, 100) com raio 10px
      // Ponto em aproximadamente (107.07, 107.07) - na borda diagonal
      const diagonalPoint = 100 + 10 / Math.sqrt(2); // ~107.07
      expect(
        isPointInsideEraser(100, 100, 10, diagonalPoint, diagonalPoint, 1)
      ).toBe(true);

      // Ponto um pouco além
      const outsidePoint = 100 + 11 / Math.sqrt(2); // ~107.78
      expect(
        isPointInsideEraser(100, 100, 10, outsidePoint, outsidePoint, 1)
      ).toBe(false);
    });
  });

  describe('Eraser cursor position', () => {
    function getEraserCursorPosition(
      mouseScreenX: number,
      mouseScreenY: number,
      eraserSize: number
    ): { left: number; top: number; centerX: number; centerY: number } {
      const left = mouseScreenX - eraserSize / 2;
      const top = mouseScreenY - eraserSize / 2;
      return {
        left,
        top,
        centerX: mouseScreenX,
        centerY: mouseScreenY,
      };
    }

    it('deve posicionar o cursor centrado no mouse', () => {
      const pos = getEraserCursorPosition(100, 100, 20);
      expect(pos.left).toBe(90);
      expect(pos.top).toBe(90);
      expect(pos.centerX).toBe(100);
      expect(pos.centerY).toBe(100);
    });

    it('centro do cursor deve corresponder à posição de detecção', () => {
      const mouseX = 150;
      const mouseY = 200;
      const eraserSize = 30;

      const cursorPos = getEraserCursorPosition(mouseX, mouseY, eraserSize);

      // O centro do cursor visual deve ser onde fazemos a detecção
      expect(cursorPos.centerX).toBe(mouseX);
      expect(cursorPos.centerY).toBe(mouseY);

      // O raio visual deve ser eraserSize / 2
      const visualRadius = eraserSize / 2;
      expect(visualRadius).toBe(15);
    });
  });

  describe('Integration: Visual cursor matches detection area', () => {
    it('ponto no centro visual da borracha deve ser detectado', () => {
      const mouseScreenX = 100;
      const mouseScreenY = 100;
      const eraserSize = 20;
      const zoom = 1;

      // Ponto exatamente no centro (em coordenadas de documento)
      const pointDocX = mouseScreenX / zoom;
      const pointDocY = mouseScreenY / zoom;

      expect(
        isPointInsideEraser(
          mouseScreenX,
          mouseScreenY,
          eraserSize / 2,
          pointDocX,
          pointDocY,
          zoom
        )
      ).toBe(true);
    });

    it('ponto na borda visual da borracha deve ser detectado', () => {
      const mouseScreenX = 100;
      const mouseScreenY = 100;
      const eraserSize = 20;
      const zoom = 1;
      const radius = eraserSize / 2;

      // Ponto na borda direita do círculo visual
      const pointDocX = (mouseScreenX + radius) / zoom;
      const pointDocY = mouseScreenY / zoom;

      expect(
        isPointInsideEraser(
          mouseScreenX,
          mouseScreenY,
          radius,
          pointDocX,
          pointDocY,
          zoom
        )
      ).toBe(true);
    });

    it('ponto 1px fora da borda visual NÃO deve ser detectado', () => {
      const mouseScreenX = 100;
      const mouseScreenY = 100;
      const eraserSize = 20;
      const zoom = 1;
      const radius = eraserSize / 2;

      // Ponto 1px além da borda direita
      const pointDocX = (mouseScreenX + radius + 1) / zoom;
      const pointDocY = mouseScreenY / zoom;

      expect(
        isPointInsideEraser(
          mouseScreenX,
          mouseScreenY,
          radius,
          pointDocX,
          pointDocY,
          zoom
        )
      ).toBe(false);
    });

    it('com zoom 1.5x: ponto na borda visual deve ser detectado', () => {
      const mouseScreenX = 150; // posição do mouse na tela
      const mouseScreenY = 150;
      const eraserSize = 30; // 30px na tela
      const zoom = 1.5;
      const radius = eraserSize / 2; // 15px na tela

      // Mouse está em (150, 150) na tela
      // Isso corresponde a (100, 100) em coordenadas de documento

      // Um ponto em (100, 100) documento aparece em (150, 150) tela
      expect(isPointInsideEraser(150, 150, 15, 100, 100, 1.5)).toBe(true);

      // Um ponto em (110, 100) documento aparece em (165, 150) tela
      // Distância do centro (150,150) = 15px = exatamente o raio
      expect(isPointInsideEraser(150, 150, 15, 110, 100, 1.5)).toBe(true);

      // Um ponto em (100, 110) documento aparece em (150, 165) tela
      expect(isPointInsideEraser(150, 150, 15, 100, 110, 1.5)).toBe(true);
    });
  });
});
