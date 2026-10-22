# CodeAlpha_EventRegistration

**CodeAlpha Backend Development Internship - Task 2: Event Registration System**

A REST API where organizers publish events and users register for them, view their registrations and cancel them.
Built with **Node.js, Express, SQLite and JWT authentication** (no database server needed).

## Features
- Register / login with **JWT** auth, passwords hashed with **bcrypt**
- Two roles: **user** and **organizer** (organizer sign-up protected by a secret code)
- **Events:** list (search, upcoming filter, pagination), details, create / update / delete (only the organizer who owns it)
- **Registrations:** submit a registration form (name, phone, notes), see my registrations, **cancel** them
- Business rules enforced in a database transaction: no duplicate registration, **capacity limit**, no registering for past events, seat frees up on cancel, can re-register after cancelling
- Organizer can view the attendee list of their own events
- Organizer capacity cannot be lowered below confirmed registrations; deleting an event removes its registrations
- Security: helmet, rate limiting on auth, input validation, parameterised SQL (no SQL injection)
- Automated tests (`npm test`)

## Tech stack
Node.js 20+, Express 4, better-sqlite3, jsonwebtoken, bcryptjs, helmet, cors, express-rate-limit, dotenv

## Setup
```bash
git clone https://github.com/<your-username>/CodeAlpha_EventRegistration.git
cd CodeAlpha_EventRegistration
npm install
cp .env.example .env      # Windows: copy .env.example .env
# open .env and set JWT_SECRET (see the comment inside the file)
npm run dev               # or: npm start
```
Server: http://localhost:5000 &nbsp; Health: http://localhost:5000/health

Try the API quickly in VS Code: install the **REST Client** extension and open `api-requests.http`.

## Database schema
```
users          (id, name, email UNIQUE, password_hash, role[user|organizer], created_at)
events         (id, title, description, location, event_date, capacity, created_by -> users, created_at, updated_at)
registrations  (id, user_id -> users, event_id -> events, full_name, phone, notes,
                status[confirmed|cancelled], created_at, cancelled_at)
               UNIQUE(user_id, event_id) WHERE status = 'confirmed'
```

## API endpoints
Send the token as `Authorization: Bearer <token>` where "Auth" is required.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | - | Body: `name, email, password, organizerCode?` |
| POST | `/api/auth/login` | - | Body: `email, password` -> `{ token, user }` |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/events` | - | Query: `q`, `upcoming=true`, `page`, `limit` |
| GET | `/api/events/:id` | - | Event details incl. `registeredCount`, `seatsLeft` |
| POST | `/api/events` | organizer | Body: `title, description?, location, eventDate (ISO), capacity` |
| PUT | `/api/events/:id` | owner organizer | Update any of the fields above |
| DELETE | `/api/events/:id` | owner organizer | Delete event (+ its registrations) |
| POST | `/api/events/:id/register` | user | Registration form: `fullName?, phone?, notes?` |
| GET | `/api/events/:id/registrations` | owner organizer | Attendee list |
| GET | `/api/registrations/my` | user | My registrations (`?status=confirmed\|cancelled`) |
| DELETE | `/api/registrations/:id` | owner | Cancel my registration |

Common errors: `400` validation, `401` not logged in, `403` not allowed, `404` not found, `409` duplicate / event full.

## Example
```bash
curl -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"password123"}'
```

## Project structure
```
src/
  server.js  app.js  config.js  db.js
  routes/      auth.js  events.js  registrations.js
  middleware/  auth.js
  utils/       errors.js  validate.js
test/api.test.js
```

## Deployment (Render)
1. Push to GitHub -> Render **Web Service**. Build: `npm install`, Start: `npm start`
2. Environment variables: `NODE_ENV=production`, `JWT_SECRET`, `ORGANIZER_CODE`
3. Render's free disk is temporary (data resets on redeploy). For permanent data add a Render Disk and set `DB_PATH=/var/data/events.db`, or move to PostgreSQL/MongoDB.
