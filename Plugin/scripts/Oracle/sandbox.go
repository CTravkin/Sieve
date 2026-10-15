// SPDX-License-Identifier: MPL-2.0
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Root-bound mutations prevent ancestor symlinks from escaping even between
// validation and the operation. Alias names and permission paths never traverse
// symlinks; readable aliases may target another location inside this own base.
type fixtureSandbox struct {
	base  string
	vault string
	root  *os.Root
}

type fixtureAlias struct{ name, target string }

func newFixtureSandbox(base, vault string) (*fixtureSandbox, error) {
	r, err := os.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	return &fixtureSandbox{base: base, vault: vault, root: r}, nil
}

func (s *fixtureSandbox) relative(name string) (string, error) {
	if !filepath.IsAbs(name) {
		name = filepath.Join(s.vault, name)
	}
	rel, err := filepath.Rel(s.base, filepath.Clean(name))
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("fixture path escapes generated sandbox")
	}
	return rel, nil
}

func (s *fixtureSandbox) rejectSymlinks(name string, planned map[string]bool) error {
	parts := strings.Split(name, string(os.PathSeparator))
	current := ""
	for _, part := range parts {
		current = filepath.Join(current, part)
		if planned[current] {
			return fmt.Errorf("symlink permission or alias ancestor is forbidden in sandbox")
		}
		info, err := s.root.Lstat(current)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return fmt.Errorf("sandbox path validation: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink permission or alias ancestor is forbidden in sandbox")
		}
	}
	return nil
}

func (s *fixtureSandbox) alias(name, target string) (fixtureAlias, error) {
	rel, err := s.relative(name)
	if err != nil {
		return fixtureAlias{}, err
	}
	parent := filepath.Join(s.base, filepath.Dir(rel))
	if !filepath.IsAbs(target) {
		target = filepath.Join(parent, target)
	}
	targetRel, err := s.relative(target)
	if err != nil {
		return fixtureAlias{}, err
	}
	if _, err = s.root.Stat(targetRel); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fixtureAlias{}, fmt.Errorf("sandbox alias target validation: %w", err)
	}
	linkTarget, err := filepath.Rel(parent, filepath.Join(s.base, targetRel))
	if err != nil {
		return fixtureAlias{}, fmt.Errorf("sandbox alias target: %w", err)
	}
	return fixtureAlias{name: rel, target: linkTarget}, nil
}

func (s *fixtureSandbox) write(name string, contents []byte) error {
	rel, err := s.relative(name)
	if err != nil {
		return err
	}
	if err = s.root.MkdirAll(filepath.Dir(rel), 0o700); err != nil {
		return fmt.Errorf("sandbox directory: %w", err)
	}
	if err = s.root.WriteFile(rel, contents, 0o600); err != nil {
		return fmt.Errorf("sandbox write: %w", err)
	}
	return nil
}

func (s *fixtureSandbox) createAlias(alias fixtureAlias) error {
	if err := s.rejectSymlinks(alias.name, nil); err != nil {
		return err
	}
	if err := s.root.MkdirAll(filepath.Dir(alias.name), 0o700); err != nil {
		return fmt.Errorf("sandbox alias parent: %w", err)
	}
	if err := s.root.Symlink(alias.target, alias.name); err != nil {
		return err
	}
	return nil
}

func (s *fixtureSandbox) chmod(name string, mode uint32) error {
	rel, err := s.relative(name)
	if err != nil {
		return err
	}
	if err = s.rejectSymlinks(rel, nil); err != nil {
		return err
	}
	if err = s.root.Chmod(rel, os.FileMode(mode)); err != nil {
		return fmt.Errorf("sandbox chmod: %w", err)
	}
	return nil
}
