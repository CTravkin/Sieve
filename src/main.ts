import {Plugin,Notice,Platform as HostPlatform,getLanguage} from 'obsidian';
import type {Platform,Diagnostic} from './core/types.ts';
import {SettingsService} from './settings/storage.ts';
import type {SaveResult,SettingsError} from './settings/storage.ts';
import type {SieveSettings} from './settings/model.ts';
import {installFilter} from './platform/lifecycle.ts';
import type {FilterInstallation,PrivateAdapter,RuntimeApp} from './platform/contracts.ts';
import {messages} from './i18n/index.ts';
import {SieveSettingsTab} from './ui/settings-tab.ts';

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
  private readonly listeners=new Set<()=>void>();
  get savedSettings():SieveSettings|undefined {return this.service?.state.saved;}
  get activeSettings():SieveSettings|undefined {return this.runtime?.phase==='applied'?this.service?.state.active:undefined;}
  get draftSettings():SieveSettings|undefined {return this.service?.state.draft;}
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
    this.runtime?.dispose();this.service?.dispose();this.runtime=undefined;
    this.settingsTab?.hide();this.settingsTab=new SieveSettingsTab(this.app,this);this.addSettingTab(this.settingsTab);
    const platform=hostPlatform();
    if(!platform){this.state='unsupported';new Notice(messages(getLanguage()).unsupportedVersion);return;}
    const adapter=this.app.vault.adapter;
    const privateAdapter=adapter as unknown as PrivateAdapter;
    const reader=platform==='ios'||platform==='android'?(await import('./platform/mobile.ts')).mobileIncludeReader(privateAdapter):(await import('./platform/desktop.ts')).desktopIncludeReader(privateAdapter);
    if(this.disposed || generation!==this.generation)return;
    this.service=new SettingsService({platform,configDir:this.app.vault.configDir,io:{exists:path=>adapter.exists(path),read:path=>adapter.read(path),write:(path,value)=>adapter.write(path,value)},readInclude:reader,onChange:()=>this.changed()});
    const startup=await this.service.startup();
    if(this.disposed || generation!==this.generation)return;
    if(!startup.ok){this.state='unfiltered';new Notice(messages(getLanguage()).configurationError);this.changed();return;}
    this.runtime=installFilter(this.app as unknown as RuntimeApp,startup.compiled.matcher,platform,{onChange:()=>this.changed()});
    this.state=this.runtime.phase;
    if(this.runtime.status==='unsupported')new Notice(messages(getLanguage()).unsupportedVersion);
    else if(this.runtime.status==='ready' && startup.fallback)new Notice(messages(getLanguage()).fallbackUsed);
    this.changed();
  }
  async saveSettings(candidate:unknown):Promise<SaveResult> {
    if(!this.service || this.disposed || this.state==='loading')return{ok:false,error:{code:'cancelled'}};
    return this.service.save(candidate);
  }
  setDraftSettings(candidate:SieveSettings):void {if(!this.disposed && this.state!=='loading')this.service?.setDraft(candidate);}
  reloadVault():void {if(!this.disposed)window.location.reload();}
  async onExternalSettingsChange():Promise<void> {
    if(!this.service || this.disposed)return;
    const result=await this.service.externalChange();if(this.disposed)return;
    if(!result.ok)new Notice(messages(getLanguage()).externalError);this.changed();
  }
  onunload():void {this.disposed=true;this.generation++;this.settingsTab?.hide();this.service?.dispose();this.runtime?.dispose();this.listeners.clear();}
}
