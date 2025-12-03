const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@hostel.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@hostel.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
      universityId: 'ADMIN001',
    },
  });

  // Create warden user
  const wardenPassword = await bcrypt.hash('warden123', 10);
  const warden = await prisma.user.upsert({
    where: { email: 'warden@hostel.com' },
    update: {},
    create: {
      name: 'Warden User',
      email: 'warden@hostel.com',
      passwordHash: wardenPassword,
      role: 'WARDEN',
      universityId: 'WARDEN001',
    },
  });

  // Create sample students
  const studentPasswords = await Promise.all(
    Array.from({ length: 10 }, () => bcrypt.hash('student123', 10))
  );

  const students = [];
  for (let i = 1; i <= 10; i++) {
    const student = await prisma.user.upsert({
      where: { email: `student${i}@university.edu` },
      update: {},
      create: {
        name: `Student ${i}`,
        email: `student${i}@university.edu`,
        passwordHash: studentPasswords[i - 1],
        role: 'STUDENT',
        universityId: `STU${String(i).padStart(3, '0')}`,
      },
    });
    students.push(student);
  }

  // Create hostels
  const hostel1 = await prisma.hostel.upsert({
    where: { id: 'hostel-1' },
    update: {},
    create: {
      id: 'hostel-1',
      name: 'Boys Hostel A',
      gender: 'MALE',
    },
  });

  const hostel2 = await prisma.hostel.upsert({
    where: { id: 'hostel-2' },
    update: {},
    create: {
      id: 'hostel-2',
      name: 'Girls Hostel B',
      gender: 'FEMALE',
    },
  });

  // Create blocks
  const block1 = await prisma.block.upsert({
    where: { id: 'block-1' },
    update: {},
    create: {
      id: 'block-1',
      hostelId: hostel1.id,
      name: 'Block 1',
    },
  });

  const block2 = await prisma.block.upsert({
    where: { id: 'block-2' },
    update: {},
    create: {
      id: 'block-2',
      hostelId: hostel1.id,
      name: 'Block 2',
    },
  });

  const block3 = await prisma.block.upsert({
    where: { id: 'block-3' },
    update: {},
    create: {
      id: 'block-3',
      hostelId: hostel2.id,
      name: 'Block 1',
    },
  });

  // Create floors
  const floors = [];
  for (const block of [block1, block2, block3]) {
    for (let floorNum = 1; floorNum <= 3; floorNum++) {
      const floor = await prisma.floor.upsert({
        where: {
          blockId_floorNumber: {
            blockId: block.id,
            floorNumber: floorNum,
          },
        },
        update: {},
        create: {
          blockId: block.id,
          floorNumber: floorNum,
        },
      });
      floors.push({ floor, block });
    }
  }

  // Create rooms and beds
  let bedCount = 0;
  for (const { floor, block } of floors) {
    for (let roomNum = 1; roomNum <= 5; roomNum++) {
      const capacity = roomNum % 2 === 0 ? 2 : 3; // Alternate between 2 and 3 bed rooms
      const room = await prisma.room.create({
        data: {
          blockId: block.id,
          floorId: floor.id,
          number: `${floor.floorNumber}${String(roomNum).padStart(2, '0')}`,
          capacity,
          features: {
            ac: roomNum % 3 === 0,
            attachedBathroom: roomNum % 2 === 0,
          },
          status: 'AVAILABLE',
        },
      });

      // Create beds for the room
      for (let bedNum = 1; bedNum <= capacity; bedNum++) {
        await prisma.bed.create({
          data: {
            roomId: room.id,
            bedNumber: bedNum,
          },
        });
        bedCount++;
      }
    }
  }

  console.log(`✅ Seeded:
  - 1 Admin user (admin@hostel.com / admin123)
  - 1 Warden user (warden@hostel.com / warden123)
  - 10 Student users (student1@university.edu to student10@university.edu / student123)
  - 2 Hostels
  - 3 Blocks
  - 9 Floors
  - 45 Rooms
  - ${bedCount} Beds
  `);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

