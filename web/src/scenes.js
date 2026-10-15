// Room scenes ("ธีมห้อง"): decoration only. Layout, click targets and status logic are shared by every
// scene; drawings live in components/SceneDecor.jsx and colours in styles.css ([data-scene="…"]).
// A scene may put a flavor word in front of a busy desk chip, but the real tool name always stays.
// To add a scene: an entry here + a DECOR entry + a CSS token block (+ the key in public/theme-init.js).

export const SCENES = [
  { key: 'office', icon: '🏢', label: 'ออฟฟิศ', sign: ['Neko Dream', 'office ✿ since today'] },
  {
    key: 'magic', icon: '🔮', label: 'โรงเรียนเวทมนตร์', sign: ['Neko Academy', '✦ school of magic ✦'],
    flavor: { code: 'เขียนตำรา', research: 'ส่องลูกแก้ว', data: 'อ่านดวงดาว', creative: 'เรียกภูตน้อย', qa: 'ร่ายคาถา' },
  },
  {
    key: 'fairy', icon: '🍄', label: 'ป่าแฟรี่', sign: ['Neko Grove', '✿ fairy forest ✿'],
    flavor: { code: 'เขียนใบไม้', research: 'ตามหิ่งห้อย', data: 'นับเห็ด', creative: 'ปลุกภูตน้อย', qa: 'โปรยผงวิเศษ' },
  },
  {
    key: 'cafe', icon: '☕', label: 'คาเฟ่', sign: ['Neko Café', 'fresh brew all day'],
    flavor: { code: 'จดออร์เดอร์', research: 'เลือกเมล็ด', data: 'เช็กสต็อก', creative: 'ส่งต่อบาริสต้า', qa: 'ชิมกาแฟ' },
  },
  {
    key: 'kitchen', icon: '🍳', label: 'ครัว', sign: ['Neko Kitchen', 'secret recipes inside'],
    flavor: { code: 'หั่นผัก', research: 'ค้นสูตร', data: 'ตวงวัตถุดิบ', creative: 'ส่งต่อลูกมือ', qa: 'ชิมรส' },
  },
];

export const DEFAULT_SCENE = SCENES[0].key;
export const sceneOf = (key) => SCENES.find((s) => s.key === key) || SCENES[0];

// Flavor word for a desk's chip, only while that desk really runs a tool (busy tone); else null.
export function flavorOf(sceneKey, catKey, chip) {
  if (!chip || chip.tone !== 'busy') return null;
  return sceneOf(sceneKey).flavor?.[catKey] ?? null;
}
