process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.ORGANIZER_CODE = 'ORG-SECRET';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

let organizer, otherOrganizer, alice, bob, carol;
let event;

test('auth: register, login, me', async () => {
  const org = await api('POST', '/api/auth/register', {
    name: 'Olivia Organizer', email: 'olivia@example.com', password: 'password123', organizerCode: 'ORG-SECRET',
  });
  assert.equal(org.status, 201);
  assert.equal(org.data.user.role, 'organizer');
  organizer = org.data.token;

  const org2 = await api('POST', '/api/auth/register', {
    name: 'Other Org', email: 'other@example.com', password: 'password123', organizerCode: 'ORG-SECRET',
  });
  otherOrganizer = org2.data.token;

  const a = await api('POST', '/api/auth/register', { name: 'Alice', email: 'alice@example.com', password: 'password123' });
  assert.equal(a.status, 201);
  assert.equal(a.data.user.role, 'user');
  assert.equal(a.data.user.passwordHash, undefined);
  assert.equal(a.data.user.password_hash, undefined);
  alice = a.data.token;
  bob = (await api('POST', '/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'password123' })).data.token;
  carol = (await api('POST', '/api/auth/register', { name: 'Carol', email: 'carol@example.com', password: 'password123' })).data.token;

  const login = await api('POST', '/api/auth/login', { email: 'ALICE@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  assert.ok(login.data.token);

  const me = await api('GET', '/api/auth/me', null, login.data.token);
  assert.equal(me.data.user.email, 'alice@example.com');
});

test('auth: validation and security', async () => {
  assert.equal((await api('POST', '/api/auth/register', { name: 'Al', email: 'alice@example.com', password: 'password123' })).status, 409);
  assert.equal((await api('POST', '/api/auth/register', { name: 'X Y', email: 'bad-email', password: 'password123' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { name: 'X Y', email: 'x@y.com', password: 'short' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { name: 'X Y', email: 'x@y.com', password: 'password123', organizerCode: 'wrong' })).status, 403);
  assert.equal((await api('POST', '/api/auth/login', { email: 'alice@example.com', password: 'wrongpass' })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'password123' })).status, 401);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
  assert.equal((await api('GET', '/api/auth/me', null, 'garbage.token.here')).status, 401);
});

test('events: only organizers can create; validation works', async () => {
  const payload = { title: 'Node.js Workshop', description: 'Hands-on', location: 'Karachi', eventDate: future(7), capacity: 2 };

  assert.equal((await api('POST', '/api/events', payload)).status, 401);
  assert.equal((await api('POST', '/api/events', payload, alice)).status, 403);

  assert.equal((await api('POST', '/api/events', { ...payload, title: 'x' }, organizer)).status, 400);
  assert.equal((await api('POST', '/api/events', { ...payload, eventDate: 'not-a-date' }, organizer)).status, 400);
  assert.equal((await api('POST', '/api/events', { ...payload, eventDate: future(-1) }, organizer)).status, 400);
  assert.equal((await api('POST', '/api/events', { ...payload, capacity: 0 }, organizer)).status, 400);
  assert.equal((await api('POST', '/api/events', { ...payload, capacity: '5' }, organizer)).status, 400);

  const ok = await api('POST', '/api/events', payload, organizer);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.seatsLeft, 2);
  assert.equal(ok.data.registeredCount, 0);
  event = ok.data;
});

test('events: list, search, details', async () => {
  await api('POST', '/api/events', { title: 'Python Meetup', location: 'Lahore', eventDate: future(3), capacity: 50 }, organizer);

  const all = await api('GET', '/api/events');
  assert.equal(all.status, 200);
  assert.equal(all.data.total, 2);
  assert.equal(all.data.data[0].title, 'Python Meetup'); // sorted by date ascending

  const search = await api('GET', '/api/events?q=node');
  assert.equal(search.data.total, 1);
  assert.equal((await api('GET', '/api/events?q=%25')).data.total, 0); // "%" is literal, not a wildcard

  const upcoming = await api('GET', '/api/events?upcoming=true&limit=1&page=2');
  assert.equal(upcoming.data.data.length, 1);

  const one = await api('GET', `/api/events/${event.id}`);
  assert.equal(one.data.title, 'Node.js Workshop');
  assert.equal((await api('GET', '/api/events/99999')).status, 404);
  assert.equal((await api('GET', '/api/events/abc')).status, 400);
});

test('registration: register, duplicate, capacity, cancel, re-register', async () => {
  const r1 = await api('POST', `/api/events/${event.id}/register`, { phone: '0300-1234567', notes: 'Vegetarian' }, alice);
  assert.equal(r1.status, 201);
  assert.equal(r1.data.fullName, 'Alice'); // defaults to account name
  assert.equal(r1.data.status, 'confirmed');

  assert.equal((await api('POST', `/api/events/${event.id}/register`, {}, alice)).status, 409); // duplicate
  assert.equal((await api('POST', `/api/events/${event.id}/register`, {})).status, 401);

  const r2 = await api('POST', `/api/events/${event.id}/register`, { fullName: 'Bob Builder' }, bob);
  assert.equal(r2.status, 201);

  const full = await api('POST', `/api/events/${event.id}/register`, {}, carol);
  assert.equal(full.status, 409);
  assert.match(full.data.error, /full/i);

  const details = await api('GET', `/api/events/${event.id}`);
  assert.equal(details.data.seatsLeft, 0);

  // Bob cannot cancel Alice's registration
  assert.equal((await api('DELETE', `/api/registrations/${r1.data.id}`, null, bob)).status, 403);

  // Alice cancels -> seat frees up -> Carol can join
  const cancel = await api('DELETE', `/api/registrations/${r1.data.id}`, null, alice);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.status, 'cancelled');
  assert.equal((await api('DELETE', `/api/registrations/${r1.data.id}`, null, alice)).status, 409); // already cancelled

  assert.equal((await api('POST', `/api/events/${event.id}/register`, {}, carol)).status, 201);
  // Alice can't re-register now (full again), but after Carol cancels she can
  assert.equal((await api('POST', `/api/events/${event.id}/register`, {}, alice)).status, 409);

  const mine = await api('GET', '/api/registrations/my', null, alice);
  assert.equal(mine.data.total, 1);
  assert.equal(mine.data.data[0].eventTitle, 'Node.js Workshop');
  assert.equal((await api('GET', '/api/registrations/my?status=confirmed', null, alice)).data.total, 0);
  assert.equal((await api('GET', '/api/registrations/my?status=bad', null, alice)).status, 400);
  assert.equal((await api('GET', '/api/registrations/my')).status, 401);
});

test('organizer: attendee list and ownership rules', async () => {
  const list = await api('GET', `/api/events/${event.id}/registrations`, null, organizer);
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 3); // alice (cancelled), bob, carol
  assert.equal(list.data.data.filter((r) => r.status === 'confirmed').length, 2);

  assert.equal((await api('GET', `/api/events/${event.id}/registrations`, null, alice)).status, 403);
  assert.equal((await api('GET', `/api/events/${event.id}/registrations`, null, otherOrganizer)).status, 403);

  // update
  assert.equal((await api('PUT', `/api/events/${event.id}`, { title: 'Hacked' }, otherOrganizer)).status, 403);
  assert.equal((await api('PUT', `/api/events/${event.id}`, { capacity: 1 }, organizer)).status, 400); // below confirmed count
  const upd = await api('PUT', `/api/events/${event.id}`, { title: 'Node.js Workshop v2', capacity: 3 }, organizer);
  assert.equal(upd.status, 200);
  assert.equal(upd.data.title, 'Node.js Workshop v2');
  assert.equal(upd.data.seatsLeft, 1);
});

test('events: delete removes registrations too', async () => {
  assert.equal((await api('DELETE', `/api/events/${event.id}`, null, otherOrganizer)).status, 403);
  assert.equal((await api('DELETE', `/api/events/${event.id}`, null, organizer)).status, 200);
  assert.equal((await api('GET', `/api/events/${event.id}`)).status, 404);
  assert.equal((await api('GET', '/api/registrations/my', null, bob)).data.total, 0);
});

test('misc: 404 route, bad JSON, health', async () => {
  assert.equal((await api('GET', '/nope')).status, 404);
  assert.equal((await api('GET', '/health')).status, 200);
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});
