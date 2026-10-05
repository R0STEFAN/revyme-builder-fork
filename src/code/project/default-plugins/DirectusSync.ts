// DirectusSync.ts — Full-featured Directus CMS synchronization plugin for Revyme.
// Supports: connecting to Directus, selecting collection, creating new collection or
// importing into existing collection with field diffing, validation, and merging.

export const DIRECTUS_SYNC_PLUGIN_SOURCE = `// Directus CMS Sync — Revyme plugin
import { createPlugin } from '@revyme/plugin-sdk';
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

function App({ plugin }) {
  // Step 1: Connection
  const [url, setUrl] = useState('http://localhost:8055');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2: Collections & Schema
  const [directusCollections, setDirectusCollections] = useState([]);
  const [selectedDirectusColl, setSelectedDirectusColl] = useState('');
  const [directusFields, setDirectusFields] = useState([]);
  const [fetchingFields, setFetchingFields] = useState(false);

  // Target in Revyme
  const [targetMode, setTargetMode] = useState('new'); // 'new' | 'existing'
  const [newCollName, setNewCollName] = useState('');
  const [revymeCollections, setRevymeCollections] = useState([]);
  const [selectedRevymeSlug, setSelectedRevymeSlug] = useState('');
  const [revymeFields, setRevymeFields] = useState([]);

  // Field validation / diff
  const [missingFields, setMissingFields] = useState([]);
  const [mergeChoice, setMergeChoice] = useState('merge'); // 'merge' | 'switch-new'

  // Step 3: Syncing
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState('');

  // Load saved credentials on mount
  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem('revyme:directus:url');
      const savedToken = localStorage.getItem('revyme:directus:token');
      if (savedUrl) setUrl(savedUrl);
      if (savedToken) setToken(savedToken);
    } catch {}
  }, []);

  // Fetch Revyme CMS collections
  const loadRevymeCollections = async () => {
    try {
      const list = await plugin.revyme.cms.getCollections();
      setRevymeCollections(list || []);
      if (list && list.length > 0 && !selectedRevymeSlug) {
        setSelectedRevymeSlug(list[0].id);
      }
    } catch {}
  };

  // Fetch helper that transparently falls back to local server-side proxy
  // if the remote Directus server blocks browser requests with CORS
  const directusFetch = async (targetUrl, init = {}) => {
    try {
      const res = await fetch(targetUrl, init);
      return res;
    } catch {
      // Browser CORS blocked the request -> route through self-host server proxy
      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          method: init.method || 'GET',
          headers: init.headers || {},
          body: init.body,
        }),
      });
      return proxyRes;
    }
  };

  // Connect to Directus
  const handleConnect = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    setSyncSuccess('');
    const cleanUrl = url.trim().replace(/\\/+$/, '');

    try {
      const headers = {};
      if (token.trim()) headers['Authorization'] = \`Bearer \${token.trim()}\`;

      const res = await directusFetch(\`\${cleanUrl}/collections\`, { headers });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          const errJson = await res.json().catch(() => null);
          const msg = errJson?.errors?.[0]?.message || 'Access denied (403/401). Please enter a valid Directus API Token with permissions to read collections.';
          throw new Error(msg);
        }
        throw new Error(\`Directus returned HTTP \${res.status}\`);
      }
      const json = await res.json();
      const colls = (json.data || []).filter(c => !c.collection.startsWith('directus_'));
      if (colls.length === 0) throw new Error('No user collections found in Directus');

      setDirectusCollections(colls);
      setSelectedDirectusColl(colls[0].collection);
      setNewCollName(colls[0].name || colls[0].collection);
      setConnected(true);

      // Save credentials
      try {
        localStorage.setItem('revyme:directus:url', cleanUrl);
        localStorage.setItem('revyme:directus:token', token.trim());
      } catch {}

      await loadRevymeCollections();
    } catch (err) {
      setError(err.message || 'Failed to connect to Directus');
    } finally {
      setLoading(false);
    }
  };

  // When Directus collection changes, load its fields
  useEffect(() => {
    if (!connected || !selectedDirectusColl) return;
    const cleanUrl = url.trim().replace(/\\/+$/, '');
    const headers = {};
    if (token.trim()) headers['Authorization'] = \`Bearer \${token.trim()}\`;

    setFetchingFields(true);
    directusFetch(\`\${cleanUrl}/fields/\${selectedDirectusColl}\`, { headers })
      .then(r => r.json())
      .then(json => {
        const fields = (json.data || []).filter(f => !f.field.startsWith('directus_') && !['sort', 'user_created', 'date_created', 'user_updated', 'date_updated'].includes(f.field));
        setDirectusFields(fields);
        const col = directusCollections.find(c => c.collection === selectedDirectusColl);
        if (col) setNewCollName(col.name || col.collection);
      })
      .catch(() => {})
      .finally(() => setFetchingFields(false));
  }, [connected, selectedDirectusColl, url, token]);

  // When Revyme collection selected, load its existing fields
  useEffect(() => {
    if (targetMode !== 'existing' || !selectedRevymeSlug) return;
    plugin.revyme.cms.getFields({ collectionId: selectedRevymeSlug })
      .then(fields => setRevymeFields(fields || []))
      .catch(() => setRevymeFields([]));
  }, [targetMode, selectedRevymeSlug]);

  // Compare Directus fields with Revyme fields
  useEffect(() => {
    if (targetMode !== 'existing') {
      setMissingFields([]);
      return;
    }

    const revymeFieldNames = new Set(revymeFields.map(f => (f.name || f.id).toLowerCase()));
    const missing = [];

    for (const df of directusFields) {
      const name = df.field.toLowerCase();
      if (!revymeFieldNames.has(name)) {
        missing.push(df);
      }
    }
    setMissingFields(missing);
  }, [targetMode, directusFields, revymeFields]);

  // Map Directus field types to Revyme CMS types
  const mapFieldType = (df) => {
    const dt = (df.type || '').toLowerCase();
    const iface = (df.meta?.interface || '').toLowerCase();
    if (['integer', 'biginteger', 'float', 'decimal'].includes(dt)) return 'number';
    if (dt === 'boolean') return 'boolean';
    if (['date', 'datetime', 'timestamp', 'time'].includes(dt)) return 'date';
    if (iface.includes('image') || dt === 'file' || iface.includes('file')) return 'image';
    if (iface.includes('wysiwyg') || iface.includes('markdown') || dt === 'text') return 'rich-text';
    return 'string';
  };

  // Start Sync
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError('');
    setSyncSuccess('');
    const cleanUrl = url.trim().replace(/\\/+$/, '');
    const headers = {};
    if (token.trim()) headers['Authorization'] = \`Bearer \${token.trim()}\`;

    try {
      let targetSlug = selectedRevymeSlug;

      // 1. If New Collection
      if (targetMode === 'new') {
        const name = newCollName.trim() || selectedDirectusColl;
        targetSlug = await plugin.revyme.cms.createCollection({ name });

        // Add fields
        const fieldsToAdd = directusFields.map(f => ({
          name: f.field,
          type: mapFieldType(f),
          required: false,
        }));
        if (fieldsToAdd.length > 0) {
          await plugin.revyme.cms.addFields({ collectionId: targetSlug, fields: fieldsToAdd });
        }
      } else {
        // 2. Existing Collection
        if (missingFields.length > 0 && mergeChoice === 'merge') {
          const fieldsToAdd = missingFields.map(f => ({
            name: f.field,
            type: mapFieldType(f),
            required: false,
          }));
          await plugin.revyme.cms.addFields({ collectionId: targetSlug, fields: fieldsToAdd });
        }
      }

      // 3. Fetch Items from Directus
      const itemsRes = await directusFetch(\`\${cleanUrl}/items/\${selectedDirectusColl}?limit=-1\`, { headers });
      if (!itemsRes.ok) throw new Error(\`Failed to fetch Directus items: \${itemsRes.status}\`);
      const itemsJson = await itemsRes.json();
      const rawItems = itemsJson.data || [];

      // 4. Map & Add Items into Revyme CMS
      const mappedItems = rawItems.map(item => {
        const slug = item.slug || item.title || item.name || \`item-\${item.id}\`;
        const cleanSlug = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || \`item-\${Date.now()}\`;
        const fieldData = {};

        for (const [k, v] of Object.entries(item)) {
          if (v === null || v === undefined) continue;
          // Image/file expansion
          const df = directusFields.find(f => f.field === k);
          if (df && mapFieldType(df) === 'image' && typeof v === 'string') {
            fieldData[k] = \`\${cleanUrl}/assets/\${v}\`;
          } else {
            fieldData[k] = v;
          }
        }

        return { slug: cleanSlug, fieldData };
      });

      if (mappedItems.length > 0) {
        await plugin.revyme.cms.addItems({ collectionId: targetSlug, items: mappedItems });
      }

      setSyncSuccess(\`Successfully synced \${mappedItems.length} items into collection "\${targetSlug}"!\`);
      plugin.revyme.ui?.notify?.(\`Directus sync complete (\${mappedItems.length} items)\`, 'success');
      await loadRevymeCollections();
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: 14, fontFamily: 'system-ui, sans-serif', fontSize: 12, color: '#f4f4f5' }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
        <div style={{ width: 22, height: 22, background: '#6644ff', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 13, color: '#fff' }}>D</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Directus CMS Sync</div>
          <div style={{ fontSize: 10, opacity: 0.6 }}>Import & sync collections into Revyme</div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 8, borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', marginBottom: 10, fontSize: 11 }}>
          {error}
        </div>
      )}

      {syncSuccess && (
        <div style={{ padding: 8, borderRadius: 6, background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#6ee7b7', marginBottom: 10, fontSize: 11 }}>
          {syncSuccess}
        </div>
      )}

      {/* Screen 1: Connect */}
      {!connected ? (
        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, opacity: 0.8, fontSize: 11 }}>Directus URL</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="http://localhost:8055"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 4, background: '#27272a', border: '1px solid #3f3f46', color: '#fff', fontSize: 12 }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, opacity: 0.8, fontSize: 11 }}>API Token (Optional)</label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Bearer Token"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 4, background: '#27272a', border: '1px solid #3f3f46', color: '#fff', fontSize: 12 }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: 6, padding: '7px 12px', background: '#eab308', color: '#000', fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Connecting...' : 'Connect to Directus'}
          </button>
        </form>
      ) : (
        /* Screen 2: Configuration */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Source Collection */}
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 11, color: '#eab308' }}>1. Directus Source Collection</label>
            <select
              value={selectedDirectusColl}
              onChange={e => setSelectedDirectusColl(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: 4, background: '#27272a', border: '1px solid #3f3f46', color: '#fff', fontSize: 12 }}
            >
              {directusCollections.map(c => (
                <option key={c.collection} value={c.collection}>{c.name || c.collection} ({c.collection})</option>
              ))}
            </select>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3 }}>
              {fetchingFields ? 'Inspecting schema...' : \`\${directusFields.length} field(s) detected\`}
            </div>
          </div>

          {/* Target in Revyme */}
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 11, color: '#eab308' }}>2. Revyme Target Collection</label>
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11 }}>
                <input
                  type="radio"
                  name="mode"
                  checked={targetMode === 'new'}
                  onChange={() => setTargetMode('new')}
                />
                Create New
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11 }}>
                <input
                  type="radio"
                  name="mode"
                  checked={targetMode === 'existing'}
                  onChange={() => setTargetMode('existing')}
                />
                Import to Existing
              </label>
            </div>

            {targetMode === 'new' ? (
              <div>
                <label style={{ display: 'block', marginBottom: 4, opacity: 0.8, fontSize: 11 }}>New Collection Name</label>
                <input
                  type="text"
                  value={newCollName}
                  onChange={e => setNewCollName(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 4, background: '#27272a', border: '1px solid #3f3f46', color: '#fff', fontSize: 12 }}
                />
                <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>
                  All {directusFields.length} field(s) will be created automatically matching Directus types.
                </div>
              </div>
            ) : (
              <div>
                <label style={{ display: 'block', marginBottom: 4, opacity: 0.8, fontSize: 11 }}>Select Existing Collection</label>
                {revymeCollections.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#fca5a5' }}>No collections exist in Revyme yet. Please select &quot;Create New&quot;.</div>
                ) : (
                  <select
                    value={selectedRevymeSlug}
                    onChange={e => setSelectedRevymeSlug(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 4, background: '#27272a', border: '1px solid #3f3f46', color: '#fff', fontSize: 12 }}
                  >
                    {revymeCollections.map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.id}</option>
                    ))}
                  </select>
                )}

                {/* Field Validation & Mismatch Warning */}
                {missingFields.length === 0 ? (
                  <div style={{ marginTop: 8, padding: 6, borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#6ee7b7', fontSize: 10 }}>
                    ✓ All Directus fields match this collection.
                  </div>
                ) : (
                  <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#fde68a', fontSize: 11 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠️ Missing {missingFields.length} field(s) in Revyme:</div>
                    <div style={{ fontSize: 10, opacity: 0.9, marginBottom: 8 }}>
                      {missingFields.map(f => f.field).join(', ')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="mergeChoice"
                          checked={mergeChoice === 'merge'}
                          onChange={() => setMergeChoice('merge')}
                        />
                        <span><strong>Add missing fields & Merge</strong> (recommended)</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setTargetMode('new')}
                        style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 10 }}
                      >
                        Unsure? Switch to New Collection instead &rarr;
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sync Button & Disconnect */}
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || (targetMode === 'existing' && revymeCollections.length === 0)}
              style={{ flex: 1, padding: '8px 12px', background: '#eab308', color: '#000', fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', opacity: syncing ? 0.7 : 1 }}
            >
              {syncing ? 'Syncing...' : 'Sync Collection Now'}
            </button>
            <button
              type="button"
              onClick={() => setConnected(false)}
              style={{ padding: '8px 10px', background: '#27272a', color: '#aaa', border: '1px solid #3f3f46', borderRadius: 4, cursor: 'pointer' }}
            >
              Change Server
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const plugin = await createPlugin({ pluginId: 'local.directussync' });
createRoot(document.getElementById('root')).render(<App plugin={plugin} />);
`;
