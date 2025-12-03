const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const authenticate = async (req, res, next) => {
  try {
    // Try to get token from cookie first, then from Authorization header
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

    // Debug logging (always log in production too for troubleshooting)
    // console.log('Auth check:', {
    //   hasCookie: !!req.cookies?.token,
    //   hasAuthHeader: !!req.headers.authorization,
    //   cookies: Object.keys(req.cookies || {}),
    //   origin: req.headers.origin,
    //   cookieHeader: req.headers.cookie ? req.headers.cookie.substring(0, 50) + '...' : 'none',
    //   path: req.path,
    // });

    if (!token) {
      // More detailed error message for debugging
      const errorMsg = !req.cookies?.token && !req.headers.authorization
        ? 'Authentication required: No token found in cookie or Authorization header'
        : 'Authentication required';
      
      return res.status(401).json({ 
        success: false, 
        message: errorMsg,
        debug: process.env.NODE_ENV !== 'production' ? {
          hasCookies: !!req.cookies,
          cookieKeys: Object.keys(req.cookies || {}),
          hasAuthHeader: !!req.headers.authorization,
        } : undefined,
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, name: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    // More specific error messages
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    console.error('Auth error:', error);
    return res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    next();
  };
};

module.exports = { authenticate, authorize };

