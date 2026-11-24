import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api.js";

const DISPLAY_FIELDS = [
  ["Ward number", "wardno"],
  ["Serial number", "serialNumber"],
  ["Voter name (Telugu)", "voterName"],
  ["Voter name (English)", "voterNameEn"],
  ["Relation name", "relationName"],
  ["Age", "age"],
  ["Gender", "gender"],
  ["House number", "houseNumber"],
  ["Voter ID", "voterId"],
  ["Page number", "pageNumber"],
];

function messageFrom(error) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(username, password);
    } catch (loginError) {
      setError(messageFrom(loginError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="panel login-panel" onSubmit={submit}>
        <p className="eyebrow">VOTER SLIP MANAGEMENT</p>
        <h1>Administrator sign in</h1>
        <p className="muted">Sign in to search and manage voter records.</p>
        <label>
          Username
          <input
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function ImportDashboard({ csrfToken }) {
  const [preview, setPreview] = useState(null);
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const polling = useRef(false);

  const refresh = useCallback(async () => {
    const [previewResult, historyResult] = await Promise.all([
      apiRequest("/api/voters/bulk-import/preview", { csrfToken }),
      apiRequest("/api/voters/import-runs", { csrfToken }),
    ]);
    setPreview(previewResult);
    setHistory(historyResult.items);
    const activeRun = historyResult.items.find((item) =>
      ["queued", "running"].includes(item.status),
    );
    setRun((current) =>
      current && ["queued", "running"].includes(current.status)
        ? current
        : activeRun ?? current,
    );
  }, [csrfToken]);

  useEffect(() => {
    refresh().catch((loadError) => setError(messageFrom(loadError)));
  }, [refresh]);

  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status) || polling.current) {
      return undefined;
    }
    let active = true;
    let timer;
    polling.current = true;

    async function poll() {
      try {
        const result = await apiRequest(
          `/api/voters/bulk-import/${run._id}`,
          { csrfToken },
        );
        if (!active) return;
        setRun(result.run);
        if (["queued", "running"].includes(result.run.status)) {
          timer = window.setTimeout(poll, 1200);
        } else {
          polling.current = false;
          await refresh();
        }
      } catch (pollError) {
        if (active) {
          polling.current = false;
          setError(messageFrom(pollError));
        }
      }
    }
    timer = window.setTimeout(poll, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
      polling.current = false;
    };
  }, [run, csrfToken, refresh]);

  async function startImport() {
    setError("");
    try {
      const result = await apiRequest("/api/voters/bulk-import", {
        method: "POST",
        csrfToken,
      });
      setConfirmed(false);
      setRun(result.run);
      await refresh();
    } catch (importError) {
      setError(messageFrom(importError));
    }
  }

  const progress = run?.totalRecords
    ? Math.round((run.processedRecords / run.totalRecords) * 100)
    : 0;

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DATA MANAGEMENT</p>
          <h1>Bulk import</h1>
          <p className="muted">
            Import the server-side JSON in batches of 500. Existing voter IDs
            are skipped, not overwritten.
          </p>
        </div>
        <span className="pill">Admin only</span>
      </div>

      <div className="panel import-panel">
        <div className="metric-row">
          <div className="metric">
            <span className="muted">JSON records</span>
            <strong>{preview?.totalRecords ?? "—"}</strong>
          </div>
          <div className="metric">
            <span className="muted">Imported this run</span>
            <strong>{run?.importedCount ?? "—"}</strong>
          </div>
          <div className="metric">
            <span className="muted">Duplicates</span>
            <strong>{run?.duplicateCount ?? "—"}</strong>
          </div>
          <div className="metric">
            <span className="muted">Failed</span>
            <strong>{run?.failedCount ?? "—"}</strong>
          </div>
        </div>

        {preview?.totalRecords > 0 && (
          <label className="confirmation">
            <input
              checked={confirmed}
              disabled={
                Boolean(run && ["queued", "running"].includes(run.status)) ||
                Boolean(preview.invalidCount)
              }
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              I confirm importing {preview.totalRecords.toLocaleString()} voter
              records from <code>output/voters.json</code>.
            </span>
          </label>
        )}
        <button
          disabled={
            !confirmed ||
            Boolean(run && ["queued", "running"].includes(run.status))
          }
          onClick={startImport}
          type="button"
        >
          Start import
        </button>
        {preview?.invalidCount > 0 && (
          <p className="error">
            Import is disabled because {preview.invalidCount} source record(s)
            fail schema validation.
          </p>
        )}
        {error && <p className="error">{error}</p>}

        {run && (
          <div className="progress-section" aria-live="polite">
            <div className="progress-label">
              <strong>{run.status.replaceAll("_", " ")}</strong>
              <span>
                {run.processedRecords.toLocaleString()} /{" "}
                {run.totalRecords.toLocaleString()} records ({progress}%)
              </span>
            </div>
            <progress max={run.totalRecords || 1} value={run.processedRecords} />
            <p className="muted">
              {run.importedCount} imported · {run.duplicateCount} duplicates ·{" "}
              {run.failedCount} failed
            </p>
            {run.issues?.length > 0 && (
              <details>
                <summary>Import issues ({run.issues.length})</summary>
                <ul className="issues-list">
                  {run.issues.slice(0, 100).map((issue, index) => (
                    <li key={`${issue.recordNumber}-${index}`}>
                      Record {issue.recordNumber}: {issue.message}
                      {issue.fields?.length
                        ? ` (${issue.fields.join(", ")})`
                        : ""}
                    </li>
                  ))}
                </ul>
                {run.issues.length > 100 && (
                  <p className="muted">Showing the first 100 issues.</p>
                )}
              </details>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Recent import history</h2>
        {history.length === 0 ? (
          <p className="muted">No import runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Processed</th>
                  <th>Imported</th>
                  <th>Duplicates</th>
                  <th>Failed</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item._id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.status.replaceAll("_", " ")}</td>
                    <td>{item.processedRecords}</td>
                    <td>{item.importedCount}</td>
                    <td>{item.duplicateCount}</td>
                    <td>{item.failedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SearchPage({ csrfToken, onSelect }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("wardno");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          page: String(page),
          limit: "20",
          sortBy,
        });
        const data = await apiRequest(`/api/voters/search?${params}`, {
          csrfToken,
        });
        if (active) {
          setResult(data);
          setError("");
        }
      } catch (searchError) {
        if (active) setError(messageFrom(searchError));
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, page, sortBy, csrfToken]);

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">VOTER RECORDS</p>
          <h1>Search voters</h1>
          <p className="muted">
            Search English names, voter ID, serial, house, or ward.
          </p>
        </div>
      </div>
      <div className="panel">
        <label className="search-label">
          Search term
          <input
            autoFocus
            placeholder="e.g. Annapuarna, IQV1377498, 1876, 9"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="search-label sort-label">
          Sort by
          <select
            value={sortBy}
            onChange={(event) => { setSortBy(event.target.value); setPage(1); }}
          >
            <option value="wardno">Ward Number</option>
            <option value="serialNumber">Serial Number</option>
            <option value="voterNameEn">Name (A–Z)</option>
            <option value="age">Age</option>
          </select>
        </label>
        <p className="muted search-help">
          English-name matching is case-insensitive and partial.
        </p>
        {error && <p className="error">{error}</p>}
        {result && (
          <>
            <div className="results-heading">
              <strong>{result.total.toLocaleString()} results</strong>
              <span>
                Page {result.page} of {Math.max(result.totalPages, 1)}
              </span>
            </div>
            {result.items.length === 0 ? (
              <p className="muted">No matching records.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>English name</th>
                      <th>Telugu name</th>
                      <th>Voter ID</th>
                      <th>Ward</th>
                      <th>Serial</th>
                      <th>Age</th>
                      <th>Gender</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((voter) => (
                      <tr key={voter._id}>
                        <td>{voter.voterNameEn}</td>
                        <td lang="te">{voter.voterName}</td>
                        <td>{voter.voterId}</td>
                        <td>{voter.wardno}</td>
                        <td>{voter.serialNumber}</td>
                        <td>{voter.age}</td>
                        <td>{voter.gender}</td>
                        <td>
                          <button
                            className="button-small"
                            onClick={() => onSelect(voter._id)}
                            type="button"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                disabled={page >= result.totalPages}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function VoterDetails({ voterId, csrfToken, onBack, onPreview }) {
  const [voter, setVoter] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest(`/api/voters/${encodeURIComponent(voterId)}`, { csrfToken })
      .then(({ voter: record }) => {
        if (active) setVoter(record);
      })
      .catch((loadError) => {
        if (active) setError(messageFrom(loadError));
      });
    return () => {
      active = false;
    };
  }, [voterId, csrfToken]);

  return (
    <section className="page-content">
      <button className="text-button" onClick={onBack} type="button">
        ← Back to search
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">SELECTED RECORD</p>
          <h1>Voter details</h1>
        </div>
      </div>
      <div className="panel details-panel">
        {error && <p className="error">{error}</p>}
        {!voter && !error ? (
          <p className="muted">Loading voter record...</p>
        ) : (
          voter && (
            <>
              <dl className="details-grid">
                {DISPLAY_FIELDS.map(([label, field]) => (
                  <div key={field}>
                    <dt>{label}</dt>
                    <dd lang={field === "voterName" || field === "relationName" ? "te" : undefined}>
                      {voter[field] ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              <button onClick={onPreview} type="button">
                Proceed to slip preview
              </button>
            </>
          )
        )}
      </div>
    </section>
  );
}

function SlipPreview({ voter, onBack }) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <section className="page-content slip-preview-page">
      <div className="no-print preview-toolbar">
        <button className="text-button" onClick={onBack} type="button">
          ← Back to voter details
        </button>
        <div className="page-heading">
          <div>
            <p className="eyebrow">PRINTING OPTIMIZED FOR 58MM THERMAL PRINTER</p>
            <h1>Voter Slip Preview</h1>
            <p className="muted">
              Receipt-optimized layout for 58mm thermal rolls. Click "Print Slip" to print via browser dialog.
            </p>
          </div>
          <div className="preview-actions">
            <button
              className="print-button"
              onClick={handlePrint}
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print Slip (58mm)
            </button>
          </div>
        </div>
      </div>

      <div className="slip-container">
        <article className="slip-card thermal-slip" id="printable-slip">
          <header className="slip-header">
            <div className="slip-title">VOTER INFORMATION SLIP</div>
            <div className="slip-subtitle" lang="te">ఓటరు సమాచార పత్రం</div>
          </header>

          <div className="slip-divider-line" />

          <div className="slip-meta-grid">
            <div className="slip-meta-item">
              <span className="slip-meta-label">WARD NO</span>
              <strong className="slip-meta-val">{voter.wardno}</strong>
            </div>
            <div className="slip-meta-item">
              <span className="slip-meta-label">SERIAL NO</span>
              <strong className="slip-meta-val">{voter.serialNumber}</strong>
            </div>
          </div>

          <div className="slip-divider-line" />

          <div className="slip-names">
            <div className="slip-voter-name-en">{voter.voterNameEn}</div>
            <div className="slip-voter-name-te" lang="te">{voter.voterName}</div>
          </div>

          <div className="slip-divider-dashed" />

          <table className="slip-table">
            <tbody>
              <tr>
                <td className="slip-label">Voter ID:</td>
                <td className="slip-value slip-id">{voter.voterId}</td>
              </tr>
              <tr>
                <td className="slip-label">Age / Gender:</td>
                <td className="slip-value">{voter.age} Yrs / {voter.gender}</td>
              </tr>
              <tr>
                <td className="slip-label">Relation:</td>
                <td className="slip-value" lang="te">{voter.relationName || "—"}</td>
              </tr>
              <tr>
                <td className="slip-label">House No:</td>
                <td className="slip-value">{voter.houseNumber ?? "—"}</td>
              </tr>
              {voter.pageNumber && (
                <tr>
                  <td className="slip-label">Part / Page:</td>
                  <td className="slip-value">{voter.pageNumber}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="slip-divider-dashed" />

          <footer className="slip-footer">
            <div className="slip-footer-tag">*** ELECTION SLIP ***</div>
            <div className="slip-footer-date">
              {new Date().toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </div>
          </footer>
        </article>
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [view, setView] = useState("search");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedVoter, setSelectedVoter] = useState(null);
  const [error, setError] = useState("");

  const refreshSession = useCallback(async () => {
    const current = await apiRequest("/api/auth/session");
    setSession(current.authenticated);
    setCsrfToken(current.csrfToken);
  }, []);

  useEffect(() => {
    refreshSession().catch((loadError) => setError(messageFrom(loadError)));
  }, [refreshSession]);

  async function login(username, password) {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      csrfToken,
      body: JSON.stringify({ username, password }),
    });
    setSession(true);
    setCsrfToken(result.csrfToken);
    setError("");
  }

  async function logout() {
    await apiRequest("/api/auth/logout", {
      method: "POST",
      csrfToken,
    });
    setSession(false);
    setView("search");
    setSelectedId(null);
    await refreshSession();
  }

  async function selectVoter(id) {
    try {
      const result = await apiRequest(
        `/api/voters/${encodeURIComponent(id)}`,
        { csrfToken },
      );
      setSelectedVoter(result.voter);
      setSelectedId(id);
      setView("details");
    } catch (loadError) {
      setError(messageFrom(loadError));
    }
  }

  if (session === null) {
    return (
      <main className="login-shell">
        <div className="panel login-panel">
          <h1>Voter Slip Admin</h1>
          <p className={error ? "error" : "muted"}>
            {error || "Checking administrator session..."}
          </p>
        </div>
      </main>
    );
  }
  if (!session) return <Login onLogin={login} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#search"
          onClick={(event) => {
            event.preventDefault();
            setView("search");
          }}
        >
          <span className="brand-mark">V</span>
          <span>Voter Slip Admin</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={view === "search" || view === "details" || view === "preview" ? "nav-active" : ""}
            onClick={() => {
              setView("search");
              setSelectedId(null);
            }}
            type="button"
          >
            Search
          </button>
          <button
            className={view === "import" ? "nav-active" : ""}
            onClick={() => setView("import")}
            type="button"
          >
            Import
          </button>
        </nav>
        <button className="logout-button" onClick={logout} type="button">
          Sign out
        </button>
      </header>
      <main className="main-shell">
        {error && <div className="global-error">{error}</div>}
        {view === "import" && <ImportDashboard csrfToken={csrfToken} />}
        {view === "search" && (
          <SearchPage csrfToken={csrfToken} onSelect={selectVoter} />
        )}
        {view === "details" && selectedId && (
          <VoterDetails
            voterId={selectedId}
            csrfToken={csrfToken}
            onBack={() => setView("search")}
            onPreview={() => setView("preview")}
          />
        )}
        {view === "preview" && selectedVoter && (
          <SlipPreview
            voter={selectedVoter}
            onBack={() => setView("details")}
          />
        )}
      </main>
    </div>
  );
}
