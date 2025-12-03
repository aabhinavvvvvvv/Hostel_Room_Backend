const { PrismaClient } = require('@prisma/client');
const { createAuditLog } = require('../middleware/auditLog');
const { sendAllocationNotification, sendWaitlistNotification } = require('../utils/email');

const prisma = new PrismaClient();

// Priority categories and their quotas (configurable)
const PRIORITY_QUOTAS = {
  HANDICAPPED: 0.1, // 10% reserved
  MERIT: 0.2, // 20% reserved
};

/**
 * Run the allocation engine
 */
const runAllocation = async (allocatedBy) => {
  const stats = {
    allocated: 0,
    waitlisted: 0,
    errors: 0,
  };

  try {
    // Get all pending applications, ordered by priority and applied date
    const applications = await prisma.application.findMany({
      where: {
        status: { in: ['PENDING', 'WAITLISTED'] },
      },
      include: {
        student: true,
      },
      orderBy: [
        { priorityCategory: 'desc' }, // Priority categories first
        { appliedAt: 'asc' }, // FCFS within same priority
      ],
    });

    for (const application of applications) {
      try {
        // Mark as in progress to prevent double processing
        await prisma.application.update({
          where: { id: application.id },
          data: { status: 'IN_PROGRESS' },
        });

        const allocated = await allocateBed(application, allocatedBy);

        if (allocated) {
          stats.allocated++;
        } else {
          // Add to waitlist
          await addToWaitlist(application);
          stats.waitlisted++;
        }
      } catch (error) {
        console.error(`Error processing application ${application.id}:`, error);
        stats.errors++;

        // Reset status on error
        await prisma.application.update({
          where: { id: application.id },
          data: { status: application.status === 'WAITLISTED' ? 'WAITLISTED' : 'PENDING' },
        });
      }
    }

    await createAuditLog(
      allocatedBy,
      'CREATE',
      'ALLOCATION',
      'batch',
      { stats, timestamp: new Date() }
    );

    return stats;
  } catch (error) {
    console.error('Allocation engine error:', error);
    throw error;
  }
};

/**
 * Allocate a bed for an application
 */
const allocateBed = async (application, allocatedBy) => {
  const preferences = application.preferences || {};
  const preferredHostels = preferences.preferredHostels || [];
  const roomType = preferences.roomType || 'STANDARD';
  const priorityCategory = application.priorityCategory;

  // Build query for available beds (base)
  const baseRoomFilter = {
    status: 'AVAILABLE',
  };

  if (preferredHostels.length > 0) {
    baseRoomFilter.block = {
      hostelId: { in: preferredHostels },
    };
  }

  // Check for priority quotas (placeholder)
  if (priorityCategory && PRIORITY_QUOTAS[priorityCategory]) {
    const quota = PRIORITY_QUOTAS[priorityCategory];
    // TODO: Apply quota logic (track reserved beds)
  }

  // Use transaction with row-level locking
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Build where clause for beds (single declaration)
      const bedWhere = {
        occupiedBy: null,
        room: baseRoomFilter,
      };

      // Find candidate beds
      const candidateBeds = await tx.bed.findMany({
        where: bedWhere,
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
        },
        orderBy: { id: 'asc' },
        take: 10, // Get a few candidates
      });

      if (!candidateBeds || candidateBeds.length === 0) {
        return null;
      }

      // Try to lock and allocate the first available bed
      let lockedBed = null;
      for (const candidate of candidateBeds) {
        try {
          // Attempt to lock this bed row using raw SQL (Postgres style)
          // NOTE: table and column names depend on your DB schema.
          // If Prisma uses different table names, adjust accordingly.
          const locked = await tx.$queryRawUnsafe(
            `SELECT id FROM beds WHERE id = $1 AND occupied_by IS NULL FOR UPDATE SKIP LOCKED LIMIT 1`,
            candidate.id
          );

          // locked will typically be an array with one row if locked
          if (locked && locked.length > 0) {
            lockedBed = candidate;
            break;
          }
        } catch (error) {
          // If locking this candidate fails, continue to next
          continue;
        }
      }

      if (!lockedBed) {
        return null;
      }

      const bed = lockedBed;

      // Update bed (we already have the lock from raw SQL)
      const updatedBed = await tx.bed.update({
        where: { id: bed.id },
        data: { occupiedBy: application.studentId },
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
        },
      });

      // Update application status
      await tx.application.update({
        where: { id: application.id },
        data: { status: 'ALLOCATED' },
      });

      // Remove from waitlist if exists
      await tx.waitlistEntry.deleteMany({
        where: { applicationId: application.id },
      });

      // Create allocation record
      const allocation = await tx.allocation.create({
        data: {
          applicationId: application.id,
          studentId: application.studentId,
          roomId: updatedBed.room.id,
          bedId: bed.id,
          allocatedBy,
        },
      });

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          actorId: allocatedBy,
          action: 'ALLOCATE',
          targetType: 'ALLOCATION',
          targetId: allocation.id,
          details: {
            applicationId: application.id,
            studentId: application.studentId,
            roomId: updatedBed.room.id,
            bedId: bed.id,
            automated: true,
          },
        },
      });

      return {
        allocation,
        room: updatedBed.room,
        bed: updatedBed,
      };
    }, {
      timeout: 10000, // 10 second timeout
    });

    if (result) {
      // Send notification email
      await sendAllocationNotification(
        application.student.email,
        application.student.name,
        {
          hostelName: result.room.block.hostel.name,
          blockName: result.room.block.name,
          roomNumber: result.room.number,
          bedNumber: result.bed.bedNumber,
        }
      );
    }

    return result !== null;
  } catch (error) {
    console.error('Transaction error:', error);
    return false;
  }
};

/**
 * Add application to waitlist
 */
const addToWaitlist = async (application) => {
  const preferences = application.preferences || {};
  const preferredHostels = preferences.preferredHostels || [];
  const hostelId = preferredHostels.length > 0 ? preferredHostels[0] : null;

  // Get current max rank
  const maxRankEntry = await prisma.waitlistEntry.findFirst({
    where: hostelId ? { hostelId } : {},
    orderBy: { rank: 'desc' },
  });

  const newRank = maxRankEntry ? maxRankEntry.rank + 1 : 1;

  // Update or create waitlist entry
  await prisma.waitlistEntry.upsert({
    where: { applicationId: application.id },
    update: { rank: newRank },
    create: {
      applicationId: application.id,
      rank: newRank,
      hostelId,
      roomType: preferences.roomType || null,
    },
  });

  // Update application status
  await prisma.application.update({
    where: { id: application.id },
    data: { status: 'WAITLISTED' },
  });

  // Send notification
  await sendWaitlistNotification(application.student.email, application.student.name, newRank);
};

module.exports = {
  runAllocation,
  allocateBed,
  addToWaitlist,
};
