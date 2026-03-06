export type CredentialType = 'api_key' | 'oauth_token' | 'allow_from' | 'pairing' | 'webhook_secret' | 'other';

export interface Credential {
  id: string;
  machineId: string | null;
  name: string;
  credentialType: CredentialType;
  provider: string | null;
  targetFilePath: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialInput {
  machineId?: string;
  name: string;
  credentialType: CredentialType;
  provider?: string;
  value: string;
  targetFilePath?: string;
  description?: string;
}

export interface UpdateCredentialInput {
  name?: string;
  value?: string;
  targetFilePath?: string;
  description?: string;
}
