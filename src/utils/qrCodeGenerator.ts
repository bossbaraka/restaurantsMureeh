import QRCode from 'qrcode';

export function getTableLink(tableIdOrNumber: string | number, restaurantSlug: string = 'merar', qrToken?: string): string {
  const tableNum = typeof tableIdOrNumber === 'number'
    ? tableIdOrNumber
    : parseInt(String(tableIdOrNumber).replace(/\D/g, ''), 10) || 1;

  const token = qrToken || '';
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/r/${restaurantSlug}?qr=${encodeURIComponent(token)}`;
  }
  return `https://merar-dining.com/r/${restaurantSlug}?qr=${encodeURIComponent(token)}`;
}

export async function generateQrDataUrl(
  tableIdOrNumber: string | number,
  restaurantSlug: string = 'merar',
  originUrl?: string,
  qrToken?: string
): Promise<string> {
  const targetUrl = originUrl || getTableLink(tableIdOrNumber, restaurantSlug, qrToken);

  try {
    return await QRCode.toDataURL(targetUrl, {
      width: 450,
      margin: 2,
      color: {
        dark: '#0A0B0D',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    return '';
  }
}

export async function generateQrSvgString(
  tableIdOrNumber: string | number,
  restaurantSlug: string = 'merar',
  originUrl?: string,
  qrToken?: string
): Promise<string> {
  const targetUrl = originUrl || getTableLink(tableIdOrNumber, restaurantSlug, qrToken);

  try {
    return await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#0A0B0D',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'H',
    });
  } catch (err) {
    console.error('Error generating QR SVG:', err);
    return '';
  }
}
