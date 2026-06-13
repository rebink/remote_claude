import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { HostRecord } from './host-record.ts';
export interface ProvisionArgs { host: string; user: string; port: number; keyPath: string; agentPort: number; token: string; }
export const startProvision = (args: ProvisionArgs) => invoke('start_provision', { args });
export const sendConsent = (consent: boolean) => invoke('send_consent', { consent });
export const onProvEvent = (cb: (line: string) => void) => listen<string>('pw://prov', (e) => cb(e.payload));
export const onProvEnd = (cb: (code: number | null) => void) => listen<number | null>('pw://prov-end', (e) => cb(e.payload));
export const saveHost = (record: HostRecord) => invoke('save_host', { record });
