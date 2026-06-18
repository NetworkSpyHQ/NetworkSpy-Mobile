export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS';

export interface TrafficEntry {
  id: string;
  method: HttpMethod;
  url: string;
  host: string;
  path: string;
  statusCode: number;
  duration: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody: string | null;
  responseBody: string | null;
  timestamp: number;
  isSecure: boolean;
  contentType: string | null;
  responseSize: number;
  error: string | null;
}
