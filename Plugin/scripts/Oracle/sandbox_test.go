// SPDX-License-Identifier: MPL-2.0
package main

import (
	"crypto/sha256"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExistingAncestorCannotMutateOwnExternalSentinel(t *testing.T) {
	temporary := os.Getenv("SIEVE_ORACLE_TEMP")
	if temporary == "" {
		temporary = filepath.Join("..", "..", "Local", ".temp", "Oracle")
	}
	temporary, err := filepath.Abs(temporary)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(temporary, 0o700); err != nil {
		t.Fatal(err)
	}
	owned, err := os.MkdirTemp(temporary, "sandbox-native-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		rel, e := filepath.Rel(temporary, owned)
		if e != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			t.Error("refusing cleanup outside own temporary root")
			return
		}
		os.RemoveAll(owned)
	})
	base := filepath.Join(owned, "base")
	vault := filepath.Join(base, "vault")
	outside := filepath.Join(owned, "outside")
	if err = os.MkdirAll(vault, 0o700); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(outside, "sentinel.txt")
	contents := []byte("Own synthetic ancestor-symlink regression\n")
	if err = os.WriteFile(sentinel, contents, 0o640); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(vault, "escape")
	if err = os.Symlink(outside, link); err != nil {
		if os.IsPermission(err) || strings.Contains(err.Error(), "privilege") {
			t.Skip("native symlink creation unavailable; platform-independent plan guard is tested in Node")
		}
		t.Fatal(err)
	}
	sandbox, err := newFixtureSandbox(base, vault)
	if err != nil {
		t.Fatal(err)
	}
	defer sandbox.root.Close()
	if err = sandbox.write("escape/sentinel.txt", []byte("must not replace")); err == nil {
		t.Fatal("outside ancestor write succeeded")
	}
	if err = sandbox.chmod("escape/sentinel.txt", 0); err == nil {
		t.Fatal("outside ancestor chmod succeeded")
	}
	alias, err := sandbox.alias("escape/alias", "../common")
	if err == nil {
		err = sandbox.createAlias(alias)
	}
	if err == nil {
		t.Fatal("alias created through outside ancestor")
	}
	after, err := os.Stat(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	if after.Mode().Perm() != before.Mode().Perm() {
		t.Fatal("own external sentinel mode changed")
	}
	actual, err := os.ReadFile(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	if sha256.Sum256(actual) != sha256.Sum256(contents) {
		t.Fatal("own external sentinel content changed")
	}
}
