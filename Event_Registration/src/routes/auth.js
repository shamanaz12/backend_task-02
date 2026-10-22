const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { HttpError } = require('../utils/errors');
const { requireString, requireEmail } = require('../utils/validate');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const insertUser = db.prepare(
  'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
);
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

// Used so login takes similar time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = requireString(body.name, 'name', { min: 2, max: 100 });
    const email = requireEmail(body.email);
    // bcrypt only uses the first 72 bytes, so cap the length.
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 72) {
      throw new HttpError(400, 'password must be between 8 and 72 characters.');
    }

    let role = 'user';
    if (body.organizerCode !== undefined && body.organizerCode !== '') {
      const valid =
        config.ORGANIZER_CODE !== '' &&
        crypto.timingSafeEqual(sha(body.organizerCode), sha(config.ORGANIZER_CODE));
      if (!valid) throw new HttpError(403, 'Invalid organizer code.');
      role = 'organizer';
    }

    if (findByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists.');

    const hash = await bcrypt.hash(body.password, 10);
    const info = insertUser.run(name, email, hash, role);
    const user = { id: Number(info.lastInsertRowid), name, email, role };
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      return next(new HttpError(409, 'An account with this email already exists.'));
    }
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'email and password are required.');
    }
    const user = findByEmail.get(email.trim().toLowerCase());
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password.');
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
