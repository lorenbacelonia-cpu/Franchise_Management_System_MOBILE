import QRCode from 'qrcode';

let currentQRCanvas = null;

export async function generateQR(data, options = {}) {
  const outputContainer = document.getElementById('qr-output');
  if (!outputContainer) return;

  const colorDark = options.colorDark || '#0f172a';
  const colorLight = options.colorLight || '#ffffff';
  const size = parseInt(options.size || 300, 10);

  outputContainer.innerHTML = '';

  const canvas = document.createElement('canvas');
  outputContainer.appendChild(canvas);
  currentQRCanvas = canvas;

  try {
    await QRCode.toCanvas(canvas, data || 'https://scanverse.app', {
      width: size,
      margin: 2,
      color: {
        dark: colorDark,
        light: colorLight
      },
      errorCorrectionLevel: 'M'
    });
    return canvas;
  } catch (err) {
    console.error('Error generating QR code:', err);
    outputContainer.innerHTML = `<div style="color: var(--danger); font-size: 0.8rem;">Failed to render QR Code</div>`;
    return null;
  }
}

export function downloadQRPNG(filename = 'qrcode.png') {
  if (!currentQRCanvas) return;

  const link = document.createElement('a');
  link.download = filename;
  link.href = currentQRCanvas.toDataURL('image/png');
  link.click();
}

export async function shareQRImage() {
  if (!currentQRCanvas) return false;

  try {
    currentQRCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], 'qrcode.png', { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'QR Code',
          text: 'Check out this generated QR code'
        });
      } else if (navigator.share) {
        await navigator.share({
          title: 'QR Code',
          url: window.location.href
        });
      } else {
        alert('Sharing is not supported on this browser. Download PNG instead.');
      }
    });
  } catch (err) {
    console.warn('Share canceled or failed:', err);
  }
}
