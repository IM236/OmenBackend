import { fetch } from 'undici';

import { AppConfig } from '@config';
import { ApplicationError } from '@lib/errors';

export interface AuthorizationRequest {
  principalId: string;
  principalType?: string;
  entityId: string;
  action: string;
  context?: Record<string, unknown>;
}

export interface AuthorizationResponse {
  allowed: boolean;
  reasons: string[];
  effectiveRoles: string[];
}

export class EntityPermissionsClient {
  private readonly baseUrl = AppConfig.permissionsService.baseUrl;
  private readonly apiKey = AppConfig.permissionsService.apiKey;

  async authorize(
    request: AuthorizationRequest
  ): Promise<AuthorizationResponse> {
    const response = await fetch(`${this.baseUrl}/authorize`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(AppConfig.permissionsService.timeoutMs)
    });

    if (!response.ok) {
      throw new ApplicationError('Entity permissions service error', {
        statusCode: response.status,
        code: 'permissions_service_error',
        details: { statusText: response.statusText }
      });
    }

    return (await response.json()) as AuthorizationResponse;
  }

  private buildHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }
}

export const entityPermissionsClient = new EntityPermissionsClient();
