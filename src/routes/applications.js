const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/auditLog');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/applications:
 *   post:
 *     summary: Submit a room application (Student only)
 *     tags: [Applications]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - preferences
 *             properties:
 *               preferences:
 *                 type: object
 *               priorityCategory:
 *                 type: string
 */
router.post(
  '/',
  authenticate,
  authorize('STUDENT'),
  [
    body('preferences').isObject().withMessage('Preferences must be an object'),
    body('priorityCategory').optional().isString(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { preferences, priorityCategory } = req.body;
      const studentId = req.user.id;

      // Check if student already has an active application
      const existingApplication = await prisma.application.findFirst({
        where: {
          studentId,
          status: { in: ['PENDING', 'WAITLISTED', 'IN_PROGRESS'] },
        },
      });

      if (existingApplication) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active application',
        });
      }

      // Check if student already has an allocation
      const existingAllocation = await prisma.allocation.findFirst({
        where: { studentId },
      });

      if (existingAllocation) {
        return res.status(400).json({
          success: false,
          message: 'You already have a room allocation',
        });
      }

      const application = await prisma.application.create({
        data: {
          studentId,
          preferences,
          priorityCategory: priorityCategory || null,
          status: 'PENDING',
        },
        include: {
          student: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        data: application,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/applications/me:
 *   get:
 *     summary: Get current student's application
 *     tags: [Applications]
 *     security:
 *       - cookieAuth: []
 */
router.get('/me', authenticate, authorize('STUDENT'), async (req, res, next) => {
  try {
    const application = await prisma.application.findFirst({
      where: { studentId: req.user.id },
      include: {
        allocations: {
          include: {
            room: {
              include: {
                block: {
                  include: {
                    hostel: true,
                  },
                },
                floor: true,
              },
            },
            bed: true,
          },
        },
        waitlistEntry: true,
      },
      orderBy: { appliedAt: 'desc' },
    });

    if (!application) {
      return res.json({
        success: true,
        data: null,
        message: 'No application found',
      });
    }

    res.json({ success: true, data: application });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/applications:
 *   get:
 *     summary: List all applications (Warden/Admin only)
 *     tags: [Applications]
 *     security:
 *       - cookieAuth: []
 */
router.get('/', authenticate, authorize('WARDEN', 'ADMIN'), async (req, res, next) => {
  try {
    const { status } = req.query;

    const where = {};
    if (status && status !== '') {
      where.status = status;
    }

    const applications = await prisma.application.findMany({
      where,
      include: {
        student: {
          select: { id: true, name: true, email: true, universityId: true },
        },
        allocations: {
          include: {
            room: {
              include: {
                block: {
                  include: {
                    hostel: true,
                  },
                },
                floor: true,
              },
            },
            bed: true,
          },
        },
        waitlistEntry: true,
      },
      orderBy: { appliedAt: 'desc' },
    });

    res.json({ success: true, data: applications });
  } catch (error) {
    console.error('Error fetching applications:', error);
    next(error);
  }
});

/**
 * @swagger
 * /api/applications/{id}:
 *   get:
 *     summary: Get application by ID
 *     tags: [Applications]
 *     security:
 *       - cookieAuth: []
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        student: {
          select: { id: true, name: true, email: true, universityId: true },
        },
        allocations: {
          include: {
            room: {
              include: {
                block: {
                  include: {
                    hostel: true,
                  },
                },
                floor: true,
              },
            },
            bed: true,
          },
        },
        waitlistEntry: true,
      },
    });

    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Students can only view their own applications
    if (req.user.role === 'STUDENT' && application.studentId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: application });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

