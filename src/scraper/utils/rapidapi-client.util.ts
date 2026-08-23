import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

/** GET a RapidAPI endpoint with the standard x-rapidapi-key / x-rapidapi-host headers. */
export async function rapidApiGet<T = unknown>(
  key: string,
  host: string,
  path: string,
  params: Record<string, string> = {},
  axiosConfig: AxiosRequestConfig = {},
): Promise<AxiosResponse<T>> {
  const { headers, ...restConfig } = axiosConfig;
  return axios.get<T>(`https://${host}${path}`, {
    timeout: 30_000,
    params,
    validateStatus: (s) => s >= 200 && s < 400,
    ...restConfig,
    headers: {
      'x-rapidapi-key': key,
      'x-rapidapi-host': host,
      ...headers,
    },
  });
}
