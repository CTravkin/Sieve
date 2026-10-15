// SPDX-License-Identifier: MPL-2.0
import {nativeNormalize,joinPath} from '../core/normalize.ts';
import type {Platform} from '../core/types.ts';
// Exact Rl/Fl/xl projection from pinned Obsidian 1.14.4. This is an index key,
// never the input to the Syncthing matcher (NBSP and case must stay intact).
export function hostClean(path:string):string {return path.replace(/[\\/]+/g,'/').replace(/^\/+|\/+$/g,'')||'/';}
export function hostKey(path:string):string {return hostClean(path).replace(/[\u00a0\u202f]/g,' ').normalize('NFC');}
export function matchPath(path:string,platform:Platform):string {return nativeNormalize(joinPath(platform,hostClean(path)==='/'?'.':hostClean(path)),platform);}
export const parentPath=(path:string):string=>path.lastIndexOf('/')<0?'':path.slice(0,path.lastIndexOf('/'));
export const within=(path:string,root:string):boolean=>path===root||path.startsWith(root+'/');
