const BASE_URL = 'http://192.168.1.192:8000';

export async function parseCOA(documentUrl: string) {
  const response = await fetch(`${BASE_URL}/parse-coa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: documentUrl }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as any).detail || 'Failed to parse COA');
  }

  return response.json();
}
