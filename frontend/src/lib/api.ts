export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues?: ApiIssue[]
  ) {
    super(message);
  }
}

/**
 * Cliente fino sobre fetch. Tudo passa pelo rewrite /api → backend, então o
 * cookie httpOnly viaja same-origin. 401 fora do fluxo de auth manda o
 * usuário de volta para o login.
 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError('Sessão expirada', 401);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (body as { error?: string }).error ?? 'Erro inesperado',
      response.status,
      (body as { issues?: ApiIssue[] }).issues
    );
  }
  return body as T;
}
