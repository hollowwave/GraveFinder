const crypto = require('crypto');
const db = require('./db');

const hash = (p) => crypto.createHash('sha256').update(p).digest('hex');

const LAT0 = 14.52;
const LNG0 = 121.05;
const D = 0.00003;
const BLOCK_W = 4 * D + 0.00002;
const SECTION_W = 2 * BLOCK_W + 0.00006;
const SECTION_H = 3 * D + 0.00006;
const SECTIONS = ['A', 'B', 'C', 'D'];

const records = [
  ['Eleanor Mae Castillo', '1931-03-14', '2009-11-02', '2009-11-05', 'A', 1, 1, 1],
  ['Ramon Dela Cruz', '1928-07-22', '2004-01-19', '2004-01-22', 'A', 1, 1, 2],
  ['Teresita Santos Villanueva', '1940-12-01', '2015-06-30', '2015-07-03', 'A', 1, 2, 1],
  ['Benjamin Aquino Reyes', '1935-05-09', '2012-09-14', '2012-09-17', 'A', 2, 1, 3],
  ['Lourdes Magsaysay', '1946-02-27', '2018-03-08', '2018-03-11', 'A', 2, 2, 2],
  ['Fernando Bautista', '1922-10-30', '1999-08-12', '1999-08-15', 'A', 2, 3, 4],
  ['Corazon Ilagan Mendoza', '1950-04-18', '2020-01-25', '2020-01-28', 'B', 1, 1, 1],
  ['Alfredo Navarro', '1938-09-03', '2007-05-21', '2007-05-24', 'B', 1, 1, 3],
  ['Remedios Pascual', '1944-01-11', '2016-12-09', '2016-12-12', 'B', 1, 2, 2],
  ['Danilo Fernandez Ocampo', '1955-06-06', '2021-10-17', '2021-10-20', 'B', 1, 3, 4],
  ['Josefina Salazar', '1933-08-29', '2010-04-04', '2010-04-07', 'B', 2, 1, 2],
  ['Gregorio Manalo', '1927-11-15', '2001-02-28', '2001-03-03', 'B', 2, 2, 1],
  ['Natividad Cruz Soriano', '1949-03-23', '2019-07-14', '2019-07-17', 'B', 2, 3, 3],
  ['Victorino Lim', '1941-05-12', '2013-01-06', '2013-01-09', 'C', 1, 1, 2],
  ['Amparo Domingo', '1952-09-20', '2022-05-11', '2022-05-14', 'C', 1, 2, 1],
  ['Cesar Valdez Tolentino', '1936-02-02', '2008-10-30', '2008-11-02', 'C', 1, 2, 4],
  ['Milagros Evangelista', '1948-12-25', '2017-04-19', '2017-04-22', 'C', 1, 3, 3],
  ['Rogelio Panganiban', '1930-07-07', '2003-09-23', '2003-09-26', 'C', 2, 1, 1],
  ['Estrella Hernandez', '1957-10-14', '2023-02-16', '2023-02-19', 'C', 2, 2, 3],
  ['Bonifacio Estrada', '1943-04-01', '2014-11-27', '2014-11-30', 'C', 2, 3, 2],
  ['Luzviminda Cabrera', '1939-06-18', '2011-03-12', '2011-03-15', 'D', 1, 1, 4],
  ['Isidro Marquez', '1925-01-09', '1998-12-01', '1998-12-04', 'D', 1, 2, 2],
  ['Perla Gonzales Ramos', '1960-08-31', '2024-08-05', '2024-08-08', 'D', 1, 3, 1],
  ['Hilario Javier', '1934-03-05', '2006-06-20', '2006-06-23', 'D', 2, 1, 2],
  ['Concepcion Abad', '1947-11-08', '2019-12-29', '2020-01-01', 'D', 2, 2, 4],
  ['Ernesto Villareal', '1953-07-26', '2025-03-18', '2025-03-21', 'D', 2, 3, 3],
];

const run = db.transaction(() => {
  db.exec('DELETE FROM burial_records; DELETE FROM graves; DELETE FROM cemeteries; DELETE FROM admin_users;');

  db.prepare('INSERT INTO cemeteries (id, name, description) VALUES (1, ?, ?)').run(
    'Hardin ng Alaala Memorial Park',
    'Fictional demonstration cemetery with four sections, each divided into two blocks of three rows.'
  );

  const insertGrave = db.prepare(
    'INSERT INTO graves (cemetery_id, section, block, row, grave_number, latitude, longitude, status) VALUES (1,?,?,?,?,?,?, \'available\')'
  );
  SECTIONS.forEach((section, i) => {
    const sc = i % 2;
    const sr = Math.floor(i / 2);
    for (let b = 0; b < 2; b++) {
      for (let r = 0; r < 3; r++) {
        for (let g = 0; g < 4; g++) {
          const lat = LAT0 - sr * SECTION_H - r * D;
          const lng = LNG0 + sc * SECTION_W + b * BLOCK_W + g * D;
          const number = `${section}${b + 1}-R${r + 1}-${String(g + 1).padStart(2, '0')}`;
          insertGrave.run(section, String(b + 1), String(r + 1), number, +lat.toFixed(7), +lng.toFixed(7));
        }
      }
    }
  });

  const findGrave = db.prepare('SELECT id FROM graves WHERE section=? AND block=? AND row=? AND grave_number LIKE ?');
  const insertRecord = db.prepare(
    'INSERT INTO burial_records (full_name, date_of_birth, date_of_death, burial_date, grave_id, created_at) VALUES (?,?,?,?,?,?)'
  );
  const occupy = db.prepare("UPDATE graves SET status='occupied' WHERE id=?");

  records.forEach(([name, dob, dod, bd, section, block, row, g], idx) => {
    const grave = findGrave.get(section, String(block), String(row), `%-${String(g).padStart(2, '0')}`);
    const created = `2025-0${(idx % 9) + 1}-1${idx % 9} 09:00:00`;
    insertRecord.run(name, dob, dod, bd, grave.id, created);
    occupy.run(grave.id);
  });

  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash('admin123'));
});

run();
console.log('seeded', db.prepare('SELECT COUNT(*) c FROM graves').get().c, 'graves,',
  db.prepare('SELECT COUNT(*) c FROM burial_records').get().c, 'records');
