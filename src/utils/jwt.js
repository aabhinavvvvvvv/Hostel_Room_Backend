const jwt = require('jsonwebtoken');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const setTokenCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = process.env.FRONTEND_URL && 
    !process.env.FRONTEND_URL.includes('localhost');
  
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction || isCrossOrigin, // HTTPS required for cross-origin
    sameSite: (isProduction && isCrossOrigin) ? 'none' : 'lax', // 'none' for cross-origin
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/', // Ensure cookie is available for all paths
  };
  
  // Only set domain if explicitly configured (for subdomains)
  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }
  
  res.cookie('token', token, cookieOptions);
  
  // Log cookie settings in development for debugging
  // if (!isProduction) {
  //   console.log('Cookie set with options:', {
  //     secure: cookieOptions.secure,
  //     sameSite: cookieOptions.sameSite,
  //     path: cookieOptions.path,
  //     domain: cookieOptions.domain || 'not set',
  //   });
  // }
};

module.exports = { generateToken, setTokenCookie };

