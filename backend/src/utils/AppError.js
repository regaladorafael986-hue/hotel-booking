class AppError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(msg, details) { return new AppError(400, msg, { code: 'BAD_REQUEST', details }); }
  static unauthorized(msg = 'Please log in to continue.') { return new AppError(401, msg, { code: 'UNAUTHORIZED' }); }
  static forbidden(msg = 'You do not have permission to perform this action.') { return new AppError(403, msg, { code: 'FORBIDDEN' }); }
  static notFound(msg = 'Resource not found.') { return new AppError(404, msg, { code: 'NOT_FOUND' }); }
  static conflict(msg, details) { return new AppError(409, msg, { code: 'CONFLICT', details }); }
}
module.exports = AppError;
