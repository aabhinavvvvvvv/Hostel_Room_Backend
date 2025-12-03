const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/reports/occupancy:
 *   get:
 *     summary: Export occupancy report as CSV (Admin/Warden only)
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 */
router.get('/occupancy', authenticate, authorize('ADMIN', 'WARDEN'), async (req, res, next) => {
  try {
    const allocations = await prisma.allocation.findMany({
      include: {
        student: {
          select: { name: true, email: true, universityId: true },
        },
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
      orderBy: { allocatedAt: 'desc' },
    });

    // Convert to CSV
    const csvHeader = 'Hostel,Block,Floor,Room,Bed,Student Name,Email,University ID,Allocated At\n';
    const csvRows = allocations.map((allocation) => {
      const { student, room, bed } = allocation;
      return [
        room.block.hostel.name,
        room.block.name,
        room.floor.floorNumber,
        room.number,
        bed.bedNumber,
        student.name,
        student.email,
        student.universityId || '',
        allocation.allocatedAt.toISOString(),
      ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    const csv = csvHeader + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=occupancy-report.csv');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/reports/applications:
 *   get:
 *     summary: Export applications report as CSV (Admin/Warden only)
 *     tags: [Reports]
 *     security:
 *       - cookieAuth: []
 */
router.get('/applications', authenticate, authorize('ADMIN', 'WARDEN'), async (req, res, next) => {
  try {
    const applications = await prisma.application.findMany({
      include: {
        student: {
          select: { name: true, email: true, universityId: true },
        },
        waitlistEntry: true,
        allocations: {
          include: {
            room: {
              include: {
                block: {
                  include: {
                    hostel: true,
                  },
                },
              },
            },
            bed: true,
          },
        },
      },
      orderBy: { appliedAt: 'desc' },
    });

    const csvHeader = 'Student Name,Email,University ID,Status,Priority Category,Applied At,Hostel,Room,Bed,Waitlist Rank\n';
    const csvRows = applications.map((app) => {
      const allocation = app.allocations[0];
      return [
        app.student.name,
        app.student.email,
        app.student.universityId || '',
        app.status,
        app.priorityCategory || '',
        app.appliedAt.toISOString(),
        allocation?.room?.block?.hostel?.name || '',
        allocation?.room?.number || '',
        allocation?.bed?.bedNumber || '',
        app.waitlistEntry?.rank || '',
      ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    const csv = csvHeader + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=applications-report.csv');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

