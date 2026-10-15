// Scenes are decoration: a flavor word is only added to real busy desk chips, never replaces them.
import test from 'node:test'; import assert from 'node:assert/strict';
import { SCENES, sceneOf, flavorOf, DEFAULT_SCENE } from './scenes.js';
import { CATS } from './office.js';

test('sceneOf falls back to the office', () => {
  assert.equal(DEFAULT_SCENE, 'office');
  assert.equal(sceneOf('nope').key, 'office');
  assert.equal(sceneOf('magic').label, 'โรงเรียนเวทมนตร์');
});

test('flavorOf only for busy desk chips', () => {
  const busy = { tone: 'busy', text: 'Bash' };
  assert.equal(flavorOf('magic', 'qa', busy), 'ร่ายคาถา');
  assert.equal(flavorOf('office', 'qa', busy), null);
  assert.equal(flavorOf('magic', 'qa', { tone: 'error', text: 'Error' }), null);
  assert.equal(flavorOf('magic', 'manage', busy), null); // Nori's chip is the session status: never flavored
  assert.equal(flavorOf('magic', 'qa', null), null);
});

test('every themed scene flavors each desk lead except the manager', () => {
  for (const s of SCENES.filter((x) => x.flavor)) {
    for (const c of CATS) assert.equal(Boolean(s.flavor[c.key]), c.key !== 'manage', `${s.key}/${c.key}`);
  }
});
