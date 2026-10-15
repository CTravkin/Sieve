// SPDX-License-Identifier: MPL-2.0
import {Plugin,Notice,Platform as HostPlatform,getLanguage} from 'obsidian';
import type {Platform,Diagnostic} from './core/types.ts';
import {SettingsService} from './settings/storage.ts';
import type {SaveResult,SettingsError,ValidationResult} from './settings/storage.ts';
import type {SieveSettings} from './settings/model.ts';
import {installFilter} from './platform/lifecycle.ts';
import type {FilterInstallation,PrivateAdapter,RuntimeApp} from './platform/contracts.ts';
import {messages} from './i18n/index.ts';
import {SieveSettingsTab} from './ui/settings-tab.ts';
import {localizeManifestDescription} from './ui/manifest-description.ts';
import {installAliases} from './alias/projection.ts';
import type {AliasApp,AliasInstallation,AliasCapabilities} from './alias/contracts.ts';

export interface PluginStatus {
  readonly status:'loading'|'pending'|'applied'|'unsupported'|'unfiltered'|'error'|'disposed';
  readonly revision?:string;
  readonly fallback:boolean;
  readonly pendingReload:boolean;
  readonly diagnostics:readonly Diagnostic[];
  readonly errorCode?:SettingsError['code'];
  readonly initial:{readonly started:boolean;readonly completed:boolean;readonly layoutReady:boolean};
}
function hostPlatform():Platform|undefined {
  if(HostPlatform.isIosApp)return 'ios';if(HostPlatform.isAndroidApp)return 'android';
  if(HostPlatform.isDesktopApp){if(HostPlatform.isWin)return 'windows';if(HostPlatform.isMacOS)return 'darwin';if(HostPlatform.isLinux)return 'linux';}
  return undefined;
}

export default class SievePlugin extends Plugin {
  private service?:SettingsService;
  private runtime?:FilterInstallation;
  private generation=0;
  private disposed=false;
  private state:PluginStatus['status']='loading';
  private runtimeErrorNotified=false;
  private settingsTab?:SieveSettingsTab;
  private restoreDescription?:()=>void;
  private readonly listeners=new Set<()=>void>();
  private aliases?:AliasInstallation;
  private aliasName='';
  getAliasCapabilities():AliasCapabilities|undefined {return this.aliases?.capabilities;}
  get savedSettings():SieveSettings|undefined {return this.service?.state.saved;}
  get activeSettings():SieveSettings|undefined {return this.runtime?.phase==='applied'?this.service?.state.active:undefined;}
  get draftSettings():SieveSettings|undefined {return this.service?.state.draft;}
  get needsSettingsRecovery():boolean {return this.service?.state.needsRecovery??false;}
  getStatus():PluginStatus {
    const settings=this.service?.state;
    const status=this.disposed?'disposed':this.runtime?.status==='unsupported'?'unsupported':this.runtime?.status==='error'?'error':this.runtime?.phase??this.state;
    return Object.freeze({status,revision:settings?.activeRevision,fallback:settings?.fallback??false,pendingReload:(settings?.pending??false)||(this.runtime?.reloadNeeded??false),diagnostics:settings?.error?.diagnostics??Object.freeze([]),errorCode:settings?.error?.code,initial:Object.freeze({started:this.runtime?.initialStarted??false,completed:this.runtime?.initialCompleted??false,layoutReady:this.runtime?.layoutReady??this.app.workspace.layoutReady})});
  }
  subscribeStatus(listener:()=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private changed():void {
    if(this.disposed)return;
    if(this.runtime?.phase==='applied')this.service?.confirmActive();
    if(this.runtime?.phase==='error' && !this.runtimeErrorNotified){this.runtimeErrorNotified=true;new Notice(messages(getLanguage()).runtimeError);}
    for(const listener of this.listeners)try{listener();}catch{/* UI observers cannot break filesystem operations. */}
  }
  async onload():Promise<void> {
    const generation=++this.generation;this.disposed=false;this.state='loading';this.runtimeErrorNotified=false;
    this.restoreDescription?.();this.restoreDescription=localizeManifestDescription(this.manifest,getLanguage);
    this.aliases?.dispose();this.aliases=undefined;this.aliasName='';
    this.runtime?.dispose();this.service?.dispose();this.runtime=undefined;
    this.settingsTab?.hide();this.settingsTab=new SieveSettingsTab(this.app,this);this.addSettingTab(this.settingsTab);
    const platform=hostPlatform();
    if(!platform){this.state='unsupported';new Notice(messages(getLanguage()).unsupportedVersion);return;}
    const adapter=this.app.vault.adapter;
    const privateAdapter=adapter as unknown as PrivateAdapter;
    const mobile=platform==='ios'||platform==='android';
    const provider=mobile?await import('./platform/mobile.ts'):await import('./platform/desktop.ts');
    const reader=mobile?(provider as typeof import('./platform/mobile.ts')).mobileIncludeReader(privateAdapter):(provider as typeof import('./platform/desktop.ts')).desktopIncludeReader(privateAdapter);
    if(this.disposed || generation!==this.generation)return;
    this.service=new SettingsService({platform,configDir:this.app.vault.configDir,io:{exists:path=>adapter.exists(path),read:path=>adapter.read(path),write:(path,value)=>adapter.write(path,value)},readInclude:reader,onChange:()=>this.changed()});
    const startup=await this.service.startup();
    if(this.disposed || generation!==this.generation)return;
    this.aliasName=startup.ok?this.service.state.active?.displayName??'':'';
    this.app.workspace.onLayoutReady(()=>{
      if(this.disposed || generation!==this.generation)return;
      const source=mobile?(provider as typeof import('./platform/mobile.ts')).mobileAliasProvider(privateAdapter,this.app.vault.configDir):(provider as typeof import('./platform/desktop.ts')).desktopAliasProvider(privateAdapter,(this.app as unknown as AliasApp).appId,this.app.vault.configDir);
      try{this.aliases=installAliases(this.app as unknown as AliasApp,source,()=>this.aliasName);}catch{/* Alias capabilities cannot disable filtering or settings. */}
    });
    if(!startup.ok){this.state='unfiltered';new Notice(messages(getLanguage()).configurationError);this.changed();return;}
    this.runtime=installFilter(this.app as unknown as RuntimeApp,startup.compiled.matcher,platform,{onChange:()=>this.changed()});
    this.state=this.runtime.phase;
    if(this.runtime.status==='unsupported')new Notice(messages(getLanguage()).unsupportedVersion);
    else if(this.runtime.status==='ready' && startup.fallback)new Notice(messages(getLanguage()).fallbackUsed);
    this.changed();
  }
  async saveSettings(candidate:unknown):Promise<SaveResult> {
    if(!this.service || this.disposed || this.state==='loading')return{ok:false,error:{code:'cancelled'}};
    const result=await this.service.save(candidate);
    if(result.ok && !this.disposed){this.aliasName=this.service.state.saved?.displayName??this.aliasName;this.aliases?.refresh();}
    return result;
  }
  setDraftSettings(candidate:SieveSettings):void {if(!this.disposed && this.state!=='loading')this.service?.setDraft(candidate);}
  resetDraftSettings():void {if(!this.disposed && this.state!=='loading')this.service?.resetDraft();}
  validateSettings(candidate:unknown):Promise<ValidationResult> {
    if(!this.service || this.disposed || this.state==='loading')return Promise.resolve({ok:false,error:{code:'cancelled'}});
    return this.service.validate(candidate);
  }
  reloadVault():void {if(!this.disposed)window.location.reload();}
  async onExternalSettingsChange():Promise<void> {
    if(!this.service || this.disposed)return;
    const result=await this.service.externalChange();if(this.disposed)return;
    if(!result.ok)new Notice(messages(getLanguage()).externalError);
    else {this.aliasName=this.service.state.saved?.displayName??this.aliasName;this.aliases?.refresh();}
    this.changed();
  }
  onunload():void {this.disposed=true;this.generation++;this.restoreDescription?.();this.aliases?.dispose();this.settingsTab?.hide();this.service?.dispose();this.runtime?.dispose();this.listeners.clear();}
}
