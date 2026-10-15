// Which animal the office is drawn as ("สัตว์ในห้อง"): decoration only. Poses, status, desks and
// names are the same for every animal; components/Cat.jsx swaps only ears, tail and muzzle.
// To add an animal: an entry here + its parts in Cat.jsx (EARS / FRONT_EARS / TAILS / MUZZLES).

export const ANIMALS = [
  { key: 'cat', icon: '🐱', label: 'แมว', word: 'Cat' },
  { key: 'dog', icon: '🐶', label: 'หมา', word: 'Dog' },
  { key: 'bunny', icon: '🐰', label: 'กระต่าย', word: 'Bunny' },
  { key: 'bear', icon: '🐻', label: 'หมี', word: 'Bear' },
  { key: 'fox', icon: '🦊', label: 'จิ้งจอก', word: 'Fox' },
];

export const DEFAULT_ANIMAL = ANIMALS[0].key;
export const animalOf = (key) => ANIMALS.find((a) => a.key === key) || ANIMALS[0];

// "Coding Cat" → "Coding Dog". Only the trailing word changes; names (Mochi, Miso…) stay.
export const roleFor = (role, key) => (typeof role === 'string' ? role.replace(/\bCat$/, animalOf(key).word) : role);

export const withAnimal = (cats, key) => cats.map((c) => ({ ...c, role: roleFor(c.role, key) }));
