import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, claimTab, openTabs, DRAFT_KEY, TAB_KEY } from '../studio/draft.js';

// The parts of the browser's Storage that the studio uses.
function fakeStorage({ quota = Infinity, items = new Map() } = {}) {
  return {
    items,
    get length() { return items.size; },
    key: i => [...items.keys()][i] ?? null,
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem(key, value) { if (value.length > quota) throw new Error('QuotaExceededError'); items.set(key, String(value)); },
    removeItem: key => { items.delete(key); }
  };
}
// The browser's LockManager, shared by every page of one address. `close(name)` is the page holding that lock going away.
function fakeLocks() {
  const held = new Set(), waiting = [];
  return {
    held,
    request(name, options, callback) {
      if (!held.has(name)) { held.add(name); return Promise.resolve(callback({ name })); }
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        const entry = { name, grant() { held.add(name); resolve(callback({ name })); } };
        waiting.push(entry);
        options.signal?.addEventListener('abort', () => { waiting.splice(waiting.indexOf(entry), 1); reject(options.signal.reason); });
      });
    },
    query: async () => ({ held: [...held].map(name => ({ name, mode: 'exclusive' })), pending: [] }),
    close(name) { held.delete(name); const next = waiting.findIndex(entry => entry.name === name); if (next >= 0) waiting.splice(next, 1)[0].grant(); }
  };
}
test('the studio keeps one draft with its name and time, and forgets it on request', () => {
  const storage = fakeStorage(), drafts = createDraftStore(storage, { now: () => 1790000000000 });
  assert.equal(drafts.load(), null);
  assert.equal(drafts.save('{ "name": "broken', 'hero.json'), true);
  // The text is kept as typed, valid JSON or not: an unfinished edit is exactly what recovery is for.
  assert.deepEqual(drafts.load(), { text: '{ "name": "broken', name: 'hero.json', savedAt: 1790000000000 });
  assert.deepEqual([...storage.items.keys()], [DRAFT_KEY]);
  assert.equal(drafts.save('{}', 'hero.json'), true); assert.equal(drafts.load().text, '{}');
  drafts.clear(); assert.equal(drafts.load(), null); assert.equal(storage.items.size, 0);
});
test('a draft that cannot be stored or read never breaks the studio', () => {
  const storage = fakeStorage({ quota: 120 }), drafts = createDraftStore(storage);
  assert.equal(drafts.save('small', 'a.json'), true);
  // A refused write reports false and leaves the earlier draft in place.
  assert.equal(drafts.save('x'.repeat(500), 'a.json'), false); assert.equal(drafts.load().text, 'small');
  for (const stored of ['not json', 'null', '[]', '{"text":1,"name":"a","savedAt":2}', '{"text":"a","name":"a"}', '{"text":"a","name":"a","savedAt":"soon"}']) { storage.items.set(DRAFT_KEY, stored); assert.equal(drafts.load(), null, stored); }
  // Browsers with storage switched off hand out nothing, or throw on every call.
  for (const broken of [null, undefined, { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } }]) {
    const none = createDraftStore(broken);
    assert.equal(none.load(), null); assert.equal(none.save('a', 'b'), false); assert.doesNotThrow(() => none.clear());
  }
});
test('each tab keeps its own draft, and replacing or clearing it never touches another tab\'s', () => {
  const storage = fakeStorage(), clock = { now: 1790000000000 }, now = () => clock.now++;
  const a = createDraftStore(storage, { id: 'a', now }), b = createDraftStore(storage, { id: 'b', now });
  // Tab A has an unsaved edit; tab B then edits, and later loads a sample (which clears B's draft only).
  assert.equal(a.save('{ "name": "edited-in-a" }', 'edited-in-a.json'), true);
  assert.equal(b.save('{ "name": "edited-in-b" }', 'edited-in-b.json'), true);
  assert.deepEqual([a.load().text, b.load().text], ['{ "name": "edited-in-a" }', '{ "name": "edited-in-b" }']);
  b.clear();
  assert.deepEqual([a.load()?.name, b.load()], ['edited-in-a.json', null]);
  assert.deepEqual([...storage.items.keys()], [`${DRAFT_KEY}.a`]);
  // A new tab is offered the drafts of tabs that are closed, newest first, and never one of a tab still open. A draft
  // kept before tabs had ids belongs to no tab. Other entries in storage are not drafts.
  b.save('{}', 'b.json');
  storage.items.set(DRAFT_KEY, JSON.stringify({ text: 'old', name: 'old.json', savedAt: 1 }));
  storage.items.set(TAB_KEY, 'c'); storage.items.set(`${DRAFT_KEY}.broken`, 'not json'); storage.items.set('unrelated', '{}');
  const c = createDraftStore(storage, { id: 'c', now });
  assert.deepEqual(c.others().map(draft => [draft.id, draft.name]), [['b', 'b.json'], ['a', 'edited-in-a.json'], [null, 'old.json']]);
  assert.deepEqual(c.others(new Set(['a'])).map(draft => draft.id), ['b', null]);
  assert.deepEqual(a.others().map(draft => draft.id), ['b', null], 'a tab is not offered its own draft as another\'s');
  // Taking over or discarding a closed tab's draft removes that tab's copy only.
  c.forget('b'); c.forget(null);
  assert.deepEqual(c.others().map(draft => draft.id), ['a']);
  assert.equal(c.load(), null);
  for (const broken of [null, { get length() { throw new Error('SecurityError'); }, key() { throw new Error('SecurityError'); } }]) assert.deepEqual(createDraftStore(broken, { id: 'x' }).others(), []);
});
test('a tab keeps its id through a reload, a duplicated tab takes a new one, and closed tabs no longer count as open', async () => {
  const locks = fakeLocks(), session = fakeStorage();
  assert.equal(await claimTab(session, locks, { newId: () => 'one' }), 'one');
  assert.equal(session.getItem(TAB_KEY), 'one');
  // A reload: the page it replaces may hold the lock a moment longer, so the new page waits for it.
  const reloaded = claimTab(session, locks, { newId: () => 'wrong', wait: 2000 });
  setTimeout(() => locks.close('pixelforge.studio.tab.one'), 20);
  assert.equal(await reloaded, 'one');
  // A duplicated tab starts with a copy of the session storage, but the original still holds the id.
  const copy = fakeStorage({ items: new Map(session.items) });
  assert.equal(await claimTab(copy, locks, { newId: () => 'two', wait: 30 }), 'two');
  assert.deepEqual([copy.getItem(TAB_KEY), session.getItem(TAB_KEY)], ['two', 'one']);
  assert.deepEqual([...await openTabs(locks)].sort(), ['one', 'two']);
  locks.close('pixelforge.studio.tab.two');
  assert.deepEqual([...await openTabs(locks)], ['one']);
  // Without Web Locks a tab still keeps its id, and no tab counts as open; without session storage each page has its own.
  const plain = fakeStorage();
  assert.equal(await claimTab(plain, null, { newId: () => 'three' }), 'three');
  assert.equal(await claimTab(plain, null, { newId: () => 'wrong' }), 'three');
  assert.deepEqual([...await openTabs(null)], []);
  const ids = ['four', 'five'];
  for (const none of [null, { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } }]) assert.equal(await claimTab(none, locks, { newId: () => ids.shift() }), none ? 'five' : 'four');
});
