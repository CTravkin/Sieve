function Assert-SievePackagePath {
    param(
        [Parameter(Mandatory=$true)][string]$RepositoryRoot,
        [Parameter(Mandatory=$true)][string]$Path,
        [switch]$AllowMissingLeaf
    )
    $sieveRootPath = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd([char[]]'\/')
    $sieveTargetPath = [IO.Path]::GetFullPath($Path)
    $sievePrefix = $sieveRootPath + [IO.Path]::DirectorySeparatorChar
    if (-not $sieveTargetPath.StartsWith($sievePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escapes repository' }
    $sieveRootItem = Get-Item -LiteralPath $sieveRootPath -Force -ErrorAction Stop
    if (-not $sieveRootItem.PSIsContainer -or ($sieveRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Package repository is not a physical directory' }
    $sieveParts = $sieveTargetPath.Substring($sievePrefix.Length).Split([char[]]'\/', [StringSplitOptions]::RemoveEmptyEntries)
    $sieveCurrentPath = $sieveRootPath
    for ($sievePartIndex = 0; $sievePartIndex -lt $sieveParts.Length; $sievePartIndex++) {
        $sieveCurrentPath = Join-Path $sieveCurrentPath $sieveParts[$sievePartIndex]
        $sieveLastPart = $sievePartIndex -eq $sieveParts.Length - 1
        if ($sieveLastPart -and $AllowMissingLeaf) {
            # Enumerate the verified parent so a dangling link is not mistaken for
            # an absent output. No entry is followed during this existence check.
            $sieveParentPath = [IO.Path]::GetDirectoryName($sieveCurrentPath)
            $sieveExists = $false
            foreach ($sieveEntryPath in [IO.Directory]::EnumerateFileSystemEntries($sieveParentPath)) {
                if ([IO.Path]::GetFileName($sieveEntryPath).Equals($sieveParts[$sievePartIndex], [StringComparison]::OrdinalIgnoreCase)) { $sieveExists = $true; break }
            }
            if (-not $sieveExists) { return $sieveTargetPath }
        }
        $sieveItem = Get-Item -LiteralPath $sieveCurrentPath -Force -ErrorAction Stop
        if ($sieveItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package path contains a reparse point' }
        if (-not $sieveLastPart -and -not $sieveItem.PSIsContainer) { throw 'Package parent is not a directory' }
    }
    return $sieveTargetPath
}
