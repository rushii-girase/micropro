import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { 
  Upload, 
  FileText, 
  RefreshCw, 
  Settings, 
  Grid, 
  Layers, 
  Scissors, 
  Printer, 
  Download, 
  AlertTriangle,
  FileDown,
  Info,
  Maximize2
} from 'lucide-react';
import { processNUpPdf, getPaperDimensions } from './utils/pdfProcessor';

// Set up the PDFJS worker using unpkg CDN which matches the library version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Component to render individual source pages as canvas thumbnails
function PageThumbnail({ pdfDocument, pageIndex }) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pdfDocument) return;
    let active = true;
    let renderTask = null;

    async function renderPage() {
      try {
        setLoading(true);
        // Pages are 1-indexed in PDFJS
        const page = await pdfDocument.getPage(pageIndex + 1);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        const unscaledViewport = page.getViewport({ scale: 1.0 });
        // Set thumbnail width to ~240px for quick rendering
        const scale = 240 / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        // Get high DPI backing store if necessary, but standard scale is fine for thumbnails
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({
          canvasContext: context,
          viewport: viewport
        });

        await renderTask.promise;
        if (active) setLoading(false);
      } catch (err) {
        if (active && err.name !== 'RenderingCancelledException') {
          console.error('Thumbnail render error:', err);
          setError(err.message);
          setLoading(false);
        }
      }
    }

    renderPage();

    return () => {
      active = false;
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDocument, pageIndex]);

  if (error) {
    return <div className="thumbnail-error" title={error}>!</div>;
  }

  return (
    <div style={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      background: '#f8fafc',
      overflow: 'hidden'
    }}>
      {loading && (
        <div style={{ position: 'absolute', display: 'flex', gap: '4px' }}>
          <div className="spin" style={{ width: '12px', height: '12px', border: '2px solid var(--color-primary)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
        </div>
      )}
      <canvas 
        ref={canvasRef} 
        style={{ 
          maxWidth: '90%', 
          maxHeight: '90%', 
          display: loading ? 'none' : 'block', 
          boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0'
        }} 
      />
    </div>
  );
}

function App() {
  // File State
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfBytes, setPdfBytes] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');

  // Configuration State
  const [preset, setPreset] = useState('3x3'); // '3x3', '2x2', '2x3', '4x4', 'custom'
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [margin, setMargin] = useState(20); // in points
  const [gap, setGap] = useState(10); // in points
  const [paperSize, setPaperSize] = useState('a4');
  const [orientation, setOrientation] = useState('portrait');
  const [duplexMode, setDuplexMode] = useState('long-edge'); // 'long-edge', 'short-edge', 'none'
  const [flowMode, setFlowMode] = useState('card'); // 'card' (Sequential Duplex) or 'grid' (Sheet Flow)
  const [drawBorders, setDrawBorders] = useState(true);

  // Processing State
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Sync rows & cols to presets
  useEffect(() => {
    if (preset === '3x3') {
      setRows(3);
      setCols(3);
    } else if (preset === '2x2') {
      setRows(2);
      setCols(2);
    } else if (preset === '2x3') {
      setRows(3);
      setCols(2);
    } else if (preset === '4x4') {
      setRows(4);
      setCols(4);
    }
  }, [preset]);

  const handlePresetChange = (e) => {
    setPreset(e.target.value);
  };

  // Drag and drop state
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf" || file.name.endsWith('.pdf')) {
        await loadPdfFile(file);
      } else {
        alert("Please drop a valid PDF file.");
      }
    }
  };

  const handleFileChange = async (e) => {
    if (e.target.files && e.target.files[0]) {
      await loadPdfFile(e.target.files[0]);
    }
  };

  const loadPdfFile = async (file) => {
    try {
      setPdfFile(file);
      setFileName(file.name);
      setFileSize((file.size / (1024 * 1024)).toFixed(2) + ' MB');
      setProcessing(true);
      setProgress(20);

      const arrayBuffer = await file.arrayBuffer();
      setPdfBytes(arrayBuffer);
      setProgress(50);

      // Slice arrayBuffer to pass a copy, preventing PDFJS worker from detaching the original
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      const doc = await loadingTask.promise;
      
      setPdfDocument(doc);
      setNumPages(doc.numPages);
      setProgress(100);
      setProcessing(false);
    } catch (err) {
      console.error('Error parsing PDF:', err);
      alert('Failed to parse PDF. It might be corrupt or encrypted.');
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setPdfFile(null);
    setPdfBytes(null);
    setPdfDocument(null);
    setNumPages(0);
    setFileName('');
    setFileSize('');
  };

  // Trigger output PDF generation
  const handleGenerate = async () => {
    if (!pdfBytes) return;
    try {
      setProcessing(true);
      setProgress(10);

      const outputBytes = await processNUpPdf({
        srcFileBytes: pdfBytes,
        rows,
        cols,
        margin,
        gap,
        paperSize,
        orientation,
        duplexMode,
        flowMode,
        drawBorders,
        onProgress: (p) => setProgress(p)
      });

      // Trigger file download in browser
      const blob = new Blob([outputBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Add suffix indicating N-up config
      const originalBase = fileName.replace(/\.pdf$/i, '');
      link.download = `${originalBase}_micro_${rows}x${cols}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setProcessing(false);
    } catch (err) {
      console.error('PDF creation error:', err);
      alert('Failed to compile PDF: ' + err.message);
      setProcessing(false);
    }
  };

  // Math dimensions for the preview container
  const [sheetW, sheetH] = getPaperDimensions(paperSize, orientation);
  const aspect = sheetH / sheetW;
  const sheetWidth = 480; // Fixed preview width in pixels (increased from 320 for larger size)
  const sheetHeight = sheetWidth * aspect;

  const cellsPerSheet = rows * cols;
  
  let totalSheets = 0;
  if (numPages > 0) {
    if (flowMode === 'card') {
      const totalLeaves = Math.ceil(numPages / (2 * cellsPerSheet));
      totalSheets = totalLeaves * 2;
    } else {
      totalSheets = Math.ceil(numPages / cellsPerSheet);
    }
  }

  // Render sheet preview pairs
  const renderSheetsPreview = () => {
    const sheetPairs = [];
    const paddingPct = (margin / sheetW) * 100;
    const gapPct = (gap / sheetW) * 100;

    // We process sheets in pairs (front and back of each leaf)
    for (let s = 0; s < totalSheets; s += 2) {
      const frontSheetIdx = s;
      const backSheetIdx = s + 1;

      sheetPairs.push(
        <div key={`sheet-pair-${s}`} className="sheet-pair" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '3rem' }}>
          
          {/* Front Sheet */}
          <div className="sheet-preview-card">
            <span className="sheet-label">
              <Printer size={16} /> Leaf {Math.floor(s / 2) + 1} - Front (Sheet {frontSheetIdx + 1})
            </span>
            <div 
              className="sheet-canvas-wrapper" 
              style={{ 
                width: '100%',
                maxWidth: `${sheetWidth}px`,
                aspectRatio: `${sheetW} / ${sheetH}`,
                padding: `${paddingPct}%`,
                gap: `${gapPct}%`,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`
              }}
            >
              {Array.from({ length: cellsPerSheet }).map((_, cellIdx) => {
                let srcPageIndex = -1;
                if (flowMode === 'card') {
                  // Card Flow front sheet: contains odd source indices (0, 2, 4, 6...)
                  srcPageIndex = Math.floor(s / 2) * (2 * cellsPerSheet) + (2 * cellIdx);
                } else {
                  // Grid Flow front sheet: sequential indices
                  srcPageIndex = frontSheetIdx * cellsPerSheet + cellIdx;
                }

                return (
                  <div key={`front-cell-${cellIdx}`} style={{ position: 'relative', border: drawBorders ? '1px dashed #cbd5e1' : 'none', overflow: 'hidden' }}>
                    {srcPageIndex < numPages ? (
                      <>
                        <span className="preview-grid-cell-label" style={{ top: '4px', left: '4px' }}>
                          P. {srcPageIndex + 1}
                        </span>
                        <PageThumbnail pdfDocument={pdfDocument} pageIndex={srcPageIndex} />
                      </>
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: '#f8fafc', border: '1px dashed #cbd5e1' }}></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Back Sheet */}
          {backSheetIdx < totalSheets || (flowMode === 'grid' && numPages > frontSheetIdx * cellsPerSheet) ? (
            <div className="sheet-preview-card">
              <span className="sheet-label">
                <Printer size={16} /> Leaf {Math.floor(s / 2) + 1} - Back (Sheet {backSheetIdx + 1})
              </span>
              <div 
                className="sheet-canvas-wrapper" 
                style={{ 
                  width: '100%',
                  maxWidth: `${sheetWidth}px`,
                  aspectRatio: `${sheetW} / ${sheetH}`,
                  padding: `${paddingPct}%`,
                  gap: `${gapPct}%`,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, 1fr)`
                }}
              >
                {Array.from({ length: cellsPerSheet }).map((_, cellIdx) => {
                  const r = Math.floor(cellIdx / cols);
                  const c = cellIdx % cols;

                  let rSrc = r;
                  let cSrc = c;

                  if (duplexMode === 'long-edge') {
                    cSrc = cols - 1 - c; // Horizontal column mirror
                  } else if (duplexMode === 'short-edge') {
                    rSrc = rows - 1 - r; // Vertical row mirror
                  }

                  let srcPageIndex = -1;
                  let correspondingFrontIdx = -1;

                  if (flowMode === 'card') {
                    // Card Flow back sheet: even source indices (1, 3, 5, 7...) aligned back-to-back
                    const frontCellIdx = rSrc * cols + cSrc;
                    const leafIndex = Math.floor(s / 2);
                    srcPageIndex = leafIndex * (2 * cellsPerSheet) + (2 * frontCellIdx) + 1;
                    correspondingFrontIdx = leafIndex * (2 * cellsPerSheet) + (2 * frontCellIdx);
                  } else {
                    // Grid Flow back sheet: sequential indices
                    const srcIdxInSheet = rSrc * cols + cSrc;
                    srcPageIndex = backSheetIdx * cellsPerSheet + srcIdxInSheet;
                    correspondingFrontIdx = frontSheetIdx * cellsPerSheet + (r * cols + (cols - 1 - c));
                  }

                  return (
                    <div key={`back-cell-${cellIdx}`} style={{ position: 'relative', border: drawBorders ? '1px dashed #cbd5e1' : 'none', overflow: 'hidden' }}>
                      {srcPageIndex < numPages ? (
                        <>
                          <span className="preview-grid-cell-label" style={{ top: '4px', left: '4px', backgroundColor: 'var(--color-secondary)' }}>
                            P. {srcPageIndex + 1}
                          </span>
                          {correspondingFrontIdx !== -1 && correspondingFrontIdx < numPages && (
                            <span className="preview-grid-cell-label" style={{ bottom: '4px', right: '4px', fontSize: '8px', backgroundColor: 'var(--color-success)' }} title="This cell aligns back-to-back with this front page number">
                              Back of P.{correspondingFrontIdx + 1}
                            </span>
                          )}
                          <PageThumbnail pdfDocument={pdfDocument} pageIndex={srcPageIndex} />
                        </>
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#f8fafc', border: '1px dashed #cbd5e1' }}></div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

        </div>
      );
    }
    return sheetPairs;
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">μ</div>
          <span className="logo-text">MicroPDF Pro</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>v1.1.0</span>
          {pdfDocument && (
            <button 
              onClick={handleReset} 
              style={{
                background: 'transparent',
                border: '1px solid var(--glass-border)',
                color: 'var(--text-secondary)',
                padding: '0.35rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                cursor: 'pointer'
              }}
            >
              Reset File
            </button>
          )}
        </div>
      </header>

      {/* Main Grid content */}
      <main className="main-content">
        
        {/* Sidebar Controls */}
        <aside className="sidebar">
          
          {/* File Upload Section */}
          <div className="glass-card">
            <span className="section-title">
              <Layers size={14} /> 1. Input Document
            </span>
            
            {!pdfFile ? (
              <div 
                className={`dropzone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                <Upload className="dropzone-icon" size={32} />
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.875rem' }}>Drag & Drop PDF</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>or click to browse files</p>
                </div>
                <input 
                  type="file" 
                  id="file-input" 
                  accept="application/pdf" 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }} 
                />
              </div>
            ) : (
              <div className="file-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <FileText size={24} style={{ color: 'var(--color-primary)' }} />
                  <div style={{ overflow: 'hidden' }}>
                    <p style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileName}>
                      {fileName}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fileSize}</p>
                  </div>
                </div>
                <div className="meta-row">
                  <span>Source Pages:</span>
                  <span className="meta-val">{numPages} pages</span>
                </div>
                <div className="meta-row">
                  <span>Expected Sheets:</span>
                  <span className="meta-val">{totalSheets} ({totalSheets * 2} pages)</span>
                </div>
              </div>
            )}
          </div>

          {/* Grid Configuration Section */}
          <div className="glass-card">
            <span className="section-title">
              <Grid size={14} /> 2. Grid Arrangement
            </span>

            <div className="control-group">
              <label className="control-label">Layout Preset</label>
              <select className="input-select" value={preset} onChange={handlePresetChange}>
                <option value="3x3">3x3 Grid (9 Pages per Sheet)</option>
                <option value="2x2">2x2 Grid (4 Pages per Sheet)</option>
                <option value="2x3">2x3 Grid (6 Pages per Sheet)</option>
                <option value="4x4">4x4 Grid (16 Pages per Sheet)</option>
                <option value="custom">Custom Dimensions</option>
              </select>
            </div>

            {preset === 'custom' && (
              <>
                <div className="control-group">
                  <label className="control-label">
                    Rows 
                    <span className="control-badge">{rows}</span>
                  </label>
                  <input 
                    type="range" 
                    min="1" 
                    max="6" 
                    className="input-range"
                    value={rows} 
                    onChange={(e) => setRows(parseInt(e.target.value))} 
                  />
                </div>
                <div className="control-group">
                  <label className="control-label">
                    Columns 
                    <span className="control-badge">{cols}</span>
                  </label>
                  <input 
                    type="range" 
                    min="1" 
                    max="6" 
                    className="input-range"
                    value={cols} 
                    onChange={(e) => setCols(parseInt(e.target.value))} 
                  />
                </div>
              </>
            )}

            <div className="control-group" style={{ marginTop: '0.75rem' }}>
              <label className="control-label" style={{ marginBottom: '0.25rem' }}>
                Page Flow Mode
              </label>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Determines how pages are grouped and printed.
              </p>
              <select className="input-select" value={flowMode} onChange={(e) => setFlowMode(e.target.value)}>
                <option value="card">Card Duplex Flow (P. 1-2, 3-4 back-to-back)</option>
                <option value="grid">Sheet Grid Flow (P. 1-9 front, 10-18 back)</option>
              </select>
            </div>
          </div>

          {/* Alignment Configuration */}
          <div className="glass-card">
            <span className="section-title">
              <Printer size={14} /> 3. Duplex Alignment
            </span>

            <div className="control-group">
              <label className="control-label" style={{ marginBottom: '0.25rem' }}>
                Duplex Flipped Binding
                <span className="control-badge" style={{ textTransform: 'capitalize' }}>{duplexMode.replace('-', ' ')}</span>
              </label>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                Mirrors backing layout so odd/even grids align perfectly back-to-back when cut.
              </p>
              <div className="toggle-group">
                <div 
                  className={`toggle-option ${duplexMode === 'long-edge' ? 'active' : ''}`}
                  onClick={() => setDuplexMode('long-edge')}
                  title="Horizontally mirror columns on back pages (Standard double sided)"
                >
                  Long Edge
                </div>
                <div 
                  className={`toggle-option ${duplexMode === 'short-edge' ? 'active' : ''}`}
                  onClick={() => setDuplexMode('short-edge')}
                  title="Vertically mirror rows on back pages (Tablet/Clipboard double sided)"
                >
                  Short Edge
                </div>
                <div 
                  className={`toggle-option ${duplexMode === 'none' ? 'active' : ''}`}
                  onClick={() => setDuplexMode('none')}
                  title="Maintain normal grid direction on back pages"
                >
                  None
                </div>
              </div>
            </div>
          </div>

          {/* Sheet Options Panel */}
          <div className="glass-card">
            <span className="section-title">
              <Settings size={14} /> 4. Page Options
            </span>

            <div className="control-group">
              <label className="control-label">Paper Standard</label>
              <select className="input-select" value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
                <option value="a4">A4 (Standard International)</option>
                <option value="letter">Letter (Standard US)</option>
                <option value="a3">A3 (Large Format)</option>
              </select>
            </div>

            <div className="control-group">
              <label className="control-label">Orientation</label>
              <select className="input-select" value={orientation} onChange={(e) => setOrientation(e.target.value)}>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </div>

            <div className="control-group">
              <label className="control-label">
                Sheet Border Margin
                <span className="control-badge">{margin}pt</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="80" 
                className="input-range"
                value={margin} 
                onChange={(e) => setMargin(parseInt(e.target.value))} 
              />
            </div>

            <div className="control-group">
              <label className="control-label">
                Inter-Grid Gap
                <span className="control-badge">{gap}pt</span>
              </label>
              <input 
                type="range" 
                min="0" 
                max="40" 
                className="input-range"
                value={gap} 
                onChange={(e) => setGap(parseInt(e.target.value))} 
              />
            </div>

            <div className="control-group" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <label className="control-label" style={{ cursor: 'pointer' }}>
                Draw Cutting Guidelines
              </label>
              <input 
                type="checkbox" 
                checked={drawBorders} 
                onChange={(e) => setDrawBorders(e.target.checked)} 
                style={{ width: '1.15rem', height: '1.15rem', accentColor: 'var(--color-primary)', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Action Trigger */}
          <button 
            className="btn-primary" 
            disabled={!pdfBytes || processing}
            onClick={handleGenerate}
          >
            {processing ? (
              <>
                <RefreshCw size={18} className="spin" /> Generating...
              </>
            ) : (
              <>
                <Download size={18} /> Compile & Download
              </>
            )}
          </button>
        </aside>

        {/* Live Preview Pane */}
        <section className="preview-area">
          {pdfDocument ? (
            <>
              <div className="preview-header">
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h2 className="preview-title">Real-Time Print Preview</h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    Inspect the back-to-back alignment of the print sheets. Green labels on the back indicate matching front page cells.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <span className="control-badge" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                    Mode: {flowMode === 'card' ? 'Card Duplex' : 'Sheet Grid'}
                  </span>
                  <span className="control-badge" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                    Layout: {rows}x{cols}
                  </span>
                </div>
              </div>

              <div className="preview-grid-container">
                {renderSheetsPreview()}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                <FileDown size={32} />
              </div>
              <div>
                <h3 className="empty-text-title">MicroPDF Grid Compiler</h3>
                <p className="empty-text-desc">
                  This utility reformats multi-page documents into sheets containing micro grid pages. 
                </p>
                <div style={{ 
                  marginTop: '1.5rem', 
                  padding: '1rem', 
                  background: 'rgba(255,255,255,0.03)', 
                  border: '1px solid var(--glass-border)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left',
                  fontSize: '0.8rem',
                  lineHeight: '1.5'
                }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Info size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <strong style={{ color: 'var(--text-primary)' }}>Duplex Printing Ready:</strong>
                  </div>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    Normally, double-sided printing flips the sheet horizontally. To keep pages matching (so Page 1 is physically backed by Page 10 when cut), the columns on even pages must be mirrored horizontally. This tool handles this alignment calculation automatically.
                  </p>
                </div>
              </div>
              <button 
                className="btn-primary" 
                style={{ marginTop: '0.5rem', maxWidth: '240px' }}
                onClick={() => document.getElementById('file-input').click()}
              >
                Select PDF Document
              </button>
            </div>
          )}

          {/* Loading Screen */}
          {processing && (
            <div className="progress-overlay">
              <div className="progress-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
                  <span>Creating Micro PDF...</span>
                  <span>{progress}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.75rem', textAlign: 'center' }}>
                  Processing locally in browser. This may take a few seconds for large documents.
                </p>
              </div>
            </div>
          )}
        </section>

      </main>
    </div>
  );
}

export default App;
