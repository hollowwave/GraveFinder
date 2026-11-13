# GraveFinder: A Cross-Platform GIS Application for Grave Location and Record Mapping

Academic prototype. A visitor mobile app (React Native / Expo) and an admin web dashboard (React) share one Node.js + SQLite backend.

## Project structure

```
  gravefinder/
      server/   Node.js + Express REST API, SQLite database, seed data   (port 4000)
      admin/    React + Vite admin dashboard with a Leaflet map           (port 5173)
      mobile/   React Native (Expo) visitor app with a react-native-maps map
```

## Features by app

Admin: overview counts, record search and filters, add / edit / delete with confirmation, grave assignment from a list or the map, and a locked cemetery map to view graves, add graves, move graves and assign or unassign records.

Mobile: name search with partial matches, record details, cemetery map with boundary, sections and grave markers, tap-to-select graves, distance and direction to the grave, optional GPS.

## External APIs and services

- OpenStreetMap tile server: base map on both apps (attribution is shown on the maps).
- The project's own REST API in `server/`, which both apps use as the single source of truth.

## Location (GPS)

Location access is optional. The mobile app uses your GPS only when you are within 1 km of the cemetery. Otherwise it shows a simulated position at the cemetery entrance and labels it as simulated. The sample cemetery uses fictional data.

## Cemetery location

The pilot site is Trece Martires Memorial Park (Katangan, Aguado, Trece Martires City, Cavite). Its name and map position are set in `server/cemetery.config.json`:
```
    {
      "name": "Trece Martires Memorial Park",
      "description": "...",
      "center": { "latitude": 14.25611, "longitude": 120.86432 }
    }
```
To place the sample layout exactly on the park: open Google Maps, right-click the middle of the burial grounds, click the coordinates at the top of the menu to copy them, and paste the two numbers into `center`. Then run `npm run seed` in `server/` and restart the server. The sample graves are illustrative and are not a survey of the real graves.

## Troubleshooting

- Mobile shows "Could not reach the cemetery records": confirm the server is running, the phone is on the same Wi-Fi, and allow Node.js through your computer's firewall on port 4000. Otherwise set EXPO_PUBLIC_API_URL as above.
- `npm install` fails in `server/` on better-sqlite3: use a Node.js LTS version, since it downloads a prebuilt binary for supported versions.
- Admin shows a login screen again: the server was restarted, which signs everyone out. Log in again.
- Map tiles are blank: check your internet connection.
- Data looks wrong after testing: stop the server and run `npm run seed` in `server/` to reset.

## API summary
```
    POST   /api/login
    GET    /api/cemetery
    GET    /api/stats
    GET    /api/graves            (?status= &section=)
    POST   /api/graves            (admin)
    PUT    /api/graves/:id        (admin, coordinates)
    GET    /api/records           (?q= &section= &status=assigned|unassigned)
    GET    /api/records/:id
    POST   /api/records           (admin)
    PUT    /api/records/:id       (admin)
    PUT    /api/records/:id/grave (admin)
    DELETE /api/records/:id       (admin)
```

Admin routes need the bearer token returned by /api/login.

## Automated checks

With the server and admin running (and freshly seeded), these can be run from the project root. They need Python 3 and, for the browser test, `pip install playwright` then `playwright install chromium`.

    python3 tests/visitor_flow.py     (API: search, record detail, grave coordinates, new record visible to visitors)
    python3 tests/e2e_admin.py        (browser: login, records CRUD, grave assignment by map, map page edits)

Run `npm run seed` in `server/` before the browser test to reset the data.

