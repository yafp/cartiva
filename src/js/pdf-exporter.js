// PDF worker adapter. Export orchestration does not need to know worker details.
(function attachPdfExporter(global) {
  async function createPdfBlob(blob, width, height, dpi = 300) {
    const image = new Uint8Array(await blob.arrayBuffer());
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [0];
    const size = () => parts.reduce((sum, part) => sum + part.length, 0);
    const add = value => parts.push(typeof value === 'string' ? encoder.encode(value) : value);
    const object = (number, body) => {
      offsets[number] = size();
      add(`${number} 0 obj\n${body}\nendobj\n`);
    };

    add('%PDF-1.4\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    const pageWidth = width * 72 / dpi;
    const pageHeight = height * 72 / dpi;
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    offsets[4] = size();
    add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
    add(image);
    add('\nendstream\nendobj\n');
    const commands = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
    object(5, `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
    const xref = size();
    add('xref\n0 6\n0000000000 65535 f \n');
    for (let number = 1; number <= 5; number += 1) add(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
    add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function createLosslessPdfBlob(blob, width, height, dpi) {
    const jsPdf = global.jspdf?.jsPDF;
    if (!jsPdf) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('PNG could not be read for PDF export.'));
      reader.readAsDataURL(blob);
    });
    const pageWidth = width * 72 / dpi;
    const pageHeight = height * 72 / dpi;
    const document = new jsPdf({ unit: 'pt', format: [pageWidth, pageHeight], compress: false });
    document.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'NONE');
    return document.output('blob');
  }

  function create(workerUrl = 'js/export-worker.js') {
    let worker = null;
    let requestId = 0;
    const pending = new Map();

    try {
      worker = new Worker(workerUrl);
    } catch (error) {
      global.CartivaDiagnostics?.record('pdf.worker', 'PDF export worker unavailable; using the main-thread encoder.', { message: error.message }, 'warn');
    }

    if (worker) {
      worker.onmessage = event => {
        const request = pending.get(event.data.id);
        if (!request) return;
        pending.delete(event.data.id);
        if (event.data.error) request.reject(new Error(event.data.error));
        else request.resolve(event.data);
      };
      worker.onerror = event => {
        const error = new Error(event.message || 'PDF worker failed.');
        pending.forEach(request => request.reject(error));
        pending.clear();
      };
    }

    return Object.freeze({
      available: () => Boolean(worker),
      async process(action, payload) {
        if (action === 'pdf' && global.jspdf?.jsPDF) {
          const blob = await createLosslessPdfBlob(payload.blob, payload.width, payload.height, payload.dpi || 300);
          return { filename: payload.filename, blob };
        }
        if (!worker) {
          if (action !== 'pdf') throw new Error('PDF export worker is unavailable.');
          return { filename: payload.filename, blob: await createPdfBlob(payload.blob, payload.width, payload.height, payload.dpi) };
        }
        const id = ++requestId;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, action, ...payload });
        });
      },
      dispose() {
        if (worker) worker.terminate();
        pending.clear();
      }
    });
  }

  global.CartivaPdfExporter = Object.freeze({ create });
})(window);
