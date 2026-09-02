'use client';

import { useEffect, useRef, useState } from 'react';
import { RGSClient } from 'stake-engine';

type JsonValue = unknown;
type Client = ReturnType<typeof RGSClient>;

export default function RgsTestPage() {
  const clientRef = useRef<Client | null>(null);
  const [authResult, setAuthResult] = useState<JsonValue>(null);
  const [playResult, setPlayResult] = useState<JsonValue>(null);
  const [actionResult, setActionResult] = useState<JsonValue>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    clientRef.current = RGSClient({ url: window.location.href });
    void handleAuthenticate();
  }, []);

  async function handleAuthenticate() {
    setLoading(true);
    setError('');

    try {
      if (!clientRef.current) {
        clientRef.current = RGSClient({ url: window.location.href });
      }
      const response = await clientRef.current.Authenticate();
      setAuthResult(response);
    } catch (err) {
      console.error('AUTH ERROR:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePlay() {
    setLoading(true);
    setError('');
    setActionResult(null);

    try {
      if (!clientRef.current) {
        throw new Error('RGS client not initialized');
      }
      const response = await clientRef.current.Play({
        amount: 1000000,
        mode: 'base',
      });
      setPlayResult(response);
    } catch (err) {
      console.error('PLAY ERROR:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision() {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams(window.location.search);
      const sessionID = params.get('sessionID');
      const rgsUrl = params.get('rgs_url');

      if (!sessionID || !rgsUrl) {
        throw new Error('sessionID ou rgs_url manquant dans URL');
      }

      const response = await fetch(`https://${rgsUrl}/bet/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionID,
          action: 'DECISION',
          meta: {
            cell: 7,
          },
        }),
      });

      const text = await response.text();
      console.log('ACTION HTTP STATUS:', response.status);
      console.log('ACTION RAW:', text);

      try {
        setActionResult(JSON.parse(text));
      } catch {
        setActionResult({
          httpStatus: response.status,
          raw: text,
        });
      }
    } catch (err) {
      console.error('ACTION ERROR:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: '40px auto', padding: 24, fontFamily: 'monospace' }}>
      <h1>Vault Mines — RGS Test</h1>
      <p>
        Diagnostic page for Authenticate, Play and the stateful /bet/action DECISION endpoint.
        Do not EndRound before testing DECISION.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        <button onClick={handleAuthenticate} disabled={loading} style={{ padding: '12px 20px' }}>
          Authenticate
        </button>
        <button onClick={handlePlay} disabled={loading || !authResult} style={{ padding: '12px 20px' }}>
          Play 1 USD
        </button>
        <button onClick={handleDecision} disabled={loading || !playResult} style={{ padding: '12px 20px' }}>
          DECISION cell 7
        </button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <pre style={{ whiteSpace: 'pre-wrap' }}>ERROR: {error}</pre>}

      <h2>AUTH</h2>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(authResult, null, 2)}
      </pre>

      <h2>PLAY</h2>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(playResult, null, 2)}
      </pre>

      <h2>ACTION</h2>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {JSON.stringify(actionResult, null, 2)}
      </pre>
    </main>
  );
}
