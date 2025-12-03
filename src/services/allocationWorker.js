const { Queue, Worker } = require('bullmq');
const allocationEngine = require('./allocationEngine');

// Redis connection config
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Create queue
const allocationQueue = new Queue('allocation', { connection });

// Create worker
const allocationWorker = new Worker(
  'allocation',
  async (job) => {
    console.log(`Processing allocation job ${job.id}`);
    const { allocatedBy } = job.data;
    const result = await allocationEngine.runAllocation(allocatedBy);
    return result;
  },
  { connection }
);

allocationWorker.on('completed', (job) => {
  console.log(`Allocation job ${job.id} completed`);
});

allocationWorker.on('failed', (job, err) => {
  console.error(`Allocation job ${job.id} failed:`, err);
});

// Schedule daily allocation (runs at 2 AM)
const scheduleDailyAllocation = async () => {
  try {
    const cron = require('node-cron');
    
    cron.schedule('0 2 * * *', async () => {
      console.log('Running scheduled daily allocation...');
      try {
        // Use a system admin user ID or create a system user
        const systemUserId = process.env.SYSTEM_USER_ID || 'system';
        await allocationQueue.add('daily-allocation', {
          allocatedBy: systemUserId,
        });
      } catch (error) {
        console.error('Failed to schedule daily allocation:', error);
      }
    });
  } catch (error) {
    console.error('Failed to initialize cron scheduler:', error);
  }
};

// Start scheduler if enabled
if (process.env.ENABLE_SCHEDULED_ALLOCATION === 'true') {
  scheduleDailyAllocation();
}

module.exports = {
  allocationQueue,
  allocationWorker,
};

