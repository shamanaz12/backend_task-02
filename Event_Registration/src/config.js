require('dotenv').config({ quiet: true });

const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  jwtSecret = 'dev-only-secret-change-me';
  console.warn('[warn] JWT_SECRET not set - using an insecure development secret.');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  // Anyone who registers with this code becomes an event organizer. Empty = organizer sign-up disabled.
  ORGANIZER_CODE: process.env.ORGANIZER_CODE || '',
  DB_PATH: process.env.DB_PATH || '', // resolved in db.js
};
