import { PDFDocument, PageSizes, rgb } from 'pdf-lib';

/**
 * Maps a paper size name to its points dimensions.
 */
export function getPaperDimensions(paperSize, orientation) {
  let width, height;
  switch (paperSize.toLowerCase()) {
    case 'a3':
      [width, height] = PageSizes.A3;
      break;
    case 'a4':
      [width, height] = PageSizes.A4;
      break;
    case 'letter':
    default:
      [width, height] = PageSizes.Letter;
      break;
  }
  if (orientation === 'landscape') {
    return [height, width];
  }
  return [width, height];
}

/**
 * Calculates page placement grid cell coordinates.
 */
export function calculateGridCells({
  width,
  height,
  rows,
  cols,
  margin,
  gap
}) {
  const availW = width - 2 * margin;
  const availH = height - 2 * margin;

  const cellW = (availW - (cols - 1) * gap) / cols;
  const cellH = (availH - (rows - 1) * gap) / rows;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const xCell = margin + c * (cellW + gap);
      // In PDF coordinates, y=0 is at the bottom, so rows start from the top
      const yCell = height - margin - (r + 1) * cellH - r * gap;
      cells.push({ row: r, col: c, x: xCell, y: yCell, w: cellW, h: cellH });
    }
  }
  return cells;
}

/**
 * Process a source PDF and compile it into a grid-based N-Up PDF.
 */
export async function processNUpPdf({
  srcFileBytes,
  rows,
  cols,
  margin,
  gap,
  paperSize,
  orientation,
  duplexMode,
  flowMode = 'card', // 'card' (Sequential Duplex) or 'grid' (Sheet Flow)
  drawBorders,
  onProgress
}) {
  if (onProgress) onProgress(10);

  // Load the source PDF
  const srcDoc = await PDFDocument.load(srcFileBytes);
  const srcPages = srcDoc.getPages();
  const srcPageCount = srcPages.length;

  if (onProgress) onProgress(30);

  // Create the destination PDF
  const destDoc = await PDFDocument.create();
  
  // Embed all source pages into the destination PDF
  const embeddedPages = await destDoc.embedPages(srcPages);
  
  if (onProgress) onProgress(50);

  const [sheetW, sheetH] = getPaperDimensions(paperSize, orientation);
  const cells = calculateGridCells({ width: sheetW, height: sheetH, rows, cols, margin, gap });
  
  const cellsPerSheet = rows * cols;
  
  let totalSheets;
  if (flowMode === 'card') {
    const totalLeaves = Math.ceil(srcPageCount / (2 * cellsPerSheet));
    totalSheets = totalLeaves * 2;
  } else {
    totalSheets = Math.ceil(srcPageCount / cellsPerSheet);
  }

  for (let s = 0; s < totalSheets; s++) {
    // Add page to destination document
    const destPage = destDoc.addPage([sheetW, sheetH]);
    
    // Check if this sheet is even (back page, 0-indexed odd index)
    const isBackPage = s % 2 !== 0;
    const leafIndex = Math.floor(s / 2);

    for (let cellIdx = 0; cellIdx < cellsPerSheet; cellIdx++) {
      const cell = cells[cellIdx];
      let srcPageIndex = -1;

      if (flowMode === 'card') {
        if (!isBackPage) {
          // Front page of Leaf: contains odd source indices (0, 2, 4, 6...)
          srcPageIndex = leafIndex * (2 * cellsPerSheet) + (2 * cellIdx);
        } else {
          // Back page of Leaf: contains even source indices (1, 3, 5, 7...)
          // Apply duplex mirroring on back cells to find corresponding front cell
          let rSrc = cell.row;
          let cSrc = cell.col;

          if (duplexMode === 'long-edge') {
            cSrc = cols - 1 - cell.col; // flip columns horizontally
          } else if (duplexMode === 'short-edge') {
            rSrc = rows - 1 - cell.row; // flip rows vertically
          }

          const frontCellIdx = rSrc * cols + cSrc;
          srcPageIndex = leafIndex * (2 * cellsPerSheet) + (2 * frontCellIdx) + 1;
        }
      } else {
        // Grid Flow Mode (sequential page order filling sheets)
        let rSrc = cell.row;
        let cSrc = cell.col;

        if (isBackPage) {
          if (duplexMode === 'long-edge') {
            cSrc = cols - 1 - cell.col;
          } else if (duplexMode === 'short-edge') {
            rSrc = rows - 1 - cell.row;
          }
        }

        const srcIdxInSheet = rSrc * cols + cSrc;
        srcPageIndex = s * cellsPerSheet + srcIdxInSheet;
      }

      // If page index is within bounds, draw it
      if (srcPageIndex >= 0 && srcPageIndex < srcPageCount) {
        const embeddedPage = embeddedPages[srcPageIndex];
        const { width: srcW, height: srcH } = srcPages[srcPageIndex].getSize();

        // Calculate scaling to fit cell while maintaining aspect ratio
        const scale = Math.min(cell.w / srcW, cell.h / srcH);
        const scaledW = srcW * scale;
        const scaledH = srcH * scale;

        // Center within the cell
        const dx = (cell.w - scaledW) / 2;
        const dy = (cell.h - scaledH) / 2;

        destPage.drawPage(embeddedPage, {
          x: cell.x + dx,
          y: cell.y + dy,
          width: scaledW,
          height: scaledH,
        });

        // Draw cutting border around the cell if requested
        if (drawBorders) {
          destPage.drawRectangle({
            x: cell.x,
            y: cell.y,
            width: cell.w,
            height: cell.h,
            borderColor: rgb(0.75, 0.75, 0.75),
            borderWidth: 0.5,
          });
        }
      }
    }
    
    if (onProgress) {
      const progressPercent = 50 + Math.floor((s + 1) / totalSheets * 40);
      onProgress(progressPercent);
    }
  }

  // Save the document to bytes
  const destPdfBytes = await destDoc.save();
  
  if (onProgress) onProgress(100);
  return destPdfBytes;
}
