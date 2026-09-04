export const ROLES = Object.freeze({
  OWNER: 'owner',
  VOLUNTEER: 'volunteer',
  OUTSIDER: 'outsider',
});

// This module simulates permissions for the demo. Actor strings are not authentication.
export function createDemoState() {
  return {
    name: 'checkin.community.eth',
    owner: ROLES.OWNER,
    recordKey: 'url',
    url: 'https://example.org/register',
    grants: [],
    audit: [],
    revision: 0,
  };
}

function validateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Enter a non-empty HTTPS URL.');
  }

  const candidate = value.trim();
  if (!/^https:\/\/[^/\\?#]/i.test(candidate) || /[\s\\\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error('Use a valid HTTPS URL, such as https://example.org/register.');
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Use a valid HTTPS URL, such as https://example.org/register.');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error('Only HTTPS URLs are allowed.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs must not contain credentials.');
  }

  return parsed.href;
}

export function applyCommand(state, command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('Provide a valid command.');
  }
  const { type, actor } = command;
  if (!['grant', 'revoke', 'update'].includes(type)) {
    throw new Error('Unsupported command. Use grant, revoke, or update.');
  }
  if (!Object.values(ROLES).includes(actor)) {
    throw new Error('Unknown actor.');
  }
  if (command.key !== undefined && command.key !== 'url') {
    throw new Error('This demo only permits changes to the url record.');
  }

  const activeGrant = state.grants.some(
    (grant) => grant.actor === ROLES.VOLUNTEER && grant.key === 'url' && grant.active,
  );

  if (type !== 'update' && actor !== state.owner) {
    throw new Error('Only the owner can grant or revoke access.');
  }
  if (type === 'update' && actor !== state.owner && !(actor === ROLES.VOLUNTEER && activeGrant)) {
    throw new Error('Access denied. The owner must grant active url access before this actor can update.');
  }

  // Validate before constructing a transition; rejected commands never change state.
  const url = type === 'update' ? validateUrl(command.value) : state.url;
  const next = {
    ...state,
    grants: state.grants.map((grant) => ({ ...grant })),
    audit: state.audit.map((entry) => ({ ...entry })),
  };

  // Repeating a grant or revoke is an idempotent no-op with a fresh snapshot.
  if ((type === 'grant' && activeGrant) || (type === 'revoke' && !activeGrant)) {
    return next;
  }

  let detail;
  if (type === 'grant') {
    next.grants = [{ actor: ROLES.VOLUNTEER, key: 'url', active: true }];
    detail = 'Granted volunteer permission to update the url record.';
  } else if (type === 'revoke') {
    next.grants = next.grants.map((grant) => ({ ...grant, active: false }));
    detail = 'Revoked volunteer permission to update the url record.';
  } else {
    next.url = url;
    detail = `Updated the url record to ${url}`;
  }

  next.revision += 1;
  next.audit.push({ id: next.revision, action: type, actor, detail });
  return next;
}
