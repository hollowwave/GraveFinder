const SECTIONS = ['A', 'B', 'C', 'D'];
const SPACING = 0.00003;

function generateLayout(center, scale = 1) {
  const d = SPACING * scale;
  const blockW = 4 * d + 0.00002 * scale;
  const sectionW = 2 * blockW + 0.00006 * scale;
  const sectionH = 3 * d + 0.00006 * scale;
  const raw = [];
  SECTIONS.forEach((section, i) => {
    const sc = i % 2;
    const sr = Math.floor(i / 2);
    for (let b = 0; b < 2; b++) {
      for (let r = 0; r < 3; r++) {
        for (let g = 0; g < 4; g++) {
          raw.push({
            section,
            block: String(b + 1),
            row: String(r + 1),
            number: `${section}${b + 1}-R${r + 1}-${String(g + 1).padStart(2, '0')}`,
            lat: -(sr * sectionH + r * d),
            lng: sc * sectionW + b * blockW + g * d,
          });
        }
      }
    }
  });
  const mid = (k) => (Math.min(...raw.map((g) => g[k])) + Math.max(...raw.map((g) => g[k]))) / 2;
  const dLat = center.latitude - mid('lat');
  const dLng = center.longitude - mid('lng');
  return raw.map((g) => ({
    section: g.section,
    block: g.block,
    row: g.row,
    number: g.number,
    latitude: +(g.lat + dLat).toFixed(7),
    longitude: +(g.lng + dLng).toFixed(7),
  }));
}

module.exports = { generateLayout, SECTIONS };
