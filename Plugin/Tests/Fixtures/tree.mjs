// SPDX-License-Identifier: MPL-2.0
export function projectTree(matcher, files, prune) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    while (parts.length > 1) { parts.pop(); directories.add(parts.join('/')); }
  }
  const skipped = []; const seen = []; const allowed = [];
  const walk = parent => {
    const prefix = parent ? parent + '/' : '';
    const children = [...directories, ...files].filter(p => p.startsWith(prefix) && !p.slice(prefix.length).includes('/')).sort();
    for (const child of children) {
      const result = matcher.match(child); seen.push(child);
      if (directories.has(child)) {
        if (prune && result.canSkipDir) { skipped.push(child); continue; }
        walk(child);
      } else if (!result.ignored) allowed.push(child);
    }
  };
  walk('');
  const containers = new Set();
  for (const file of allowed) {
    let p = file;
    while (p.includes('/')) { p = p.slice(0,p.lastIndexOf('/')); containers.add(p); }
  }
  return { files: allowed.sort(), containers: [...containers].sort(), skipped, seen };
}
