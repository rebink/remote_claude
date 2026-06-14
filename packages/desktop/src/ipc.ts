import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { HostRecord } from './host-record.ts';
export interface ProvisionArgs { host: string; user: string; port: number; keyPath: string; agentPort: number; token: string; }
export const startProvision = (args: ProvisionArgs) => invoke('start_provision', { args });
export const sendConsent = (consent: boolean) => invoke('send_consent', { consent });
export const onProvEvent = (cb: (line: string) => void) => listen<string>('pw://prov', (e) => cb(e.payload));
export const onProvEnd = (cb: (code: number | null) => void) => listen<number | null>('pw://prov-end', (e) => cb(e.payload));
export const saveHost = (record: HostRecord) => invoke('save_host', { record });
export const listHosts = () => invoke<HostRecord[]>('list_hosts');
export const deleteHost = (id: string) => invoke<void>('delete_host', { id });
export interface HostArgs { host: string; user: string; port: number; keyPath: string; agentPort: number; }
export const hostHealth = (args: HostArgs) => invoke<string>('host_health', { args });
export const hostUninstall = (args: HostArgs) => invoke<string>('host_uninstall', { args });
export const hostLogs = (args: HostArgs, limit: number) => invoke<string>('host_logs', { args, limit });
