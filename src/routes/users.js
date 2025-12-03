const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { auditMiddleware, createAuditLog } = require('../middleware/auditLog');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user (Admin only)
 *     tags: [Users]
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
 *               - email
 *               - password
 *               - role
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [STUDENT, WARDEN, ADMIN]
 *               universityId:
 *                 type: string
 */
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  auditMiddleware('CREATE', 'USER'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['STUDENT', 'WARDEN', 'ADMIN']).withMessage('Role must be STUDENT, WARDEN, or ADMIN'),
    body('universityId').optional().trim(),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, role, universityId } = req.body;

      // Check if user exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role,
          universityId: universityId || null,
        },
        select: { id: true, name: true, email: true, role: true, universityId: true },
      });

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all users (Admin only)
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 */
router.get('/', authenticate, authorize('ADMIN', 'WARDEN'), async (req, res, next) => {
  try {
    const { role } = req.query;

    const where = {};
    if (role) {
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        universityId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/users/{id}/role:
 *   patch:
 *     summary: Update user role (Admin only)
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 */
router.patch(
  '/:id/role',
  authenticate,
  authorize('ADMIN'),
  auditMiddleware('UPDATE', 'USER'),
  [
    body('role').isIn(['STUDENT', 'WARDEN', 'ADMIN']).withMessage('Role must be STUDENT, WARDEN, or ADMIN'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id } = req.params;
      const { role } = req.body;

      // Prevent admin from removing their own admin role
      if (id === req.user.id && role !== 'ADMIN') {
        return res.status(400).json({
          success: false,
          message: 'You cannot remove your own admin role',
        });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, email: true, role: true },
      });

      await createAuditLog(req.user.id, 'UPDATE', 'USER', id, {
        action: 'role_change',
        oldRole: user.role,
        newRole: role,
      });

      res.json({
        success: true,
        message: 'User role updated successfully',
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID (Admin only)
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 */
router.get('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        universityId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user (Admin only)
 *     tags: [Users]
 *     security:
 *       - cookieAuth: []
 */
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  auditMiddleware('DELETE', 'USER'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Prevent admin from deleting themselves
      if (id === req.user.id) {
        return res.status(400).json({
          success: false,
          message: 'You cannot delete your own account',
        });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      await prisma.user.delete({ where: { id } });

      res.json({
        success: true,
        message: 'User deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

