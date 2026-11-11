// Image storage: Cloudinary when configured, otherwise local disk (backend/storage/uploads → served at /uploads).
// Local disk is for development only: on Vercel the filesystem is read-only and not persistent, so uploads
// there require Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { sniffImage } = require('../middleware/upload');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'storage', 'uploads');
const cloudinaryEnabled = () => Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

function cloudinarySignature(params) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + env.cloudinary.apiSecret).digest('hex');
}

/** @returns {{ url: string, publicId: string }} */
async function saveImage(file, subfolder = 'misc') {
  const ext = sniffImage(file.buffer);
  if (!ext) throw AppError.badRequest('The uploaded file is not a valid JPG, PNG or WEBP image.');

  if (cloudinaryEnabled()) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `${env.cloudinary.folder}/${subfolder}`;
    const signature = cloudinarySignature({ folder, timestamp });
    const form = new FormData();
    form.append('file', new Blob([file.buffer], { type: file.mimetype }), `upload.${ext}`);
    form.append('api_key', env.cloudinary.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('signature', signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/image/upload`, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError(502, `Image upload failed: ${data?.error?.message || res.status}`);
    return { url: data.secure_url, publicId: data.public_id };
  }

  if (env.isVercel) {
    throw new AppError(503, 'Image uploads are not configured on this server yet (Cloudinary keys are missing). Please contact the administrator.', { code: 'UPLOADS_NOT_CONFIGURED' });
  }
  const dir = path.join(UPLOAD_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer);
  return { url: `/uploads/${subfolder}/${name}`, publicId: `local:${subfolder}/${name}` };
}

async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    if (publicId.startsWith('local:')) {
      const rel = publicId.slice(6).replace(/\.\./g, '');
      const p = path.join(UPLOAD_DIR, rel);
      if (p.startsWith(UPLOAD_DIR) && fs.existsSync(p)) fs.unlinkSync(p);
      return;
    }
    if (!cloudinaryEnabled()) return;
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = cloudinarySignature({ public_id: publicId, timestamp });
    const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: env.cloudinary.apiKey, signature });
    await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/image/destroy`, { method: 'POST', body });
  } catch (err) {
    console.error('[storage] delete failed', publicId, err.message);
  }
}

module.exports = { saveImage, deleteImage, UPLOAD_DIR, cloudinaryEnabled };
