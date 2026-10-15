// SPDX-License-Identifier: MPL-2.0
export interface VaultLabel {readonly path:string;readonly name:string;readonly id?:string;readonly isCurrentVault:boolean}
export interface AliasProvider {
  /** Native order and identities, never a synthetic global registry. */
  list?():readonly VaultLabel[]|undefined;
  read(vault:VaultLabel):Promise<unknown>;
  /** One validated registry/index per projection; no per-file synchronous IPC. */
  snapshot?():AliasSnapshot|undefined;
}
export interface AliasSnapshot {readonly vaults:readonly VaultLabel[];read(vault:VaultLabel):Promise<unknown>;validate():boolean}
export interface AliasCapabilities {readonly activeLabel:boolean;readonly windowTitle:boolean;readonly drawer:boolean;readonly commands:readonly string[]}
export interface AliasInstallation {readonly capabilities:AliasCapabilities;refresh():void;dispose():void}

export interface AliasApp {
  vault:{configDir:string;getName?:()=>string};
  appId?:string;title?:string;getAppTitle?:(...args:unknown[])=>unknown;
  commands?:{commands?:Record<string,{callback?:unknown}>};
  workspace:{onLayoutReady:(callback:()=>void)=>unknown;on?:(event:string,callback:(...args:any[])=>void)=>unknown;offref?:(ref:any)=>void};
}
