import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMALS, DEFAULT_ANIMAL, animalOf, roleFor, withAnimal } from './animals.js';
import { CATS } from './office.js';

test('cat is the default and unknown keys fall back to it', () => {
  assert.equal(DEFAULT_ANIMAL, 'cat');
  assert.equal(animalOf('dragon').key, 'cat');
  assert.equal(animalOf(null).key, 'cat');
  assert.equal(new Set(ANIMALS.map((a) => a.key)).size, ANIMALS.length);
});

test('roleFor swaps only the trailing animal word', () => {
  assert.equal(roleFor('Coding Cat', 'dog'), 'Coding Dog');
  assert.equal(roleFor('QA Cat', 'fox'), 'QA Fox');
  assert.equal(roleFor('Catalog Cat', 'bear'), 'Catalog Bear');
  assert.equal(roleFor('Coding Cat', 'cat'), 'Coding Cat');
});

test('withAnimal keeps names and keys, never mutates CATS', () => {
  const dogs = withAnimal(CATS, 'bunny');
  assert.deepEqual(dogs.map((c) => c.name), CATS.map((c) => c.name));
  assert.ok(dogs.every((c) => c.role.endsWith(' Bunny')));
  assert.ok(CATS.every((c) => c.role.endsWith(' Cat')));
});
