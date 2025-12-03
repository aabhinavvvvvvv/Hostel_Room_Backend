const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/auditLog');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/hostels:
 *   get:
 *     summary: List all hostels
 *     tags: [Hostels]
 *     responses:
 *       200:
 *         description: List of hostels
 */
router.get('/', async (req, res, next) => {
  try {
    const hostels = await prisma.hostel.findMany({
      include: {
        blocks: {
          include: {
            floors: {
              include: {
                rooms: {
                  include: {
                    beds: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    res.json({ success: true, data: hostels });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/hostels:
 *   post:
 *     summary: Create a new hostel (Admin only)
 *     tags: [Hostels]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - gender
 *             properties:
 *               name:
 *                 type: string
 *               gender:
 *                 type: string
 */
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  auditMiddleware('CREATE', 'HOSTEL'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('gender').isIn(['MALE', 'FEMALE', 'MIXED']).withMessage('Gender must be MALE, FEMALE, or MIXED'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, gender } = req.body;

      const hostel = await prisma.hostel.create({
        data: { name, gender },
      });

      res.status(201).json({ success: true, data: hostel });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/hostels/{id}:
 *   get:
 *     summary: Get hostel by ID
 *     tags: [Hostels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/:id', async (req, res, next) => {
  try {
    const hostel = await prisma.hostel.findUnique({
      where: { id: req.params.id },
      include: {
        blocks: {
          include: {
            floors: {
              include: {
                rooms: {
                  include: {
                    beds: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!hostel) {
      return res.status(404).json({ success: false, message: 'Hostel not found' });
    }

    res.json({ success: true, data: hostel });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

