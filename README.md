# GraveFinder

A cemetery geomapping and grave-location system for Trece Martires Memorial Park, Trece Martires City, Cavite, Philippines.

Visitors search for a deceased person on a mobile app and see the grave on a map, with the distance and direction to it. Cemetery staff use a web dashboard to manage burial records and place each record on a grave plot. Both apps share one backend.

GraveFinder is an undergraduate capstone prototype (Bachelor of Science in Information Technology, Cavite State University). It is a working demonstration, not a production system. See [Project status](#project-status) before using it for anything real.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Map tiles and the OpenStreetMap usage policy](#map-tiles-and-the-openstreetmap-usage-policy)
- [Sample data and privacy](#sample-data-and-privacy)
- [API reference](#api-reference)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Project status](#project-status)
- [Roadmap](#roadmap)
- [Acknowledgements and license](#acknowledgements-and-license)

## Features

**Visitor mobile app (React Native / Expo)**
- Search burial records by name, with partial matches
- Record details with the grave's section, block, row, and number
- Cemetery map with the boundary, sections, and grave markers
- Tap a grave to see who is buried there
- Distance and direction from the visitor to the selected grave
- Optional GPS. Outside the cemetery, the app shows a labeled, simulated position at the entrance
- The map is locked to the cemetery, so it cannot be panned or zoomed away

**Admin web dashboard (React / Leaflet)**
- Login, overview counts, and record search and filters
- Add, edit, and delete burial records, with delete confirmation and form validation
- Assign a record to a grave from a list or by clicking the map
- Cemetery map tools:
  - add a grave
  - move a grave by dragging it or clicking
  - edit a grave's section, block, row, and number
  - delete a grave that has no burial record
  - assign or unassign records
- Boundary editor: draw the cemetery outline by clicking corner points, dragging them, and right-clicking to delete
- Graves can only be placed inside the boundary, and the server enforces this as well

## Architecture

```
gravefinder/
  server/   Node.js + Express REST API, SQLite database, seed script      port 4000
  admin/    React + Vite admin dashboard with a Leaflet map               port 5173
  mobile/   React Native (Expo) visitor app with react-native-maps
  tests/    API and browser tests (Python)
```

| Part | Main technology |
| --- | --- |
| Server | Node.js 22+, Express 4, better-sqlite3 |
| Admin | React 18, Vite 5, Leaflet 1.9 |
| Mobile | Expo SDK 58, React Native 0.88, React Navigation, react-native-maps |
| Base map | OpenStreetMap raster tiles, served through the project's own server |

The SQLite database is the single source of truth for both apps. Its tables are `cemeteries`, `graves`, `burial_records`, and `admin_users`.

## Getting started

### Requirements

- Node.js 22 or newer and npm
- For the mobile app: the Expo Go app on a phone (iOS or Android), or an Android emulator or iOS simulator
- For Expo Go: the phone and the computer on the same Wi-Fi network
- Internet access, because map tiles come from OpenStreetMap

### 1. Server

```bash
cd server
npm install
npm run seed
npm start
```

The API runs at `http://localhost:4000`. `npm run seed` creates `gravefinder.db` with one cemetery, 96 sample graves, and 26 sample burial records. Running it again resets the database.

Before starting the server, set a contact in `TILE_USER_AGENT`. See [Map tiles](#map-tiles-and-the-openstreetmap-usage-policy).

### 2. Admin dashboard

```bash
cd admin
npm install
npm run dev
```

Open `http://localhost:5173`. The seeded demo login is `admin` / `admin123`.

### 3. Mobile app

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS). The app finds the API on the computer running Expo, on port 4000.

If the app cannot reach the server, set the address yourself:

```bash
# macOS / Linux
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api npx expo start

# Windows (PowerShell)
$env:EXPO_PUBLIC_API_URL="http://192.168.1.10:4000/api"; npx expo start
```

Replace `192.168.1.10` with your computer's local IP address. An Android emulator uses `10.0.2.2` automatically.

## Configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `TILE_USER_AGENT` | environment variable, server | Identifies your deployment to OpenStreetMap. Use a real contact, for example `GraveFinder/1.0 (https://github.com/your-name/gravefinder)` |
| `PORT` | environment variable, server | API port. Default `4000` |
| `EXPO_PUBLIC_API_URL` | environment variable, mobile | API address when automatic detection fails |
| `server/cemetery.config.json` | file | Cemetery name, description, and center coordinates used when seeding |

Environment variables last only for the terminal session where you set them. Set them in the same terminal that runs the process.

To place the sample layout on the real park, copy the center coordinates from a map service into `cemetery.config.json`, then run `npm run seed` and restart the server. The sample graves are illustrative. They are not a survey of real graves.

## Map tiles and the OpenStreetMap usage policy

Neither app talks to OpenStreetMap directly. Both request tiles from the project server at `/api/tiles/{z}/{x}/{y}.png`. The server:

- fetches each tile from OpenStreetMap with an identifying `User-Agent`
- caches tiles on disk in `server/tile-cache/` (not committed to git)
- sends at most two requests to OpenStreetMap at a time
- merges simultaneous requests for the same tile into one
- retries a failed request once, with an 8-second timeout

This follows the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/), which requires every app to identify itself and limits heavy use. Attribution ("© OpenStreetMap contributors") is shown on both maps.

OpenStreetMap's tile servers are volunteer-run and intended for light use. If you deploy GraveFinder for real visitors, switch to a tile provider built for applications. The tile URL is set in `server/server.js`.

If a map tile shows an "Access blocked" message, read the text on the tile. It states the reason. See [Troubleshooting](#troubleshooting).

## Sample data and privacy

The repository contains **only fictional data**. Burial records are personal data. If you load real records, handle them under the Philippine Data Privacy Act of 2012 and the policies of the cemetery office.

- Do not commit `gravefinder.db`. It is already listed in `.gitignore`.
- Do not publish real records, screenshots of real records, or the real database.
- Change the demo admin credentials before any real use.

## API reference

Admin routes need the bearer token returned by `POST /api/login`.

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/login` | public | Log in and receive a token |
| GET | `/api/cemetery` | public | Cemetery details, boundary, and sections |
| PUT | `/api/cemetery/boundary` | admin | Save a new boundary |
| GET | `/api/stats` | public | Overview counts |
| GET | `/api/graves` | public | List graves (`?status=`, `?section=`) |
| POST | `/api/graves` | admin | Add a grave |
| PUT | `/api/graves/:id` | admin | Update coordinates and/or section, block, row, grave number |
| DELETE | `/api/graves/:id` | admin | Delete a grave. Refused if it has a burial record |
| GET | `/api/records` | public | Search records (`?q=`, `?section=`, `?status=assigned\|unassigned`) |
| GET | `/api/records/:id` | public | One record |
| POST | `/api/records` | admin | Add a record |
| PUT | `/api/records/:id` | admin | Update a record |
| PUT | `/api/records/:id/grave` | admin | Assign or unassign a grave |
| DELETE | `/api/records/:id` | admin | Delete a record |
| GET | `/api/tiles/:z/:x/:y.png` | public | Cached OpenStreetMap tile (zoom 0 to 19) |

## Tests

With the server and the admin app running and the database freshly seeded, run these from the project root. They need Python 3. The browser test also needs Playwright (`pip install playwright`, then `playwright install chromium`).

```bash
python3 tests/visitor_flow.py   # API: search, record detail, grave coordinates, boundary rules
python3 tests/e2e_admin.py      # browser: login, records, grave assignment, map edits
```

Run `npm run seed` in `server/` before the browser test to reset the data. The mobile app's screens are not covered by the automated tests.

## Troubleshooting

- **Mobile says it could not reach the records:** confirm the server is running and the phone is on the same Wi-Fi. Allow Node.js through the computer's firewall on port 4000, or set `EXPO_PUBLIC_API_URL`.
- **`npm install` fails in `server/` on better-sqlite3:** use a current Node.js LTS release. better-sqlite3 downloads a prebuilt binary for supported versions.
- **The admin returns to the login screen:** login tokens live in server memory, so restarting the server signs everyone out.
- **Blank map tiles:** check your internet connection and that the server is running. Failed tile requests are logged in the server console with a `[tiles]` prefix and the reason.
- **"Access blocked" on a tile:** OpenStreetMap is refusing the request. Common causes are a missing or placeholder `TILE_USER_AGENT`, too many requests in a short time, and a shared network address that has been blocked. Set a real `TILE_USER_AGENT`, restart the server, and wait a few minutes. A browser privacy extension can also strip the Referer header if the page loads tiles directly.
- **Data looks wrong after testing:** stop the server and run `npm run seed` to reset.

## Project status

This is a prototype built for a capstone study. Known limitations:

- **Not production-ready security.** Login tokens are kept in memory and do not expire, and passwords are hashed with unsalted SHA-256. Use a proper authentication system before any real deployment.
- **Online only.** The apps need a connection to the server. There is no offline mode.
- **Point-based graves.** Each grave is a single point, not a surveyed outline.
- **Sample layout.** The seeded graves and boundary are illustrative. A real deployment needs a survey of the actual plots.
- **Single cemetery.** The data model and layout assume one cemetery.
- **Limited device testing.** The mobile app has not been tested on a wide range of phones. GPS accuracy depends on the device and conditions on site.

## Roadmap

Possible next steps, depending on what the cemetery office needs:

- Import the official boundary and lots from GeoJSON, with the boundary locked against casual edits
- Bulk import of existing burial records from the cemetery's spreadsheet
- Surveyed grave outlines instead of points
- Aerial or drone imagery as the base layer in place of OpenStreetMap tiles
- Walking routes along surveyed paths
- Stronger authentication and per-user admin accounts

## Acknowledgements and license

Map data and tiles are © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License.

**Authors:** Zachary Carl M. Galano, Ian Carlo R. Manoza, Clark Kent S. Neri, Albert R. Villarosa. Department of Information Technology, College of Engineering and Information Technology, Cavite State University, Main Campus, Indang, Cavite.

**License:** not yet specified. Until a license is added, all rights are reserved by the authors.
