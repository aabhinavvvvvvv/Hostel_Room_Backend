const express = require('express');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/auditLog');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/rooms:
 *   get:
 *     summary: List all rooms
 *     tags: [Rooms]
 *     responses:
 *       200:
 *         description: List of rooms
 */
router.get('/', async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      include: {
        block: {
          include: {
            hostel: true,
          },
        },
        floor: true,
        beds: {
          include: {
            occupant: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    res.json({ success: true, data: rooms });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/rooms:
 *   post:
 *     summary: Create a new room (Admin/Warden only)
 *     tags: [Rooms]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - blockId
 *               - floorId
 *               - number
 *               - capacity
 *             properties:
 *               blockId:
 *                 type: string
 *               floorId:
 *                 type: string
 *               number:
 *                 type: string
 *               capacity:
 *                 type: integer
 *               features:
 *                 type: object
 *               status:
 *                 type: string
 */
router.post(
  '/',
  authenticate,
  authorize('ADMIN', 'WARDEN'),
  auditMiddleware('CREATE', 'ROOM'),
  [
    body('blockId').notEmpty().withMessage('Block ID is required'),
    body('floorId').notEmpty().withMessage('Floor ID is required'),
    body('number').trim().notEmpty().withMessage('Room number is required'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { blockId, floorId, number, capacity, features = {}, status = 'AVAILABLE' } = req.body;

      // Create room
      const room = await prisma.room.create({
        data: {
          blockId,
          floorId,
          number,
          capacity,
          features,
          status,
        },
      });

      // Create beds for the room
      const beds = [];
      for (let i = 1; i <= capacity; i++) {
        const bed = await prisma.bed.create({
          data: {
            roomId: room.id,
            bedNumber: i,
          },
        });
        beds.push(bed);
      }

      res.status(201).json({
        success: true,
        data: { ...room, beds },
      });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ success: false, message: 'Room already exists' });
      }
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/rooms/{id}:
 *   get:
 *     summary: Get room by ID
 *     tags: [Rooms]
 */
router.get('/:id', async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: {
        block: {
          include: {
            hostel: true,
          },
        },
        floor: true,
        beds: {
          include: {
            occupant: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found' });
    }

    res.json({ success: true, data: room });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/rooms/{id}/assign:
 *   post:
 *     summary: Manually assign a student to a room (Warden/Admin only)
 *     tags: [Rooms]
 *     security:
 *       - cookieAuth: []
 */
router.post(
  '/:id/assign',
  authenticate,
  authorize('WARDEN', 'ADMIN'),
  [
    body('studentId').notEmpty().withMessage('Student ID is required'),
    body('bedNumber').optional().isInt({ min: 1 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { studentId, bedNumber } = req.body;
      const roomId = req.params.id;

      // Check if room exists
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: { beds: true },
      });

      if (!room) {
        return res.status(404).json({ success: false, message: 'Room not found' });
      }

      // Check if student exists
      const student = await prisma.user.findUnique({
        where: { id: studentId },
      });

      if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found' });
      }

      if (student.role !== 'STUDENT') {
        return res.status(400).json({ success: false, message: 'User is not a student' });
      }

      // Check if student already has an allocation
      const existingAllocation = await prisma.allocation.findFirst({
        where: { studentId },
      });

      if (existingAllocation) {
        return res.status(400).json({ success: false, message: 'Student already has an allocation' });
      }

      // Find available bed
      let bed;
      if (bedNumber) {
        bed = room.beds.find(b => b.bedNumber === bedNumber && !b.occupiedBy);
        if (!bed) {
          return res.status(400).json({ success: false, message: 'Specified bed is not available' });
        }
      } else {
        bed = room.beds.find(b => !b.occupiedBy);
        if (!bed) {
          return res.status(400).json({ success: false, message: 'No available beds in this room' });
        }
      }

      // Create allocation using transaction
      const result = await prisma.$transaction(async (tx) => {
        // Lock the bed
        const lockedBed = await tx.bed.findUnique({
          where: { id: bed.id },
        });

        if (lockedBed.occupiedBy) {
          throw new Error('Bed is already occupied');
        }

        // Update bed
        await tx.bed.update({
          where: { id: bed.id },
          data: { occupiedBy: studentId },
        });

        // Create or update application
        let application = await tx.application.findFirst({
          where: { studentId, status: { in: ['PENDING', 'WAITLISTED'] } },
        });

        if (!application) {
          application = await tx.application.create({
            data: {
              studentId,
              preferences: {},
              status: 'ALLOCATED',
            },
          });
        } else {
          application = await tx.application.update({
            where: { id: application.id },
            data: { status: 'ALLOCATED' },
          });
        }

        // Create allocation record
        const allocation = await tx.allocation.create({
          data: {
            applicationId: application.id,
            studentId,
            roomId,
            bedId: bed.id,
            allocatedBy: req.user.id,
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            actorId: req.user.id,
            action: 'ALLOCATE',
            targetType: 'ALLOCATION',
            targetId: allocation.id,
            details: { manual: true, roomId, bedId: bed.id },
          },
        });

        return { allocation, application };
      });

      res.status(201).json({
        success: true,
        message: 'Student assigned successfully',
        data: result.allocation,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

