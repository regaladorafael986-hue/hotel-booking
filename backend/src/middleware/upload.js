const multer = require('multer');
const AppError = require('../utils/AppError');

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 5 * 1024 * 1024;

// Files are kept in memory, validated by MIME type *and* magic bytes, then handed to the storage service.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(AppError.badRequest('Only JPG, PNG or WEBP images are allowed.'));
    cb(null, true);
  },
});

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

module.exports = { imageUpload, sniffImage, ALLOWED, MAX_BYTES };
