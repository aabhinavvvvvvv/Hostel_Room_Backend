const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const createAuditLog = async (actorId, action, targetType, targetId, details = null) => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        details: details || {},
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw - audit logging shouldn't break the main flow
  }
};

const auditMiddleware = (action, targetType) => {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = async function(data) {
      // Only log successful operations
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const targetId = req.params.id || req.body.id || data.id || 'unknown';
        await createAuditLog(
          req.user.id,
          action,
          targetType,
          targetId,
          { method: req.method, path: req.path, body: req.body }
        );
      }
      return originalJson(data);
    };
    
    next();
  };
};

module.exports = { createAuditLog, auditMiddleware };

