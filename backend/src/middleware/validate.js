const { ZodError } = require('zod');
const AppError = require('../utils/AppError');

function formatZod(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * validate({ body, query, params }) — parses with zod and replaces the input with the parsed value.
 * Parsed query is stored at req.q (Express 5 makes req.query read-only).
 */
const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) req.q = schemas.query.parse(req.query);
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = formatZod(err);
      return next(AppError.badRequest(Object.values(fields)[0] || 'Invalid input.', { fields }));
    }
    next(err);
  }
};

module.exports = { validate, formatZod };
