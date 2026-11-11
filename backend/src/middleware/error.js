const { Prisma } = require('@prisma/client');
const multer = require('multer');
const { ZodError } = require('zod');
const AppError = require('../utils/AppError');
const { formatZod } = require('./validate');
const env = require('../config/env');

function notFound(req, res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found.`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let body = { error: { message: 'Something went wrong on our side. Please try again.', code: 'SERVER_ERROR' } };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { message: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) } };
  } else if (err instanceof ZodError) {
    const fields = formatZod(err);
    status = 400;
    body = { error: { message: Object.values(fields)[0] || 'Invalid input.', code: 'BAD_REQUEST', details: { fields } } };
  } else if (err instanceof multer.MulterError) {
    status = 400;
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5 MB).' : err.message;
    body = { error: { message: msg, code: 'UPLOAD' } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      // PostgreSQL reports the column list (e.g. ["room_number"]); MySQL reported the index name
      // (e.g. "rooms_room_number_key"), which still needs its table prefix and suffix stripped.
      const target = err.meta?.target;
      const field = Array.isArray(target)
        ? String(target[0] || '')
        : String(target || '').replace(/^[a-z]+_/, '').replace(/_(key|unique)$/, '');
      const label = field ? field.replace(/_/g, ' ') : 'value';
      const message = `This ${label} is already in use.`;
      body = { error: { message, code: 'DUPLICATE', details: field ? { fields: { [field]: message } } : undefined } };
    } else if (err.code === 'P2025') {
      status = 404;
      body = { error: { message: 'Record not found.', code: 'NOT_FOUND' } };
    } else if (err.code === 'P2003') {
      status = 409;
      body = { error: { message: 'This record is referenced by other data and cannot be changed or removed.', code: 'FK' } };
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    // e.g. an unknown enum value passed in a filter
    status = 400;
    body = { error: { message: 'Invalid filter or field value.', code: 'BAD_REQUEST' } };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { error: { message: 'Malformed JSON body.', code: 'BAD_JSON' } };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    body = { error: { message: 'Request body too large.', code: 'TOO_LARGE' } };
  }

  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, err);
    if (!env.isProd) body.error.debug = err.message;
  }
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
