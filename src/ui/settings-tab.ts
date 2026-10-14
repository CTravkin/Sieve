import {Notice,PluginSettingTab,Setting,getLanguage} from 'obsidian';
import type {App,ButtonComponent,TextAreaComponent,TextComponent} from 'obsidian';
import type SievePlugin from '../main.ts';
import type {SettingsError} from '../settings/storage.ts';
import {defaultSettings,sameSettings} from '../settings/model.ts';
import type {SieveSettings} from '../settings/model.ts';
import {locale,settingsErrorMessages} from '../i18n/index.ts';
import {SyntaxHelpModal} from './syntax-help.ts';
import {ReloadOfferModal} from './reload-offer.ts';
import {statusLines} from './status.ts';

export class SieveSettingsTab extends PluginSettingTab {
  private draft:SieveSettings=defaultSettings();
  private unsubscribe?:()=>void;
  private statusEl?:HTMLElement;
  private errorsEl?:HTMLElement;
  private rules?:TextAreaComponent;
  private displayName?:TextComponent;
  private saveButton?:ButtonComponent;
  private saving=false;
  private visible=false;
  private hydrated=false;
  private observedSaved?:SieveSettings;
  private displayedBaseline:SieveSettings=defaultSettings();
  private saveError?:SettingsError;
  private help?:SyntaxHelpModal;
  private reloadOffer?:ReloadOfferModal;
  constructor(app:App,private readonly sieve:SievePlugin){super(app,sieve);}
  display():void {
    this.unsubscribe?.();this.visible=true;
    if(!this.hydrated)this.draft=this.sieve.draftSettings??defaultSettings();
    const text=locale(getLanguage()).settings;const container=this.containerEl;container.empty();container.addClass('sieve-settings');
    container.createEl('h2',{text:text.title});container.createEl('p',{text:text.description});
    const rulesSetting=new Setting(container).setName(text.rulesLabel).setDesc(text.rulesDescription).setClass('sieve-rules-setting');
    rulesSetting.descEl.setAttr('id','sieve-rules-description');
    rulesSetting.addTextArea(input=>{
      this.rules=input;input.setValue(this.draft.rules).setDisabled(this.saving).onChange(value=>this.edit({...this.draft,rules:value}));
      input.inputEl.setAttr('aria-label',text.rulesLabel);input.inputEl.setAttr('aria-describedby','sieve-rules-description sieve-settings-errors');input.inputEl.setAttr('spellcheck','false');input.inputEl.rows=12;input.inputEl.wrap='off';
    });
    new Setting(container).setName(text.syntaxLabel).setDesc(text.syntaxSummary).addButton(button=>button.setButtonText(text.openHelp).onClick(()=>{this.help?.close();this.help=new SyntaxHelpModal(this.app);this.help.open();}));
    const nameSetting=new Setting(container).setName(text.displayNameLabel).setDesc(text.displayNameDescription).setClass('sieve-display-name-setting');
    nameSetting.descEl.setAttr('id','sieve-display-name-description');
    nameSetting.addText(input=>{
      this.displayName=input;input.setValue(this.draft.displayName).setDisabled(this.saving).onChange(value=>this.edit({...this.draft,displayName:value}));input.inputEl.setAttr('aria-label',text.displayNameLabel);input.inputEl.setAttr('aria-describedby','sieve-display-name-description');
    });
    this.statusEl=container.createEl('div',{cls:'sieve-status',attr:{role:'status','aria-live':'polite','aria-atomic':'true'}});
    this.errorsEl=container.createEl('div',{cls:'sieve-errors',attr:{id:'sieve-settings-errors',role:'alert','aria-live':'assertive'}});
    new Setting(container).addButton(button=>{this.saveButton=button;button.setButtonText(text.save).setCta().setDisabled(this.saving).onClick(()=>this.save());});
    this.unsubscribe=this.sieve.subscribeStatus(()=>this.refresh());this.refresh();
  }
  private edit(draft:SieveSettings):void {
    if(this.saving||!this.hydrated||this.sieve.getStatus().status==='loading')return;
    this.draft=draft;this.saveError=undefined;this.sieve.setDraftSettings(draft);this.refresh();
  }
  private refresh():void {
    if(!this.visible)return;
    const status=this.sieve.getStatus();const language=getLanguage();
    const serviceDraft=this.sieve.draftSettings;const saved=this.sieve.savedSettings;
    const blocked=this.saving||status.status==='loading'||status.status==='disposed'||!serviceDraft;
    if(status.status!=='loading'&&status.status!=='disposed'&&serviceDraft){
      // First hydrate only after startup. Later, follow external saves only when
      // the form is clean; status changes must never overwrite entered edits.
      if(!this.hydrated||(!this.saving&&!sameSettings(saved,this.observedSaved)&&sameSettings(this.draft,this.displayedBaseline))){
        this.draft=serviceDraft;this.displayedBaseline=serviceDraft;this.hydrated=true;this.rules?.setValue(this.draft.rules);this.displayName?.setValue(this.draft.displayName);
      }
      this.observedSaved=saved;
    }
    this.statusEl?.empty();for(const line of statusLines(status,this.sieve.savedSettings,this.draft,language))this.statusEl?.createEl('p',{text:line});
    const error=this.saveError??(status.errorCode?{code:status.errorCode,diagnostics:status.diagnostics}:undefined);
    this.errorsEl?.empty();if(error)for(const message of settingsErrorMessages(error,language))this.errorsEl?.createEl('p',{text:message});
    this.rules?.inputEl.setAttr('aria-invalid',String(error?.code==='rules'));
    this.saveButton?.setDisabled(blocked);
    this.rules?.setDisabled(blocked);this.displayName?.setDisabled(blocked);
  }
  private async save():Promise<void> {
    if(this.saving||!this.hydrated||this.sieve.getStatus().status==='loading')return;
    this.saving=true;this.saveError=undefined;this.refresh();
    const candidate=this.draft;
    try {
      const result=await this.sieve.saveSettings(candidate);
      if(!result.ok){this.saveError=result.error;return;}
      this.displayedBaseline=candidate;
      if(!this.visible||this.sieve.getStatus().status==='disposed')return;
      new Notice(locale(getLanguage()).messages.saved);
      if(result.pending||this.sieve.getStatus().pendingReload){
        this.reloadOffer?.close();this.reloadOffer=new ReloadOfferModal(this.app,()=>this.sieve.reloadVault());this.reloadOffer.open();
      }
    }catch{this.saveError={code:'write'};}
    finally{
      this.saving=false;
      // Keep entered draft on errors. Controls were disabled during validation/write.
      if(!sameSettings(this.sieve.draftSettings,this.draft))this.sieve.setDraftSettings(this.draft);
      this.refresh();
    }
  }
  hide():void {this.visible=false;this.unsubscribe?.();this.unsubscribe=undefined;this.help?.close();this.help=undefined;this.reloadOffer?.close();this.reloadOffer=undefined;}
}
