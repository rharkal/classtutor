/**
 * ClassTutor — PDF Viewer (PDF.js integration)
 * Renders PDFs page by page in a canvas, with text layer for highlighting.
 * Phase 1: Loads from a URL. Phase 2: loads via Gemini-provided citation URLs.
 *
 * PDF.js is loaded from CDN (no vendored file needed for Phase 1).
 */

const PdfViewer = (() => {
    let pdfDoc = null;
    let currentPage = 1;
    let totalPages = 0;
    let scale = 1.5;
    let currentFileName = '';
    let isLoading = false;

    // DOM references (set in init)
    let canvas = null;
    let ctx = null;
    let viewport = null;
    let titleEl = null;
    let pageInfoEl = null;
    let prevBtn = null;
    let nextBtn = null;
    let closeBtn = null;
    let placeholderEl = null;
    let highlightLayer = null;

    /** Initialize the viewer with DOM element references */
    function init() {
        canvas = document.getElementById('pdf-canvas');
        ctx = canvas ? canvas.getContext('2d') : null;
        viewport = document.getElementById('pdf-viewport');
        titleEl = document.getElementById('pdf-title');
        pageInfoEl = document.getElementById('pdf-page-info');
        prevBtn = document.getElementById('pdf-prev');
        nextBtn = document.getElementById('pdf-next');
        closeBtn = document.getElementById('pdf-close');
        placeholderEl = viewport ? viewport.querySelector('.pdf-placeholder') : null;
        highlightLayer = document.getElementById('pdf-highlight-layer');

        if (prevBtn) prevBtn.addEventListener('click', prevPage);
        if (nextBtn) nextBtn.addEventListener('click', nextPage);
        if (closeBtn) closeBtn.addEventListener('click', close);

        // Configure PDF.js worker
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        } else {
            loadPdfJs();
        }
    }

    /** Dynamically load PDF.js library from CDN if needed */
    function loadPdfJs() {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            if (window.pdfjsLib) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        };
        document.head.appendChild(script);
    }

    /**
     * Open a PDF at a specific page.
     * @param {string} url - URL to the PDF file
     * @param {number} page - Page number to open (1-indexed)
     * @param {string} fileName - Display name
     * @param {string} highlightText - Text to highlight on the page (optional)
     */
    async function open(url, page = 1, fileName = '', highlightText = '') {
        currentFileName = fileName;
        if (titleEl) titleEl.textContent = fileName || 'Textbook Preview';
        if (placeholderEl) placeholderEl.style.display = 'none';

        // Check if this is a Google Drive URL
        const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (driveMatch) {
            const fileId = driveMatch[1];
            const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
            
            // Hide canvas and show iframe
            if (canvas) canvas.style.display = 'none';
            let iframe = viewport.querySelector('#drive-preview-frame');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = 'drive-preview-frame';
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.border = 'none';
                viewport.appendChild(iframe);
            }
            iframe.style.display = 'block';
            iframe.src = previewUrl;
            if (pageInfoEl) pageInfoEl.textContent = page > 1 ? `Page ${page}` : '';
            return;
        }

        if (!window.pdfjsLib) {
            console.warn('PDF.js not loaded yet. Please wait...');
            return;
        }

        if (isLoading) return;
        isLoading = true;

        try {
            let iframe = viewport.querySelector('#drive-preview-frame');
            if (iframe) iframe.style.display = 'none';
            if (canvas) canvas.style.display = 'block';

            // Load the PDF via PDF.js
            const loadingTask = window.pdfjsLib.getDocument(url);
            pdfDoc = await loadingTask.promise;
            totalPages = pdfDoc.numPages;
            currentPage = Math.max(1, Math.min(page, totalPages));

            await renderPage(currentPage);
            updateNav();
        } catch (e) {
            console.error('Failed to load PDF:', e);
            if (titleEl) titleEl.textContent = 'Failed to load PDF';
            close();
        } finally {
            isLoading = false;
        }
    }

    /** Render a specific page */
    async function renderPage(pageNum) {
        if (!pdfDoc || !canvas || !ctx) return;

        const page = await pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale });

        canvas.width = vp.width;
        canvas.height = vp.height;

        await page.render({
            canvasContext: ctx,
            viewport: vp,
        }).promise;

        currentPage = pageNum;
        updateNav();
    }

    /** Update navigation buttons and page info */
    function updateNav() {
        if (pageInfoEl) pageInfoEl.textContent = `${currentPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
        if (titleEl) titleEl.textContent = currentFileName || 'Document';
    }

    /** Go to previous page */
    async function prevPage() {
        if (currentPage > 1) {
            await renderPage(currentPage - 1);
        }
    }

    /** Go to next page */
    async function nextPage() {
        if (currentPage < totalPages) {
            await renderPage(currentPage + 1);
        }
    }

    /** Close the PDF viewer */
    function close() {
        pdfDoc = null;
        currentPage = 1;
        totalPages = 0;
        currentFileName = '';

        if (canvas) {
            canvas.style.display = 'none';
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        const iframe = viewport ? viewport.querySelector('#drive-preview-frame') : null;
        if (iframe) iframe.style.display = 'none';
        if (placeholderEl) placeholderEl.style.display = '';
        if (titleEl) titleEl.textContent = 'No document open';
        if (pageInfoEl) pageInfoEl.textContent = '—';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        if (highlightLayer) highlightLayer.innerHTML = '';
    }

    /** Check if a PDF is currently open */
    function isOpen() {
        return pdfDoc !== null;
    }

    return {
        init,
        open,
        close,
        prevPage,
        nextPage,
        isOpen,
    };
})();
