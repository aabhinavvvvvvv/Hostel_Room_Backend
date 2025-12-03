const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/auditLog');
const { sendAllocationNotification, sendWaitlistNotification } = require('../utils/email');
const allocationEngine = require('../services/allocationEngine');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/allocate/run:
 *   post:
 *     summary: Trigger allocation run (Admin only)
 *     tags: [Allocations]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Allocation run completed
 */
router.post('/run', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const result = await allocationEngine.runAllocation(req.user.id);
    
    res.json({
      success: true,
      message: 'Allocation run completed',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/allocate/stats:
 *   get:
 *     summary: Get allocation statistics
 *     tags: [Allocations]
 *     security:
 *       - cookieAuth: []
 */
router.get('/stats', authenticate, authorize('ADMIN', 'WARDEN'), async (req, res, next) => {
  try {
    const [
      totalApplications,
      pendingApplications,
      allocatedApplications,
      waitlistedApplications,
      totalBeds,
      occupiedBeds,
    ] = await Promise.all([
      prisma.application.count(),
      prisma.application.count({ where: { status: 'PENDING' } }),
      prisma.application.count({ where: { status: 'ALLOCATED' } }),
      prisma.application.count({ where: { status: 'WAITLISTED' } }),
      prisma.bed.count(),
      prisma.bed.count({ where: { occupiedBy: { not: null } } }),
    ]);

    res.json({
      success: true,
      data: {
        applications: {
          total: totalApplications,
          pending: pendingApplications,
          allocated: allocatedApplications,
          waitlisted: waitlistedApplications,
        },
        beds: {
          total: totalBeds,
          occupied: occupiedBeds,
          available: totalBeds - occupiedBeds,
          occupancyRate: totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(2) : 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

