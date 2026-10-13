// Sieve's oracle executes the unchanged Syncthing v2.1.6 libraries.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"unicode"

	"github.com/syncthing/syncthing/lib/events"
	"github.com/syncthing/syncthing/lib/fs"
	"github.com/syncthing/syncthing/lib/ignore"
	"github.com/syncthing/syncthing/lib/scanner"
	"golang.org/x/text/unicode/norm"
)

const upstreamCommit = "4461a1ce354d3990660966ad70176e00246adb61"

type fixture struct {
	Name        string            `json:"name"`
	Rules       string            `json:"rules"`
	Files       map[string]string `json:"files"`
	Bytes       map[string][]byte `json:"bytes"`
	Paths       []string          `json:"paths"`
	Tree        []string          `json:"tree"`
	Basic       bool              `json:"basic"`
	Aliases     map[string]string `json:"aliases"`
	Permissions map[string]uint32 `json:"permissions"`
}

type matchResult struct {
	Path       string `json:"path"`
	Ignored    bool   `json:"ignored"`
	Deletable  bool   `json:"deletable"`
	CaseFolded bool   `json:"caseFolded"`
	CanSkipDir bool   `json:"canSkipDir"`
}

type scanResult struct {
	Files       []string `json:"files"`
	Directories []string `json:"directories"`
	Errors      []string `json:"errors"`
}

type output struct {
	Name           string         `json:"name"`
	UpstreamCommit string         `json:"upstreamCommit"`
	Profile        map[string]any `json:"profile"`
	Error          string         `json:"error,omitempty"`
	ParseError     bool           `json:"parseError,omitempty"`
	Matches        []matchResult  `json:"matches"`
	Patterns       []string       `json:"patterns,omitempty"`
	Lines          []string       `json:"lines,omitempty"`
	Hash           string         `json:"hash,omitempty"`
	Scan           *scanResult    `json:"scan,omitempty"`
}

func profile() map[string]any {
	return map[string]any{"os": runtime.GOOS, "arch": runtime.GOARCH, "go": runtime.Version(), "unicode": unicode.Version,
		"normalizationUnicode": norm.Version, "defaultCaseFold": runtime.GOOS == "windows" || runtime.GOOS == "darwin" || runtime.GOOS == "ios"}
}

func run(f fixture) output {
	o := output{Name: f.Name, UpstreamCommit: upstreamCommit, Profile: profile(), Matches: []matchResult{}}
	base, err := os.MkdirTemp(os.Getenv("SIEVE_ORACLE_TEMP"), "fixture-")
	if err != nil {
		o.Error = err.Error()
		return o
	}
	defer os.RemoveAll(base) // Only this process's generated fixture directory.
	root := filepath.Join(base, "vault")
	if err = os.Mkdir(root, 0o700); err != nil {
		o.Error = err.Error()
		return o
	}
	var filesystem fs.Filesystem
	if f.Basic || f.Tree != nil {
		filesystem = fs.NewFilesystem(fs.FilesystemTypeBasic, root)
	} else {
		filesystem = fs.NewFilesystem(fs.FilesystemTypeFake, base+"?content=true&nostfolder=true")
	}
	expand := func(s string) string {
		return strings.NewReplacer("{{root}}", root, "{{outside}}", base).Replace(s)
	}
	var sandbox *fixtureSandbox
	aliases := []fixtureAlias{}
	if f.Basic || f.Tree != nil {
		sandbox, err = newFixtureSandbox(base, root)
		if err != nil {
			o.Error = err.Error()
			return o
		}
		defer sandbox.root.Close()
		planned := map[string]bool{}
		for name, target := range f.Aliases {
			a, e := sandbox.alias(expand(name), expand(target))
			if e != nil {
				o.Error = e.Error()
				return o
			}
			aliases = append(aliases, a)
			planned[a.name] = true
		}
		for _, alias := range aliases {
			if err = sandbox.rejectSymlinks(filepath.Dir(alias.name), planned); err != nil {
				o.Error = err.Error()
				return o
			}
		}
		for name := range f.Permissions {
			rel, e := sandbox.relative(expand(name))
			if e == nil {
				e = sandbox.rejectSymlinks(rel, planned)
			}
			if e != nil {
				o.Error = e.Error()
				return o
			}
		}
	}
	write := func(name string, data []byte) error {
		name = expand(name)
		if sandbox != nil {
			return sandbox.write(name, data)
		}
		if e := filesystem.MkdirAll(filepath.Dir(name), 0o700); e != nil {
			return e
		}
		return fs.WriteFile(filesystem, name, data, 0o600)
	}
	for name, text := range f.Files {
		if err = write(name, []byte(expand(text))); err != nil {
			o.Error = err.Error()
			return o
		}
	}
	for name, data := range f.Bytes {
		if err = write(name, data); err != nil {
			o.Error = err.Error()
			return o
		}
	}
	for _, name := range f.Tree {
		if err = write(name, []byte("synthetic oracle fixture\n")); err != nil {
			o.Error = err.Error()
			return o
		}
	}
	if sandbox != nil {
		for _, alias := range aliases {
			if err = sandbox.createAlias(alias); err != nil {
				o.Error = err.Error()
				return o
			}
		}
	} else {
		for name, target := range f.Aliases {
			if err = filesystem.CreateSymlink(expand(target), expand(name)); err != nil {
				o.Error = err.Error()
				return o
			}
		}
	}
	for name, mode := range f.Permissions {
		if sandbox != nil {
			err = sandbox.chmod(expand(name), mode)
		} else {
			err = filesystem.Chmod(expand(name), fs.FileMode(mode))
		}
		if err != nil {
			o.Error = err.Error()
			return o
		}
	}
	m := ignore.New(filesystem)
	err = m.Parse(bytes.NewBufferString(expand(f.Rules)), ".stignore")
	if err != nil {
		o.Error = err.Error()
		o.ParseError = ignore.IsParseError(err)
		return o
	}
	o.Patterns = m.Patterns()
	o.Lines = m.Lines()
	o.Hash = m.Hash()
	for _, p := range f.Paths {
		r := m.Match(filepath.FromSlash(p))
		o.Matches = append(o.Matches, matchResult{p, r.IsIgnored(), r.IsDeletable(), r.IsCaseFolded(), r.CanSkipDir()})
	}
	if f.Tree != nil {
		o.Scan = &scanResult{Files: []string{}, Directories: []string{}, Errors: []string{}}
		for r := range scanner.WalkWithoutHashing(context.Background(), scanner.Config{Folder: "oracle", Filesystem: filesystem, Matcher: m, IgnorePerms: true, ProgressTickIntervalS: -1, EventLogger: events.NoopLogger}) {
			if r.Err != nil {
				o.Scan.Errors = append(o.Scan.Errors, r.Err.Error())
				continue
			}
			if r.File.IsIgnored() {
				continue
			}
			if r.File.IsDirectory() {
				o.Scan.Directories = append(o.Scan.Directories, filepath.ToSlash(r.File.Name))
			} else {
				o.Scan.Files = append(o.Scan.Files, filepath.ToSlash(r.File.Name))
			}
		}
		sort.Strings(o.Scan.Files)
		sort.Strings(o.Scan.Directories)
		sort.Strings(o.Scan.Errors)
	}
	return o
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "unicode-normalization" {
		decompositions := map[int32][]int32{}
		combining := map[int32]uint8{}
		streamSafe := [][3]int32{}
		compositions := map[[2]int32]int32{}
		for r := rune(0); r <= unicode.MaxRune; r++ {
			if r >= 0xd800 && r <= 0xdfff {
				continue
			}
			s := string(r)
			properties := reflect.ValueOf(norm.NFD.PropertiesString(s))
			lead := int32(properties.FieldByName("nLead").Uint())
			trail := int32(properties.FieldByName("flags").Uint() & 3)
			if (lead != 0 || trail != 0) && !(r >= 0xac00 && r <= 0xd7a3) {
				streamSafe = append(streamSafe, [3]int32{r, lead, trail})
			}
			if ccc := norm.NFD.PropertiesString(s).CCC(); ccc != 0 {
				combining[r] = ccc
			}
			if r >= 0xac00 && r <= 0xd7a3 {
				continue
			} // Hangul uses the standard algorithm.
			d := []rune(norm.NFD.String(s))
			if string(d) == s {
				continue
			}
			decompositions[r] = d
			if norm.NFC.String(s) != s {
				continue
			} // Canonical composition exclusions.
			for i := 1; i < len(d); i++ {
				prefix := []rune(norm.NFC.String(string(d[:i])))
				joined := []rune(norm.NFC.String(string(d[:i+1])))
				if len(prefix) == 1 && len(joined) == 1 {
					compositions[[2]int32{prefix[0], d[i]}] = joined[0]
				}
			}
		}
		dec := [][2]any{}
		ccc := [][2]int32{}
		comp := [][3]int32{}
		for cp, ds := range decompositions {
			dec = append(dec, [2]any{cp, ds})
		}
		for cp, value := range combining {
			ccc = append(ccc, [2]int32{cp, int32(value)})
		}
		for pair, cp := range compositions {
			comp = append(comp, [3]int32{pair[0], pair[1], cp})
		}
		sort.Slice(dec, func(i, j int) bool { return dec[i][0].(int32) < dec[j][0].(int32) })
		sort.Slice(ccc, func(i, j int) bool { return ccc[i][0] < ccc[j][0] })
		sort.Slice(comp, func(i, j int) bool {
			return comp[i][0] < comp[j][0] || (comp[i][0] == comp[j][0] && comp[i][1] < comp[j][1])
		})
		json.NewEncoder(os.Stdout).Encode(map[string]any{"unicode": norm.Version, "decompositions": dec, "combining": ccc, "compositions": comp, "streamSafe": streamSafe})
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "normalize" {
		var samples []string
		if err := json.NewDecoder(os.Stdin).Decode(&samples); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		results := []map[string]string{}
		for _, s := range samples {
			results = append(results, map[string]string{"NFC": norm.NFC.String(s), "NFD": norm.NFD.String(s)})
		}
		json.NewEncoder(os.Stdout).Encode(results)
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "unicode-lower" {
		pairs := [][2]int32{}
		for r := rune(0); r <= unicode.MaxRune; r++ {
			if l := unicode.ToLower(r); l != r {
				pairs = append(pairs, [2]int32{r, l})
			}
		}
		json.NewEncoder(os.Stdout).Encode(map[string]any{"unicode": unicode.Version, "pairs": pairs})
		return
	}
	var fixtures []fixture
	if err := json.NewDecoder(os.Stdin).Decode(&fixtures); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	outputs := make([]output, 0, len(fixtures))
	for _, f := range fixtures {
		outputs = append(outputs, run(f))
	}
	if err := json.NewEncoder(os.Stdout).Encode(outputs); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
