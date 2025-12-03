const request = require('supertest');
const app = require('../server');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

describe('Auth Endpoints', () => {
  beforeEach(async () => {
    // Clean up test data
    await prisma.user.deleteMany({
      where: {
        email: { contains: 'test@' },
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new student', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Test Student',
          email: 'test@university.edu',
          password: 'password123',
          universityId: 'TEST001',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@university.edu');
      expect(response.body.user.role).toBe('STUDENT');
    });

    it('should reject duplicate email', async () => {
      await request(app).post('/api/auth/register').send({
        name: 'Test Student',
        email: 'test@university.edu',
        password: 'password123',
        universityId: 'TEST001',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Another Student',
          email: 'test@university.edu',
          password: 'password123',
          universityId: 'TEST002',
        });

      expect(response.status).toBe(400);
    });

    it('should validate required fields', async () => {
      const response = await request(app).post('/api/auth/register').send({
        name: 'Test Student',
        // Missing email, password, universityId
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      await prisma.user.create({
        data: {
          name: 'Test Student',
          email: 'test@university.edu',
          passwordHash,
          universityId: 'TEST001',
          role: 'STUDENT',
        },
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@university.edu',
          password: 'password123',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@university.edu');
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@university.edu',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
    });
  });
});

