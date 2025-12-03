const nodemailer = require('nodemailer');

let transporter = null;

const initEmailTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '2525'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
};

const sendEmail = async (to, subject, html, text = '') => {
  try {
    const emailTransporter = initEmailTransporter();
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@hostelroom.com',
      to,
      subject,
      text,
      html,
    });
    
    console.log(`Email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
};

const sendAllocationNotification = async (studentEmail, studentName, roomDetails) => {
  const subject = 'Room Allocation Confirmed';
  const html = `
    <h2>Room Allocation Confirmed</h2>
    <p>Dear ${studentName},</p>
    <p>Your room allocation has been confirmed:</p>
    <ul>
      <li><strong>Hostel:</strong> ${roomDetails.hostelName}</li>
      <li><strong>Block:</strong> ${roomDetails.blockName}</li>
      <li><strong>Room:</strong> ${roomDetails.roomNumber}</li>
      <li><strong>Bed:</strong> ${roomDetails.bedNumber}</li>
    </ul>
    <p>Please report to the warden office to collect your keys.</p>
  `;
  
  return sendEmail(studentEmail, subject, html);
};

const sendWaitlistNotification = async (studentEmail, studentName, rank) => {
  const subject = 'Application Waitlisted';
  const html = `
    <h2>Application Waitlisted</h2>
    <p>Dear ${studentName},</p>
    <p>Your application has been added to the waitlist. Your current rank is: <strong>${rank}</strong></p>
    <p>You will be notified when a room becomes available.</p>
  `;
  
  return sendEmail(studentEmail, subject, html);
};

module.exports = {
  sendEmail,
  sendAllocationNotification,
  sendWaitlistNotification,
};

