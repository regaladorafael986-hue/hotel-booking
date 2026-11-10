const prisma = require('../config/prisma');

/**
 * Record an administrative / security-relevant action. Never throws — auditing must not break the request.
 * @param {object} req Express request (for user + IP) or null for system jobs
 */
async function log(req, action, { entityType, entityId, description } = {}, client = prisma) {
  try {
    await client.auditLog.create({
      data: {
        userId: req?.user?.id ?? null,
        action,
        entityType: entityType ?? null,
        entityId: entityId !== undefined && entityId !== null ? String(entityId) : null,
        description: description ?? null,
        ipAddress: req ? String(req.ip || '').slice(0, 45) : null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write log', action, err.message);
  }
}

module.exports = { log };
