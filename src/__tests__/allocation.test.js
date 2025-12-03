const { PrismaClient } = require('@prisma/client');
const allocationEngine = require('../services/allocationEngine');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

describe('Allocation Engine', () => {
  let testHostel, testBlock, testFloor, testRoom, testBed, student1, student2, admin;

  beforeAll(async () => {
    // Create test data
    const passwordHash = await bcrypt.hash('password', 10);
    
    admin = await prisma.user.upsert({
      where: { email: 'admin-test@hostel.com' },
      update: {},
      create: {
        name: 'Test Admin',
        email: 'admin-test@hostel.com',
        passwordHash,
        role: 'ADMIN',
        universityId: 'ADMIN-TEST',
      },
    });

    student1 = await prisma.user.create({
      data: {
        name: 'Test Student 1',
        email: 'student1-test@university.edu',
        passwordHash,
        role: 'STUDENT',
        universityId: 'STU-TEST-1',
      },
    });

    student2 = await prisma.user.create({
      data: {
        name: 'Test Student 2',
        email: 'student2-test@university.edu',
        passwordHash,
        role: 'STUDENT',
        universityId: 'STU-TEST-2',
      },
    });

    testHostel = await prisma.hostel.create({
      data: {
        name: 'Test Hostel',
        gender: 'MALE',
      },
    });

    testBlock = await prisma.block.create({
      data: {
        hostelId: testHostel.id,
        name: 'Test Block',
      },
    });

    testFloor = await prisma.floor.create({
      data: {
        blockId: testBlock.id,
        floorNumber: 1,
      },
    });

    testRoom = await prisma.room.create({
      data: {
        blockId: testBlock.id,
        floorId: testFloor.id,
        number: '101',
        capacity: 2,
        status: 'AVAILABLE',
        features: {},
      },
    });

    testBed = await prisma.bed.create({
      data: {
        roomId: testRoom.id,
        bedNumber: 1,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.allocation.deleteMany({
      where: {
        studentId: { in: [student1.id, student2.id] },
      },
    });
    await prisma.application.deleteMany({
      where: {
        studentId: { in: [student1.id, student2.id] },
      },
    });
    await prisma.bed.deleteMany({ where: { roomId: testRoom.id } });
    await prisma.room.delete({ where: { id: testRoom.id } });
    await prisma.floor.delete({ where: { id: testFloor.id } });
    await prisma.block.delete({ where: { id: testBlock.id } });
    await prisma.hostel.delete({ where: { id: testHostel.id } });
    await prisma.user.deleteMany({
      where: {
        id: { in: [student1.id, student2.id, admin.id] },
      },
    });
    await prisma.$disconnect();
  });

  it('should allocate bed for application', async () => {
    const application = await prisma.application.create({
      data: {
        studentId: student1.id,
        preferences: {
          preferredHostels: [testHostel.id],
        },
        status: 'PENDING',
      },
    });

    const allocated = await allocationEngine.allocateBed(application, admin.id);
    expect(allocated).toBe(true);

    const updatedBed = await prisma.bed.findUnique({
      where: { id: testBed.id },
    });
    expect(updatedBed.occupiedBy).toBe(student1.id);

    const allocation = await prisma.allocation.findFirst({
      where: { applicationId: application.id },
    });
    expect(allocation).toBeTruthy();
  });

  it('should prevent double allocation of same bed', async () => {
    // Create second bed
    const bed2 = await prisma.bed.create({
      data: {
        roomId: testRoom.id,
        bedNumber: 2,
      },
    });

    const app1 = await prisma.application.create({
      data: {
        studentId: student1.id,
        preferences: { preferredHostels: [testHostel.id] },
        status: 'PENDING',
      },
    });

    const app2 = await prisma.application.create({
      data: {
        studentId: student2.id,
        preferences: { preferredHostels: [testHostel.id] },
        status: 'PENDING',
      },
    });

    // Try to allocate both simultaneously
    const [result1, result2] = await Promise.all([
      allocationEngine.allocateBed(app1, admin.id),
      allocationEngine.allocateBed(app2, admin.id),
    ]);

    // Only one should succeed
    const successCount = [result1, result2].filter(Boolean).length;
    expect(successCount).toBeLessThanOrEqual(1);

    // Cleanup
    await prisma.bed.delete({ where: { id: bed2.id } });
  });
});

