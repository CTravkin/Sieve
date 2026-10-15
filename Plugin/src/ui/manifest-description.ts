// SPDX-License-Identifier: MPL-2.0
import type {PluginManifest} from 'obsidian';
import {locale} from '../i18n/index.ts';

/** The installed-plugin list reads the loaded manifest; keep its file unchanged. */
export function localizeManifestDescription(manifest:Pick<PluginManifest,'description'>|undefined,language:()=>string):()=>void {
  if(!manifest)return()=>{};
  const original=Object.getOwnPropertyDescriptor(manifest,'description');
  if(!original?.configurable || !('value' in original) || !original.writable)return()=>{};
  const get=()=>locale(language()).settings.description;
  const set=(value:string)=>Object.defineProperty(manifest,'description',{...original,value});
  Object.defineProperty(manifest,'description',{configurable:true,enumerable:original.enumerable,get,set});
  return()=>{if(Object.getOwnPropertyDescriptor(manifest,'description')?.get===get)Object.defineProperty(manifest,'description',original);};
}
