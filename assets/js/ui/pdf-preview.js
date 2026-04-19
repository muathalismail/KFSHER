// ═══════════════════════════════════════════════════════════════
// UI · PDF PREVIEW — inline PDF rendering and source-hint display
// Extracted from app.js (Sprint 6)
// Depends on: ui/card.js (escapeHtml), app.js (loadPdfJs, getPdfHref)
// ═══════════════════════════════════════════════════════════════

let currentPdfPreviewKey = null;
let currentPdfPreviewContext = null;
const lastPreviewContextByDept = new Map();
let currentPdfRenderTask = 0;
let currentPdfTextIndex = [];
let currentPdfSearchResults = [];

function closePdfPreview() {
  const wrap = document.getElementById('pdfPreviewWrap');
  const frame = document.getElementById('pdfFrame');
  const hint = document.getElementById('pdfSourceHint');
  const render = document.getElementById('pdfRender');
  const status = document.getElementById('pdfRenderStatus');
  currentPdfRenderTask += 1;
  currentPdfTextIndex = [];
  currentPdfSearchResults = [];
  frame.src = 'about:blank';
  if (render) render.innerHTML = '';
  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  if (hint) {
    hint.hidden = true;
    hint.innerHTML = '';
  }
  wrap.style.display = 'none';
  currentPdfPreviewKey = null;
  currentPdfPreviewContext = null;
}

function renderPdfSourceHint(context=null) {
  const hint = document.getElementById('pdfSourceHint');
  if (!hint) return;
  if (!context || (!context.section && !context.highlightTerms?.length)) {
    hint.hidden = true;
    hint.innerHTML = '';
    return;
  }
  const chips = (context.highlightTerms || []).filter(Boolean)
    .map(term => `<span class="pdf-source-chip">${escapeHtml(term)}</span>`)
    .join('');
  const pageText = context.page ? `Page ${context.page}` : 'Matched section';
  const sectionText = context.section ? ` · ${escapeHtml(context.section)}` : '';
  hint.innerHTML = `<span class="pdf-source-label">Source Match</span><span class="pdf-source-text">${escapeHtml(pageText)}${sectionText}</span>${chips}`;
  hint.hidden = false;
}

async function renderPdfPreviewPages(meta, context=null) {
  const render = document.getElementById('pdfRender');
  const frame = document.getElementById('pdfFrame');
  const status = document.getElementById('pdfRenderStatus');
  if (!render || !status || !frame) return;
  ++currentPdfRenderTask;
  currentPdfTextIndex = [];
  currentPdfSearchResults = [];
  render.innerHTML = '';
  status.hidden = true;

  // Use native browser PDF rendering via iframe/embed
  const pageSuffix = context && context.page ? `#page=${context.page}` : '';
  const pdfUrl = `${meta.href}${pageSuffix}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    // iOS Safari: use embed + fallback link
    const embed = document.createElement('embed');
    embed.src = pdfUrl;
    embed.type = 'application/pdf';
    embed.style.cssText = 'width:100%;height:80vh;border:none;display:block;background:#fff;border-radius:8px';
    render.appendChild(embed);
    const fallback = document.createElement('a');
    fallback.href = pdfUrl;
    fallback.target = '_blank';
    fallback.rel = 'noopener';
    fallback.textContent = 'فتح PDF في نافذة جديدة';
    fallback.style.cssText = 'display:block;padding:12px;text-align:center;font-size:14px;color:var(--accent,#7ee8fa);margin-top:8px';
    render.appendChild(fallback);
  } else {
    // Desktop + Android: native iframe with browser PDF toolbar
    frame.style.display = 'block';
    frame.style.cssText = 'width:100%;height:80vh;border:none;display:block;background:#fff;border-radius:8px';
    frame.src = pdfUrl;
  }
}

async function showPdfPreview(deptKey, context=null) {
  const meta = await getPdfHref(deptKey);
  if (!meta) return;
  closePdfPreview();
  currentPdfPreviewKey = deptKey;
  currentPdfPreviewContext = context || lastPreviewContextByDept.get(deptKey) || null;
  document.getElementById('pdfPreviewWrap').style.display = 'block';
  document.getElementById('pdfPreviewName').textContent = meta.name || '';
  const pageSuffix = currentPdfPreviewContext && currentPdfPreviewContext.page ? `#page=${currentPdfPreviewContext.page}` : '';
  document.getElementById('openPdfBtn').href = `${meta.href}${pageSuffix}`;
  document.getElementById('downloadPdfBtn').href = meta.href;
  document.getElementById('downloadPdfBtn').setAttribute('download', meta.name || 'rota.pdf');
  renderPdfSourceHint(currentPdfPreviewContext);
  await renderPdfPreviewPages(meta, currentPdfPreviewContext);
  document.getElementById('pdfPreviewWrap').scrollIntoView({behavior:'smooth', block:'start'});
}
