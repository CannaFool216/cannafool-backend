// Base URL for your backend — update this when deployed
const BASE_URL = 'http://192.168.1.192:8000';

/**
 * Send a COA document URL to the backend for parsing and extraction.
 * Returns structured COA data: THC, CBD, terpenes, batch number.
 */
export async function parseCOA(documentUrl) {
  const response = await fetch(`${BASE_URL}/parse-coa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: documentUrl }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to parse COA');
  }

  return response.json();
}
