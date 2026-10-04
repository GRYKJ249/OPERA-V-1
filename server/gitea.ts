export class GiteaError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, status?: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = 'GiteaError';
  }
}

type GiteaConfig = { baseUrl: URL; token: string };

function configFromEnv(env: NodeJS.ProcessEnv = process.env): GiteaConfig | null {
  const rawUrl = env.GITEA_API_BASE_URL?.trim();
  const token = env.GITEA_ADMIN_TOKEN?.trim();
  if (!rawUrl || !token) return null;

  try {
    const baseUrl = new URL(rawUrl);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) return null;
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;
    return { baseUrl, token };
  } catch {
    return null;
  }
}

export function isGiteaConfigured(): boolean {
  return configFromEnv() !== null;
}

export async function giteaStatus(): Promise<{ configured: boolean; reachable: boolean }> {
  const config = configFromEnv();
  if (!config) return { configured: false, reachable: false };

  try {
    const response = await fetch(new URL('version', config.baseUrl), {
      headers: { Authorization: `token ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    return { configured: true, reachable: response.ok };
  } catch {
    return { configured: true, reachable: false };
  }
}

export type CreatedGiteaRepository = {
  id: number;
  owner: string;
  name: string;
  cloneUrl: string;
  htmlUrl: string;
  isPrivate: true;
};

export async function createGiteaRepository(name: string, description: string): Promise<CreatedGiteaRepository> {
  const config = configFromEnv();
  if (!config) throw new GiteaError('gitea_not_configured');
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name)) throw new GiteaError('invalid_repository_name');

  let response: Response;
  try {
    response = await fetch(new URL('user/repos', config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `token ${config.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description: description.slice(0, 350), private: true, auto_init: false }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GiteaError('gitea_unreachable');
  }

  if (response.status === 409) throw new GiteaError('repository_exists', 409);
  if (!response.ok) throw new GiteaError('gitea_request_failed', response.status);

  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new GiteaError('gitea_invalid_response');
  }

  const id = Number(data?.id);
  const owner = String(data?.owner?.login ?? '');
  const cloneUrl = String(data?.clone_url ?? '');
  const htmlUrl = String(data?.html_url ?? '');
  if (!Number.isSafeInteger(id) || id <= 0 || !owner || data?.name !== name || !cloneUrl || !htmlUrl) {
    throw new GiteaError('gitea_invalid_response');
  }
  if (data?.private !== true) throw new GiteaError('gitea_unexpected_visibility');

  return { id, owner, name, cloneUrl, htmlUrl, isPrivate: true };
}
