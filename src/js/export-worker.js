self.onmessage = async event => {
  const { id, action, blob, filename } = event.data;
  try {
    if (action === 'passthrough') {
      self.postMessage({ id, filename, blob });
      return;
    }
    if (action === 'pdf') {
      const image = new Uint8Array(await blob.arrayBuffer());
      const { width, height, dpi = 300 } = event.data;
      const pageWidth = width * 72 / dpi;
      const pageHeight = height * 72 / dpi;
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
      self.postMessage({ id, filename, blob: new Blob(parts, { type: 'application/pdf' }) });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
