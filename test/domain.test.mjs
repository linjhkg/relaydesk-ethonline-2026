import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createDemoState, ROLES } from '../src/domain.mjs';

function frozenSnapshot(state) {
  state.grants.forEach(Object.freeze);
  state.audit.forEach(Object.freeze);
  Object.freeze(state.grants);
  Object.freeze(state.audit);
  return Object.freeze(state);
}

test('creates independent demo states with the fixed name and url record', () => {
  const state = createDemoState();
  assert.deepEqual(state, {
    name: 'checkin.community.eth',
    owner: 'owner',
    recordKey: 'url',
    url: 'https://example.org/register',
    grants: [],
    audit: [],
    revision: 0,
  });
  assert.notStrictEqual(state.grants, createDemoState().grants);
  assert.notStrictEqual(state.audit, createDemoState().audit);
});

test('owner grants access, volunteer updates, owner revokes, volunteer is denied', () => {
  const initial = frozenSnapshot(createDemoState());
  const granted = frozenSnapshot(applyCommand(initial, { type: 'grant', actor: ROLES.OWNER }));
  assert.deepEqual(granted.grants, [{ actor: 'volunteer', key: 'url', active: true }]);

  const updated = frozenSnapshot(applyCommand(granted, {
    type: 'update', actor: ROLES.VOLUNTEER, value: 'https://event.example/check-in',
  }));
  assert.equal(updated.url, 'https://event.example/check-in');
  const revoked = frozenSnapshot(applyCommand(updated, { type: 'revoke', actor: ROLES.OWNER }));
  const beforeDenial = structuredClone(revoked);

  assert.throws(() => applyCommand(revoked, {
    type: 'update', actor: ROLES.VOLUNTEER, value: 'https://event.example/hijack',
  }), /Access denied/);
  assert.deepEqual(revoked, beforeDenial);
  assert.equal(revoked.grants[0].active, false);
  assert.equal(revoked.url, updated.url);
  assert.equal(revoked.name, initial.name);
  assert.equal(updated.name, initial.name);
  assert.equal(granted.name, initial.name);
  assert.equal(revoked.revision, 3);
  assert.deepEqual(revoked.audit.map(({ id, action, actor }) => ({ id, action, actor })), [
    { id: 1, action: 'grant', actor: 'owner' },
    { id: 2, action: 'update', actor: 'volunteer' },
    { id: 3, action: 'revoke', actor: 'owner' },
  ]);
  assert.ok(revoked.audit.every(({ detail }) => typeof detail === 'string' && detail.length > 0));
  assert.equal(initial.url, 'https://example.org/register');
  assert.equal(initial.revision, 0);
  assert.equal(granted.url, initial.url);
});

test('owner can update without a grant and after revocation', () => {
  let state = applyCommand(createDemoState(), {
    type: 'update', actor: 'owner', value: '  https://event.example/owner  ',
  });
  assert.equal(state.url, 'https://event.example/owner');
  state = applyCommand(state, { type: 'grant', actor: 'owner' });
  state = applyCommand(state, { type: 'revoke', actor: 'owner' });
  state = applyCommand(state, { type: 'update', actor: 'owner', value: 'https://event.example/final' });
  assert.equal(state.url, 'https://event.example/final');
});

test('outsider cannot update even while volunteer has a grant', () => {
  for (const state of [createDemoState(), applyCommand(createDemoState(), { type: 'grant', actor: 'owner' })]) {
    const before = structuredClone(state);
    assert.throws(() => applyCommand(frozenSnapshot(state), {
      type: 'update', actor: 'outsider', value: 'https://event.example/outsider',
    }), /Access denied/);
    assert.deepEqual(state, before);
  }
});

test('volunteer cannot update before receiving a grant', () => {
  assert.throws(() => applyCommand(createDemoState(), {
    type: 'update', actor: 'volunteer', value: 'https://event.example/check-in',
  }), /Access denied/);
});

test('only owner can grant and revoke access', () => {
  for (const actor of ['volunteer', 'outsider']) {
    for (const type of ['grant', 'revoke']) {
      const state = frozenSnapshot(applyCommand(createDemoState(), { type: 'grant', actor: 'owner' }));
      const before = structuredClone(state);
      assert.throws(() => applyCommand(state, { type, actor }), /Only the owner/);
      assert.deepEqual(state, before);
    }
  }
});

test('rejects invalid or unsafe URLs without changing any state', () => {
  const invalidValues = [
    undefined, null, 12, {}, '', ' \t\n ', 'not a URL',
    'http://event.example', 'javascript:alert(1)', 'data:text/plain,event',
    'ftp://event.example', 'https:', 'https:example.org', 'https://',
    'https:///missing-host', 'https://bad host.example', 'https://example.org/a b',
    'https://example.org:invalid', 'https://[broken',
    'https://user:password@example.org', 'https://user@example.org',
  ];
  for (const value of invalidValues) {
    const state = frozenSnapshot(createDemoState());
    const before = structuredClone(state);
    assert.throws(() => applyCommand(state, { type: 'update', actor: 'owner', value }),
      Error, `Expected URL to be rejected: ${String(value)}`);
    assert.deepEqual(state, before);
  }
});

test('accepts a valid HTTPS URL with query parameters and fragment', () => {
  const state = applyCommand(createDemoState(), {
    type: 'update', actor: 'owner', value: 'https://event.example:8443/register?day=2#check-in',
  });
  assert.equal(state.url, 'https://event.example:8443/register?day=2#check-in');
});

test('repeated grant and revoke are idempotent, and regrant creates one active grant', () => {
  const initial = frozenSnapshot(createDemoState());
  const emptyRevoke = applyCommand(initial, { type: 'revoke', actor: 'owner' });
  assert.deepEqual(emptyRevoke, initial);
  assert.notStrictEqual(emptyRevoke, initial);

  const granted = frozenSnapshot(applyCommand(initial, { type: 'grant', actor: 'owner' }));
  const repeatedGrant = applyCommand(granted, { type: 'grant', actor: 'owner' });
  assert.deepEqual(repeatedGrant, granted);
  assert.notStrictEqual(repeatedGrant, granted);
  assert.notStrictEqual(repeatedGrant.grants[0], granted.grants[0]);
  assert.notStrictEqual(repeatedGrant.audit[0], granted.audit[0]);

  const revoked = frozenSnapshot(applyCommand(granted, { type: 'revoke', actor: 'owner' }));
  const repeatedRevoke = applyCommand(revoked, { type: 'revoke', actor: 'owner' });
  assert.deepEqual(repeatedRevoke, revoked);
  assert.notStrictEqual(repeatedRevoke, revoked);

  const regranted = applyCommand(revoked, { type: 'grant', actor: 'owner' });
  assert.deepEqual(regranted.grants, [{ actor: 'volunteer', key: 'url', active: true }]);
  assert.equal(regranted.revision, 3);
  assert.equal(regranted.name, initial.name);
});

test('rejects unsupported commands, actors, and record keys', () => {
  for (const command of [
    null, undefined, [], 'grant', {},
    { type: 'transfer', actor: 'owner' },
    { type: 'grant', actor: 'unknown' },
    { type: 'grant', actor: 'owner', key: 'address' },
    { type: 'update', actor: 'owner', key: 'name', value: 'https://event.example' },
  ]) {
    const state = frozenSnapshot(createDemoState());
    const before = structuredClone(state);
    assert.throws(() => applyCommand(state, command), Error);
    assert.deepEqual(state, before);
  }
});
