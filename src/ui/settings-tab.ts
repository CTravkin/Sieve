import {Notice,PluginSettingTab,Setting,getLanguage,setIcon} from 'obsidian';
import type {App,ButtonComponent,TextAreaComponent,TextComponent} from 'obsidian';
import type SievePlugin from '../main.ts';
import type {SettingsError} from '../settings/storage.ts';
import {defaultSettings,sameSettings} from '../settings/model.ts';
import type {SieveSettings} from '../settings/model.ts';
import {locale,settingsErrorMessages} from '../i18n/index.ts';
import {SyntaxHelpModal} from './syntax-help.ts';
import {ReloadOfferModal} from './reload-offer.ts';
import {statusEntries} from './status.ts';

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
  private validationError?:SettingsError;
  private dismissedStatusError?:string;
  private generation=0;
  private validationGeneration=0;
  private help?:SyntaxHelpModal;
  private reloadOffer?:ReloadOfferModal;
  constructor(app:App,private readonly sieve:SievePlugin){super(app,sieve);this.icon='layers';}
  display():void {
    this.unsubscribe?.();this.visible=true;
    if(!this.hydrated)this.draft=this.sieve.draftSettings??defaultSettings();
    const text=locale(getLanguage()).settings;const container=this.containerEl;container.empty();container.addClass('sieve-settings');
    const heading=container.createEl('h2',{cls:'sieve-settings-heading'});
    setIcon(heading.createEl('span',{cls:'sieve-settings-icon',attr:{'aria-hidden':'true'}}),this.icon);
    heading.createEl('span',{text:text.title});
    const rulesSetting=new Setting(container).setName(text.rulesLabel).setDesc(text.rulesDescription).setClass('sieve-rules-setting');
    rulesSetting.descEl.setAttr('id','sieve-rules-description');
    rulesSetting.addTextArea(input=>{
      this.rules=input;input.setValue(this.draft.rules).setDisabled(this.saving).onChange(value=>this.edit({...this.draft,rules:value}));
      input.setPlaceholder(text.rulesPlaceholder);
      input.inputEl.setAttr('aria-label',text.rulesLabel);input.inputEl.setAttr('aria-describedby','sieve-rules-description sieve-settings-errors');input.inputEl.setAttr('spellcheck','false');input.inputEl.rows=12;input.inputEl.wrap='off';
      input.inputEl.addEventListener('focus',()=>input.setPlaceholder(''));
      input.inputEl.addEventListener('blur',event=>{
        input.setPlaceholder(text.rulesPlaceholder);
        // A native button click follows blur. Let Save validate authoritatively
        // instead of disabling the button before that first click can arrive.
        if(event.relatedTarget===this.saveButton?.buttonEl)return;
        return this.validateRules();
      });
    });
    this.errorsEl=rulesSetting.settingEl.createEl('div',{cls:'sieve-rule-errors',attr:{id:'sieve-settings-errors',role:'alert','aria-live':'assertive'}});
    const syntaxSetting=new Setting(container).setName(text.syntaxLabel).addButton(button=>button.setButtonText(text.openHelp).onClick(()=>{this.help?.close();this.help=new SyntaxHelpModal(this.app);this.help.open();}));
    syntaxSetting.descEl.addClass('sieve-syntax-examples');
    for(const example of Object.values(text.syntaxExamples)){
      const row=syntaxSetting.descEl.createEl('div',{cls:'sieve-syntax-example'});
      row.createEl('code',{text:example.rule,cls:'sieve-syntax-pattern'});if('description' in example)row.createEl('span',{text:example.description});
    }
    const nameSetting=new Setting(container).setName(text.displayNameLabel).setDesc(text.displayNameDescription).setClass('sieve-display-name-setting');
    nameSetting.descEl.setAttr('id','sieve-display-name-description');
    nameSetting.addText(input=>{
      this.displayName=input;input.setValue(this.draft.displayName).setPlaceholder(this.app.vault.getName()).setDisabled(this.saving).onChange(value=>this.edit({...this.draft,displayName:value}));input.inputEl.setAttr('aria-label',text.displayNameLabel);input.inputEl.setAttr('aria-describedby','sieve-display-name-description');
    });
    const saveSetting=new Setting(container).setName(text.statusLabel).addButton(button=>{this.saveButton=button;button.setButtonText(text.save).setCta().setDisabled(this.saving).onClick(()=>this.save());});
    this.statusEl=saveSetting.descEl;this.statusEl.addClass('sieve-status');this.statusEl.setAttr('role','status');this.statusEl.setAttr('aria-live','polite');this.statusEl.setAttr('aria-atomic','true');
    this.unsubscribe=this.sieve.subscribeStatus(()=>this.refresh());this.refresh();
  }
  private edit(draft:SieveSettings):void {
    if(this.saving||!this.visible||!this.hydrated||['loading','disposed'].includes(this.sieve.getStatus().status))return;
    this.validationGeneration++;this.draft=draft;this.saveError=undefined;this.validationError=undefined;this.dismissedStatusError=this.statusErrorKey();this.sieve.setDraftSettings(draft);this.refresh();
  }
  private statusErrorKey():string {const status=this.sieve.getStatus();return JSON.stringify([status.errorCode,status.diagnostics]);}
  private canSave():boolean {
    const status=this.sieve.getStatus();
    return this.visible&&this.hydrated&&!this.saving&&!['loading','disposed'].includes(status.status)&&!!this.sieve.draftSettings&&(this.sieve.needsSettingsRecovery||!sameSettings(this.sieve.savedSettings,this.draft))&&this.saveError?.code!=='rules'&&this.validationError?.code!=='rules';
  }
  private async validateRules():Promise<void> {
    if(this.saving||!this.visible||!this.hydrated||['loading','disposed'].includes(this.sieve.getStatus().status))return;
    const generation=++this.validationGeneration;const session=this.generation;const candidate=this.draft;
    try {
      const result=await this.sieve.validateSettings(candidate);
      if(!this.visible||this.saving||session!==this.generation||generation!==this.validationGeneration||!sameSettings(candidate,this.draft))return;
      this.saveError=undefined;this.validationError=result.ok?undefined:result.error;this.dismissedStatusError=this.statusErrorKey();this.refresh();
    }catch{
      if(this.visible&&!this.saving&&session===this.generation&&generation===this.validationGeneration){this.validationError={code:'read'};this.refresh();}
    }
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
        this.validationGeneration++;this.saveError=undefined;this.validationError=undefined;this.dismissedStatusError=undefined;this.draft=serviceDraft;this.displayedBaseline=serviceDraft;this.hydrated=true;this.rules?.setValue(this.draft.rules);this.displayName?.setValue(this.draft.displayName);
      }
      this.observedSaved=saved;
    }
    this.statusEl?.empty();for(const entry of statusEntries(status,this.sieve.savedSettings,this.draft,language))this.statusEl?.createEl('div',{text:entry.text,cls:entry.severity?`sieve-status-${entry.severity}`:undefined});
    const error=this.saveError??this.validationError??(status.errorCode&&this.dismissedStatusError!==this.statusErrorKey()?{code:status.errorCode,diagnostics:status.diagnostics}:undefined);
    this.errorsEl?.empty();if(error)for(const message of settingsErrorMessages(error,language))(error.code==='rules'?this.errorsEl:this.statusEl)?.createEl('div',{text:message,cls:'sieve-status-error'});
    this.rules?.inputEl.setAttr('aria-invalid',String(error?.code==='rules'));
    this.saveButton?.setDisabled(!this.canSave());
    this.rules?.setDisabled(blocked);this.displayName?.setDisabled(blocked);
  }
  private async save():Promise<void> {
    if(!this.canSave())return;
    this.validationGeneration++;this.saving=true;this.saveError=undefined;this.validationError=undefined;this.refresh();
    const candidate=this.draft;const generation=this.generation;
    try {
      const result=await this.sieve.saveSettings(candidate);
      if(!this.visible||generation!==this.generation||this.sieve.getStatus().status==='disposed')return;
      if(!result.ok){this.saveError=result.error;return;}
      this.displayedBaseline=candidate;
      if(!this.visible||this.sieve.getStatus().status==='disposed')return;
      new Notice(locale(getLanguage()).messages.saved);
      if(result.pending||this.sieve.getStatus().pendingReload){
        this.reloadOffer?.close();this.reloadOffer=new ReloadOfferModal(this.app,()=>this.sieve.reloadVault());this.reloadOffer.open();
      }
    }catch{if(this.visible&&generation===this.generation)this.saveError={code:'write'};}
    finally{
      this.saving=false;
      // Keep entered draft on errors. Controls were disabled during validation/write.
      if(generation===this.generation&&this.visible){if(!sameSettings(this.sieve.draftSettings,this.draft))this.sieve.setDraftSettings(this.draft);}
      else {this.hydrated=false;this.sieve.resetDraftSettings();}
      this.refresh();
    }
  }
  hide():void {
    this.visible=false;this.generation++;this.validationGeneration++;this.hydrated=false;this.saveError=undefined;this.validationError=undefined;this.dismissedStatusError=undefined;
    this.unsubscribe?.();this.unsubscribe=undefined;this.help?.close();this.help=undefined;this.reloadOffer?.close();this.reloadOffer=undefined;
    this.sieve.resetDraftSettings();this.draft=this.sieve.draftSettings??defaultSettings();this.displayedBaseline=this.draft;this.observedSaved=this.sieve.savedSettings;
  }
}
