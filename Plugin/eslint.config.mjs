// SPDX-License-Identifier: MPL-2.0
import obsidianmd from 'eslint-plugin-obsidianmd';

// Match the directory scanner's advisory severities and documented exclusions.
// Directive restrictions remain errors so a suppressed warning cannot block a release.
const blocking=new Set(['no-eval','no-implied-eval','no-unsanitized/method','no-unsanitized/property','obsidianmd/regex-lookbehind','obsidianmd/no-forbidden-elements']);
const recommended=obsidianmd.configs.recommended.map(config=>({...config,...(config.rules?{rules:Object.fromEntries(Object.entries(config.rules).map(([name,value])=>{
  const options=Array.isArray(value)?value:[value];
  const enabled=options[0]!=='off'&&options[0]!==0;
  return [name,enabled&&!blocking.has(name)&&!name.startsWith('eslint-comments/')?['warn',...options.slice(1)]:value];
}))}:{})}));

export default [
  ...recommended,
  {
    files:['Plugin/src/**/*.ts'],
    languageOptions:{parserOptions:{project:'./tsconfig.json',tsconfigRootDir:import.meta.dirname}},
    rules:{
      'no-undef':'off',
      '@typescript-eslint/no-unsafe-member-access':'off',
      '@typescript-eslint/no-unsafe-assignment':'off',
      '@typescript-eslint/no-unsafe-argument':'off',
      '@typescript-eslint/no-unsafe-call':'off',
      '@typescript-eslint/no-unsafe-return':'off',
      '@typescript-eslint/restrict-template-expressions':'off',
      '@typescript-eslint/no-base-to-string':'off',
      'import/no-unresolved':'off',
      'obsidianmd/validate-manifest':'off',
      'obsidianmd/validate-license':'off',
      'obsidianmd/commands/no-command-in-command-id':'off',
      'obsidianmd/commands/no-plugin-id-in-command-id':'off',
    },
  },
];
