'use client';

import { useState } from 'react';

export default function ClaudeTestPage() {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');

  const handleTestClaude = async () => {
    setLoading(true);
    setError('');
    setResponse('');

    try {
      const res = await fetch('/api/claude-test');
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Request failed');
      }

      setResponse(data.response || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-2xl rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
        <h1 className="text-2xl font-semibold text-gray-900">Claude API Test</h1>
        <p className="mt-2 text-sm text-gray-600">
          버튼을 눌러 Claude API 연결을 확인합니다.
        </p>

        <button
          type="button"
          onClick={handleTestClaude}
          disabled={loading}
          className="mt-6 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Testing...' : 'Test Claude'}
        </button>

        {response ? (
          <div className="mt-6 rounded-lg bg-green-50 p-4 text-sm text-gray-800 ring-1 ring-green-200">
            <div className="mb-2 font-semibold text-green-700">Response</div>
            <pre className="whitespace-pre-wrap font-sans">{response}</pre>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
            <div className="mb-2 font-semibold">Error</div>
            <pre className="whitespace-pre-wrap font-sans">{error}</pre>
          </div>
        ) : null}
      </div>
    </main>
  );
}
