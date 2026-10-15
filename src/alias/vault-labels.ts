import type {VaultLabel} from './contracts.ts';

export function labels(items:readonly VaultLabel[]):boolean {return items.every(item=>item && typeof item.path==='string' && typeof item.name==='string' && typeof item.isCurrentVault==='boolean');}

/** Display names may change; native order, paths, IDs and current-vault flags may not. */
export function sameVaults(latest:readonly VaultLabel[]|undefined,expected:readonly VaultLabel[]):boolean {
  return !!latest && latest.length===expected.length && latest.every((vault,index)=>vault.path===expected[index].path && vault.id===expected[index].id && vault.isCurrentVault===expected[index].isCurrentVault);
}
