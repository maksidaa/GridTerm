// QR Code Generator using qrcode library
const QRCode = require('qrcode');

class QRGenerator {
  static async generate(data, canvas, options = {}) {
    const size = options.size || 200;
    const margin = options.margin || 2;

    try {
      await QRCode.toCanvas(canvas, data, {
        width: size,
        margin: margin,
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
      return true;
    } catch (err) {
      console.error('Error generating QR code:', err);
      return false;
    }
  }

  static async toDataURL(data, options = {}) {
    const size = options.size || 200;
    const margin = options.margin || 2;

    try {
      return await QRCode.toDataURL(data, {
        width: size,
        margin: margin,
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('Error generating QR code data URL:', err);
      return null;
    }
  }
}

// Export for use in renderer
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QRGenerator };
}
