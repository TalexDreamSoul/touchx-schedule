export interface ApiErrorPayload {
  detail?: string;
  message?: string;
}

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const parseErrorMessage = async (response: Response) => {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    if (payload.detail && payload.detail.trim()) {
      return payload.detail.trim();
    }
    if (payload.message && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch {
    return `HTTP ${response.status}`;
  }
  return `HTTP ${response.status}`;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(path, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }
  return (await response.json()) as T;
};

export const apiPost = async <T>(path: string, payload: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });
  if (!response.ok) {
    throw new ApiError(await parseErrorMessage(response), response.status);
  }
  return (await response.json()) as T;
};
