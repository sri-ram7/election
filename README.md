# Telugu voter-list PDF extractor

Extracts voter records from the selectable text in `Srimukhalingam.pdf` and
writes one JSON object per voter. The output preserves Telugu names and house
numbers, adds an automatic Latin-script transliteration of each voter name,
and normalizes the PDF's Telugu gender labels to `Male` and `Female`. The
English name is a phonetic transliteration, not an official English spelling.

## Setup

From this folder, install the dependency:

```powershell
python -m pip install -r requirements.txt
```

## Run

Pass the PDF path explicitly. The output defaults to `output\voters.json`:

```powershell
python extract_voters.py --pdf "C:\Users\tsrir\Downloads\Srimukhalingam.pdf"
```

To choose a different output path:

```powershell
python extract_voters.py --pdf "C:\Users\tsrir\Downloads\Srimukhalingam.pdf" --output "output\voters.json"
```

Each record contains `wardno`, `serialNumber`, `voterName`, `voterNameEn`,
`relationName`, `age`, `gender`, `houseNumber`, `voterId`, and `pageNumber`.
The ward number is read from the top-right header of each page containing
voter cards. The script stops with an error if it cannot identify the ward
number, card header, serial number, age, or expected field values for a voter.
A missing house number is written as JSON `null` and reported in the run
summary. Check `voterNameEn` against an official English spelling where one is
required.

## MongoDB admin application

The standalone web app uses an Express/Mongoose API and a React/Vite admin UI.
The API reads `output/voters.json` from the server filesystem; the browser
cannot choose an import path and never receives MongoDB credentials.

### Configure MongoDB Atlas

1. Create an Atlas database user with `readWrite` access to the application
   database, and allow-list only the IP address(es) that will host the backend.
2. Copy `backend/.env.example` to `backend/.env`.
3. Set `MONGODB_URI`, `ADMIN_USERNAME`, and a strong `ADMIN_PASSWORD`.
   Generate a separate random `SESSION_SECRET` of at least 32 characters.
   Keep `backend/.env` private; it is excluded by `.gitignore`.
4. After the initial import creates the `voters` collection, create a MongoDB
   Atlas Search index on that collection. Name the index `voter_search`, use
   the Search JSON editor, and paste the definition from
   `backend/atlas-search-index.json`. Name/ID/house partial search uses this
   index; serial and ward are numeric Search-index equality queries.

If Windows DNS tools resolve your Atlas cluster but Node.js reports
`ECONNREFUSED` during SRV discovery, run the backend from PowerShell with the
Windows-configured DNS servers for that terminal:

```powershell
$dnsServers = (Get-DnsClientServerAddress -AddressFamily IPv4 |
  ForEach-Object ServerAddresses |
  Where-Object { $_ } |
  Select-Object -Unique) -join ','
$env:MONGODB_DNS_SERVERS = $dnsServers
npm run dev
```

Alternatively, set `MONGODB_DNS_SERVERS` in `backend/.env` to DNS server IP
addresses allowed by your network. This setting configures only Node.js DNS
for this backend process.

### Install and run locally

In one PowerShell terminal:

```powershell
Set-Location backend
Copy-Item .env.example .env
# Edit .env with your Atlas URI and administrator credentials.
npm install
npm run dev
```

In a second terminal:

```powershell
Set-Location frontend
npm install
npm run dev
```

Open the Vite URL shown in the second terminal (normally
`http://localhost:5173`). The Vite development server proxies API requests to
the backend on port 3001. Sign in with the configured admin account. Use the
Import page, review the record count, confirm the import, and monitor progress.
The Search page supports partial English-name and voter-ID matching plus
serial, house, and ward queries. Selecting a result opens all ten fields and a
non-printing slip preview.

For a production build, run `npm install` in both folders, run
`npm run build` in `frontend`, then run `npm start` in `backend`. The backend
serves the built React app and API from the same origin. Set `NODE_ENV=production`
when using HTTPS so the session cookie is marked secure.

### Tests

```powershell
Set-Location backend
npm test
```

These automated tests cover record validation, schema/index definition,
authentication and CSRF enforcement, pagination/search parsing, duplicate
handling, and 500-record batching. They use mocked database operations and do
not verify Atlas connectivity or claim that a real database import succeeded.
